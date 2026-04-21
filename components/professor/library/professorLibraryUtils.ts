/**
 * ProfessorLibraryTab 유틸리티 함수
 *
 * 신문 배경 텍스트, AI 제목 판별, 문제 유형 포맷,
 * Firestore 문제 → QuestionData 변환
 */

import type { QuestionData, SubQuestion } from '@/components/quiz/create/questionTypes';
export { NEWSPAPER_BG_TEXT } from '@/lib/utils/quizHelpers';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyValue = any;

/** AI 기본 제목 판별 (날짜 형식이면 serif 비적용) */
export function isDefaultAiTitle(title: string): boolean {
  return /^\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.\s*\d{1,2}:\d{2}$/.test(title.trim());
}

/** 문제 유형 라벨 */
export function formatQuestionTypes(questions: AnyValue[]): string {
  let ox = 0, mc = 0, sa = 0;
  for (const q of questions) {
    if (q.type === 'ox') ox++;
    else if (q.type === 'multiple') mc++;
    else if (q.type === 'short_answer') sa++;
  }
  const parts: string[] = [];
  if (ox > 0) parts.push(`OX ${ox}`);
  if (mc > 0) parts.push(`객관식 ${mc}`);
  if (sa > 0) parts.push(`주관식 ${sa}`);
  return parts.length > 0 ? parts.join(' / ') : `${questions.length}문제`;
}

/**
 * Firestore 문제 → QuestionData 변환
 *
 * 결합형 문제 그룹핑, 0-indexed answer 변환 포함
 */
export const convertToQuestionDataList = (rawQuestions: AnyValue[]): QuestionData[] => {
  const loadedQuestions: QuestionData[] = [];
  const processedCombinedGroups = new Set<string>();

  rawQuestions.forEach((q: AnyValue, index: number) => {
    if (q.combinedGroupId) {
      if (processedCombinedGroups.has(q.combinedGroupId)) return;
      processedCombinedGroups.add(q.combinedGroupId);

      const groupQuestions = rawQuestions
        .filter((gq: AnyValue) => gq.combinedGroupId === q.combinedGroupId)
        .sort((a: AnyValue, b: AnyValue) => (a.combinedIndex || 0) - (b.combinedIndex || 0));

      const firstQ = groupQuestions[0] as AnyValue;

      const subQuestions: SubQuestion[] = groupQuestions.map((sq: AnyValue) => {
        let answerIndex = -1;
        let answerIndices: number[] | undefined;
        let isMultipleAnswer = false;

        if (sq.type === 'multiple') {
          if (Array.isArray(sq.answer)) {
            const sqChoiceCount = (sq.choices || []).length || 4;
            const anyOver = sq.answer.some((a: number) => typeof a === 'number' && a >= sqChoiceCount);
            answerIndices = anyOver ? sq.answer.map((a: number) => typeof a === 'number' ? a - 1 : a) : [...sq.answer];
            isMultipleAnswer = true;
            answerIndex = (answerIndices && answerIndices[0] !== undefined) ? answerIndices[0] : -1;
          } else if (typeof sq.answer === 'number') {
            const sqChoiceCount = (sq.choices || []).length || 4;
            if (sq.answer >= sqChoiceCount) {
              answerIndex = sq.answer - 1;
            } else if (sq.answer >= 0) {
              answerIndex = sq.answer;
            }
          }
        } else if (sq.type === 'ox' && typeof sq.answer === 'number') {
          answerIndex = sq.answer;
        }
        return {
          id: sq.id || `${q.combinedGroupId}_${sq.combinedIndex || 0}`,
          text: sq.text || '',
          type: sq.type || 'multiple',
          choices: sq.choices || undefined,
          answerIndex: sq.type === 'multiple' || sq.type === 'ox' ? answerIndex : undefined,
          answerIndices: isMultipleAnswer ? answerIndices : undefined,
          isMultipleAnswer: isMultipleAnswer || undefined,
          answerText: typeof sq.answer === 'string' ? sq.answer : undefined,
          explanation: sq.explanation || undefined,
          choiceExplanations: Array.isArray((sq as { choiceExplanations?: string[] }).choiceExplanations)
            ? [...((sq as { choiceExplanations?: string[] }).choiceExplanations as string[])]
            : undefined,
          mixedExamples: sq.examples || sq.mixedExamples || undefined,
          image: sq.imageUrl || undefined,
          chapterId: sq.chapterId || undefined,
          chapterDetailId: sq.chapterDetailId || undefined,
          passagePrompt: sq.passagePrompt || undefined,
          bogi: sq.bogi || null,
          passageBlocks: sq.passageBlocks || undefined,
        };
      });

      loadedQuestions.push({
        id: q.combinedGroupId,
        text: firstQ.combinedMainText || '',
        type: 'combined',
        choices: [],
        answerIndex: -1,
        answerText: '',
        explanation: '',
        subQuestions,
        passageType: firstQ.passageType || undefined,
        passage: firstQ.passage || undefined,
        koreanAbcItems: firstQ.koreanAbcItems || undefined,
        passageMixedExamples: firstQ.passageMixedExamples || undefined,
        passageImage: firstQ.passageImage || undefined,
        commonQuestion: firstQ.commonQuestion || undefined,
      });
    } else {
      let answerIndex = -1;
      let answerIndices: number[] | undefined;
      let isMultipleAnswer = false;

      if (q.type === 'multiple') {
        if (Array.isArray(q.answer)) {
          const qChoiceCount = (q.choices || []).length || 4;
          const anyOver = q.answer.some((a: number) => typeof a === 'number' && a >= qChoiceCount);
          answerIndices = anyOver ? q.answer.map((a: number) => typeof a === 'number' ? a - 1 : a) : [...q.answer];
          isMultipleAnswer = true;
          answerIndex = (answerIndices && answerIndices[0] !== undefined) ? answerIndices[0] : -1;
        } else if (typeof q.answer === 'number') {
          const qChoiceCount = (q.choices || []).length || 4;
          if (q.answer >= qChoiceCount) {
            answerIndex = q.answer - 1;
          } else if (q.answer >= 0) {
            answerIndex = q.answer;
          }
        }
      } else if (q.type === 'ox' && typeof q.answer === 'number') {
        answerIndex = q.answer;
      }

      loadedQuestions.push({
        id: q.id || `q_${index}`,
        text: q.text || '',
        type: q.type || 'multiple',
        choices: q.choices || ['', '', '', ''],
        answerIndex,
        answerIndices: isMultipleAnswer ? answerIndices : undefined,
        isMultipleAnswer: isMultipleAnswer || undefined,
        answerText: typeof q.answer === 'string' ? q.answer : '',
        explanation: q.explanation || '',
        choiceExplanations: Array.isArray((q as { choiceExplanations?: string[] }).choiceExplanations)
          ? [...((q as { choiceExplanations?: string[] }).choiceExplanations as string[])]
          : undefined,
        imageUrl: q.imageUrl || null,
        examples: q.examples || null,
        mixedExamples: q.mixedExamples || null,
        chapterId: q.chapterId || undefined,
        chapterDetailId: q.chapterDetailId || undefined,
        passagePrompt: q.passagePrompt || undefined,
        bogi: q.bogi || null,
        scoringMethod: q.scoringMethod || undefined,
        passageBlocks: q.passageBlocks || undefined,
      });
    }
  });

  return loadedQuestions;
};
