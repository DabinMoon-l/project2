/**
 * XP 보상 상수 — 서버(functions/src/utils/gold.ts)와 동일하게 유지
 *
 * 실제 XP 지급은 Cloud Functions에서 수행.
 * 이 파일은 클라이언트 토스트 표시용.
 */

export const EXP_REWARDS = {
  // 퀴즈 완료 (점수 기반)
  QUIZ_PERFECT: 50,       // 만점
  QUIZ_EXCELLENT: 40,     // 90% 이상
  QUIZ_GOOD: 35,          // 70% 이상
  QUIZ_PASS: 30,          // 50% 이상
  QUIZ_FAIL: 25,          // 50% 미만 (참여 보상)

  // 퀴즈 생성
  QUIZ_CREATE: 50,        // 커스텀 퀴즈 생성 (공개)
  QUIZ_AI_SAVE: 25,       // AI 퀴즈 서재 저장 (비공개)
  QUIZ_MAKE_PUBLIC: 10,   // 서재 퀴즈 공개 전환

  // 피드백
  FEEDBACK_SUBMIT: 10,    // 피드백 1개당

  // 게시판
  POST_CREATE: 15,        // 글 작성
  COMMENT_CREATE: 15,     // 댓글 작성
} as const;

/** 퀴즈 점수에 따른 XP 계산 */
export function calculateQuizExp(score: number): number {
  if (score === 100) return EXP_REWARDS.QUIZ_PERFECT;
  if (score >= 90) return EXP_REWARDS.QUIZ_EXCELLENT;
  if (score >= 70) return EXP_REWARDS.QUIZ_GOOD;
  if (score >= 50) return EXP_REWARDS.QUIZ_PASS;
  return EXP_REWARDS.QUIZ_FAIL;
}
