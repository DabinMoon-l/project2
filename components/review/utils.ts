'use client';

import { MOTIVATIONAL_QUOTES } from './types';
import type { CompletedQuizData } from './types';

/**
 * 문제 유형을 포맷하여 표시
 * 예: "OX 2 / 객관식 5 / 주관식 2"
 */
export function formatQuestionTypes(
  oxCount: number = 0,
  multipleChoiceCount: number = 0,
  subjectiveCount: number = 0
): string {
  const parts: string[] = [];
  if (oxCount > 0) parts.push(`OX ${oxCount}`);
  if (multipleChoiceCount > 0) parts.push(`객관식 ${multipleChoiceCount}`);
  if (subjectiveCount > 0) parts.push(`주관식 ${subjectiveCount}`);

  if (parts.length === 0) {
    const total = oxCount + multipleChoiceCount + subjectiveCount;
    return total > 0 ? `${total}문제` : '-';
  }

  return parts.join(' / ');
}

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
