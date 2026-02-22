import { type FeedbackType } from '@/components/quiz/InstantFeedbackButton';

/**
 * 피드백 타입별 점수 매핑 (-2 ~ +2)
 */
export const FEEDBACK_SCORES: Record<FeedbackType, number> = {
  praise: 2,    // 문제가 좋아요!
  wantmore: 1,  // 더 풀고 싶어요
  other: 0,     // 기타
  typo: -1,     // 오타
  unclear: -1,  // 이해 안 됨
  wrong: -2,    // 정답 틀림
};

/**
 * 피드백 배열의 평균 점수 계산
 * @returns 평균 점수 (-2 ~ +2), 피드백 없으면 0
 */
export function calcFeedbackScore(feedbacks: { type: FeedbackType }[]): number {
  if (!feedbacks.length) return 0;
  const sum = feedbacks.reduce((acc, fb) => acc + (FEEDBACK_SCORES[fb.type] ?? 0), 0);
  return Math.round((sum / feedbacks.length) * 100) / 100;
}

/**
 * 점수에 따른 라벨과 색상 반환
 */
export function getFeedbackLabel(score: number): { label: string; color: string } {
  if (score >= 1) return { label: '좋음', color: '#16a34a' };   // 초록
  if (score >= 0) return { label: '보통', color: '#6b7280' };   // 회색
  return { label: '나쁨', color: '#dc2626' };                    // 빨강
}
