/**
 * ReviewPractice 채점 유틸리티 함수
 */

import type { ReviewItem } from '@/lib/hooks/useReview';
import type { AnswerType } from './reviewPracticeTypes';

/**
 * 개별 문제 정답 체크
 * OX, 객관식(단일/복수), 단답형(복수정답 |||) 지원
 */
export function checkSingleAnswer(item: ReviewItem, userAnswer: AnswerType): boolean {
  if (!item || userAnswer === null) return false;

  const correctAnswerStr = item.correctAnswer?.toString() || '';
  const isMultipleAnswer = correctAnswerStr.includes(',');

  if (item.type === 'multiple') {
    if (isMultipleAnswer) {
      // correctAnswer와 userAnswer 모두 0-indexed
      const correctIndices = correctAnswerStr.split(',').map(s => parseInt(s.trim(), 10));
      if (Array.isArray(userAnswer)) {
        const sortedCorrect = [...correctIndices].sort((a, b) => a - b);
        const sortedUser = [...userAnswer].sort((a, b) => a - b);
        return (
          sortedCorrect.length === sortedUser.length &&
          sortedCorrect.every((val, idx) => val === sortedUser[idx])
        );
      }
      return false;
    } else {
      if (typeof userAnswer === 'number') {
        // 0-indexed 직접 비교
        return correctAnswerStr === userAnswer.toString();
      }
      return false;
    }
  }

  if (item.type === 'ox') {
    let normalizedUser = userAnswer.toString().toUpperCase();
    if (normalizedUser === '0') normalizedUser = 'O';
    else if (normalizedUser === '1') normalizedUser = 'X';
    let normalizedCorrect = correctAnswerStr.toUpperCase();
    if (normalizedCorrect === '0') normalizedCorrect = 'O';
    else if (normalizedCorrect === '1') normalizedCorrect = 'X';
    return normalizedUser === normalizedCorrect;
  }

  const userAnswerNormalized = userAnswer.toString().trim().toLowerCase();
  if (correctAnswerStr.includes('|||')) {
    const correctAnswers = correctAnswerStr.split('|||').map(a => a.trim().toLowerCase());
    return correctAnswers.some(ca => userAnswerNormalized === ca);
  }
  return userAnswerNormalized === correctAnswerStr.trim().toLowerCase();
}
