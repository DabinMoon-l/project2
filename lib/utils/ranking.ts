/**
 * 랭킹 점수 계산 유틸리티 (v2)
 *
 * 개인: 교수 퀴즈 정답률 × 0.4 + EXP 백분위 × 0.6
 * 팀: 정규화된 반 평균 EXP × 0.4 + 평균 성적 × 0.4 + 평균 응시율 × 0.2
 */

/**
 * 개인 랭킹 점수 계산
 *
 * @param professorCorrectRate 교수 퀴즈 정답률 (0~100), 미응시 시 50
 * @param expPercentile EXP 백분위 (0~100)
 * @returns 랭킹 점수 (0~100)
 */
export function computeRankScore(
  professorCorrectRate: number,
  expPercentile: number,
): number {
  return professorCorrectRate * 0.4 + expPercentile * 0.6;
}

/**
 * EXP 백분위 계산
 * 나보다 EXP 낮은 학생 수 / 전체 학생 수 × 100
 */
export function computeExpPercentile(myExp: number, allExps: number[]): number {
  if (allExps.length <= 1) return 100;
  const below = allExps.filter(e => e < myExp).length;
  return (below / allExps.length) * 100;
}

/**
 * 교수 퀴즈 정답률 계산
 * 미응시 시 기본값 50
 */
export function computeProfessorCorrectRate(
  correctCount: number,
  attemptedCount: number,
): number {
  if (attemptedCount === 0) return 0;
  return (correctCount / attemptedCount) * 100;
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
