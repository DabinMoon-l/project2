import { describe, it, expect, vi } from "vitest";
import {
  calculateActualQuestionCount,
  calculateCustomFolderQuestionCount,
  groupByQuiz,
  groupByChapterAndQuiz,
} from "./useReviewUtils";
import type { ReviewItem } from "./useReviewTypes";

// ============================================================
// getChapterById 모킹
// ============================================================
vi.mock("@/lib/courseIndex", () => ({
  getChapterById: (courseId: string, chapterId: string) => {
    // 테스트용 챕터 데이터
    const chapters: Record<string, Record<string, { id: string; name: string }>> = {
      biology: {
        bio_1: { id: "bio_1", name: "1. 세포" },
        bio_2: { id: "bio_2", name: "2. 유전" },
        bio_3: { id: "bio_3", name: "3. 진화" },
      },
    };
    return chapters[courseId]?.[chapterId] ?? null;
  },
}));

// ============================================================
// 헬퍼: 최소 ReviewItem 생성
// ============================================================
let idCounter = 0;

/** 테스트용 최소 ReviewItem 생성 */
function makeItem(
  overrides: Partial<ReviewItem> & { quizId: string; questionId: string }
): ReviewItem {
  idCounter++;
  return {
    id: `r${idCounter}`,
    userId: "u1",
    quizTitle: "테스트 퀴즈",
    question: "테스트 문제",
    type: "multiple",
    correctAnswer: "0",
    userAnswer: "1",
    reviewType: "wrong",
    isBookmarked: false,
    reviewCount: 0,
    lastReviewedAt: null,
    // createdAt — toMillis() 호출용 간이 객체
    createdAt: { toMillis: () => Date.now() - idCounter * 1000 } as any,
    ...overrides,
  } as ReviewItem;
}

// ============================================================
// calculateActualQuestionCount
// ============================================================
describe("calculateActualQuestionCount", () => {
  it("빈 배열 → 0", () => {
    expect(calculateActualQuestionCount([])).toBe(0);
  });

  it("일반 문제 3개 → 3", () => {
    const items = [
      makeItem({ quizId: "q1", questionId: "q0" }),
      makeItem({ quizId: "q1", questionId: "q1" }),
      makeItem({ quizId: "q1", questionId: "q2" }),
    ];
    expect(calculateActualQuestionCount(items)).toBe(3);
  });

  it("결합형 문제 (같은 combinedGroupId) 3개 → 1", () => {
    const items = [
      makeItem({ quizId: "q1", questionId: "q1-0", combinedGroupId: "cg1" }),
      makeItem({ quizId: "q1", questionId: "q1-1", combinedGroupId: "cg1" }),
      makeItem({ quizId: "q1", questionId: "q1-2", combinedGroupId: "cg1" }),
    ];
    expect(calculateActualQuestionCount(items)).toBe(1);
  });

  it("일반 2개 + 결합형 그룹 1개(하위 3문제) → 3", () => {
    const items = [
      makeItem({ quizId: "q1", questionId: "q0" }),
      makeItem({ quizId: "q1", questionId: "q2" }),
      makeItem({ quizId: "q1", questionId: "q1-0", combinedGroupId: "cg1" }),
      makeItem({ quizId: "q1", questionId: "q1-1", combinedGroupId: "cg1" }),
      makeItem({ quizId: "q1", questionId: "q1-2", combinedGroupId: "cg1" }),
    ];
    expect(calculateActualQuestionCount(items)).toBe(3);
  });

  it("combinedGroupId가 null/undefined인 경우 개별 카운트", () => {
    const items = [
      makeItem({ quizId: "q1", questionId: "q0", combinedGroupId: undefined }),
      makeItem({ quizId: "q1", questionId: "q1", combinedGroupId: null as any }),
      makeItem({ quizId: "q1", questionId: "q2" }),
    ];
    // null/undefined/빈값 → falsy → 각각 개별 카운트
    expect(calculateActualQuestionCount(items)).toBe(3);
  });
});

// ============================================================
// calculateCustomFolderQuestionCount
// ============================================================
describe("calculateCustomFolderQuestionCount", () => {
  it("빈 배열 → 0", () => {
    expect(calculateCustomFolderQuestionCount([])).toBe(0);
  });

  it("일반 문제만 → 개수 그대로", () => {
    const questions = [
      { combinedGroupId: undefined },
      { combinedGroupId: null },
      { combinedGroupId: undefined },
    ];
    expect(calculateCustomFolderQuestionCount(questions)).toBe(3);
  });

  it("결합형 혼합 → 그룹별 1개", () => {
    const questions = [
      { combinedGroupId: undefined },       // 일반 1개
      { combinedGroupId: "cg1" },           // 결합형 그룹 1
      { combinedGroupId: "cg1" },           // 결합형 그룹 1 (중복)
      { combinedGroupId: "cg2" },           // 결합형 그룹 2
      { combinedGroupId: "cg2" },           // 결합형 그룹 2 (중복)
      { combinedGroupId: "cg2" },           // 결합형 그룹 2 (중복)
    ];
    // 일반 1 + 그룹1(1) + 그룹2(1) = 3
    expect(calculateCustomFolderQuestionCount(questions)).toBe(3);
  });
});

// ============================================================
// groupByQuiz
// ============================================================
describe("groupByQuiz", () => {
  it("빈 배열 → 빈 배열", () => {
    expect(groupByQuiz([])).toEqual([]);
  });

  it("같은 quizId → 1그룹", () => {
    const items = [
      makeItem({ quizId: "quiz1", questionId: "q0" }),
      makeItem({ quizId: "quiz1", questionId: "q1" }),
      makeItem({ quizId: "quiz1", questionId: "q2" }),
    ];
    const result = groupByQuiz(items);
    expect(result).toHaveLength(1);
    expect(result[0].quizId).toBe("quiz1");
    expect(result[0].items).toHaveLength(3);
  });

  it("다른 quizId → 각각 그룹", () => {
    const items = [
      makeItem({ quizId: "quiz1", questionId: "q0" }),
      makeItem({ quizId: "quiz2", questionId: "q0" }),
      makeItem({ quizId: "quiz3", questionId: "q0" }),
    ];
    const result = groupByQuiz(items);
    expect(result).toHaveLength(3);
    const quizIds = result.map((g) => g.quizId);
    expect(quizIds).toContain("quiz1");
    expect(quizIds).toContain("quiz2");
    expect(quizIds).toContain("quiz3");
  });

  it("그룹 내 문제 정렬 (questionId 순)", () => {
    const items = [
      makeItem({ quizId: "quiz1", questionId: "q2" }),
      makeItem({ quizId: "quiz1", questionId: "q0" }),
      makeItem({ quizId: "quiz1", questionId: "q1" }),
    ];
    const result = groupByQuiz(items);
    const ids = result[0].items.map((i) => i.questionId);
    // parseQuestionId: q0→[0,0], q1→[1,0], q2→[2,0] → 오름차순
    expect(ids).toEqual(["q0", "q1", "q2"]);
  });

  it("결합형 문제 정렬 (q1-0 < q1-1 < q1-2 < q2)", () => {
    const items = [
      makeItem({ quizId: "quiz1", questionId: "q2" }),
      makeItem({ quizId: "quiz1", questionId: "q1-2", combinedGroupId: "cg1" }),
      makeItem({ quizId: "quiz1", questionId: "q1-0", combinedGroupId: "cg1" }),
      makeItem({ quizId: "quiz1", questionId: "q1-1", combinedGroupId: "cg1" }),
      makeItem({ quizId: "quiz1", questionId: "q0" }),
    ];
    const result = groupByQuiz(items);
    const ids = result[0].items.map((i) => i.questionId);
    expect(ids).toEqual(["q0", "q1-0", "q1-1", "q1-2", "q2"]);
  });

  it("그룹 정렬 (최신순 — createdAt 큰 것이 먼저)", () => {
    const now = Date.now();
    const items = [
      // quiz1: 오래된 것
      makeItem({
        quizId: "quiz1",
        questionId: "q0",
        createdAt: { toMillis: () => now - 10000 } as any,
      }),
      // quiz2: 최신
      makeItem({
        quizId: "quiz2",
        questionId: "q0",
        createdAt: { toMillis: () => now } as any,
      }),
      // quiz3: 중간
      makeItem({
        quizId: "quiz3",
        questionId: "q0",
        createdAt: { toMillis: () => now - 5000 } as any,
      }),
    ];
    const result = groupByQuiz(items);
    const quizIds = result.map((g) => g.quizId);
    // 최신순: quiz2 → quiz3 → quiz1
    expect(quizIds).toEqual(["quiz2", "quiz3", "quiz1"]);
  });

  it("questionCount 정확성 — 결합형 포함", () => {
    const items = [
      makeItem({ quizId: "quiz1", questionId: "q0" }),
      makeItem({ quizId: "quiz1", questionId: "q1-0", combinedGroupId: "cg1" }),
      makeItem({ quizId: "quiz1", questionId: "q1-1", combinedGroupId: "cg1" }),
      makeItem({ quizId: "quiz1", questionId: "q2" }),
    ];
    const result = groupByQuiz(items);
    // 일반 2개 + 결합형 그룹 1개 = 3
    expect(result[0].questionCount).toBe(3);
  });

  it("quizTitle이 없으면 기본값 '퀴즈' 사용", () => {
    const items = [
      makeItem({ quizId: "quiz1", questionId: "q0", quizTitle: undefined }),
    ];
    const result = groupByQuiz(items);
    expect(result[0].quizTitle).toBe("퀴즈");
  });
});

// ============================================================
// groupByChapterAndQuiz
// ============================================================
describe("groupByChapterAndQuiz", () => {
  it("빈 배열 → 빈 배열", () => {
    expect(groupByChapterAndQuiz([])).toEqual([]);
  });

  it("같은 챕터 → 1챕터 그룹", () => {
    const items = [
      makeItem({ quizId: "quiz1", questionId: "q0", chapterId: "bio_1" }),
      makeItem({ quizId: "quiz1", questionId: "q1", chapterId: "bio_1" }),
    ];
    const result = groupByChapterAndQuiz(items, "biology");
    expect(result).toHaveLength(1);
    expect(result[0].chapterId).toBe("bio_1");
    expect(result[0].chapterName).toBe("1. 세포");
  });

  it("다른 챕터 → 각각 챕터 그룹", () => {
    const items = [
      makeItem({ quizId: "quiz1", questionId: "q0", chapterId: "bio_1" }),
      makeItem({ quizId: "quiz2", questionId: "q0", chapterId: "bio_2" }),
    ];
    const result = groupByChapterAndQuiz(items, "biology");
    expect(result).toHaveLength(2);
    const chapterIds = result.map((g) => g.chapterId);
    expect(chapterIds).toContain("bio_1");
    expect(chapterIds).toContain("bio_2");
  });

  it("chapterId가 null → '미분류' 그룹", () => {
    const items = [
      makeItem({ quizId: "quiz1", questionId: "q0", chapterId: undefined }),
      makeItem({ quizId: "quiz1", questionId: "q1", chapterId: undefined }),
    ];
    const result = groupByChapterAndQuiz(items, "biology");
    expect(result).toHaveLength(1);
    expect(result[0].chapterId).toBeNull();
    expect(result[0].chapterName).toBe("미분류");
  });

  it("courseId가 없으면 모든 챕터 → 미분류", () => {
    const items = [
      makeItem({ quizId: "quiz1", questionId: "q0", chapterId: "bio_1" }),
      makeItem({ quizId: "quiz2", questionId: "q0", chapterId: "bio_2" }),
    ];
    // courseId 없이 호출
    const result = groupByChapterAndQuiz(items);
    expect(result).toHaveLength(1);
    expect(result[0].chapterId).toBeNull();
    expect(result[0].chapterName).toBe("미분류");
  });

  it("존재하지 않는 chapterId → 미분류로 통합", () => {
    const items = [
      makeItem({ quizId: "quiz1", questionId: "q0", chapterId: "bio_999" }),
    ];
    const result = groupByChapterAndQuiz(items, "biology");
    expect(result).toHaveLength(1);
    expect(result[0].chapterId).toBeNull();
    expect(result[0].chapterName).toBe("미분류");
  });

  it("챕터 내 퀴즈별 그룹핑 (folders)", () => {
    const now = Date.now();
    const items = [
      makeItem({
        quizId: "quiz1",
        questionId: "q0",
        chapterId: "bio_1",
        createdAt: { toMillis: () => now } as any,
      }),
      makeItem({
        quizId: "quiz1",
        questionId: "q1",
        chapterId: "bio_1",
        createdAt: { toMillis: () => now - 1000 } as any,
      }),
      makeItem({
        quizId: "quiz2",
        questionId: "q0",
        chapterId: "bio_1",
        createdAt: { toMillis: () => now - 2000 } as any,
      }),
    ];
    const result = groupByChapterAndQuiz(items, "biology");
    expect(result).toHaveLength(1);
    // 챕터 bio_1 내에 quiz1, quiz2 두 폴더
    expect(result[0].folders).toHaveLength(2);
    // totalCount = quiz1(2문제) + quiz2(1문제) = 3
    expect(result[0].totalCount).toBe(3);
  });

  it("챕터 정렬 — 미분류는 마지막", () => {
    const items = [
      makeItem({ quizId: "quiz1", questionId: "q0", chapterId: undefined }),
      makeItem({ quizId: "quiz2", questionId: "q0", chapterId: "bio_2" }),
      makeItem({ quizId: "quiz3", questionId: "q0", chapterId: "bio_1" }),
    ];
    const result = groupByChapterAndQuiz(items, "biology");
    expect(result).toHaveLength(3);
    // bio_1 < bio_2 < null(미분류)
    expect(result[0].chapterId).toBe("bio_1");
    expect(result[1].chapterId).toBe("bio_2");
    expect(result[2].chapterId).toBeNull();
  });

  it("totalCount — 결합형 문제 포함 시 정확성", () => {
    const items = [
      makeItem({ quizId: "quiz1", questionId: "q0", chapterId: "bio_1" }),
      makeItem({
        quizId: "quiz1",
        questionId: "q1-0",
        chapterId: "bio_1",
        combinedGroupId: "cg1",
      }),
      makeItem({
        quizId: "quiz1",
        questionId: "q1-1",
        chapterId: "bio_1",
        combinedGroupId: "cg1",
      }),
    ];
    const result = groupByChapterAndQuiz(items, "biology");
    // 일반 1개 + 결합형 1그룹 = 2
    expect(result[0].totalCount).toBe(2);
  });
});

// ============================================================
// parseQuestionId (비공개 함수 — groupByQuiz 정렬로 간접 검증)
// ============================================================
describe("parseQuestionId (groupByQuiz 정렬을 통한 간접 검증)", () => {
  /** 헬퍼: questionId 목록을 groupByQuiz에 넣고 정렬 결과 반환 */
  function sortedIds(questionIds: string[]): string[] {
    const items = questionIds.map((qid) =>
      makeItem({ quizId: "quiz1", questionId: qid })
    );
    const result = groupByQuiz(items);
    return result[0].items.map((i) => i.questionId);
  }

  it('"q0" < "q1" — 기본 파싱', () => {
    expect(sortedIds(["q1", "q0"])).toEqual(["q0", "q1"]);
  });

  it('"q1" < "q1-2" — 주문제 < 하위문제', () => {
    // q1 → [1,0], q1-2 → [1,2] → sub 0 < sub 2
    expect(sortedIds(["q1-2", "q1"])).toEqual(["q1", "q1-2"]);
  });

  it('"q1_3" 언더스코어 구분자 지원', () => {
    // q1_3 → [1,3], q1-2 → [1,2] → sub 2 < sub 3
    expect(sortedIds(["q1_3", "q1-2"])).toEqual(["q1-2", "q1_3"]);
  });

  it("잘못된 형식 → [0,0] 취급 (맨 앞 정렬)", () => {
    // "abc" → [0,0], "q2" → [2,0] → abc가 먼저
    expect(sortedIds(["q2", "abc"])).toEqual(["abc", "q2"]);
  });
});
