/**
 * 서술형 문제 채점 로직
 *
 * 서술형 문제의 부분점수 채점을 위한 유틸리티 함수들을 제공합니다.
 * 루브릭(평가요소) 기반으로 학생 답안을 평가하고 점수를 산출합니다.
 */

import { RubricItem } from './ocr';

// ============================================================
// 타입 정의
// ============================================================

/**
 * 평가 결과 (각 루브릭 항목별)
 */
export interface RubricScore {
  /** 루브릭 항목 인덱스 */
  criteriaIndex: number;
  /** 평가요소 이름 */
  criteria: string;
  /** 최대 배점 비율 (0~100) */
  maxPercentage: number;
  /** 획득 비율 (0~maxPercentage) */
  achievedPercentage: number;
  /** 피드백 코멘트 (선택) */
  feedback?: string;
}

/**
 * 서술형 문제 채점 결과
 */
export interface EssayScoreResult {
  /** 문제 ID */
  questionId: string;
  /** 최종 점수 (0~100) */
  totalScore: number;
  /** 각 루브릭 항목별 점수 */
  rubricScores: RubricScore[];
  /** 전체 피드백 (선택) */
  overallFeedback?: string;
}

/**
 * 채점 입력
 */
export interface EssayScoreInput {
  /** 문제 ID */
  questionId: string;
  /** 완벽한 답 (모범답안) */
  modelAnswer: string;
  /** 학생 답안 */
  studentAnswer: string;
  /** 루브릭 (평가요소 목록) */
  rubric: RubricItem[];
}

/**
 * 달성도 레벨
 */
export type AchievementLevel = 'full' | 'partial' | 'none';

// ============================================================
// 채점 함수
// ============================================================

/**
 * 수동 채점용: 각 루브릭 항목별 점수를 합산하여 최종 점수 계산
 *
 * @param rubricScores - 각 루브릭 항목별 채점 결과
 * @returns 최종 점수 (0~100)
 *
 * @example
 * const scores = [
 *   { criteriaIndex: 0, criteria: '개념 이해', maxPercentage: 40, achievedPercentage: 32 },
 *   { criteriaIndex: 1, criteria: '적용 능력', maxPercentage: 60, achievedPercentage: 45 },
 * ];
 * const total = calculateEssayScore(scores); // 77
 */
export function calculateEssayScore(rubricScores: RubricScore[]): number {
  // 각 항목의 achievedPercentage 합산
  const totalScore = rubricScores.reduce(
    (sum, item) => sum + item.achievedPercentage,
    0
  );

  // 0~100 범위로 클램핑
  return Math.min(100, Math.max(0, totalScore));
}

/**
 * 빈 채점 결과 생성 (교수가 채점 시작할 때 사용)
 *
 * 각 루브릭 항목에 대해 초기 점수를 0으로 설정한 채점 결과를 생성합니다.
 *
 * @param questionId - 문제 ID
 * @param rubric - 루브릭 (평가요소 목록)
 * @returns 초기화된 채점 결과
 *
 * @example
 * const rubric = [
 *   { criteria: '개념 이해', percentage: 40 },
 *   { criteria: '적용 능력', percentage: 60 },
 * ];
 * const emptyScore = createEmptyEssayScore('q1', rubric);
 */
export function createEmptyEssayScore(
  questionId: string,
  rubric: RubricItem[]
): EssayScoreResult {
  const rubricScores: RubricScore[] = rubric.map((item, index) => ({
    criteriaIndex: index,
    criteria: item.criteria,
    maxPercentage: item.percentage,
    achievedPercentage: 0,
    feedback: undefined,
  }));

  return {
    questionId,
    totalScore: 0,
    rubricScores,
    overallFeedback: undefined,
  };
}

/**
 * 채점 결과 유효성 검사
 *
 * - achievedPercentage가 maxPercentage를 초과하지 않는지 확인
 * - achievedPercentage가 음수가 아닌지 확인
 * - 총점이 100을 초과하지 않는지 확인
 *
 * @param result - 검사할 채점 결과
 * @returns 유효성 검사 통과 여부
 *
 * @example
 * const result = {
 *   questionId: 'q1',
 *   totalScore: 77,
 *   rubricScores: [
 *     { criteriaIndex: 0, criteria: '개념 이해', maxPercentage: 40, achievedPercentage: 32 },
 *     { criteriaIndex: 1, criteria: '적용 능력', maxPercentage: 60, achievedPercentage: 45 },
 *   ],
 * };
 * const isValid = validateEssayScore(result); // true
 */
export function validateEssayScore(result: EssayScoreResult): boolean {
  // 각 루브릭 항목 검사
  for (const score of result.rubricScores) {
    // achievedPercentage가 음수인지 확인
    if (score.achievedPercentage < 0) {
      return false;
    }

    // achievedPercentage가 maxPercentage를 초과하는지 확인
    if (score.achievedPercentage > score.maxPercentage) {
      return false;
    }
  }

  // 총점 계산
  const calculatedTotal = calculateEssayScore(result.rubricScores);

  // 저장된 총점이 계산된 총점과 일치하는지 확인 (허용 오차: 0.01)
  if (Math.abs(result.totalScore - calculatedTotal) > 0.01) {
    return false;
  }

  // 총점이 100을 초과하지 않는지 확인
  if (result.totalScore > 100) {
    return false;
  }

  return true;
}

// ============================================================
// 유틸리티 함수
// ============================================================

/**
 * 점수를 등급으로 변환
 *
 * @param score - 점수 (0~100)
 * @returns 등급 (A, B, C, D, F)
 *
 * @example
 * scoreToGrade(95); // 'A'
 * scoreToGrade(85); // 'B'
 * scoreToGrade(75); // 'C'
 * scoreToGrade(65); // 'D'
 * scoreToGrade(55); // 'F'
 */
export function scoreToGrade(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

/**
 * 루브릭 항목별 달성도 계산 헬퍼
 *
 * 달성도 레벨에 따라 점수를 계산합니다:
 * - full: 최대 배점 100% 획득
 * - partial: 최대 배점 50% 획득
 * - none: 0점
 *
 * @param maxPercentage - 최대 배점 비율
 * @param achievementLevel - 달성도 레벨 ('full', 'partial', 'none')
 * @returns 획득 비율
 *
 * @example
 * calculateAchievement(40, 'full');    // 40
 * calculateAchievement(40, 'partial'); // 20
 * calculateAchievement(40, 'none');    // 0
 */
export function calculateAchievement(
  maxPercentage: number,
  achievementLevel: AchievementLevel
): number {
  switch (achievementLevel) {
    case 'full':
      return maxPercentage;
    case 'partial':
      return maxPercentage * 0.5;
    case 'none':
      return 0;
  }
}

/**
 * 세부 달성도 계산 헬퍼 (비율 기반)
 *
 * 0~1 사이의 비율을 받아 획득 점수를 계산합니다.
 *
 * @param maxPercentage - 최대 배점 비율
 * @param ratio - 달성 비율 (0~1)
 * @returns 획득 비율
 *
 * @example
 * calculateAchievementByRatio(40, 0.8); // 32
 * calculateAchievementByRatio(40, 0.5); // 20
 * calculateAchievementByRatio(40, 0);   // 0
 */
export function calculateAchievementByRatio(
  maxPercentage: number,
  ratio: number
): number {
  // 비율을 0~1 범위로 클램핑
  const clampedRatio = Math.min(1, Math.max(0, ratio));
  return maxPercentage * clampedRatio;
}

/**
 * 루브릭 유효성 검사
 *
 * 루브릭의 percentage 합이 100인지 확인합니다.
 *
 * @param rubric - 루브릭 (평가요소 목록)
 * @returns 유효성 검사 결과 (valid: 통과 여부, totalPercentage: 실제 합계)
 *
 * @example
 * const rubric = [
 *   { criteria: '개념 이해', percentage: 40 },
 *   { criteria: '적용 능력', percentage: 60 },
 * ];
 * validateRubric(rubric); // { valid: true, totalPercentage: 100 }
 */
export function validateRubric(
  rubric: RubricItem[]
): { valid: boolean; totalPercentage: number } {
  const totalPercentage = rubric.reduce(
    (sum, item) => sum + item.percentage,
    0
  );

  return {
    valid: Math.abs(totalPercentage - 100) < 0.01, // 허용 오차: 0.01
    totalPercentage,
  };
}

/**
 * 채점 결과 업데이트
 *
 * 특정 루브릭 항목의 점수를 업데이트하고 총점을 재계산합니다.
 *
 * @param result - 기존 채점 결과
 * @param criteriaIndex - 업데이트할 루브릭 항목 인덱스
 * @param achievedPercentage - 새로운 획득 비율
 * @param feedback - 피드백 코멘트 (선택)
 * @returns 업데이트된 채점 결과
 *
 * @example
 * const updated = updateRubricScore(result, 0, 32, '개념은 이해했으나 일부 설명이 부족');
 */
export function updateRubricScore(
  result: EssayScoreResult,
  criteriaIndex: number,
  achievedPercentage: number,
  feedback?: string
): EssayScoreResult {
  // 루브릭 점수 배열 복사
  const newRubricScores = result.rubricScores.map((score, index) => {
    if (index === criteriaIndex) {
      // 획득 비율이 최대 배점을 초과하지 않도록 클램핑
      const clampedAchieved = Math.min(
        score.maxPercentage,
        Math.max(0, achievedPercentage)
      );

      return {
        ...score,
        achievedPercentage: clampedAchieved,
        feedback: feedback !== undefined ? feedback : score.feedback,
      };
    }
    return score;
  });

  // 총점 재계산
  const newTotalScore = calculateEssayScore(newRubricScores);

  return {
    ...result,
    rubricScores: newRubricScores,
    totalScore: newTotalScore,
  };
}

/**
 * 전체 피드백 업데이트
 *
 * @param result - 기존 채점 결과
 * @param overallFeedback - 전체 피드백
 * @returns 업데이트된 채점 결과
 */
export function updateOverallFeedback(
  result: EssayScoreResult,
  overallFeedback: string
): EssayScoreResult {
  return {
    ...result,
    overallFeedback,
  };
}

/**
 * 채점 결과 요약 생성
 *
 * 채점 결과를 사람이 읽기 쉬운 형태로 요약합니다.
 *
 * @param result - 채점 결과
 * @returns 요약 문자열
 *
 * @example
 * const summary = generateScoreSummary(result);
 * // "총점: 77점 (B등급)\n\n[세부 점수]\n- 개념 이해: 32/40점\n- 적용 능력: 45/60점"
 */
export function generateScoreSummary(result: EssayScoreResult): string {
  const grade = scoreToGrade(result.totalScore);

  let summary = `총점: ${result.totalScore}점 (${grade}등급)\n\n[세부 점수]`;

  for (const score of result.rubricScores) {
    summary += `\n- ${score.criteria}: ${score.achievedPercentage}/${score.maxPercentage}점`;
    if (score.feedback) {
      summary += ` (${score.feedback})`;
    }
  }

  if (result.overallFeedback) {
    summary += `\n\n[전체 피드백]\n${result.overallFeedback}`;
  }

  return summary;
}
