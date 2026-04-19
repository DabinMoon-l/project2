'use client';

/**
 * 퀴즈 만들기 확인 단계 — 문제 미리보기 카드.
 *
 * 자동 해설 생성 후 사용자가 해설/선지별 해설을 즉시 수정할 수 있도록
 * 모든 해설 필드를 편집 가능한 textarea로 렌더.
 *
 * 구조:
 *  - 문제 번호 + 본문
 *  - (객관식/OX) 선지 리스트 — 각 선지는 아코디언, 탭하면 선지별 해설 textarea.
 *    정답 선지는 기본 펼침 (선지별 해설이 있을 때만).
 *  - 전체 해설 textarea
 *  - 결합형은 공통 질문 + 하위 문제(재귀 렌더)
 */

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { QuestionData, SubQuestion } from './questionTypes';
import { useSessionStateSet } from '@/lib/hooks/useSessionState';

interface Props {
  question: QuestionData;
  index: number;
  onChange: (patch: Partial<QuestionData>) => void;
}

function correctIndicesOf(q: { type?: string; answerIndex?: number; answerIndices?: number[] }): Set<number> {
  if (Array.isArray(q.answerIndices) && q.answerIndices.length > 0) return new Set(q.answerIndices);
  if (typeof q.answerIndex === 'number') return new Set([q.answerIndex]);
  return new Set();
}

function correctIndicesOfSub(sq: SubQuestion): Set<number> {
  if (Array.isArray(sq.answerIndices) && sq.answerIndices.length > 0) return new Set(sq.answerIndices);
  if (typeof sq.answerIndex === 'number') return new Set([sq.answerIndex]);
  return new Set();
}

/** 선지별 아코디언 — 정답 선지는 기본 펼침 */
function ChoiceAccordions({
  choices,
  correctIndices,
  choiceExplanations,
  onChangeChoiceExplanation,
  sessionKey,
}: {
  choices: string[];
  correctIndices: Set<number>;
  choiceExplanations: string[] | undefined;
  onChangeChoiceExplanation: (i: number, value: string) => void;
  sessionKey: string;
}) {
  // 정답 선지만 기본 펼침 — 사용자가 직접 연/닫은 상태는 세션에 유지
  const defaultExpanded = useMemo(() => {
    const s = new Set<number>();
    if (Array.isArray(choiceExplanations)) {
      correctIndices.forEach((i) => {
        if (choiceExplanations[i] && choiceExplanations[i].trim()) s.add(i);
      });
    }
    return s;
  }, [correctIndices, choiceExplanations]);

  const [expanded, setExpanded] = useSessionStateSet<number>(sessionKey, defaultExpanded);

  return (
    <div className="space-y-1.5 mt-2">
      {choices.map((choice, i) => {
        const isCorrect = correctIndices.has(i);
        const isOpen = expanded.has(i);
        const explanation = choiceExplanations?.[i] ?? '';
        const label = String.fromCharCode(65 + i); // A, B, C, ...
        return (
          <div
            key={i}
            className={`rounded-lg border text-sm ${
              isCorrect
                ? 'border-[#1D5D4A] bg-[#F0F7F4]'
                : 'border-[#D4CFC4] bg-[#FDFBF7]'
            }`}
          >
            <button
              type="button"
              onClick={() => {
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(i)) next.delete(i);
                  else next.add(i);
                  return next;
                });
              }}
              className="w-full flex items-start gap-2 px-3 py-2 text-left"
            >
              <span
                className={`font-black text-xs mt-0.5 w-4 text-center shrink-0 ${
                  isCorrect ? 'text-[#1D5D4A]' : 'text-[#5C5C5C]'
                }`}
              >
                {isCorrect ? '✓' : label}
              </span>
              <span className="flex-1 leading-snug whitespace-pre-wrap text-[#1A1A1A]">
                {choice || `(선지 ${i + 1} 비어있음)`}
              </span>
              <motion.svg
                className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${
                  isCorrect ? 'text-[#1D5D4A]' : 'text-[#5C5C5C]'
                }`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                animate={{ rotate: isOpen ? 180 : 0 }}
                transition={{ duration: 0.18 }}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
              </motion.svg>
            </button>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  key="exp"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="overflow-hidden"
                >
                  <div className="px-3 pb-3 pt-1 border-t border-[#D4CFC4]">
                    <textarea
                      value={explanation}
                      onChange={(e) => onChangeChoiceExplanation(i, e.target.value)}
                      placeholder={`선지 ${label} 해설을 입력하세요`}
                      rows={3}
                      className="w-full px-2 py-1.5 text-[12px] leading-relaxed text-[#1A1A1A] bg-[#F5F0E8] border border-[#D4CFC4] rounded resize-y focus:outline-none focus:border-[#1A1A1A]"
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

export default function QuizPreviewCard({ question, index, onChange }: Props) {
  const isCombined = question.type === 'combined';
  const isMultipleOrOX = question.type === 'multiple' || question.type === 'ox';

  // 일반 문제 정답 인덱스
  const correctIndices = useMemo(() => correctIndicesOf(question), [question]);

  const handleChoiceExplanationChange = (i: number, value: string) => {
    const existing = Array.isArray(question.choiceExplanations) ? [...question.choiceExplanations] : [];
    // 선지 개수만큼 확보
    const total = question.choices?.length ?? 0;
    while (existing.length < total) existing.push('');
    existing[i] = value;
    onChange({ choiceExplanations: existing });
  };

  const handleSubChange = (subId: string, patch: Partial<SubQuestion>) => {
    if (!Array.isArray(question.subQuestions)) return;
    const updated = question.subQuestions.map((sq) => (sq.id === subId ? { ...sq, ...patch } : sq));
    onChange({ subQuestions: updated });
  };

  return (
    <div className="border border-[#1A1A1A] rounded-lg bg-[#FDFBF7]">
      {/* 헤더: 번호 + 본문 */}
      <div className="flex items-start gap-2 p-3 bg-[#EDEAE4] rounded-t-lg border-b border-[#D4CFC4]">
        <span className="w-6 h-6 bg-[#1A1A1A] text-[#F5F0E8] flex items-center justify-center text-xs font-bold flex-shrink-0 rounded">
          {index + 1}
        </span>
        <p className="flex-1 text-sm text-[#1A1A1A] whitespace-pre-wrap leading-relaxed">
          {isCombined
            ? (question.commonQuestion || question.text || '(공통 질문 없음)')
            : (question.text || '(내용 없음)')}
        </p>
      </div>

      {/* 선지 + 아코디언 (객관식/OX만) */}
      {!isCombined && isMultipleOrOX && Array.isArray(question.choices) && question.choices.length > 0 && (
        <div className="px-3 pt-3">
          <ChoiceAccordions
            choices={question.choices}
            correctIndices={correctIndices}
            choiceExplanations={question.choiceExplanations}
            onChangeChoiceExplanation={handleChoiceExplanationChange}
            sessionKey={`qp-exp:${question.id}`}
          />
        </div>
      )}

      {/* 전체 해설 textarea */}
      {!isCombined && (
        <div className="p-3">
          <label className="block text-[11px] text-[#5C5C5C] mb-1 font-bold">전체 해설</label>
          <textarea
            value={question.explanation || ''}
            onChange={(e) => onChange({ explanation: e.target.value })}
            placeholder="전체 해설을 입력하세요"
            rows={3}
            className="w-full px-2 py-1.5 text-[12px] leading-relaxed text-[#1A1A1A] bg-[#F5F0E8] border border-[#D4CFC4] rounded resize-y focus:outline-none focus:border-[#1A1A1A]"
          />
        </div>
      )}

      {/* 결합형: 하위 문제 재귀 렌더 */}
      {isCombined && Array.isArray(question.subQuestions) && question.subQuestions.length > 0 && (
        <div className="p-3 space-y-3">
          {question.subQuestions.map((sq, sqIdx) => (
            <SubQuestionPreview
              key={sq.id}
              sub={sq}
              mainIndex={index}
              subIndex={sqIdx}
              onChange={(patch) => handleSubChange(sq.id, patch)}
            />
          ))}
          {/* 결합형의 전체 해설(메인) */}
          <div>
            <label className="block text-[11px] text-[#5C5C5C] mb-1 font-bold">전체 해설 (공통)</label>
            <textarea
              value={question.explanation || ''}
              onChange={(e) => onChange({ explanation: e.target.value })}
              placeholder="전체 해설을 입력하세요"
              rows={3}
              className="w-full px-2 py-1.5 text-[12px] leading-relaxed text-[#1A1A1A] bg-[#F5F0E8] border border-[#D4CFC4] rounded resize-y focus:outline-none focus:border-[#1A1A1A]"
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** 결합형 하위 문제 미리보기 */
function SubQuestionPreview({
  sub,
  mainIndex,
  subIndex,
  onChange,
}: {
  sub: SubQuestion;
  mainIndex: number;
  subIndex: number;
  onChange: (patch: Partial<SubQuestion>) => void;
}) {
  const isMultipleOrOX = sub.type === 'multiple' || sub.type === 'ox';
  const correctIndices = useMemo(() => correctIndicesOfSub(sub), [sub]);

  const handleChoiceExplanationChange = (i: number, value: string) => {
    const existing = Array.isArray(sub.choiceExplanations) ? [...sub.choiceExplanations] : [];
    const total = sub.choices?.length ?? 0;
    while (existing.length < total) existing.push('');
    existing[i] = value;
    onChange({ choiceExplanations: existing });
  };

  return (
    <div className="border border-[#D4CFC4] rounded bg-[#F5F0E8]">
      <div className="flex items-start gap-2 p-2 border-b border-[#D4CFC4]">
        <span className="text-xs font-bold text-[#5C5C5C] flex-shrink-0 min-w-[28px]">
          {mainIndex + 1}-{subIndex + 1}
        </span>
        <p className="flex-1 text-sm text-[#1A1A1A] whitespace-pre-wrap leading-relaxed">
          {sub.text || '(내용 없음)'}
        </p>
      </div>
      {isMultipleOrOX && Array.isArray(sub.choices) && sub.choices.length > 0 && (
        <div className="px-2 pt-2">
          <ChoiceAccordions
            choices={sub.choices}
            correctIndices={correctIndices}
            choiceExplanations={sub.choiceExplanations}
            onChangeChoiceExplanation={handleChoiceExplanationChange}
            sessionKey={`qp-sub-exp:${sub.id}`}
          />
        </div>
      )}
      <div className="p-2">
        <label className="block text-[11px] text-[#5C5C5C] mb-1 font-bold">해설</label>
        <textarea
          value={sub.explanation || ''}
          onChange={(e) => onChange({ explanation: e.target.value })}
          placeholder="해설을 입력하세요"
          rows={2}
          className="w-full px-2 py-1.5 text-[12px] leading-relaxed text-[#1A1A1A] bg-[#FDFBF7] border border-[#D4CFC4] rounded resize-y focus:outline-none focus:border-[#1A1A1A]"
        />
      </div>
    </div>
  );
}
