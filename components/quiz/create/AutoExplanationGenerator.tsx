'use client';

/**
 * 자동 해설 생성 컴포넌트 (확인 단계 전용)
 *
 * Gemini 2.5 Flash로 문제의 본문/선지/정답/제시문/이미지/챕터를 분석해서
 * 해설 + 선지별 해설을 자동 생성합니다. 과목 SCOPE + FocusGuide 참조.
 */

import { useCallback, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { callFunction } from '@/lib/api';
import type { QuestionData } from './questionTypes';
import type { PassageBlock, MixedExampleBlock, LabeledItem, BogiData, SubQuestion } from './questionTypes';

interface Props {
  questions: QuestionData[];
  courseId: string | null;
  /** 해설을 적용 (문제 배열 전체 교체) */
  onApply: (updated: QuestionData[]) => void;
}

// ============================================================
// 직렬화 유틸 — 제시문/보기 → 평문
// ============================================================

function labeledItemsToText(items: LabeledItem[] | undefined, wrapper: (label: string) => string): string {
  if (!items || items.length === 0) return '';
  return items.map((it) => `${wrapper(it.label)} ${it.content}`).join(' / ');
}

function passageBlockToText(block: PassageBlock | MixedExampleBlock): string {
  if (block.type === 'text') return block.content || '';
  if (block.type === 'labeled') return labeledItemsToText(block.items, (l) => `${l}.`);
  if (block.type === 'gana') return labeledItemsToText(block.items, (l) => `(${l})`);
  if (block.type === 'bullet') return labeledItemsToText(block.items, () => '◦');
  if (block.type === 'image') return '[이미지]';
  if (block.type === 'grouped' && Array.isArray(block.children)) {
    return block.children.map(passageBlockToText).join(' | ');
  }
  return '';
}

function passageBlocksToText(blocks: PassageBlock[] | undefined, prompt?: string): string {
  if (!blocks || blocks.length === 0) return prompt || '';
  const body = blocks.map(passageBlockToText).filter(Boolean).join('\n');
  return prompt ? `${prompt}\n${body}` : body;
}

function bogiToText(bogi: BogiData | null | undefined): string {
  if (!bogi || !bogi.items || bogi.items.length === 0) return '';
  const items = bogi.items.map((it) => `${it.label}. ${it.content}`).join(' / ');
  return bogi.questionText ? `${bogi.questionText} — ${items}` : items;
}

function legacyExamplesToText(q: QuestionData): string {
  if (q.passage) return q.passage;
  if (q.koreanAbcItems && q.koreanAbcItems.length > 0) {
    return q.koreanAbcItems.map((it) => `${it.label}. ${it.text}`).join(' / ');
  }
  if (q.passageMixedExamples && q.passageMixedExamples.length > 0) {
    return q.passageMixedExamples.map(passageBlockToText).filter(Boolean).join('\n');
  }
  if (q.examples && Array.isArray(q.examples.items)) {
    return q.examples.items.join(' / ');
  }
  if (q.mixedExamples && q.mixedExamples.length > 0) {
    return q.mixedExamples.map(passageBlockToText).filter(Boolean).join('\n');
  }
  return '';
}

function subPassageText(sq: SubQuestion): string {
  const newText = passageBlocksToText(sq.passageBlocks, sq.passagePrompt);
  if (newText) return newText;
  // 레거시 필드 폴백
  if (sq.examples && Array.isArray(sq.examples)) return sq.examples.join(' / ');
  if (sq.koreanAbcExamples && sq.koreanAbcExamples.length > 0) {
    return sq.koreanAbcExamples.map((it) => `${it.label}. ${it.text}`).join(' / ');
  }
  if (sq.mixedExamples && sq.mixedExamples.length > 0) {
    return sq.mixedExamples.map(passageBlockToText).filter(Boolean).join('\n');
  }
  return '';
}

// data URL인지 검사 (blob URL은 서버로 못 보냄)
function isDataUrl(s?: string | null): boolean {
  return !!s && s.startsWith('data:image/');
}

// ============================================================
// 컴포넌트
// ============================================================

export default function AutoExplanationGenerator({ questions, courseId, onApply }: Props) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<{ count: number; remaining?: number } | null>(null);

  // 기존 해설 현황
  const stats = useMemo(() => {
    let total = 0;
    let withExplanation = 0;
    for (const q of questions) {
      if (q.type === 'combined') {
        for (const sq of q.subQuestions || []) {
          total += 1;
          if (sq.explanation && sq.explanation.trim()) withExplanation += 1;
        }
      } else {
        total += 1;
        if (q.explanation && q.explanation.trim()) withExplanation += 1;
      }
    }
    return { total, withExplanation, empty: total - withExplanation };
  }, [questions]);

  const handleGenerate = useCallback(async () => {
    if (!courseId) {
      setError('과목 정보를 찾을 수 없습니다.');
      return;
    }
    if (questions.length === 0) {
      setError('생성할 문제가 없습니다.');
      return;
    }
    if (questions.length > 20) {
      setError('한 번에 최대 20문제까지만 해설을 생성할 수 있습니다.');
      return;
    }

    setIsGenerating(true);
    setError(null);
    setSuccessInfo(null);

    try {
      const payload = questions.map((q) => {
        const base = {
          id: q.id,
          text: q.text,
          type: q.type,
          choices: q.choices,
          answerIndex: q.answerIndex,
          answerIndices: q.answerIndices,
          answerText: q.answerText,
          answerTexts: q.answerTexts,
          passageText: passageBlocksToText(q.passageBlocks, q.passagePrompt) || legacyExamplesToText(q),
          bogiText: bogiToText(q.bogi),
          chapterId: q.chapterId,
          imageBase64: isDataUrl(q.imageUrl) ? q.imageUrl || undefined : undefined,
        };

        if (q.type === 'combined' && Array.isArray(q.subQuestions)) {
          return {
            ...base,
            subQuestions: q.subQuestions.map((sq) => ({
              id: sq.id,
              text: sq.text,
              type: sq.type,
              choices: sq.choices,
              answerIndex: sq.answerIndex,
              answerIndices: sq.answerIndices,
              answerText: sq.answerText,
              answerTexts: sq.answerTexts,
              passageText: subPassageText(sq),
              bogiText: bogiToText(sq.bogi),
              chapterId: sq.chapterId,
            })),
          };
        }
        return base;
      });

      const result = await callFunction('generateCustomExplanations', {
        courseId,
        questions: payload,
      });

      if (!result.success || !Array.isArray(result.explanations)) {
        throw new Error('해설 응답이 올바르지 않습니다.');
      }

      // id 기준으로 매핑해서 적용
      const byId = new Map<string, typeof result.explanations[number]>();
      for (const e of result.explanations) byId.set(e.id, e);

      const updated: QuestionData[] = questions.map((q) => {
        const found = byId.get(q.id);
        if (!found) return q;

        if (q.type === 'combined' && Array.isArray(q.subQuestions)) {
          const subMap = new Map<string, { explanation: string; choiceExplanations?: string[] }>();
          for (const se of found.subExplanations || []) {
            subMap.set(se.id, { explanation: se.explanation, choiceExplanations: se.choiceExplanations });
          }
          return {
            ...q,
            explanation: found.explanation || q.explanation,
            subQuestions: q.subQuestions.map((sq) => {
              const se = subMap.get(sq.id);
              if (!se) return sq;
              return { ...sq, explanation: se.explanation || sq.explanation };
            }),
          };
        }
        return {
          ...q,
          explanation: found.explanation || q.explanation,
        };
      });

      onApply(updated);
      setSuccessInfo({
        count: result.explanations.length,
        remaining: result.usage?.userRemaining,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '해설 생성 중 오류가 발생했습니다.';
      setError(msg);
    } finally {
      setIsGenerating(false);
    }
  }, [courseId, questions, onApply]);

  return (
    <div className="p-4 border border-[#1A1A1A] rounded-xl" style={{ backgroundColor: '#FDFBF7' }}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-[#1A1A1A] flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M12 21v-1m0-14a6 6 0 016 6c0 2.21-1.12 4.16-2.827 5.313V17a1 1 0 01-1 1h-4.346a1 1 0 01-1-1v-.687A6 6 0 0112 6z" />
            </svg>
            자동 해설 생성
          </h3>
          <p className="text-[11px] text-[#5C5C5C] mt-0.5 leading-snug">
            Gemini AI가 문제·선지·제시문과 과목 SCOPE를 참고해 해설을 자동으로 작성합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isGenerating || questions.length === 0}
          className="flex-shrink-0 px-3 py-1.5 text-xs font-bold rounded-lg border-2 border-[#1A1A1A] bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#333] disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap flex items-center gap-1.5"
        >
          {isGenerating ? (
            <>
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              생성 중...
            </>
          ) : stats.withExplanation > 0 ? (
            '다시 생성'
          ) : (
            '해설 생성'
          )}
        </button>
      </div>

      {/* 현황 */}
      <div className="flex items-center gap-3 text-[11px] text-[#5C5C5C] mb-1">
        <span>총 {stats.total}문제</span>
        <span>·</span>
        <span>해설 있음 {stats.withExplanation}</span>
        <span>·</span>
        <span className={stats.empty > 0 ? 'text-[#8B1A1A] font-bold' : ''}>비어있음 {stats.empty}</span>
      </div>

      {/* 에러 */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-2 p-2 border border-[#8B1A1A] rounded text-xs text-[#8B1A1A] bg-[#FFF5F5]"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 성공 안내 */}
      <AnimatePresence>
        {successInfo && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-2 p-2 border border-[#1D5D4A] rounded text-xs text-[#1D5D4A] bg-[#F0F7F4]"
          >
            {successInfo.count}개 문제에 해설을 적용했어요.
            {typeof successInfo.remaining === 'number' && (
              <span className="text-[#5C5C5C]"> (오늘 남은 횟수: {successInfo.remaining}회)</span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
