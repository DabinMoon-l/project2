import { describe, it, expect } from "vitest";
import {
  computeRankScore,
  computeTeamScore,
  assignCoRanks,
  calculatePendingMilestones,
  calculateQuizExp,
  calculateGrowthRate,
  calculateBattleExp,
} from "./rankingFormulas";

// ============================================================
// computeRankScore — 개인 랭킹 점수
// ============================================================

describe("computeRankScore", () => {
  it("기본 공식: profCorrectCount × 4 + totalExp × 0.6", () => {
    expect(computeRankScore(10, 100)).toBe(10 * 4 + 100 * 0.6); // 100
  });

  it("0점, 0 EXP → 0", () => {
    expect(computeRankScore(0, 0)).toBe(0);
  });

  it("정답만 있고 EXP 0 → 정답 × 4", () => {
    expect(computeRankScore(25, 0)).toBe(100);
  });

  it("EXP만 있고 정답 0 → EXP × 0.6", () => {
    expect(computeRankScore(0, 500)).toBe(300);
  });

  it("높은 값 (정답 100, EXP 2000)", () => {
    expect(computeRankScore(100, 2000)).toBe(400 + 1200); // 1600
  });
});

// ============================================================
// computeTeamScore — 팀 랭킹 점수
// ============================================================

describe("computeTeamScore", () => {
  it("기본 공식: avgExp×0.4 + correctRate×0.4 + completionRate×0.2", () => {
    expect(computeTeamScore(80, 70, 60)).toBe(80 * 0.4 + 70 * 0.4 + 60 * 0.2); // 72
  });

  it("모두 100점 → 100", () => {
    expect(computeTeamScore(100, 100, 100)).toBe(100);
  });

  it("모두 0점 → 0", () => {
    expect(computeTeamScore(0, 0, 0)).toBe(0);
  });

  it("EXP 지배적 (100, 0, 0) → 40", () => {
    expect(computeTeamScore(100, 0, 0)).toBe(40);
  });

  it("정답률 지배적 (0, 100, 0) → 40", () => {
    expect(computeTeamScore(0, 100, 0)).toBe(40);
  });

  it("완료율 지배적 (0, 0, 100) → 20", () => {
    expect(computeTeamScore(0, 0, 100)).toBe(20);
  });

  it("가중치 합 = 1.0 (비율 검증)", () => {
    // 동일 값이면 결과 = 값 자체
    expect(computeTeamScore(50, 50, 50)).toBe(50);
  });
});

// ============================================================
// assignCoRanks — 동점자 공동순위
// ============================================================

describe("assignCoRanks", () => {
  it("모두 다른 점수 → 순차 순위", () => {
    expect(assignCoRanks([100, 90, 80])).toEqual([1, 2, 3]);
  });

  it("동점자 2명 → 공동 1위, 3위", () => {
    expect(assignCoRanks([100, 100, 80])).toEqual([1, 1, 3]);
  });

  it("모두 동점 → 전원 1위", () => {
    expect(assignCoRanks([50, 50, 50])).toEqual([1, 1, 1]);
  });

  it("빈 배열 → 빈 결과", () => {
    expect(assignCoRanks([])).toEqual([]);
  });

  it("1명 → 1위", () => {
    expect(assignCoRanks([999])).toEqual([1]);
  });

  it("중간에 동점 (100, 90, 90, 80) → 1, 2, 2, 4", () => {
    expect(assignCoRanks([100, 90, 90, 80])).toEqual([1, 2, 2, 4]);
  });

  it("끝에 동점 (100, 80, 80) → 1, 2, 2", () => {
    expect(assignCoRanks([100, 80, 80])).toEqual([1, 2, 2]);
  });

  it("5명 중 3명 동점 (100, 90, 90, 90, 80) → 1, 2, 2, 2, 5", () => {
    expect(assignCoRanks([100, 90, 90, 90, 80])).toEqual([1, 2, 2, 2, 5]);
  });
});

// ============================================================
// calculatePendingMilestones — 마일스톤 계산
// ============================================================

describe("calculatePendingMilestones", () => {
  it("50XP 미만 → 0 마일스톤", () => {
    expect(calculatePendingMilestones(49, 0)).toBe(0);
  });

  it("정확히 50XP → 1 마일스톤", () => {
    expect(calculatePendingMilestones(50, 0)).toBe(1);
  });

  it("100XP, lastGacha 0 → 2 마일스톤", () => {
    expect(calculatePendingMilestones(100, 0)).toBe(2);
  });

  it("150XP, lastGacha 50 → 2 마일스톤 (50XP 시점 1개 소비됨)", () => {
    expect(calculatePendingMilestones(150, 50)).toBe(2);
  });

  it("같은 값 → 0 마일스톤", () => {
    expect(calculatePendingMilestones(200, 200)).toBe(0);
  });

  it("경계값: 99 XP, lastGacha 0 → 1", () => {
    expect(calculatePendingMilestones(99, 0)).toBe(1);
  });

  it("경계값: 51 XP, lastGacha 50 → 0 (아직 다음 50 안 넘음)", () => {
    expect(calculatePendingMilestones(51, 50)).toBe(0);
  });

  it("큰 값: 1000XP, lastGacha 0 → 20 마일스톤", () => {
    expect(calculatePendingMilestones(1000, 0)).toBe(20);
  });

  it("중복 뽑기 후 마일스톤 소비 안 됨: 250XP, lastGacha 100 → 3", () => {
    expect(calculatePendingMilestones(250, 100)).toBe(3);
  });
});

// ============================================================
// calculateQuizExp — 퀴즈 점수별 EXP
// ============================================================

describe("calculateQuizExp", () => {
  it("만점 (100) → 50 EXP", () => {
    expect(calculateQuizExp(100)).toBe(50);
  });

  it("90점 → 40 EXP", () => {
    expect(calculateQuizExp(90)).toBe(40);
  });

  it("99점 → 40 EXP (90~99)", () => {
    expect(calculateQuizExp(99)).toBe(40);
  });

  it("70점 → 35 EXP", () => {
    expect(calculateQuizExp(70)).toBe(35);
  });

  it("89점 → 35 EXP (70~89)", () => {
    expect(calculateQuizExp(89)).toBe(35);
  });

  it("50점 → 30 EXP", () => {
    expect(calculateQuizExp(50)).toBe(30);
  });

  it("69점 → 30 EXP (50~69)", () => {
    expect(calculateQuizExp(69)).toBe(30);
  });

  it("49점 → 25 EXP (50 미만)", () => {
    expect(calculateQuizExp(49)).toBe(25);
  });

  it("0점 → 25 EXP", () => {
    expect(calculateQuizExp(0)).toBe(25);
  });

  it("경계값: 정확히 각 경계", () => {
    expect(calculateQuizExp(100)).toBe(50);
    expect(calculateQuizExp(90)).toBe(40);
    expect(calculateQuizExp(70)).toBe(35);
    expect(calculateQuizExp(50)).toBe(30);
    expect(calculateQuizExp(49)).toBe(25);
  });
});

// ============================================================
// calculateGrowthRate — 성장세 (레이더 2축)
// ============================================================

describe("calculateGrowthRate", () => {
  it("빈 배열 → 0", () => {
    expect(calculateGrowthRate([])).toBe(0);
  });

  it("개선 없음 [0] → 50", () => {
    expect(calculateGrowthRate([0])).toBe(50);
  });

  it("양의 개선 [20, 30] → 50 + 25/2 = 63 (반올림)", () => {
    expect(calculateGrowthRate([20, 30])).toBe(63);
  });

  it("음의 개선 [-20, -30] → 50 + (-25)/2 = 38 (반올림)", () => {
    expect(calculateGrowthRate([-20, -30])).toBe(38);
  });

  it("최대 100 클램핑 (큰 양수)", () => {
    expect(calculateGrowthRate([200, 200])).toBe(100);
  });

  it("최소 0 클램핑 (큰 음수)", () => {
    expect(calculateGrowthRate([-200, -200])).toBe(0);
  });

  it("혼합 개선 [10, -10] → avg=0 → 50", () => {
    expect(calculateGrowthRate([10, -10])).toBe(50);
  });

  it("모두 0 → 50", () => {
    expect(calculateGrowthRate([0, 0, 0])).toBe(50);
  });
});

// ============================================================
// calculateBattleExp — 배틀 EXP
// ============================================================

describe("calculateBattleExp", () => {
  it("승리 연승 0 → 30", () => {
    expect(calculateBattleExp("win", 0)).toBe(30);
  });

  it("승리 연승 1 → 35", () => {
    expect(calculateBattleExp("win", 1)).toBe(35);
  });

  it("승리 연승 2 → 40", () => {
    expect(calculateBattleExp("win", 2)).toBe(40);
  });

  it("승리 연승 4 → 50 (최대)", () => {
    expect(calculateBattleExp("win", 4)).toBe(50);
  });

  it("승리 연승 100 → 50 (캡)", () => {
    expect(calculateBattleExp("win", 100)).toBe(50);
  });

  it("패배 → 10", () => {
    expect(calculateBattleExp("lose", 0)).toBe(10);
    expect(calculateBattleExp("lose", 5)).toBe(10);
  });

  it("무승부 → 10", () => {
    expect(calculateBattleExp("draw", 0)).toBe(10);
    expect(calculateBattleExp("draw", 10)).toBe(10);
  });
});
