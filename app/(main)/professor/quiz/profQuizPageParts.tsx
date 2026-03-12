'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import type { CourseId } from '@/lib/types/course';
import type { QuizTypeFilter } from '@/lib/hooks/useProfessorQuiz';
import type { ProfessorQuiz } from '@/lib/hooks/useProfessorQuiz';

// ============================================================
// 타입
// ============================================================

export interface QuizFeedbackInfo {
  quizId: string;
  score: number;
  count: number;
}

/** 캐러셀 카드 타입 (고정 + 단독) */
export interface CarouselCard {
  type: QuizTypeFilter;
  title: string;
  subtitle: string;
  independentQuiz?: ProfessorQuiz;
}

// ============================================================
// 상수
// ============================================================

/** 고정 캐러셀 카드 (중간/기출/기말) */
export const FIXED_CARDS: { type: QuizTypeFilter; title: string; subtitle: string }[] = [
  { type: 'midterm', title: 'MIDTERM PREP', subtitle: 'Vol.1 · Midterm Edition' },
  { type: 'past', title: 'PAST EXAM', subtitle: 'Official Archive' },
  { type: 'final', title: 'FINAL PREP', subtitle: 'Vol.2 · Final Edition' },
];

/** 캐러셀 위치 저장 키 */
export const PROF_QUIZ_CAROUSEL_KEY = 'prof-quiz-carousel-index';
/** 캐러셀 내 스크롤 위치 저장 키 (타입별) */
export const PROF_QUIZ_SCROLL_KEY = (type: string) => `prof-quiz-scroll-${type}`;

export const COURSE_IDS: CourseId[] = ['biology', 'microbiology', 'pathophysiology'];

/** 자작/서재/커스텀 탭 옵션 */
export const SECTION_OPTIONS: { key: 'custom' | 'library' | 'folder'; label: string }[] = [
  { key: 'custom', label: '자작' },
  { key: 'library', label: '서재' },
  { key: 'folder', label: '커스텀' },
];

// ============================================================
// 서브 컴포넌트
// ============================================================

/** 자작/서재/커스텀 탭 (밑줄 스타일) */
export function ProfSectionTabs({
  sectionFilter,
  onChangeFilter,
}: {
  sectionFilter: 'custom' | 'library' | 'folder';
  onChangeFilter: (key: 'custom' | 'library' | 'folder') => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [underline, setUnderline] = useState({ left: 0, width: 0 });
  const activeIdx = SECTION_OPTIONS.findIndex(o => o.key === sectionFilter);

  const measureUnderline = useCallback(() => {
    if (activeIdx < 0 || !containerRef.current || !btnRefs.current[activeIdx]) return;
    const container = containerRef.current.getBoundingClientRect();
    const btn = btnRefs.current[activeIdx]!.getBoundingClientRect();
    setUnderline({ left: btn.left - container.left, width: btn.width });
  }, [activeIdx]);

  useEffect(() => {
    measureUnderline();
  }, [measureUnderline]);

  return (
    <div ref={containerRef} className="relative flex gap-4">
      {SECTION_OPTIONS.map((opt, i) => (
        <button
          key={opt.key}
          ref={el => { btnRefs.current[i] = el; }}
          onClick={() => onChangeFilter(opt.key)}
          className={`pb-1.5 text-lg font-bold transition-colors ${
            sectionFilter === opt.key ? 'text-[#1A1A1A]' : 'text-[#5C5C5C]'
          }`}
        >
          {opt.label}
        </button>
      ))}
      {activeIdx >= 0 && underline.width > 0 && (
        <motion.div
          className="absolute bottom-0 h-[2px] bg-[#1A1A1A]"
          animate={{ left: underline.left, width: underline.width }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        />
      )}
    </div>
  );
}
