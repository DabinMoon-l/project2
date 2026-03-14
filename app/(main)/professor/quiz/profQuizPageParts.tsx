'use client';

import type { CourseId } from '@/lib/types/course';
import type { QuizTypeFilter } from '@/lib/hooks/useProfessorQuiz';
import type { ProfessorQuiz } from '@/lib/hooks/useProfessorQuiz';
import AnimatedUnderlineTabs from '@/components/common/AnimatedUnderlineTabs';

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

/** 자작/서재/커스텀 탭 옵션 */
export const SECTION_OPTIONS: { value: 'custom' | 'library' | 'folder'; label: string }[] = [
  { value: 'custom', label: '자작' },
  { value: 'library', label: '서재' },
  { value: 'folder', label: '커스텀' },
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
  return <AnimatedUnderlineTabs options={SECTION_OPTIONS} activeValue={sectionFilter} onChange={onChangeFilter} />;
}
