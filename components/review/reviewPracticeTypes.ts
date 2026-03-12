/**
 * ReviewPractice 관련 타입 정의
 */

import type { ReviewItem } from '@/lib/hooks/useReview';

export interface ReviewPracticeProps {
  /** 복습할 문제 목록 */
  items: ReviewItem[];
  /** 퀴즈 제목 (선택) */
  quizTitle?: string;
  /** 완료 핸들러 */
  onComplete: (results: PracticeResult[]) => void;
  /** 닫기 핸들러 */
  onClose: () => void;
  /** 현재 사용자 ID (본인 문제 피드백 방지용) */
  currentUserId?: string;
  /** 헤더 타이틀 커스터마이징 (기본값: "복습") */
  headerTitle?: string;
  /** 피드백 기능 표시 여부 (기본값: true) */
  showFeedback?: boolean;
}

/**
 * 연습 결과 타입
 */
export interface PracticeResult {
  /** 복습 문제 ID */
  reviewId: string;
  /** 퀴즈 ID */
  quizId: string;
  /** 문제 ID (통계 반영용) */
  questionId: string;
  /** 사용자 답변 */
  userAnswer: string;
  /** 정답 여부 */
  isCorrect: boolean;
}

/** 답안 타입 */
export type AnswerType = string | number | number[] | null;

/** 화면 단계 */
export type Phase = 'practice' | 'result' | 'feedback';

/** ㄱㄴㄷ 라벨 */
export const KOREAN_LABELS = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ'];

/** 문제 유형 라벨 */
export const TYPE_LABELS: Record<string, string> = {
  ox: 'OX',
  multiple: '객관식',
  short: '주관식',
  short_answer: '주관식',
  subjective: '주관식',
};
