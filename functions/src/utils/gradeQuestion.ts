/**
 * gradeQuestion — 퀴즈 채점 공유 유틸
 *
 * recordAttempt.ts와 regradeQuestions.ts에서 동일한 채점 로직 사용
 */

// ─── 타입 정의 ───

export interface UserAnswer {
  questionId: string;
  /** OX: 0|1, 객관식: 0-indexed number | number[], 주관식: string */
  answer: number | number[] | string;
}

// ─── 서버 채점 로직 ───

/** 채점 대상 문제 구조 (Firestore Record와 호환 가능하도록 인덱스 시그니처 포함) */
export interface GradeableQuestion {
  type: string;
  answer: number | number[] | string | undefined;
  [key: string]: unknown;
}

export function gradeQuestion(
  question: GradeableQuestion,
  userAnswer: UserAnswer | undefined,
  questionIndex: number
): { isCorrect: boolean; userAnswerStr: string; correctAnswerStr: string } {
  let isCorrect = false;
  let userAnswerStr = "";
  let correctAnswerStr = "";

  if (question.type === "ox") {
    // OX 문제 — 숫자(0/1)와 문자열("O"/"X") 양쪽 지원
    const answerVal = question.answer;
    const isO = answerVal === 0 || answerVal === "O" || answerVal === "o";
    correctAnswerStr = isO ? "O" : "X";
    if (userAnswer !== undefined) {
      const ua = userAnswer.answer;
      const uaIsO = ua === 0 || ua === "0" || ua === "O" || ua === "o";
      userAnswerStr = uaIsO ? "O" : "X";
      isCorrect = correctAnswerStr === userAnswerStr;
    }
  } else if (question.type === "multiple") {
    // 객관식
    if (Array.isArray(question.answer)) {
      // 복수정답 (0-indexed)
      correctAnswerStr = question.answer.map((a: number) => String(a)).join(",");
      if (userAnswer && Array.isArray(userAnswer.answer)) {
        const userSorted = [...(userAnswer.answer as number[])].sort();
        const correctSorted = [...question.answer].sort();
        isCorrect = JSON.stringify(userSorted) === JSON.stringify(correctSorted);
        userAnswerStr = (userAnswer.answer as number[]).map((a) => String(a)).join(",");
      } else if (userAnswer !== undefined) {
        const ua = Number(userAnswer.answer);
        isCorrect = question.answer.length === 1 && question.answer[0] === ua;
        userAnswerStr = String(ua);
      }
    } else {
      // 단일 정답 (0-indexed)
      correctAnswerStr = String(question.answer ?? 0);
      if (userAnswer !== undefined) {
        const ua = Number(userAnswer.answer);
        isCorrect = ua === question.answer;
        userAnswerStr = String(ua);
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
