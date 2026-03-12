// ============================================================
// 문제 편집기 유틸리티
// ============================================================

import type { QuestionType } from '@/lib/ocr';
import type { QuestionData, MixedExampleBlock, MixedExampleItem } from './questionTypes';
import { KOREAN_LABELS } from './questionTypes';

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

/**
 * QuestionEditor 초기 데이터 생성
 * 새 문제 또는 기존 문제의 포맷 마이그레이션 처리
 */
export function getInitialQuestionData(initialQuestion?: QuestionData): QuestionData {
  if (!initialQuestion) {
    // 새 문제
    return {
      id: generateId(),
      text: '',
      type: 'multiple',
      choices: ['', ''],
      answerIndex: -1,
      answerIndices: [],
      answerText: '',
      answerTexts: [''],
      explanation: '',
      imageUrl: null,
      examples: null,
      mixedExamples: [],
      scoringMethod: 'manual',
      subQuestions: [],
      passageType: 'text',
      koreanAbcItems: [],
      passageImage: null,
      passage: '',
    };
  }

  // 기존 QuestionData인 경우
  const existing = initialQuestion;
  // answerTexts 초기화: 기존 answerText가 있으면 파싱
  let answerTexts = existing.answerTexts || [];
  if (answerTexts.length === 0 && existing.answerText) {
    // 쉼표로 구분된 복수 정답 파싱
    answerTexts = existing.answerText.includes('|||')
      ? existing.answerText.split('|||').map(s => s.trim())
      : [existing.answerText];
  }
  if (answerTexts.length === 0) {
    answerTexts = [''];
  }
  // 기존 examples를 mixedExamples 블록으로 마이그레이션
  let mixedExamples: MixedExampleBlock[] = [];

  // 기존 mixedExamples가 있으면 새 블록 구조로 변환
  if (existing.mixedExamples && existing.mixedExamples.length > 0) {
    // 이전 형식(MixedExampleItem[])인지 새 형식(MixedExampleBlock[])인지 확인
    const firstItem = existing.mixedExamples[0] as MixedExampleBlock | MixedExampleItem;
    if ('items' in firstItem || (firstItem.type === 'text' && 'content' in firstItem && !('label' in firstItem))) {
      // 이미 새 형식
      mixedExamples = existing.mixedExamples as MixedExampleBlock[];
    } else {
      // 이전 형식 → 새 형식으로 변환
      // labeled 항목들을 하나의 블록으로 그룹화
      const oldItems = existing.mixedExamples as unknown as MixedExampleItem[];
      const labeledItems = oldItems.filter(item => item.type === 'labeled');
      const textItems = oldItems.filter(item => item.type === 'text');

      // 텍스트 항목들을 개별 블록으로
      textItems.forEach(item => {
        mixedExamples.push({
          id: item.id,
          type: 'text',
          content: item.content,
        });
      });

      // labeled 항목들을 하나의 블록으로
      if (labeledItems.length > 0) {
        mixedExamples.push({
          id: `labeled_${Date.now()}`,
          type: 'labeled',
          items: labeledItems.map((item, idx) => ({
            id: item.id,
            label: item.label || KOREAN_LABELS[idx],
            content: item.content,
          })),
        });
      }
    }
  } else if (existing.examples?.items?.length) {
    // 기존 examples를 mixedExamples 블록으로 변환
    if (existing.examples.type === 'labeled') {
      // ㄱㄴㄷ 형식 → labeled 블록 하나
      mixedExamples = [{
        id: `labeled_${Date.now()}`,
        type: 'labeled',
        items: existing.examples.items.map((content, idx) => ({
          id: `item_${Date.now()}_${idx}`,
          label: KOREAN_LABELS[idx],
          content,
        })),
      }];
    } else {
      // 텍스트 형식 → text 블록들
      mixedExamples = existing.examples.items.map((content, idx) => ({
        id: `text_${Date.now()}_${idx}`,
        type: 'text' as const,
        content,
      }));
    }
  }

  return {
    ...existing,
    answerIndices: existing.answerIndices || [],
    answerTexts,
    imageUrl: existing.imageUrl || null,
    examples: existing.examples || null,
    mixedExamples,
    scoringMethod: existing.scoringMethod || 'manual',
    subQuestions: existing.subQuestions || [],
    passageType: existing.passageType || 'text',
    koreanAbcItems: existing.koreanAbcItems || [],
    passageImage: existing.passageImage || null,
    passage: existing.passage || '',
  };
}
