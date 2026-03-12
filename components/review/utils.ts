'use client';

import { MOTIVATIONAL_QUOTES } from './types';
import type { CompletedQuizData } from './types';

export { formatQuestionTypes } from '@/lib/utils/quizHelpers';

/** 랜덤 명언 가져오기 */
export function getRandomQuote(): string {
  return MOTIVATIONAL_QUOTES[Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length)];
}

/** 문제 유형 라벨 생성 */
export function getQuestionTypeLabel(quiz: CompletedQuizData): string {
  const multiple = quiz.multipleChoiceCount || 0;
  const subjective = quiz.subjectiveCount || 0;
  if (multiple > 0 && subjective > 0) {
    return `객관 ${multiple} · 주관 ${subjective}`;
  }
  if (multiple > 0) return `객관 ${multiple}문제`;
  if (subjective > 0) return `주관 ${subjective}문제`;
  return `${quiz.questionCount}문제`;
}
