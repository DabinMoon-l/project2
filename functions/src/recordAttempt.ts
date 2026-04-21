/**
 * recordAttempt - 퀴즈 제출 서버 처리
 *
 * 클라이언트가 직접 quizzes/{quizId} 문서를 업데이트하던 기존 방식 대신,
 * 서버에서 채점 + 결과 저장 + 통계 분산 쓰기를 일괄 처리합니다.
 *
 * Write 분산:
 * - quizResults/{auto-id}: 1 write (append-only, 기존 트리거 발동)
 * - quiz_completions/{quizId}_{userId}: 1 write (set merge)
 * - quiz_agg/{quizId}/shards/{N}: 1 write (분산 카운터)
 * - reviews: N~2N writes (배치)
 *
 * quizzes/{quizId} 문서에는 직접 write하지 않음 → hotspot 제거
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { incrementShard, getShardedTotal } from "./utils/shardedCounter";
import { checkRateLimitV2 } from "./utils/rateLimitV2";
import { gradeQuestion, UserAnswer, GradeableQuestion } from "./utils/gradeQuestion";
import {
  SUPABASE_URL_SECRET,
  SUPABASE_SERVICE_ROLE_SECRET,
  DEFAULT_ORG_ID_SECRET,
  supabaseDualWriteQuizResult,
  supabaseDualUpsertCompletion,
  supabaseDualUpsertUserScore,
} from "./utils/supabase";

/** Firestore 퀴즈 문제 (채점 가능 필드 + 메타데이터) */
interface QuizQuestion extends GradeableQuestion {
  id?: string;
  [key: string]: unknown;
}

const db = getFirestore();

// ─── 타입 정의 ───

interface RecordAttemptInput {
  quizId: string;
  answers: UserAnswer[];
  attemptNo?: number;
}

interface QuestionScore {
  isCorrect: boolean;
  userAnswer: string;
  correctAnswer: string;
  answeredAt: FirebaseFirestore.FieldValue;
}

// ─── 메인 함수 ───

export const recordAttempt = onCall(
  {
    region: "asia-northeast3",
    memory: "1GiB",
    timeoutSeconds: 60,
    maxInstances: 200,
    minInstances: 1,
    concurrency: 250,
    secrets: [
      SUPABASE_URL_SECRET,
      SUPABASE_SERVICE_ROLE_SECRET,
      DEFAULT_ORG_ID_SECRET,
    ],
  },
  async (request) => {
    // 인증 확인
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }
    const userId = request.auth.uid;
    const { quizId, answers } = request.data as RecordAttemptInput;

    if (!quizId || !answers || !Array.isArray(answers)) {
      throw new HttpsError("invalid-argument", "quizId와 answers 배열이 필요합니다.");
    }

    // ── ① Rate limit ──
    try {
      await checkRateLimitV2(userId, "quiz-submit");
    } catch (e: unknown) {
      throw new HttpsError("resource-exhausted", e instanceof Error ? e.message : "요청 제한 초과");
    }

    // ── ②-a 제출 락 (동시 중복 제출 방지) ──
    const lockRef = db.doc(`quiz_submit_locks/${userId}_${quizId}`);
    try {
      await db.runTransaction(async (tx) => {
        const lockDoc = await tx.get(lockRef);
        if (lockDoc.exists) {
          const data = lockDoc.data()!;
          // 60초 이내 중복 제출 차단
          if (data.lockedAt && Date.now() - data.lockedAt < 60_000) {
            throw new Error("SUBMIT_LOCKED");
          }
        }
        tx.set(lockRef, { userId, quizId, lockedAt: Date.now() });
      });
    } catch (e: unknown) {
      if (e instanceof Error && e.message === "SUBMIT_LOCKED") {
        // 이미 처리된 결과가 있으면 반환
        const existingResult = await db
          .collection("quizResults")
          .where("userId", "==", userId)
          .where("quizId", "==", quizId)
          .orderBy("createdAt", "desc")
          .limit(1)
          .get();
        if (!existingResult.empty) {
          const d = existingResult.docs[0].data();
          return {
            alreadySubmitted: true,
            resultId: existingResult.docs[0].id,
            score: d.score,
            correctCount: d.correctCount,
            totalCount: d.totalCount,
          };
        }
        throw new HttpsError("already-exists", "이미 제출 처리 중입니다. 잠시 후 다시 시도해주세요.");
      }
      throw e;
    }

    // ── ②-b attemptNo + 퀴즈 로드 + 유저 반 정보 — 병렬 조회 ──
    const [prevAttempts, quizDoc, userDoc] = await Promise.all([
      db.collection("quizResults")
        .where("userId", "==", userId)
        .where("quizId", "==", quizId)
        .count()
        .get(),
      db.doc(`quizzes/${quizId}`).get(),
      db.doc(`users/${userId}`).get(),
    ]);
    const userClassId = userDoc.exists ? userDoc.data()?.classId || null : null;
    const attemptNo = prevAttempts.data().count + 1;

    // ── ③ Idempotency 검사 (락 통과 후에도 2차 확인) ──
    const attemptKey = `${userId}_${quizId}_${attemptNo}`;
    const existingSnap = await db
      .collection("quizResults")
      .where("attemptKey", "==", attemptKey)
      .limit(1)
      .get();

    if (!existingSnap.empty) {
      // 락 해제
      await lockRef.delete().catch(() => {});
      const existingData = existingSnap.docs[0].data();
      return {
        alreadySubmitted: true,
        resultId: existingSnap.docs[0].id,
        score: existingData.score,
        correctCount: existingData.correctCount,
        totalCount: existingData.totalCount,
      };
    }

    // ── ③ 퀴즈 검증 (이미 위에서 병렬 로드됨) ──
    if (!quizDoc.exists) {
      throw new HttpsError("not-found", "퀴즈를 찾을 수 없습니다.");
    }
    const quizData = quizDoc.data()!;

    // 비공개 퀴즈 제출 차단 (본인 퀴즈는 허용)
    const isCreator = quizData.creatorId === userId || quizData.creatorUid === userId;
    if (!isCreator && (quizData.isPublished === false || quizData.isPublic === false)) {
      throw new HttpsError("permission-denied", "이 퀴즈는 현재 비공개 상태입니다.");
    }

    const questions: QuizQuestion[] = quizData.questions || [];

    if (questions.length === 0) {
      throw new HttpsError("failed-precondition", "문제가 없는 퀴즈입니다.");
    }

    // ── ④ 서버 채점 ──
    let correctCount = 0;
    const questionScores: Record<string, QuestionScore> = {};
    const answersArr: string[] = [];

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const qId = q.id || `q${i}`;
      const userAns = answers.find((a) => a.questionId === qId);

      const { isCorrect, userAnswerStr, correctAnswerStr } = gradeQuestion(q, userAns, i);

      // 서술형은 채점 제외
      if (q.type !== "essay" && isCorrect) correctCount++;

      questionScores[qId] = {
        isCorrect,
        userAnswer: userAnswerStr,
        correctAnswer: correctAnswerStr,
        answeredAt: FieldValue.serverTimestamp(),
      };

      answersArr.push(userAnswerStr);
    }

    // 서술형 제외 총 문제 수
    const totalCount = questions.filter((q) => q.type !== "essay").length;
    const score = totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0;

    // ── ⑤ quizResults 생성 (append-only log) ──
    // → 기존 onQuizComplete 트리거 (EXP 지급)
    // → 기존 updateQuizStatistics 트리거 (문제별 통계)
    const resultRef = await db.collection("quizResults").add({
      attemptKey,
      userId,
      quizId,
      quizTitle: quizData.title || "",
      quizCreatorId: quizData.creatorId || null,
      quizType: quizData.type || null,
      quizIsPublic: quizData.isPublic ?? false,
      score,
      correctCount,
      totalCount,
      earnedExp: correctCount * 10,
      answers: answersArr,
      questionScores,
      gradedOnServer: true,
      reviewsGenerated: false,
      isUpdate: attemptNo > 1,
      courseId: quizData.courseId || null,
      classId: userClassId,
      createdAt: FieldValue.serverTimestamp(),
    });

    // ⑤-b Supabase dual-write (quiz_results)
    supabaseDualWriteQuizResult({
      firestoreId: resultRef.id,
      firestoreQuizId: quizId,
      userId,
      score,
      correctCount,
      totalCount,
      answers: answersArr,
      attemptNo,
      attemptKey,
      createdAt: new Date(),
    }).catch((e) => console.warn("[Supabase quiz_result dual-write] 실패:", e));

    // ── ⑥ quiz_completions + 분산 카운터 + 이전 점수 조회 — 병렬 처리 ──
    const completionDocId = `${quizId}_${userId}`;

    // 재시도 시 이전 점수 필요 → 완료 문서 & 분산카운터 동시에 처리
    const prevCompletionPromise = attemptNo > 1
      ? db.doc(`quiz_completions/${completionDocId}`).get()
      : Promise.resolve(null);

    const shardPromise = attemptNo <= 1
      ? incrementShard(`quiz_agg/${quizId}`, { count: 1, scoreSum: score })
      : Promise.resolve();

    const completionWritePromise = db.doc(`quiz_completions/${completionDocId}`).set(
      {
        quizId,
        userId,
        courseId: quizData.courseId || null,
        score,
        correctCount,
        totalCount,
        attemptNo,
        completedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // Supabase dual-write (quiz_completions) — Firestore 쓰기와 병렬
    supabaseDualUpsertCompletion(quizId, userId, {
      bestScore: score,
      completedAt: new Date(),
    }).catch((e) => console.warn("[Supabase quiz_completion dual-write] 실패:", e));

    // 3개 병렬 실행
    const [prevCompletionDoc] = await Promise.all([
      prevCompletionPromise,
      shardPromise,
      completionWritePromise,
    ]);

    const prevCompletionScore = prevCompletionDoc?.exists
      ? (prevCompletionDoc.data()?.score || 0)
      : 0;

    // ── ⑧ quizzes 문서 참여자/평균점수 + users quizStats — 병렬 실행 (반드시 완료 대기) ──
    // CF 반환 전에 완료해야 averageScore/participantCount 누락 방지
    const quizStatsPromise = (async () => {
      try {
        const { count: participantCount, scoreSum: aggScoreSum } = await getShardedTotal(`quiz_agg/${quizId}`);
        const averageScore = participantCount > 0
          ? Math.round((aggScoreSum / participantCount) * 10) / 10
          : 0;

        await db.doc(`quizzes/${quizId}`).update({
          [`userScores.${userId}`]: score,
          participantCount,
          averageScore,
          updatedAt: FieldValue.serverTimestamp(),
        });

        // Supabase dual-write: user_scores[userId]=score + participant_count + average_score
        await supabaseDualUpsertUserScore(quizId, userId, score, {
          participantCount,
          averageScore,
        });
      } catch (e) {
        db.doc(`quizzes/${quizId}`).update({
          [`userScores.${userId}`]: score,
          updatedAt: FieldValue.serverTimestamp(),
        }).catch(() => {});
        // Supabase 도 최소한 userScores 만 갱신
        supabaseDualUpsertUserScore(quizId, userId, score).catch(() => {});
        console.warn(`quizzes/${quizId} 통계 업데이트 실패 (무시 가능):`, e);
      }
    })();

    // ── ⑩ users/{uid}.quizStats — 트랜잭션으로 원자적 갱신 ──
    const userStatsPromise = (async () => {
      try {
        const scoreDiff = attemptNo <= 1 ? score : (score - prevCompletionScore);
        const isFirstAttempt = attemptNo <= 1;

        await db.runTransaction(async (tx) => {
          const userDoc = await tx.get(db.doc(`users/${userId}`));
          const qs = userDoc.data()?.quizStats || {};

          const newScoreSum = (qs.totalScoreSum || 0) + scoreDiff;
          const newAttempts = (qs.totalAttempts || 0) + (isFirstAttempt ? 1 : 0);
          const newAvg = newAttempts > 0 ? Math.round(newScoreSum / newAttempts) : 0;

          tx.update(db.doc(`users/${userId}`), {
            "quizStats.totalScoreSum": newScoreSum,
            "quizStats.totalAttempts": newAttempts,
            "quizStats.averageScore": newAvg,
            "quizStats.lastAttemptAt": FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
        });
      } catch (e) {
        console.warn(`users/${userId} quizStats 갱신 실패 (무시 가능):`, e);
      }
    })();

    // ── ⑨ reviews 생성은 generateReviewsOnResult 트리거에서 비동기 처리 ──

    // 통계 업데이트: 반드시 완료 대기 (fire-and-forget → await 변경)
    // CF가 반환 후 런타임 종료 시 미완료 Promise가 드랍되어 averageScore 누락 발생
    await Promise.all([quizStatsPromise, userStatsPromise]).catch((e) =>
      console.warn("통계 업데이트 실패 (무시 가능):", e)
    );

    // 제출 락 해제 (통계 완료 후)
    lockRef.delete().catch(() => {});

    console.log(
      `퀴즈 제출 처리 완료: userId=${userId}, quizId=${quizId}, ` +
      `score=${score}, correctCount=${correctCount}/${totalCount}`
    );

    return {
      resultId: resultRef.id,
      score,
      correctCount,
      totalCount,
      questionScores,
    };
  }
);
