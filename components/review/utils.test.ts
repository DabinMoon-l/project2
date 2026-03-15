import { describe, it, expect, vi } from "vitest";
import { getRandomQuote, getQuestionTypeLabel } from "./utils";
import { MOTIVATIONAL_QUOTES } from "./types";
import type { CompletedQuizData } from "./types";

// ============================================================
// getRandomQuote — 랜덤 명언 반환
// ============================================================

describe("getRandomQuote", () => {
  it("반환값이 MOTIVATIONAL_QUOTES 목록에 포함", () => {
    const quote = getRandomQuote();
    expect(MOTIVATIONAL_QUOTES).toContain(quote);
  });

  it("항상 문자열을 반환", () => {
    expect(typeof getRandomQuote()).toBe("string");
  });

  it("빈 문자열이 아닌 값을 반환", () => {
    expect(getRandomQuote().length).toBeGreaterThan(0);
  });

  it("Math.random 고정 시 예상 인덱스의 명언 반환", () => {
    // Math.random을 0으로 고정 → Math.floor(0 * length) = 0 → 첫 번째 명언
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(getRandomQuote()).toBe(MOTIVATIONAL_QUOTES[0]);
    vi.restoreAllMocks();
  });

  it("Math.random이 0.999일 때 마지막 명언 반환", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const lastIndex = MOTIVATIONAL_QUOTES.length - 1;
    expect(getRandomQuote()).toBe(MOTIVATIONAL_QUOTES[lastIndex]);
    vi.restoreAllMocks();
  });
});

// ============================================================
// getQuestionTypeLabel — 문제 유형 라벨 생성
// ============================================================

// 헬퍼: 최소 필수 필드를 가진 CompletedQuizData 생성
function makeQuiz(
  overrides: Partial<CompletedQuizData> = {}
): CompletedQuizData {
  return {
    id: "test-quiz",
    title: "테스트 퀴즈",
    type: "midterm",
    questionCount: 10,
    participantCount: 0,
    ...overrides,
  };
}

describe("getQuestionTypeLabel", () => {
  it("객관식 + 주관식 모두 있으면 '객관 N · 주관 M' 형식", () => {
    const quiz = makeQuiz({ multipleChoiceCount: 5, subjectiveCount: 3 });
    expect(getQuestionTypeLabel(quiz)).toBe("객관 5 · 주관 3");
  });

  it("객관식만 있으면 '객관 N문제'", () => {
    const quiz = makeQuiz({ multipleChoiceCount: 7, subjectiveCount: 0 });
    expect(getQuestionTypeLabel(quiz)).toBe("객관 7문제");
  });

  it("주관식만 있으면 '주관 N문제'", () => {
    const quiz = makeQuiz({ multipleChoiceCount: 0, subjectiveCount: 4 });
    expect(getQuestionTypeLabel(quiz)).toBe("주관 4문제");
  });

  it("객관식·주관식 모두 0이면 questionCount 기반 표시", () => {
    const quiz = makeQuiz({
      multipleChoiceCount: 0,
      subjectiveCount: 0,
      questionCount: 10,
    });
    expect(getQuestionTypeLabel(quiz)).toBe("10문제");
  });

  it("multipleChoiceCount/subjectiveCount가 undefined이면 questionCount 기반", () => {
    const quiz = makeQuiz({ questionCount: 15 });
    // multipleChoiceCount, subjectiveCount 기본 undefined
    delete quiz.multipleChoiceCount;
    delete quiz.subjectiveCount;
    expect(getQuestionTypeLabel(quiz)).toBe("15문제");
  });

  it("객관식 1, 주관식 1 최소 조합", () => {
    const quiz = makeQuiz({ multipleChoiceCount: 1, subjectiveCount: 1 });
    expect(getQuestionTypeLabel(quiz)).toBe("객관 1 · 주관 1");
  });

  it("객관식만 1문제", () => {
    const quiz = makeQuiz({ multipleChoiceCount: 1 });
    expect(getQuestionTypeLabel(quiz)).toBe("객관 1문제");
  });

  it("주관식만 1문제", () => {
    const quiz = makeQuiz({ subjectiveCount: 1 });
    expect(getQuestionTypeLabel(quiz)).toBe("주관 1문제");
  });

  it("questionCount가 0이면 '0문제'로 표시", () => {
    const quiz = makeQuiz({ questionCount: 0 });
    expect(getQuestionTypeLabel(quiz)).toBe("0문제");
  });

  it("큰 숫자도 정상 처리", () => {
    const quiz = makeQuiz({
      multipleChoiceCount: 100,
      subjectiveCount: 50,
    });
    expect(getQuestionTypeLabel(quiz)).toBe("객관 100 · 주관 50");
  });

  it("multipleChoiceCount만 undefined, subjectiveCount는 양수", () => {
    const quiz = makeQuiz({ subjectiveCount: 5 });
    delete quiz.multipleChoiceCount;
    expect(getQuestionTypeLabel(quiz)).toBe("주관 5문제");
  });

  it("subjectiveCount만 undefined, multipleChoiceCount는 양수", () => {
    const quiz = makeQuiz({ multipleChoiceCount: 8 });
    delete quiz.subjectiveCount;
    expect(getQuestionTypeLabel(quiz)).toBe("객관 8문제");
  });
});
