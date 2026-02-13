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
import { incrementShard } from "./utils/shardedCounter";
import { checkRateLimitV2 } from "./utils/rateLimitV2";

const db = getFirestore();

// ─── 타입 정의 ───

interface UserAnswer {
  questionId: string;
  /** OX: 0|1, 객관식: 0-indexed number | number[], 주관식: string */
  answer: number | number[] | string;
}

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

// ─── 서버 채점 로직 ───

function gradeQuestion(
  question: any,
  userAnswer: UserAnswer | undefined,
  questionIndex: number
): { isCorrect: boolean; userAnswerStr: string; correctAnswerStr: string } {
  let isCorrect = false;
  let userAnswerStr = "";
  let correctAnswerStr = "";

  if (question.type === "ox") {
    // OX 문제
    correctAnswerStr = question.answer === 0 ? "O" : "X";
    if (userAnswer !== undefined) {
      const ua = Number(userAnswer.answer);
      userAnswerStr = ua === 0 ? "O" : "X";
      isCorrect = ua === question.answer;
    }
  } else if (question.type === "multiple") {
    // 객관식
    if (Array.isArray(question.answer)) {
      // 복수정답
      correctAnswerStr = question.answer.map((a: number) => String(a + 1)).join(",");
      if (userAnswer && Array.isArray(userAnswer.answer)) {
        const userSorted = [...(userAnswer.answer as number[])].sort();
        const correctSorted = [...question.answer].sort();
        isCorrect = JSON.stringify(userSorted) === JSON.stringify(correctSorted);
        userAnswerStr = (userAnswer.answer as number[]).map((a) => String(a + 1)).join(",");
      } else if (userAnswer !== undefined) {
        const ua = Number(userAnswer.answer);
        isCorrect = question.answer.length === 1 && question.answer[0] === ua;
        userAnswerStr = String(ua + 1);
      }
    } else {
      // 단일 정답
      correctAnswerStr = String((question.answer ?? 0) + 1);
      if (userAnswer !== undefined) {
        const ua = Number(userAnswer.answer);
        isCorrect = ua === question.answer;
        userAnswerStr = String(ua + 1);
      }
    }
  } else {
    // short_answer, short, essay
    correctAnswerStr = String(question.answer ?? "");
    if (userAnswer !== undefined) {
      userAnswerStr = String(userAnswer.answer);
      // 정답이 ||| 구분자로 여러 개인 경우
      const accepted = correctAnswerStr
        .split("|||")
        .map((s: string) => s.trim().toLowerCase());
      isCorrect = accepted.includes(userAnswerStr.trim().toLowerCase());
    }
  }

  return { isCorrect, userAnswerStr, correctAnswerStr };
}

// ─── 메인 함수 ───

export const recordAttempt = onCall(
  {
    region: "asia-northeast3",
    memory: "512MiB",
    timeoutSeconds: 60,
    maxInstances: 100,
    concurrency: 80,
  },
  async (request) => {
    // 인증 확인
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }
    const userId = request.auth.uid;
    const { quizId, answers, attemptNo = 1 } = request.data as RecordAttemptInput;

    if (!quizId || !answers || !Array.isArray(answers)) {
      throw new HttpsError("invalid-argument", "quizId와 answers 배열이 필요합니다.");
    }

    // ── ① Rate limit ──
    try {
      await checkRateLimitV2(userId, "quiz-submit");
    } catch (e: any) {
      throw new HttpsError("resource-exhausted", e.message);
    }

    // ── ② Idempotency 검사 ──
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

      if (isCorrect) correctCount++;

      questionScores[qId] = {
        isCorrect,
        userAnswer: userAnswerStr,
        correctAnswer: correctAnswerStr,
        answeredAt: FieldValue.serverTimestamp(),
      };

      answersArr.push(userAnswerStr);
    }

    const totalCount = questions.length;
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
    await db.doc(`quiz_completions/${completionDocId}`).set(
      {
        quizId,
        userId,
        score,
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

    // ── ⑧ quizzes 문서 hotspot 제거 ──
    // completedUsers 배열 업데이트 제거 (quiz_completions 컬렉션으로 대체 완료)
    // userScores만 비동기로 업데이트 (통계용, 실패해도 무방)
    db.doc(`quizzes/${quizId}`).update({
      [`userScores.${userId}`]: score,
      updatedAt: FieldValue.serverTimestamp(),
    }).catch((e) => {
      console.warn(`quizzes/${quizId} userScores 업데이트 실패 (무시 가능):`, e);
    });

    // ── ⑨ reviews 생성은 generateReviewsOnResult 트리거에서 비동기 처리 ──

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
