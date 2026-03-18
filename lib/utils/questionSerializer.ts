/**
 * 문제 직렬화 유틸리티
 *
 * QuestionData[] → Firestore 저장 형식 변환 (flattenQuestionsForSave)
 * 문제 변경 감지 (isQuestionChanged, isQuestionChangedForSubQuestion)
 *
 * 사용처: preview, edit, ProfessorLibraryTab, review/[type]/[id]
 */

import type { QuestionData, SubQuestion } from '@/components/quiz/create/questionTypes';
import { Timestamp } from '@/lib/repositories';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyValue = any;

/** OX 정답 정규화: 0/"0"/"O"/"TRUE" → 0, 1/"1"/"X"/"FALSE" → 1 */
const normalizeOx = (v: AnyValue) => {
  const s = String(v).toUpperCase();
  if (s === '0' || s === 'O' || s === 'TRUE') return 0;
  if (s === '1' || s === 'X' || s === 'FALSE') return 1;
  return v;
};

/** 일반 문제 변경 감지 */
export function isQuestionChanged(original: AnyValue | undefined, current: QuestionData): boolean {
  if (!original) return true;
  if ((original.text || '') !== (current.text || '')) return true;
  if (original.type !== current.type) return true;

  // 정답 비교
  if (current.type === 'subjective' || current.type === 'short_answer') {
    if ((original.answer?.toString() || '') !== (current.answerText || '')) return true;
  } else if (current.type === 'multiple') {
    if (Array.isArray(original.answer)) {
      // 복수정답: 배열 비교
      const origSorted = [...original.answer].map(Number).sort();
      const currSorted = current.answerIndices ? [...current.answerIndices].sort() : [current.answerIndex];
      if (JSON.stringify(origSorted) !== JSON.stringify(currSorted)) return true;
    } else if (typeof original.answer === 'string' && original.answer.includes(',')) {
      // 복수정답 문자열 ("0,2")
      const origSorted = original.answer.split(',').map((s: string) => parseInt(s.trim(), 10)).sort();
      const currSorted = current.answerIndices ? [...current.answerIndices].sort() : [current.answerIndex];
      if (JSON.stringify(origSorted) !== JSON.stringify(currSorted)) return true;
    } else {
      const origNum = parseInt(String(original.answer), 10);
      if (!isNaN(origNum)) {
        const choiceCount = (original.choices || []).length || 4;
        const origAnswer = origNum >= choiceCount ? origNum - 1 : origNum;
        if (origAnswer !== current.answerIndex) return true;
      } else if (current.answerIndex !== -1) return true;
    }
  } else if (current.type === 'ox') {
    if (normalizeOx(original.answer) !== normalizeOx(current.answerIndex)) return true;
  } else {
    if (original.answer !== current.answerIndex) return true;
  }

  // 선지 비교 (객관식)
  if (current.type === 'multiple') {
    const origChoices = original.choices || [];
    const currChoices = current.choices?.filter((c) => c.trim()) || [];
    if (origChoices.length !== currChoices.length) return true;
    for (let i = 0; i < currChoices.length; i++) {
      if (origChoices[i] !== currChoices[i]) return true;
    }
  }

  if ((original.explanation || '') !== (current.explanation || '')) return true;
  if ((original.imageUrl || null) !== (current.imageUrl || null)) return true;
  if ((original.passagePrompt || '') !== (current.passagePrompt || '')) return true;
  if (JSON.stringify(original.bogi || null) !== JSON.stringify(current.bogi || null)) return true;
  return false;
}

/** 결합형 하위 문제 변경 감지 */
export function isQuestionChangedForSubQuestion(original: AnyValue, current: SubQuestion): boolean {
  if (!original) return true;
  if (original.text !== current.text) return true;
  if (original.type !== current.type) return true;

  if (current.type === 'subjective' || current.type === 'short_answer') {
    if (original.answer !== (current.answerText || '')) return true;
  } else if (current.type === 'multiple') {
    if (Array.isArray(original.answer)) {
      const origSorted = [...original.answer].map(Number).sort();
      const currSorted = current.answerIndices ? [...current.answerIndices].sort() : [current.answerIndex ?? -1];
      if (JSON.stringify(origSorted) !== JSON.stringify(currSorted)) return true;
    } else if (typeof original.answer === 'string' && original.answer.includes(',')) {
      const origSorted = original.answer.split(',').map((s: string) => parseInt(s.trim(), 10)).sort();
      const currSorted = current.answerIndices ? [...current.answerIndices].sort() : [current.answerIndex ?? -1];
      if (JSON.stringify(origSorted) !== JSON.stringify(currSorted)) return true;
    } else {
      const origNum = parseInt(String(original.answer), 10);
      if (!isNaN(origNum)) {
        const choiceCount = (original.choices || []).length || 4;
        const origAnswer = origNum >= choiceCount ? origNum - 1 : origNum;
        if (origAnswer !== (current.answerIndex ?? -1)) return true;
      } else if ((current.answerIndex ?? -1) !== -1) return true;
    }
  } else if (current.type === 'ox') {
    if (normalizeOx(original.answer) !== normalizeOx(current.answerIndex ?? 0)) return true;
  }

  if (current.type === 'multiple') {
    const origChoices = original.choices || [];
    const currChoices = (current.choices || []).filter((c) => c.trim());
    if (origChoices.length !== currChoices.length) return true;
    for (let i = 0; i < currChoices.length; i++) {
      if (origChoices[i] !== currChoices[i]) return true;
    }
  }

  if ((original.explanation || '') !== (current.explanation || '')) return true;
  if ((original.imageUrl || null) !== (current.image || null)) return true;
  if ((original.passagePrompt || '') !== (current.passagePrompt || '')) return true;
  if (JSON.stringify(original.bogi || null) !== JSON.stringify(current.bogi || null)) return true;
  return false;
}

export interface FlattenOptions {
  /** 변경 감지 + questionUpdatedAt 설정 여부 (기본: false) */
  trackChanges?: boolean;
  /** trackChanges=true일 때, 실제 questionUpdatedAt 갱신 여부 (기본: true) */
  useQuestionUpdatedAt?: boolean;
  /** undefined 값 제거 여부 — Firestore 호환 (기본: false) */
  cleanupUndefined?: boolean;
}

/**
 * QuestionData[] → Firestore 저장 형식 배열로 변환
 *
 * 결합형 문제를 개별 하위 문제로 펼치고, 원본 필드를 보존하며 수정된 필드를 덮어씁니다.
 */
export function flattenQuestionsForSave(
  editableQuestions: QuestionData[],
  originalQuestions: AnyValue[],
  options?: FlattenOptions,
): AnyValue[] {
  const trackChanges = options?.trackChanges ?? false;
  const useQuestionUpdatedAt = options?.useQuestionUpdatedAt ?? true;
  const cleanupUndefined = options?.cleanupUndefined ?? false;

  const flattenedQuestions: AnyValue[] = [];
  let orderIndex = 0;

  editableQuestions.forEach((q) => {
    if (q.type === 'combined' && q.subQuestions && q.subQuestions.length > 0) {
      const combinedGroupId = q.id || `combined_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const subQuestionsCount = q.subQuestions.length;

      // 결합형 공통 지문 변경 감지
      let parentChanged = false;
      if (trackChanges) {
        const origFirstQ = originalQuestions.find(
          (oq) => oq.combinedGroupId === combinedGroupId && (oq.combinedIndex === 0 || oq.combinedIndex === undefined)
        );
        if (!origFirstQ) {
          parentChanged = true;
        } else {
          if ((origFirstQ.passage || '') !== (q.passage || '')) parentChanged = true;
          if ((origFirstQ.passageImage || null) !== (q.passageImage || null)) parentChanged = true;
          if ((origFirstQ.commonQuestion || '') !== (q.commonQuestion || '')) parentChanged = true;
          if ((origFirstQ.combinedMainText || '') !== (q.text || '')) parentChanged = true;
          if (JSON.stringify(origFirstQ.koreanAbcItems || null) !== JSON.stringify(q.koreanAbcItems || null)) parentChanged = true;
          if (JSON.stringify(origFirstQ.passageMixedExamples || null) !== JSON.stringify(q.passageMixedExamples || null)) parentChanged = true;
        }
      }

      q.subQuestions.forEach((sq, sqIndex) => {
        let answer: string | number | number[];
        if (sq.type === 'subjective' || sq.type === 'short_answer') {
          answer = sq.answerText || '';
        } else if (sq.type === 'multiple') {
          if (sq.answerIndices && sq.answerIndices.length > 1) {
            // 복수정답: 배열로 저장
            answer = sq.answerIndices;
          } else if (sq.answerIndices && sq.answerIndices.length === 1) {
            // 단일정답: 숫자로 저장 (배열 → 숫자 추출)
            answer = sq.answerIndices[0];
          } else {
            answer = (sq.answerIndex !== undefined && sq.answerIndex >= 0) ? sq.answerIndex : -1;
          }
        } else {
          answer = sq.answerIndex ?? 0;
        }

        const originalQ = originalQuestions.find((oq) => oq.id === sq.id);

        const subQuestionData: AnyValue = {
          ...(originalQ || {}),
          id: sq.id || `${combinedGroupId}_${sqIndex}`,
          order: orderIndex++,
          text: sq.text,
          type: sq.type,
          choices: sq.type === 'multiple' ? (sq.choices || []).filter((c) => c.trim()) : undefined,
          answer,
          explanation: sq.explanation || undefined,
          imageUrl: sq.image || undefined,
          examples: sq.mixedExamples || undefined,
          mixedExamples: sq.mixedExamples || undefined,
          passagePrompt: sq.passagePrompt || undefined,
          bogi: sq.bogi || undefined,
          passageBlocks: sq.passageBlocks || undefined,
          combinedGroupId,
          combinedIndex: sqIndex,
          combinedTotal: subQuestionsCount,
          chapterId: sq.chapterId || undefined,
          chapterDetailId: sq.chapterDetailId || undefined,
        };

        if (trackChanges) {
          const hasChanged = parentChanged || !originalQ || isQuestionChangedForSubQuestion(originalQ, sq);
          subQuestionData.questionUpdatedAt = (hasChanged && useQuestionUpdatedAt)
            ? Timestamp.now()
            : (originalQ?.questionUpdatedAt || null);
        }

        if (sqIndex === 0) {
          subQuestionData.passageType = q.passageType || undefined;
          subQuestionData.passage = q.passage || undefined;
          subQuestionData.koreanAbcItems = q.koreanAbcItems || undefined;
          subQuestionData.passageMixedExamples = q.passageMixedExamples || undefined;
          subQuestionData.passageImage = q.passageImage || undefined;
          subQuestionData.commonQuestion = q.commonQuestion || undefined;
          subQuestionData.combinedMainText = q.text || '';
        }

        flattenedQuestions.push(subQuestionData);
      });
    } else {
      let answer: string | number | number[];
      if (q.type === 'subjective' || q.type === 'short_answer') {
        answer = q.answerText;
      } else if (q.type === 'multiple') {
        if (q.answerIndices && q.answerIndices.length > 1) {
          // 복수정답: 배열로 저장
          answer = q.answerIndices;
        } else if (q.answerIndices && q.answerIndices.length === 1) {
          // 단일정답: 숫자로 저장 (배열 → 숫자 추출)
          answer = q.answerIndices[0];
        } else {
          answer = q.answerIndex >= 0 ? q.answerIndex : -1;
        }
      } else {
        answer = q.answerIndex;
      }

      const originalQ = originalQuestions.find((oq) => oq.id === q.id);

      const item: AnyValue = {
        ...(originalQ || {}),
        id: q.id,
        order: orderIndex++,
        text: q.text,
        type: q.type,
        choices: q.type === 'multiple' ? q.choices?.filter((c) => c.trim()) : undefined,
        answer,
        explanation: q.explanation || undefined,
        imageUrl: q.imageUrl || undefined,
        examples: q.examples || undefined,
        mixedExamples: q.mixedExamples || undefined,
        passagePrompt: q.passagePrompt || undefined,
        bogi: q.bogi || undefined,
        scoringMethod: q.scoringMethod || undefined,
        passageBlocks: q.passageBlocks || undefined,
        chapterId: q.chapterId || undefined,
        chapterDetailId: q.chapterDetailId || undefined,
      };

      if (trackChanges) {
        const hasChanged = !originalQ || isQuestionChanged(originalQ, q);
        item.questionUpdatedAt = (hasChanged && useQuestionUpdatedAt)
          ? Timestamp.now()
          : (originalQ?.questionUpdatedAt || null);
      }

      flattenedQuestions.push(item);
    }
  });

  if (cleanupUndefined) {
    return flattenedQuestions.map((q) => {
      const cleaned: Record<string, AnyValue> = {};
      for (const [key, value] of Object.entries(q)) {
        if (value !== undefined) cleaned[key] = value;
      }
      return cleaned;
    });
  }

  return flattenedQuestions;
}
