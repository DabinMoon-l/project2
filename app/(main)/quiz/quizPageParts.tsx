'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import Image from 'next/image';
import { getDefaultQuizTab } from '@/lib/types/course';

// ============================================================
// 타입 정의
// ============================================================

export type NewsCardType = 'midterm' | 'final' | 'past';

/** 교수 퀴즈 타입 — 제작자를 "교수님"으로 표시 */
export const PROFESSOR_QUIZ_TYPES = new Set(['midterm', 'final', 'past', 'professor', 'professor-ai', 'independent']);

export interface QuizCardData {
  id: string;
  title: string;
  type: string;
  questionCount: number;
  difficulty: string;
  participantCount: number;
  averageScore: number;
  isCompleted: boolean;
  myScore?: number;
  myFirstReviewScore?: number;
  creatorNickname?: string;
  creatorClassType?: 'A' | 'B' | 'C' | 'D';
  creatorId?: string;
  hasUpdate?: boolean;
  updatedQuestionCount?: number;
  tags?: string[];
  bookmarkCount?: number;
  createdAt?: any;
  attachmentUrl?: string;
  oneLineSummary?: string;
  description?: string;
  multipleChoiceCount?: number;
  subjectiveCount?: number;
  oxCount?: number;
  difficultyImageUrl?: string;
  isAiGenerated?: boolean;
  pastYear?: number;
  pastExamType?: string;
}

// ============================================================
// 상수
// ============================================================

/** 캐러셀 카드 유니온 타입 (기본 3개 + 단독 퀴즈 각각) */
export type CarouselCard =
  | { kind: 'list'; type: NewsCardType; title: string; subtitle: string }
  | { kind: 'past' }
  | { kind: 'single'; quiz: QuizCardData };

/** 캐러셀 위치 저장 키 */
export const QUIZ_CAROUSEL_KEY = 'quiz-carousel-index';
/** 캐러셀 내 스크롤 위치 저장 키 (타입별) */
export const QUIZ_SCROLL_KEY = (type: string) => `quiz-scroll-${type}`;

/** getDefaultQuizTab → 캐러셀 인덱스 매핑 (midterm=0, past=1, final=2, 이후 단독 퀴즈) */
export function getDefaultCarouselIndex(totalCards?: number): number {
  if (typeof window !== 'undefined') {
    const saved = sessionStorage.getItem(QUIZ_CAROUSEL_KEY);
    if (saved !== null) {
      const idx = parseInt(saved, 10);
      // 카드 수가 바뀌었으면 범위 체크
      if (totalCards !== undefined && idx >= totalCards) return 0;
      return idx;
    }
  }
  const tab = getDefaultQuizTab();
  if (tab === 'midterm') return 0;
  if (tab === 'past') return 1;
  if (tab === 'final') return 2;
  return 0;
}

/** 학생 자작 섹션 반별 필터 옵션 */
export const CLASS_FILTER_OPTIONS: { key: 'all' | 'A' | 'B' | 'C' | 'D'; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'A', label: 'A' },
  { key: 'B', label: 'B' },
  { key: 'C', label: 'C' },
  { key: 'D', label: 'D' },
];

// ============================================================
// 서브 컴포넌트
// ============================================================

/** 학생 자작 섹션 반별 필터 (밑줄 스타일) */
export function ClassFilterTabs({
  activeTab,
  onChangeTab,
}: {
  activeTab: 'all' | 'A' | 'B' | 'C' | 'D';
  onChangeTab: (key: 'all' | 'A' | 'B' | 'C' | 'D') => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [underline, setUnderline] = useState({ left: 0, width: 0 });
  const activeIdx = CLASS_FILTER_OPTIONS.findIndex(o => o.key === activeTab);

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
      {CLASS_FILTER_OPTIONS.map((opt, i) => (
        <button
          key={opt.key}
          ref={el => { btnRefs.current[i] = el; }}
          onClick={() => onChangeTab(opt.key)}
          className={`pb-1.5 text-lg font-bold transition-colors ${
            activeTab === opt.key ? 'text-[#1A1A1A]' : 'text-[#5C5C5C]'
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

/** 완료 뱃지 컴포넌트 */
export function CompletedBadge({ size = 'normal' }: { size?: 'normal' | 'small' }) {
  const [imgError, setImgError] = useState(false);

  if (imgError) {
    return (
      <div className={`bg-[#1A6B1A] text-[#F5F0E8] font-bold border-2 border-[#F5F0E8] ${
        size === 'small' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'
      }`}>
        완료
      </div>
    );
  }

  return (
    <Image
      src="/images/completed-badge.png"
      alt="완료"
      width={size === 'small' ? 80 : 112}
      height={size === 'small' ? 80 : 112}
      className="object-contain"
      onError={() => setImgError(true)}
    />
  );
}
