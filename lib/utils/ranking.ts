/**
 * 랭킹 점수 계산 유틸리티 (v3)
 *
 * 개인: 교수 퀴즈 정답 수 × 4 + 총 EXP × 0.6
 *   - 천장 없음, 점수는 절대 줄어들지 않음 (단조 증가 값만 사용)
 * 팀: 정규화된 반 평균 EXP × 0.4 + 평균 성적 × 0.4 + 평균 응시율 × 0.2
 */

/**
 * 개인 랭킹 점수 계산
 *
 * @param profCorrectCount 교수 퀴즈 정답 수 (누적, 단조 증가)
 * @param totalExp 총 경험치 (누적, 단조 증가)
 * @returns 랭킹 점수 (0 이상, 천장 없음)
 */
export function computeRankScore(
  profCorrectCount: number,
  totalExp: number,
): number {
  return profCorrectCount * 4 + totalExp * 0.6;
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
