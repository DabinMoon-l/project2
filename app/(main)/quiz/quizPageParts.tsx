'use client';

import { useState } from 'react';
import Image from 'next/image';
import { getDefaultQuizTab } from '@/lib/types/course';
import AnimatedUnderlineTabs from '@/components/common/AnimatedUnderlineTabs';

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
  createdAt?: { toMillis?: () => number; seconds?: number };
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
    // 유저가 직접 스와이프한 적 있으면 그 인덱스 유지
    const userSet = sessionStorage.getItem('quiz_carousel_user_set') === '1';
    if (userSet) {
      const saved = sessionStorage.getItem(QUIZ_CAROUSEL_KEY);
      if (saved !== null) {
        const idx = parseInt(saved, 10);
        if (totalCards !== undefined && idx >= totalCards) return 0;
        return idx;
      }
    }
  }
  // 유저가 스와이프하지 않았으면 0 반환 (이후 autoNavigate가 최신 퀴즈로 이동)
  return 0;
}

/** 학생 자작 섹션 반별 필터 옵션 */
export const CLASS_FILTER_OPTIONS: { value: 'all' | 'A' | 'B' | 'C' | 'D'; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'A', label: 'A' },
  { value: 'B', label: 'B' },
  { value: 'C', label: 'C' },
  { value: 'D', label: 'D' },
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
  return <AnimatedUnderlineTabs options={CLASS_FILTER_OPTIONS} activeValue={activeTab} onChange={onChangeTab} />;
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
