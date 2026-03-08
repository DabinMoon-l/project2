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
import { gradeQuestion, UserAnswer } from "./utils/gradeQuestion";

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
    memory: "512MiB",
    timeoutSeconds: 60,
    maxInstances: 100,
    minInstances: 1,
    concurrency: 80,
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
    } catch (e: any) {
      throw new HttpsError("resource-exhausted", e.message);
    }

    // ── ② attemptNo를 서버에서 계산 (클라이언트 조작 방지) ──
    const prevAttempts = await db
      .collection("quizResults")
      .where("userId", "==", userId)
      .where("quizId", "==", quizId)
      .count()
      .get();
    const attemptNo = prevAttempts.data().count + 1;

    // ── ③ Idempotency 검사 ──
    const attemptKey = `${userId}_${quizId}_${attemptNo}`;
    const existingSnap = await db
      .collection("quizResults")
      .where("attemptKey", "==", attemptKey)
      .limit(1)
      .get();

    if (!existingSnap.empty) {
      const existingData = existingSnap.docs[0].data();
      return {
        alreadySubmitted: true,
        resultId: existingSnap.docs[0].id,
        score: existingData.score,
        correctCount: existingData.correctCount,
        totalCount: existingData.totalCount,
      };
    }

    // ── ③ 퀴즈 로드 ──
    const quizDoc = await db.doc(`quizzes/${quizId}`).get();
    if (!quizDoc.exists) {
      throw new HttpsError("not-found", "퀴즈를 찾을 수 없습니다.");
    }
    const quizData = quizDoc.data()!;

    // 비공개 퀴즈 제출 차단 (본인 퀴즈는 허용)
    const isCreator = quizData.creatorId === userId || quizData.creatorUid === userId;
    if (!isCreator && (quizData.isPublished === false || quizData.isPublic === false)) {
      throw new HttpsError("permission-denied", "이 퀴즈는 현재 비공개 상태입니다.");
    }

    const questions: any[] = quizData.questions || [];

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
    const totalCount = questions.filter((q: any) => q.type !== "essay").length;
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
      classId: quizData.classId || null,
      createdAt: FieldValue.serverTimestamp(),
    });

    // ── ⑥ quiz_completions (completedUsers 배열 대체) ──
    const completionDocId = `${quizId}_${userId}`;

    // 재시도 시 이전 점수 조회 (덮어쓰기 전)
    let prevCompletionScore = 0;
    if (attemptNo > 1) {
      const prevCompletion = await db.doc(`quiz_completions/${completionDocId}`).get();
      if (prevCompletion.exists) {
        prevCompletionScore = prevCompletion.data()?.score || 0;
      }
    }

    await db.doc(`quiz_completions/${completionDocId}`).set(
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

    // ── ⑦ 분산 카운터 (quiz_agg) ──
    // 첫 번째 시도일 때만 count 증가 (재시도는 점수만 업데이트)
    if (attemptNo <= 1) {
      await incrementShard(`quiz_agg/${quizId}`, {
        count: 1,
        scoreSum: score,
      });
    }

    // ── ⑧ quizzes 문서 참여자/평균점수 업데이트 ──
    // 분산 카운터(quiz_agg)에서 합산값 조회 (quiz_completions 전체 조회 대신)
    try {
      const { count: participantCount, scoreSum } = await getShardedTotal(`quiz_agg/${quizId}`);
      const averageScore = participantCount > 0
        ? Math.round((scoreSum / participantCount) * 10) / 10
        : 0;

      await db.doc(`quizzes/${quizId}`).update({
        [`userScores.${userId}`]: score,
        participantCount,
        averageScore,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (e) {
      // 실패해도 무방 — 다음 제출 시 재계산
      db.doc(`quizzes/${quizId}`).update({
        [`userScores.${userId}`]: score,
        updatedAt: FieldValue.serverTimestamp(),
      }).catch(() => {});
      console.warn(`quizzes/${quizId} 통계 업데이트 실패 (무시 가능):`, e);
    }

    // ── ⑨ reviews 생성은 generateReviewsOnResult 트리거에서 비동기 처리 ──

    // ── ⑩ users/{uid}.quizStats 증분 갱신 + averageScore 계산 ──
    // totalScoreSum: 퀴즈별 점수(0~100) 합계 — averageScore = totalScoreSum / totalAttempts
    // 재시도 시 점수 차이만큼 조정 (퀴즈당 최신 점수만 반영)
    try {
      const scoreDiff = attemptNo <= 1 ? score : (score - prevCompletionScore);

      await db.doc(`users/${userId}`).update({
        "quizStats.totalScoreSum": FieldValue.increment(scoreDiff),
        ...(attemptNo <= 1 ? {
          "quizStats.totalAttempts": FieldValue.increment(1),
          "quizStats.totalCorrect": FieldValue.increment(correctCount),
          "quizStats.totalQuestions": FieldValue.increment(totalCount),
        } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // 증분 후 현재 값을 읽어서 averageScore 계산
      const userDoc = await db.doc(`users/${userId}`).get();
      const userData = userDoc.data();
      if (userData?.quizStats) {
        const attempts = userData.quizStats.totalAttempts || 0;
        const scoreSum = userData.quizStats.totalScoreSum || 0;
        const avgScore = attempts > 0 ? Math.round(scoreSum / attempts) : 0;
        await db.doc(`users/${userId}`).update({
          "quizStats.averageScore": avgScore,
          "quizStats.lastAttemptAt": FieldValue.serverTimestamp(),
        });
      }
    } catch (e) {
      console.warn(`users/${userId} quizStats 갱신 실패 (무시 가능):`, e);
    }

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
