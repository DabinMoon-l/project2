import { describe, it, expect } from "vitest";
import { gradeQuestion, UserAnswer } from "./gradeQuestion";

// ─── 헬퍼 ───

function makeAnswer(answer: number | number[] | string): UserAnswer {
  return { questionId: "q1", answer };
}

// ============================================================
// OX 문제
// ============================================================

describe("gradeQuestion — OX", () => {
  const oxO = { type: "ox", answer: 0 }; // 정답: O
  const oxX = { type: "ox", answer: 1 }; // 정답: X

  it("숫자 0 정답 → 사용자 0 제출 → 정답", () => {
    const result = gradeQuestion(oxO, makeAnswer(0), 0);
    expect(result.isCorrect).toBe(true);
    expect(result.correctAnswerStr).toBe("O");
    expect(result.userAnswerStr).toBe("O");
  });

  it("숫자 0 정답 → 사용자 1 제출 → 오답", () => {
    const result = gradeQuestion(oxO, makeAnswer(1), 0);
    expect(result.isCorrect).toBe(false);
    expect(result.userAnswerStr).toBe("X");
  });

  it("숫자 1 정답 → 사용자 1 제출 → 정답", () => {
    const result = gradeQuestion(oxX, makeAnswer(1), 0);
    expect(result.isCorrect).toBe(true);
    expect(result.correctAnswerStr).toBe("X");
    expect(result.userAnswerStr).toBe("X");
  });

  it('문자열 "O" 정답 지원', () => {
    const q = { type: "ox", answer: "O" };
    const result = gradeQuestion(q, makeAnswer(0), 0);
    expect(result.isCorrect).toBe(true);
  });

  it('소문자 "o" 정답 지원', () => {
    const q = { type: "ox", answer: "o" };
    const result = gradeQuestion(q, makeAnswer("0"), 0);
    expect(result.isCorrect).toBe(true);
  });

  it('사용자 문자열 "0" 제출 → O로 정규화', () => {
    const result = gradeQuestion(oxO, makeAnswer("0"), 0);
    expect(result.isCorrect).toBe(true);
    expect(result.userAnswerStr).toBe("O");
  });

  it("미응답 (undefined) → 오답", () => {
    const result = gradeQuestion(oxO, undefined, 0);
    expect(result.isCorrect).toBe(false);
    expect(result.userAnswerStr).toBe("");
  });
});

// ============================================================
// 객관식 — 단일 정답
// ============================================================

describe("gradeQuestion — 객관식 (단일)", () => {
  const q = { type: "multiple", answer: 2 }; // 정답: 3번째 선지 (0-indexed)

  it("정답 제출", () => {
    const result = gradeQuestion(q, makeAnswer(2), 0);
    expect(result.isCorrect).toBe(true);
    expect(result.correctAnswerStr).toBe("2");
  });

  it("오답 제출", () => {
    const result = gradeQuestion(q, makeAnswer(0), 0);
    expect(result.isCorrect).toBe(false);
    expect(result.userAnswerStr).toBe("0");
  });

  it("미응답 → 오답", () => {
    const result = gradeQuestion(q, undefined, 0);
    expect(result.isCorrect).toBe(false);
  });

  it("answer가 null/undefined → 기본값 0", () => {
    const q2 = { type: "multiple", answer: undefined };
    const result = gradeQuestion(q2, makeAnswer(0), 0);
    // correctAnswerStr가 "0"이고 사용자도 0 → 동일
    expect(result.correctAnswerStr).toBe("0");
  });
});

// ============================================================
// 객관식 — 복수 정답
// ============================================================

describe("gradeQuestion — 객관식 (복수)", () => {
  const q = { type: "multiple", answer: [1, 3] }; // 정답: 2번, 4번

  it("정답을 같은 순서로 제출", () => {
    const result = gradeQuestion(q, makeAnswer([1, 3]), 0);
    expect(result.isCorrect).toBe(true);
  });

  it("정답을 다른 순서로 제출 → 여전히 정답 (순서 무관)", () => {
    const result = gradeQuestion(q, makeAnswer([3, 1]), 0);
    expect(result.isCorrect).toBe(true);
  });

  it("부분 정답 제출 → 오답", () => {
    const result = gradeQuestion(q, makeAnswer([1]), 0);
    expect(result.isCorrect).toBe(false);
  });

  it("정답 + 추가 선택 → 오답", () => {
    const result = gradeQuestion(q, makeAnswer([1, 2, 3]), 0);
    expect(result.isCorrect).toBe(false);
  });

  it("완전히 틀린 답 → 오답", () => {
    const result = gradeQuestion(q, makeAnswer([0, 2]), 0);
    expect(result.isCorrect).toBe(false);
  });

  it("복수정답인데 사용자가 단일 숫자 제출 (배열 길이 1일 때만 정답)", () => {
    const q1 = { type: "multiple", answer: [2] }; // 정답: [2] (배열이지만 1개)
    const result = gradeQuestion(q1, makeAnswer(2), 0);
    expect(result.isCorrect).toBe(true);
  });

  it("복수정답인데 사용자가 단일 숫자 제출 (배열 길이 2 → 오답)", () => {
    const result = gradeQuestion(q, makeAnswer(1), 0);
    expect(result.isCorrect).toBe(false);
  });

  it("미응답 → 오답", () => {
    const result = gradeQuestion(q, undefined, 0);
    expect(result.isCorrect).toBe(false);
  });
});

// ============================================================
// 주관식 (short_answer / short / essay)
// ============================================================

describe("gradeQuestion — 주관식", () => {
  it("정확한 답 → 정답", () => {
    const q = { type: "short_answer", answer: "세포" };
    const result = gradeQuestion(q, makeAnswer("세포"), 0);
    expect(result.isCorrect).toBe(true);
  });

  it("대소문자 무시 (case-insensitive)", () => {
    const q = { type: "short_answer", answer: "DNA" };
    const result = gradeQuestion(q, makeAnswer("dna"), 0);
    expect(result.isCorrect).toBe(true);
  });

  it("앞뒤 공백 무시 (trim)", () => {
    const q = { type: "short_answer", answer: "세포" };
    const result = gradeQuestion(q, makeAnswer("  세포  "), 0);
    expect(result.isCorrect).toBe(true);
  });

  it("||| 구분자로 복수 정답 지원", () => {
    const q = { type: "short_answer", answer: "세포|||cell|||Cell" };
    expect(gradeQuestion(q, makeAnswer("세포"), 0).isCorrect).toBe(true);
    expect(gradeQuestion(q, makeAnswer("cell"), 0).isCorrect).toBe(true);
    expect(gradeQuestion(q, makeAnswer("CELL"), 0).isCorrect).toBe(true);
  });

  it("복수 정답 중 하나도 안 맞으면 오답", () => {
    const q = { type: "short_answer", answer: "세포|||cell" };
    const result = gradeQuestion(q, makeAnswer("핵"), 0);
    expect(result.isCorrect).toBe(false);
  });

  it("type=short 도 같은 로직", () => {
    const q = { type: "short", answer: "답" };
    const result = gradeQuestion(q, makeAnswer("답"), 0);
    expect(result.isCorrect).toBe(true);
  });

  it("type=essay 도 같은 로직", () => {
    const q = { type: "essay", answer: "답" };
    const result = gradeQuestion(q, makeAnswer("답"), 0);
    expect(result.isCorrect).toBe(true);
  });

  it("정답이 없는 경우 (answer undefined) → 빈 문자열 비교", () => {
    const q = { type: "short_answer", answer: undefined };
    const result = gradeQuestion(q, makeAnswer("뭔가"), 0);
    expect(result.isCorrect).toBe(false);
    expect(result.correctAnswerStr).toBe(""); // question.answer ?? "" → ""
  });

  it("미응답 → 오답", () => {
    const q = { type: "short_answer", answer: "세포" };
    const result = gradeQuestion(q, undefined, 0);
    expect(result.isCorrect).toBe(false);
    expect(result.userAnswerStr).toBe("");
  });
});

// ============================================================
// correctAnswerStr / userAnswerStr 포맷
// ============================================================

describe("gradeQuestion — 반환값 포맷", () => {
  it("OX: correctAnswerStr은 O 또는 X", () => {
    expect(gradeQuestion({ type: "ox", answer: 0 }, makeAnswer(0), 0).correctAnswerStr).toBe("O");
    expect(gradeQuestion({ type: "ox", answer: 1 }, makeAnswer(1), 0).correctAnswerStr).toBe("X");
  });

  it("객관식 복수: correctAnswerStr은 쉼표 구분", () => {
    const q = { type: "multiple", answer: [0, 2] };
    expect(gradeQuestion(q, makeAnswer([0, 2]), 0).correctAnswerStr).toBe("0,2");
  });

  it("객관식 복수: userAnswerStr은 쉼표 구분", () => {
    const q = { type: "multiple", answer: [0, 2] };
    expect(gradeQuestion(q, makeAnswer([2, 0]), 0).userAnswerStr).toBe("2,0");
  });
});
