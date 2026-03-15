import { describe, it, expect } from "vitest";
import {
  parseAverageScore,
  sortByLatest,
  formatQuestionTypes,
} from "./quizHelpers";

// ============================================================
// parseAverageScore — averageScore fallback 계산
// ============================================================

describe("parseAverageScore", () => {
  it("averageScore 필드가 있으면 그대로 반환", () => {
    expect(parseAverageScore({ averageScore: 85.5 })).toBe(85.5);
  });

  it("averageScore가 0이고 userScores가 있으면 평균 계산", () => {
    const data = {
      averageScore: 0,
      userScores: { user1: 80, user2: 90, user3: 100 },
    };
    // (80 + 90 + 100) / 3 = 90
    expect(parseAverageScore(data)).toBe(90);
  });

  it("averageScore가 없고 userScores가 있으면 평균 계산", () => {
    const data = {
      userScores: { user1: 75, user2: 85 },
    };
    // (75 + 85) / 2 = 80
    expect(parseAverageScore(data)).toBe(80);
  });

  it("소수점 첫째 자리까지 반올림", () => {
    const data = {
      userScores: { user1: 33, user2: 33, user3: 34 },
    };
    // (33 + 33 + 34) / 3 = 33.333... → 33.3
    expect(parseAverageScore(data)).toBe(33.3);
  });

  it("averageScore도 없고 userScores도 없으면 0", () => {
    expect(parseAverageScore({})).toBe(0);
  });

  it("averageScore가 undefined이고 userScores도 없으면 0", () => {
    expect(parseAverageScore({ averageScore: undefined })).toBe(0);
  });

  it("userScores가 빈 객체이면 0", () => {
    expect(parseAverageScore({ averageScore: 0, userScores: {} })).toBe(0);
  });

  it("averageScore가 유효하면 userScores 무시", () => {
    const data = {
      averageScore: 70,
      userScores: { user1: 100 },
    };
    expect(parseAverageScore(data)).toBe(70);
  });

  it("userScores에 값이 하나만 있으면 그 값 반환", () => {
    const data = { userScores: { user1: 42 } };
    expect(parseAverageScore(data)).toBe(42);
  });

  it("averageScore가 null이면 fallback 동작", () => {
    const data = {
      averageScore: null,
      userScores: { user1: 60, user2: 80 },
    };
    // null은 falsy이므로 userScores fallback → (60+80)/2 = 70
    expect(parseAverageScore(data as Record<string, unknown>)).toBe(70);
  });

  it("모든 userScores가 0이면 평균 0", () => {
    const data = {
      userScores: { user1: 0, user2: 0, user3: 0 },
    };
    expect(parseAverageScore(data)).toBe(0);
  });

  it("userScores에 100점만 있으면 100", () => {
    const data = {
      userScores: { user1: 100, user2: 100 },
    };
    expect(parseAverageScore(data)).toBe(100);
  });
});

// ============================================================
// sortByLatest — createdAt 기반 정렬 (최신순)
// ============================================================

describe("sortByLatest", () => {
  it("toMillis()가 있으면 그 값으로 정렬", () => {
    const a = { createdAt: { toMillis: () => 1000 } };
    const b = { createdAt: { toMillis: () => 2000 } };
    // 최신순: b가 먼저 → 양수 반환
    expect(sortByLatest(a, b)).toBeGreaterThan(0);
  });

  it("seconds만 있으면 *1000으로 변환하여 정렬", () => {
    const a = { createdAt: { seconds: 100 } };
    const b = { createdAt: { seconds: 200 } };
    // bTime(200000) - aTime(100000) > 0
    expect(sortByLatest(a, b)).toBeGreaterThan(0);
  });

  it("같은 시간이면 0 반환", () => {
    const a = { createdAt: { toMillis: () => 5000 } };
    const b = { createdAt: { toMillis: () => 5000 } };
    expect(sortByLatest(a, b)).toBe(0);
  });

  it("createdAt가 없으면 0으로 처리", () => {
    const a = {};
    const b = { createdAt: { toMillis: () => 1000 } };
    // bTime(1000) - aTime(0) > 0 → b가 앞
    expect(sortByLatest(a, b)).toBeGreaterThan(0);
  });

  it("둘 다 createdAt 없으면 순서 유지 (0)", () => {
    expect(sortByLatest({}, {})).toBe(0);
  });

  it("toMillis 우선, seconds fallback", () => {
    const a = { createdAt: { toMillis: () => 3000, seconds: 1 } };
    const b = { createdAt: { seconds: 2 } };
    // a: toMillis → 3000, b: seconds → 2000
    // bTime(2000) - aTime(3000) = -1000 → a가 먼저 (최신순)
    expect(sortByLatest(a, b)).toBeLessThan(0);
  });

  it("createdAt가 undefined인 경우", () => {
    const a = { createdAt: undefined };
    const b = { createdAt: { seconds: 10 } };
    // aTime = 0, bTime = 10000
    expect(sortByLatest(a, b)).toBeGreaterThan(0);
  });

  it("배열 정렬에 사용 — 최신순 정렬 확인", () => {
    const items = [
      { id: "old", createdAt: { toMillis: () => 1000 } },
      { id: "newest", createdAt: { toMillis: () => 3000 } },
      { id: "mid", createdAt: { toMillis: () => 2000 } },
    ];
    const sorted = [...items].sort(sortByLatest);
    expect(sorted[0].id).toBe("newest");
    expect(sorted[1].id).toBe("mid");
    expect(sorted[2].id).toBe("old");
  });

  it("seconds가 0이면 시간 0으로 처리", () => {
    const a = { createdAt: { seconds: 0 } };
    const b = { createdAt: { seconds: 5 } };
    expect(sortByLatest(a, b)).toBeGreaterThan(0);
  });

  it("toMillis가 0을 반환하면 seconds fallback 사용", () => {
    // toMillis() → 0 은 falsy이므로 || 뒤의 seconds로 fallback
    const a = { createdAt: { toMillis: () => 0, seconds: 10 } };
    const b = { createdAt: { seconds: 5 } };
    // a: toMillis()=0 → falsy → seconds=10 → 10*1000=10000
    // b: seconds=5 → 5000
    // bTime(5000) - aTime(10000) = -5000 → a가 먼저
    expect(sortByLatest(a, b)).toBeLessThan(0);
  });
});

// ============================================================
// formatQuestionTypes — 문제 유형 포맷
// ============================================================

describe("formatQuestionTypes", () => {
  it("OX만 있을 때", () => {
    expect(formatQuestionTypes(3, 0, 0)).toBe("OX 3");
  });

  it("객관식만 있을 때", () => {
    expect(formatQuestionTypes(0, 5, 0)).toBe("객관식 5");
  });

  it("주관식만 있을 때", () => {
    expect(formatQuestionTypes(0, 0, 2)).toBe("주관식 2");
  });

  it("OX + 객관식 조합", () => {
    expect(formatQuestionTypes(2, 5, 0)).toBe("OX 2 / 객관식 5");
  });

  it("OX + 주관식 조합", () => {
    expect(formatQuestionTypes(1, 0, 3)).toBe("OX 1 / 주관식 3");
  });

  it("객관식 + 주관식 조합", () => {
    expect(formatQuestionTypes(0, 4, 2)).toBe("객관식 4 / 주관식 2");
  });

  it("세 유형 모두 있을 때", () => {
    expect(formatQuestionTypes(2, 5, 3)).toBe("OX 2 / 객관식 5 / 주관식 3");
  });

  it("모두 0이면 '-' 반환", () => {
    expect(formatQuestionTypes(0, 0, 0)).toBe("-");
  });

  it("인자 없이 호출 (기본값 0) → '-'", () => {
    expect(formatQuestionTypes()).toBe("-");
  });

  it("큰 숫자도 정상 처리", () => {
    expect(formatQuestionTypes(100, 200, 300)).toBe(
      "OX 100 / 객관식 200 / 주관식 300"
    );
  });

  it("OX 1개만 있는 최소 케이스", () => {
    expect(formatQuestionTypes(1, 0, 0)).toBe("OX 1");
  });
});
