/**
 * 퀴즈 통계 — 서술형 답안 모달
 *
 * QuizStatsModal에서 분리된 서브 모달.
 * 서술형 문제의 학생 답안을 반별(A/B/C/D)로 필터링하여 표시합니다.
 */

'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/** 서술형 답안 반 필터 */
const ESSAY_CLASS_FILTERS: ('A' | 'B' | 'C' | 'D')[] = ['A', 'B', 'C', 'D'];

/** 반별 색상 */
const CLASS_COLORS: Record<string, string> = {
  A: '#EF4444',
  B: '#EAB308',
  C: '#22C55E',
  D: '#3B82F6',
};

export interface StatsEssayAnswersModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 서술형 답변 배열 ({ answer: string; userId: string }[]) */
  essayAnswers: { answer: string; userId: string }[];
  /** userId → classId 캐시 */
  userClassCache: Map<string, string | null>;
  /** userId → 이름 캐시 */
  userNameCache: Map<string, string>;
}

export default function StatsEssayAnswersModal({
  isOpen,
  onClose,
  essayAnswers,
  userClassCache,
  userNameCache,
}: StatsEssayAnswersModalProps) {
  const [essayClassFilter, setEssayClassFilter] = useState<'A' | 'B' | 'C' | 'D'>('A');

  // 반별 필터링
  const filtered = essayAnswers.filter((ea) => {
    const cls = userClassCache.get(ea.userId);
    return cls === essayClassFilter;
  });

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-black/50"
          style={{ left: 'var(--modal-left, 0px)', right: 'var(--modal-right, 0px)' }}
          onClick={(e) => { e.stopPropagation(); onClose(); }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-[#F5F0E8] border-2 border-[#1A1A1A] max-h-[70vh] overflow-visible flex flex-col rounded-xl"
          >
            {/* 헤더 */}
            <div className="px-3 py-2 border-b border-[#1A1A1A]">
              <h2 className="text-sm font-bold text-[#1A1A1A] text-center">서술형 답안</h2>
            </div>

            {/* ABCD 필터 */}
            <div className="flex border-b border-[#D4CFC4]">
              {ESSAY_CLASS_FILTERS.map((cls) => (
                <button
                  key={cls}
                  onClick={() => setEssayClassFilter(cls)}
                  className={`flex-1 py-2 text-xs font-bold transition-colors ${
                    essayClassFilter === cls
                      ? 'text-[#F5F0E8]'
                      : 'text-[#5C5C5C] hover:bg-[#EDEAE4]'
                  }`}
                  style={essayClassFilter === cls ? { backgroundColor: CLASS_COLORS[cls] } : undefined}
                >
                  {cls}반
                </button>
              ))}
            </div>

            {/* 답안 목록 */}
            <div className="flex-1 overflow-y-auto overscroll-contain p-2 space-y-2">
              {filtered.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-xs text-[#5C5C5C]">{essayClassFilter}반 응답이 없습니다.</p>
                </div>
              ) : (
                filtered.map((ea, idx) => {
                  const name = userNameCache.get(ea.userId) || '(알 수 없음)';
                  return (
                    <div key={idx} className="p-2 border border-[#1A1A1A] bg-[#EDEAE4] rounded-lg">
                      <p className="text-xs font-bold text-[#1A1A1A] mb-1">{name}</p>
                      <p className="text-xs text-[#1A1A1A] whitespace-pre-wrap leading-relaxed">
                        {ea.answer || '(미응답)'}
                      </p>
                    </div>
                  );
                })
              )}
            </div>

            {/* 닫기 */}
            <div className="p-1.5 border-t border-[#1A1A1A]">
              <button
                onClick={onClose}
                className="w-full py-1.5 text-xs font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] rounded-lg"
              >
                닫기
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
