// ============================================================
// 문제 편집기 유틸리티
// ============================================================

import type { QuestionType } from '@/lib/ocr';
import type { QuestionData } from './questionTypes';

/**
 * 고유 ID 생성
 */
export const generateId = (): string => {
  return `q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * 문제 유형 라벨
 */
export const typeLabels: Record<QuestionType, string> = {
  ox: 'OX',
  multiple: '객관식',
  short_answer: '주관식',
  subjective: '주관식',
  essay: '서술형',
  combined: '결합형',
};

/**
 * 하위 문제용 유형 라벨 (결합형, 서술형, 주관식 제외)
 */
export const subQuestionTypeLabels: Record<Exclude<QuestionType, 'combined' | 'essay' | 'subjective'>, string> = {
  ox: 'OX',
  multiple: '객관식',
  short_answer: '주관식',
};

/**
 * 실제 문제 수 계산 (하위 문제 포함)
 * - 일반 문제 1개 = 1문제
 * - 결합형 1개 (하위 문제 N개) = N문제로 계산
 */
export function calculateTotalQuestionCount(questions: QuestionData[]): number {
  return questions.reduce((total, q) => {
    if (q.type === 'combined' && q.subQuestions && q.subQuestions.length > 0) {
      return total + q.subQuestions.length;
    }
    return total + 1;
  }, 0);
}
