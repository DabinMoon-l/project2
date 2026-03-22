/**
 * 랭킹 점수 계산 유틸리티 (v4)
 *
 * 개인: 퀴즈점수(정답률×응시율) × 4 + 총 EXP × 0.6
 *   - 퀴즈점수 = 평균정답률(0~100) × 0.5 + 응시율(0~100) × 0.5
 *   - 많이 풀고 잘 풀어야 높은 점수
 * 팀: 정규화된 반 평균 EXP × 0.4 + 평균 성적 × 0.4 + 평균 응시율 × 0.2
 */

/**
 * 개인 랭킹 점수 계산
 *
 * @param correctRate 평균 정답률 (0~100)
 * @param completionRate 응시율 (0~100)
 * @param totalExp 총 경험치
 * @returns 랭킹 점수
 */
export function computeRankScore(
  correctRate: number,
  completionRate: number,
  totalExp: number,
): number {
  const quizScore = correctRate * 0.5 + completionRate * 0.5;
  return quizScore * 4 + totalExp * 0.6;
}

/**
 * 팀 랭킹 점수 계산
 *
 * @param normalizedAvgExp 정규화된 반 평균 EXP (0~100)
 * @param avgCorrectRate 반 평균 교수 퀴즈 정답률 (0~100)
 * @param avgCompletionRate 반 평균 응시율 (0~100)
 * @returns 팀 점수 (0~100)
 */
export function computeTeamScore(
  normalizedAvgExp: number,
  avgCorrectRate: number,
  avgCompletionRate: number,
): number {
  return normalizedAvgExp * 0.4 + avgCorrectRate * 0.4 + avgCompletionRate * 0.2;
}
