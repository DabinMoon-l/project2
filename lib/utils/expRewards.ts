/**
 * EXP 보상 상수 + 헬퍼
 * 단일 소스: shared/expRewards.json
 * 서버(functions/src/utils/gold.ts)와 동일한 JSON을 참조
 */
import EXP_VALUES from "@/shared/expRewards.json";

export const EXP_REWARDS = EXP_VALUES;

/** 퀴즈 점수에 따른 XP 계산 (서버 calculateQuizExp와 동일 로직) */
export function calculateQuizExp(score: number): number {
  if (score === 100) return EXP_REWARDS.QUIZ_PERFECT;
  if (score >= 90) return EXP_REWARDS.QUIZ_EXCELLENT;
  if (score >= 70) return EXP_REWARDS.QUIZ_GOOD;
  if (score >= 50) return EXP_REWARDS.QUIZ_PASS;
  return EXP_REWARDS.QUIZ_FAIL;
}
