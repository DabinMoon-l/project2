/**
 * regradeQuestions — 수정된 퀴즈 문제 재채점
 *
 * 퀴즈 문제를 수정한 후 기존 응답의 isCorrect 값을
 * 새 정답 기준으로 재채점합니다.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { gradeQuestion, UserAnswer } from "./utils/gradeQuestion";

const db = getFirestore();

// ─── userAnswer 복원 로직 ───

/**
 * questionScores에 저장된 문자열 userAnswer를
 * gradeQuestion이 기대하는 원래 값으로 복원
 */
function restoreUserAnswer(
  questionType: string,
  userAnswerStr: string
): UserAnswer["answer"] {
  if (!userAnswerStr && userAnswerStr !== "0") return "";

  if (questionType === "ox") {
    // "O" → 0, "X" → 1
    return userAnswerStr === "O" ? 0 : 1;
  } else if (questionType === "multiple") {
    // "1" → 0, "1,3" → [0, 2] (1-indexed → 0-indexed)
    const parts = userAnswerStr
      .split(",")
      .map((s) => parseInt(s.trim()) - 1);
    return parts.length === 1 ? parts[0] : parts;
  }
  // short_answer 등은 문자열 그대로
  return userAnswerStr;
}

// ─── 메인 함수 ───

export const regradeQuestions = onCall(
  {
    region: "asia-northeast3",
    memory: "512MiB",
    timeoutSeconds: 120,
  },
  async (request) => {
    // 인증 확인
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }
    const userId = request.auth.uid;
    const { quizId, questionIds } = request.data as {
      quizId: string;
      questionIds: string[];
    };

    if (!quizId || !questionIds || !Array.isArray(questionIds) || questionIds.length === 0) {
      throw new HttpsError("invalid-argument", "quizId와 questionIds 배열이 필요합니다.");
    }

    // ── ① 권한 확인 ──
    const userDoc = await db.doc(`users/${userId}`).get();
    const userData = userDoc.data();

    const quizDoc = await db.doc(`quizzes/${quizId}`).get();
    if (!quizDoc.exists) {
      throw new HttpsError("not-found", "퀴즈를 찾을 수 없습니다.");
    }
    const quizData = quizDoc.data()!;

    // 교수 권한 또는 퀴즈 생성자만 재채점 가능
    const isProfessor = userData?.role === "professor";
    const isCreator = quizData.creatorId === userId || quizData.creatorUid === userId;
    if (!isProfessor && !isCreator) {
      throw new HttpsError("permission-denied", "재채점 권한이 없습니다.");
    }

    // ── ② 수정된 문제 필터 ──
    const questions: any[] = quizData.questions || [];
    const changedQuestionIds = new Set(questionIds);

    // ── ③ 해당 퀴즈의 모든 quizResult 조회 ──
    const resultsSnap = await db
      .collection("quizResults")
      .where("quizId", "==", quizId)
      .get();

    if (resultsSnap.empty) {
      return { regradedResults: 0, changedScores: 0 };
    }

    let regradedResults = 0;
    let changedScores = 0;

    // ── ④ 배치로 재채점 ──
    // Firestore 배치 최대 500건이므로 분할 처리
    const BATCH_LIMIT = 400; // 여유분 확보 (result + completion 2건씩)
    let batch = db.batch();
    let batchCount = 0;

    for (const resultDoc of resultsSnap.docs) {
      const resultData = resultDoc.data();
      const oldQuestionScores = resultData.questionScores || {};
      let scoreChanged = false;

      // 기존 questionScores 복사
      const newQuestionScores = { ...oldQuestionScores };
      let correctCount = 0;
      const newAnswersArr: string[] = [];

      // 모든 문제를 순회하면서 재계산
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const qId = q.id || `q${i}`;
        const oldScore = oldQuestionScores[qId];

        if (changedQuestionIds.has(qId) && oldScore) {
          // 수정된 문제 → 재채점
          const restoredAnswer = restoreUserAnswer(q.type, oldScore.userAnswer || "");
          const userAns: UserAnswer = {
            questionId: qId,
            answer: restoredAnswer,
          };

          const { isCorrect, userAnswerStr, correctAnswerStr } = gradeQuestion(q, userAns, i);

          // 점수 변경 여부 확인
          if (oldScore.isCorrect !== isCorrect || oldScore.correctAnswer !== correctAnswerStr) {
            scoreChanged = true;
          }

          newQuestionScores[qId] = {
            ...oldScore,
            isCorrect,
            userAnswer: userAnswerStr,
            correctAnswer: correctAnswerStr,
          };

          if (q.type !== "essay" && isCorrect) correctCount++;
          newAnswersArr.push(userAnswerStr);
        } else if (oldScore) {
          // 수정되지 않은 문제 → 기존 값 유지
          if (q.type !== "essay" && oldScore.isCorrect) correctCount++;
          newAnswersArr.push(oldScore.userAnswer || "");
        } else {
          // 응답 없는 문제
          newAnswersArr.push("");
        }
      }

      if (!scoreChanged) {
        // 점수 변동 없으면 스킵
        regradedResults++;
        continue;
      }

      // ── ⑤ 새 점수 계산 ──
      const totalCount = questions.filter((q: any) => q.type !== "essay").length;
      const newScore = totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0;

      // quizResults 업데이트
      batch.update(resultDoc.ref, {
        score: newScore,
        correctCount,
        totalCount,
        earnedExp: correctCount * 10,
        answers: newAnswersArr,
        questionScores: newQuestionScores,
      });
      batchCount++;

      // quiz_completions 업데이트
      const completionDocId = `${quizId}_${resultData.userId}`;
      const compRef = db.doc(`quiz_completions/${completionDocId}`);
      batch.update(compRef, {
        score: newScore,
        correctCount,
        totalCount,
      });
      batchCount++;

      regradedResults++;
      changedScores++;

      // 배치 한계 도달 시 커밋
      if (batchCount >= BATCH_LIMIT) {
        await batch.commit();
        batch = db.batch();
        batchCount = 0;
      }
    }

    // 잔여 배치 커밋
    if (batchCount > 0) {
      await batch.commit();
    }

    // ── ⑥ quizzes 문서의 userScores + averageScore 재계산 ──
    try {
      // 모든 quiz_completions 조회해서 userScores 재구성
      const completionsSnap = await db
        .collection("quiz_completions")
        .where("quizId", "==", quizId)
        .get();

      const userScores: Record<string, number> = {};
      let scoreSum = 0;
      let count = 0;

      for (const compDoc of completionsSnap.docs) {
        const compData = compDoc.data();
        if (compData.userId && compData.score !== undefined) {
          userScores[compData.userId] = compData.score;
          scoreSum += compData.score;
          count++;
        }
      }

      const averageScore = count > 0
        ? Math.round((scoreSum / count) * 10) / 10
        : 0;

      await db.doc(`quizzes/${quizId}`).update({
        userScores,
        averageScore,
      });
    } catch (e) {
      // userScores 업데이트 실패해도 재채점 자체는 성공
      console.warn(`quizzes/${quizId} userScores 업데이트 실패 (무시 가능):`, e);
    }

    console.log(
      `재채점 완료: quizId=${quizId}, ` +
      `questionIds=[${questionIds.join(",")}], ` +
      `regradedResults=${regradedResults}, changedScores=${changedScores}`
    );

    return { regradedResults, changedScores };
  }
);
