import { describe, it, expect } from "vitest";
import { gradeQuestion, UserAnswer, GradeableQuestion } from "./gradeQuestion";

// ─── 헬퍼 ───

function makeAnswer(answer: number | number[] | string): UserAnswer {
  return { questionId: "q1", answer };
}

/**
 * 엣지케이스 테스트용: 의도적으로 잘못된 타입을 전달하는 헬퍼
 * 실제 런타임에서 직렬화 과정 중 발생할 수 있는 타입 불일치를 시뮬레이션
 */
function makeUnsafeAnswer(answer: unknown): UserAnswer {
  return { questionId: "q1", answer: answer as UserAnswer["answer"] };
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

// ============================================================
// 결합형 (combined) — 서브 문제 개별 채점
// ============================================================

describe("gradeQuestion — 결합형 서브 문제", () => {
  // 결합형은 공통 지문 + 하위 N문제 → recordAttempt가 flatten 후 개별 gradeQuestion 호출
  // 서브 문제 타입이 mixed (OX + 객관식 + 단답) 일 때 각각 정상 채점되는지

  it("서브 문제 #0: OX 정답", () => {
    const sub = { type: "ox", answer: 1 };
    expect(gradeQuestion(sub, makeAnswer(1), 0).isCorrect).toBe(true);
  });

  it("서브 문제 #1: 객관식 정답 (0-indexed)", () => {
    const sub = { type: "multiple", answer: 3 };
    expect(gradeQuestion(sub, makeAnswer(3), 1).isCorrect).toBe(true);
  });

  it("서브 문제 #2: 단답형 정답", () => {
    const sub = { type: "short_answer", answer: "미토콘드리아" };
    expect(gradeQuestion(sub, makeAnswer("미토콘드리아"), 2).isCorrect).toBe(true);
  });

  it("서브 문제 믹스: 3개 중 1개만 맞으면 개별 채점 독립", () => {
    const subs = [
      { type: "ox", answer: 0 },
      { type: "multiple", answer: 2 },
      { type: "short_answer", answer: "세포" },
    ];
    const answers = [makeAnswer(0), makeAnswer(1), makeAnswer("핵")];

    const results = subs.map((s, i) => gradeQuestion(s, answers[i], i));
    expect(results[0].isCorrect).toBe(true);  // OX 맞음
    expect(results[1].isCorrect).toBe(false); // 객관식 틀림
    expect(results[2].isCorrect).toBe(false); // 단답 틀림
  });

  it("서브 문제 복수정답 객관식 채점", () => {
    const sub = { type: "multiple", answer: [0, 3] };
    expect(gradeQuestion(sub, makeAnswer([3, 0]), 0).isCorrect).toBe(true);
    expect(gradeQuestion(sub, makeAnswer([0]), 0).isCorrect).toBe(false);
  });
});

// ============================================================
// 0-indexed vs 1-indexed 함정
// ============================================================

describe("gradeQuestion — 0-indexed 안전성", () => {
  it("정답이 0번 선지 (첫 번째) → 사용자 0 제출 → 정답", () => {
    const q = { type: "multiple", answer: 0 };
    expect(gradeQuestion(q, makeAnswer(0), 0).isCorrect).toBe(true);
  });

  it("정답이 0번 선지 → 사용자 1 제출 → 오답 (1-indexed 착각 방지)", () => {
    const q = { type: "multiple", answer: 0 };
    expect(gradeQuestion(q, makeAnswer(1), 0).isCorrect).toBe(false);
  });

  it("8개 선지 중 마지막(index 7) 정답", () => {
    const q = { type: "multiple", answer: 7 };
    expect(gradeQuestion(q, makeAnswer(7), 0).isCorrect).toBe(true);
    expect(gradeQuestion(q, makeAnswer(8), 0).isCorrect).toBe(false);
  });

  it("복수정답 [0, 1] — 첫 두 선지 모두 정답", () => {
    const q = { type: "multiple", answer: [0, 1] };
    expect(gradeQuestion(q, makeAnswer([0, 1]), 0).isCorrect).toBe(true);
    expect(gradeQuestion(q, makeAnswer([1, 2]), 0).isCorrect).toBe(false);
  });
});

// ============================================================
// 타입 강제변환 엣지케이스
// ============================================================

describe("gradeQuestion — 타입 강제변환", () => {
  it("정답 숫자 2, 사용자 문자열 '2' 제출 → 정답 (Number 변환)", () => {
    const q: GradeableQuestion = { type: "multiple", answer: 2 };
    expect(gradeQuestion(q, makeAnswer("2"), 0).isCorrect).toBe(true);
  });

  it("정답 숫자 0, 사용자 문자열 '0' 제출 → 정답", () => {
    const q: GradeableQuestion = { type: "multiple", answer: 0 };
    expect(gradeQuestion(q, makeAnswer("0"), 0).isCorrect).toBe(true);
  });

  it("OX: 사용자 boolean true 제출 → X가 아닌 O로 처리되지 않아야 함", () => {
    const q: GradeableQuestion = { type: "ox", answer: 0 }; // 정답: O
    // boolean true → 문자열도 아니고 0도 아님 → uaIsO = false → "X"
    const result = gradeQuestion(q, makeUnsafeAnswer(true), 0);
    // true는 "O"가 아니므로 → X로 처리 → 오답
    expect(result.userAnswerStr).toBe("X");
    expect(result.isCorrect).toBe(false);
  });

  it("OX: 사용자 boolean false 제출 → O로 처리되지 않아야 함", () => {
    const q: GradeableQuestion = { type: "ox", answer: 1 }; // 정답: X
    // boolean false → 0이 아님(falsy이지만 === 비교) → uaIsO depends
    const result = gradeQuestion(q, makeUnsafeAnswer(false), 0);
    // false !== 0 (strict), false !== "0", false !== "O" → X로 처리
    expect(result.userAnswerStr).toBe("X");
    expect(result.isCorrect).toBe(true); // X == X
  });

  it("주관식: 숫자 제출도 문자열로 비교", () => {
    const q: GradeableQuestion = { type: "short_answer", answer: "42" };
    expect(gradeQuestion(q, makeAnswer(42), 0).isCorrect).toBe(true);
  });

  it("객관식: NaN 입력 → 0으로 변환되어 0번 선지 선택 취급", () => {
    const q: GradeableQuestion = { type: "multiple", answer: 1 };
    const result = gradeQuestion(q, makeAnswer("abc"), 0);
    // Number("abc") = NaN, NaN === 1 → false
    expect(result.isCorrect).toBe(false);
  });
});

// ============================================================
// 빈 배열 / 경계값
// ============================================================

describe("gradeQuestion — 경계값", () => {
  it("정답이 빈 배열 [] → 사용자 빈 배열 제출 → 정답", () => {
    const q = { type: "multiple", answer: [] };
    expect(gradeQuestion(q, makeAnswer([]), 0).isCorrect).toBe(true);
  });

  it("정답이 빈 배열 → 사용자 [0] 제출 → 오답", () => {
    const q = { type: "multiple", answer: [] };
    expect(gradeQuestion(q, makeAnswer([0]), 0).isCorrect).toBe(false);
  });

  it("주관식: 빈 문자열 정답 → 빈 문자열 제출 → 정답", () => {
    const q = { type: "short_answer", answer: "" };
    expect(gradeQuestion(q, makeAnswer(""), 0).isCorrect).toBe(true);
  });

  it("주관식: 공백만 있는 답 → trim 후 비교", () => {
    const q = { type: "short_answer", answer: "  " };
    // "  ".trim() = "", 사용자 "  ".trim() = "" → 같음
    expect(gradeQuestion(q, makeAnswer("  "), 0).isCorrect).toBe(true);
  });

  it("주관식: ||| 구분자 사이에 빈 문자열", () => {
    const q = { type: "short_answer", answer: "세포|||" };
    // ["세포", ""] → "" 입력 시 정답
    expect(gradeQuestion(q, makeAnswer(""), 0).isCorrect).toBe(true);
    expect(gradeQuestion(q, makeAnswer("세포"), 0).isCorrect).toBe(true);
  });

  it("questionIndex가 큰 값이어도 정상 작동", () => {
    const q = { type: "ox", answer: 0 };
    expect(gradeQuestion(q, makeAnswer(0), 999).isCorrect).toBe(true);
  });
});
