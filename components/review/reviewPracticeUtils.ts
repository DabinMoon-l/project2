/**
 * ReviewPractice 채점 유틸리티 함수
 *
 * 핵심 채점 로직은 lib/utils/gradeAnswer.ts에 위임.
 * 이 래퍼는 ReviewItem 타입에서 필요한 필드를 추출하여 호출만 담당한다.
 */

import type { ReviewItem } from '@/lib/hooks/useReview';
import type { AnswerType } from './reviewPracticeTypes';
import { gradeAnswer } from '@/lib/utils/gradeAnswer';

/**
 * 개별 문제 정답 체크
 * OX, 객관식(단일/복수), 단답형(복수정답 |||) 지원
 */
export function checkSingleAnswer(item: ReviewItem, userAnswer: AnswerType): boolean {
  if (!item || userAnswer === null) return false;
  return gradeAnswer(item.type, item.correctAnswer, userAnswer);
}
