/**
 * 랭킹 계산 순수 유틸리티
 *
 * computeRankings.ts와 클라이언트에서 공유하는 공식들.
 * Firestore 의존성 없음 — 단위 테스트 가능.
 */

// ── 개인 랭킹 점수 ──

export function computeRankScore(profCorrectCount: number, totalExp: number): number {
  return profCorrectCount * 4 + totalExp * 0.6;
}

// ── 팀 랭킹 점수 ──

export function computeTeamScore(
  normalizedAvgExp: number,
  avgCorrectRate: number,
  avgCompletionRate: number
): number {
  return normalizedAvgExp * 0.4 + avgCorrectRate * 0.4 + avgCompletionRate * 0.2;
}

// ── 동점자 공동순위 배정 ──
// 입력: 내림차순 정렬된 점수 배열
// 출력: 각 인덱스의 순위 배열 (1위, 1위, 3위, ...)

export function assignCoRanks(scores: number[]): number[] {
  const ranks: number[] = [];
  let currentRank = 1;
  for (let i = 0; i < scores.length; i++) {
    if (i > 0 && scores[i] < scores[i - 1]) {
      currentRank = i + 1;
    }
    ranks.push(currentRank);
  }
  return ranks;
}

// ── 마일스톤 계산 ──

export function calculatePendingMilestones(totalExp: number, lastGachaExp: number): number {
  return Math.floor(totalExp / 50) - Math.floor(lastGachaExp / 50);
}

// ── 퀴즈 EXP 계산 (shared/expRewards.json 기반) ──

export function calculateQuizExp(score: number): number {
  if (score === 100) return 50;
  if (score >= 90) return 40;
  if (score >= 70) return 35;
  if (score >= 50) return 30;
  return 25;
}

// ── 성장세 계산 (레이더 2축) ──

export function calculateGrowthRate(improvements: number[]): number {
  if (improvements.length === 0) return 0;
  const avg = improvements.reduce((s, v) => s + v, 0) / improvements.length;
  return Math.round(Math.max(0, Math.min(100, 50 + avg / 2)));
}

// ── 배틀 EXP 계산 (승리/패배/무승부) ──

export function calculateBattleExp(
  result: "win" | "lose" | "draw",
  streak: number
): number {
  if (result === "win") return Math.min(30 + streak * 5, 50);
  return 10; // 패배/무승부
}
