'use client';

import { useState, useCallback, useEffect, Suspense, useRef, useMemo } from 'react';
import { motion, AnimatePresence, PanInfo } from 'framer-motion';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { doc, getDoc, getDocs, collection, query, where, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Skeleton, ExpandModal } from '@/components/common';
import { useExpandSource } from '@/lib/hooks/useExpandSource';
import { SPRING_TAP, TAP_SCALE } from '@/lib/constants/springs';
import FolderSlider from '@/components/common/FolderSlider';
import ReviewPractice, { type PracticeResult } from '@/components/review/ReviewPractice';
import { useReview, calculateCustomFolderQuestionCount, type ReviewItem, type GroupedReviewItems, type QuizUpdateInfo, type PrivateQuiz, type CustomFolder, type QuizAttempt } from '@/lib/hooks/useReview';
import { useQuizUpdate, type QuizUpdateInfo as DetailedQuizUpdateInfo } from '@/lib/hooks/useQuizUpdate';
import UpdateQuizModal from '@/components/quiz/UpdateQuizModal';
import { useQuizBookmark, type BookmarkedQuiz } from '@/lib/hooks/useQuizBookmark';
import { useLearningQuizzes, type LearningQuiz } from '@/lib/hooks/useLearningQuizzes';
import { useAuth } from '@/lib/hooks/useAuth';
import { useCourse, useUser } from '@/lib/contexts';
import { COURSES, getPastExamOptions, type PastExamOption } from '@/lib/types/course';
import { getChapterById, generateCourseTags, COMMON_TAGS } from '@/lib/courseIndex';
import type { QuestionExportData as PdfQuestionData } from '@/lib/utils/questionPdfExport';

/** 완료된 퀴즈 데이터 타입 */
interface CompletedQuizData {
  id: string;
  title: string;
  type: string;
  questionCount: number;
  participantCount: number;
  tags?: string[];
  creatorNickname?: string;
  attachmentUrl?: string;
  oneLineSummary?: string;
  difficultyImageUrl?: string;
  multipleChoiceCount?: number;
  subjectiveCount?: number;
  oxCount?: number;
  difficulty?: 'easy' | 'normal' | 'hard';
  pastYear?: number;
  pastExamType?: 'midterm' | 'final';
  /** 처음 푼 점수 */
  myScore?: number;
  /** 첫번째 복습 점수 */
  myFirstReviewScore?: number;
  /** AI 생성 퀴즈 여부 */
  isAiGenerated?: boolean;
  /** 평균 점수 */
  averageScore?: number;
}

/**
 * 문제 유형을 포맷하여 표시
 * 예: "OX 2 / 객관식 5 / 주관식 2"
 */
function formatQuestionTypes(
  oxCount: number = 0,
  multipleChoiceCount: number = 0,
  subjectiveCount: number = 0
): string {
  const parts: string[] = [];
  if (oxCount > 0) parts.push(`OX ${oxCount}`);
  if (multipleChoiceCount > 0) parts.push(`객관식 ${multipleChoiceCount}`);
  if (subjectiveCount > 0) parts.push(`주관식 ${subjectiveCount}`);

  if (parts.length === 0) {
    const total = oxCount + multipleChoiceCount + subjectiveCount;
    return total > 0 ? `${total}문제` : '-';
  }

  return parts.join(' / ');
}

/** 필터 타입 */
type ReviewFilter = 'library' | 'wrong' | 'bookmark' | 'custom';

/** 필터 옵션 */
const FILTER_OPTIONS: { value: ReviewFilter; line1: string; line2?: string }[] = [
  { value: 'library', line1: '서재' },
  { value: 'wrong', line1: '오답' },
  { value: 'bookmark', line1: '찜' },
  { value: 'custom', line1: '커스텀' },
];

/**
 * 밑줄 스타일 필터 탭 (교수 퀴즈 페이지 ProfSectionTabs와 동일)
 */
function SlideFilter({
  activeFilter,
  onFilterChange,
}: {
  activeFilter: ReviewFilter;
  onFilterChange: (filter: ReviewFilter) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [underline, setUnderline] = useState({ left: 0, width: 0 });
  const activeIdx = FILTER_OPTIONS.findIndex(o => o.value === activeFilter);

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
      {FILTER_OPTIONS.map((opt, i) => (
        <button
          key={opt.value}
          ref={el => { btnRefs.current[i] = el; }}
          onClick={() => onFilterChange(opt.value)}
          className={`pb-1.5 text-base font-bold transition-colors ${
            activeFilter === opt.value ? 'text-[#1A1A1A]' : 'text-[#5C5C5C]'
          }`}
        >
          {opt.line1}
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

/**
 * 폴더 카드 컴포넌트
 */
function FolderCard({
  title,
  count,
  onClick,
  onDelete,
  isSelectMode = false,
  isSelected = false,
  showDelete = false,
  hasUpdate = false,
  onUpdateClick,
  variant = 'folder',
}: {
  title: string;
  count: number;
  onClick: () => void;
  onDelete?: () => void;
  isSelectMode?: boolean;
  isSelected?: boolean;
  showDelete?: boolean;
  hasUpdate?: boolean;
  onUpdateClick?: () => void;
  /** 카드 스타일: folder(폴더 아이콘) 또는 quiz(퀴즈 카드 스타일) */
  variant?: 'folder' | 'quiz';
}) {
  // gradient ID 충돌 방지용 고유 키 (특수문자 제거 — SVG url() 참조 깨짐 방지)
  const gradId = `fc-${title.replace(/[^a-zA-Z0-9가-힣]/g, '')}-${count}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileTap={!isSelectMode ? TAP_SCALE : undefined}
      transition={SPRING_TAP}
      onClick={onClick}
      className={`
        relative pt-1 flex flex-col items-center justify-center gap-0.5 cursor-pointer transition-all duration-150
        ${isSelectMode
          ? isSelected
            ? ''
            : ''
          : 'hover:scale-105'
        }
      `}
    >
      {/* 삭제 버튼 */}
      {showDelete && onDelete && !isSelectMode && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="absolute top-0 right-0 w-6 h-6 border border-[#8B1A1A] text-[#8B1A1A] bg-[#F5F0E8] hover:bg-[#FDEAEA] flex items-center justify-center transition-colors z-10"
        >
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        </button>
      )}

      {/* 선택 표시 */}
      {isSelectMode && isSelected && (
        <div className="absolute top-0.5 right-0.5 w-5 h-5 bg-[#1A1A1A] rounded-full flex items-center justify-center z-10">
          <svg className="w-3 h-3 text-[#F5F0E8]" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        </div>
      )}

      {/* 아이콘 영역 */}
      <div className="relative">
        {variant === 'quiz' ? (
          // 퀴즈 카드 스타일 아이콘 — 검정 글래스 fill
          <svg className="w-16 h-16 drop-shadow-lg" viewBox="0 0 24 24" fill="none">
            <defs>
              <linearGradient id={`${gradId}-q`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="rgba(50,50,50,0.85)" />
                <stop offset="100%" stopColor="rgba(25,25,25,0.9)" />
              </linearGradient>
            </defs>
            <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" fill={`url(#${gradId}-q)`} />
            <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke="rgba(255,255,255,0.1)" strokeWidth="0.4" fill="none" />
          </svg>
        ) : (
          // 폴더 아이콘 — 검정 글래스 fill
          <svg className="w-16 h-16 drop-shadow-lg" viewBox="0 0 24 24" fill="none">
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="rgba(50,50,50,0.85)" />
                <stop offset="100%" stopColor="rgba(25,25,25,0.9)" />
              </linearGradient>
            </defs>
            <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" fill={`url(#${gradId})`} />
            <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" stroke="rgba(255,255,255,0.1)" strokeWidth="0.4" fill="none" />
          </svg>
        )}
        {/* 업데이트 알림 아이콘 */}
        {hasUpdate && !isSelectMode && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onUpdateClick?.();
            }}
            className="absolute -top-1 -right-1 w-5 h-5 bg-[#F5C518] rounded-full flex items-center justify-center border-2 border-[#1A1A1A] hover:scale-110 transition-transform"
          >
            <span className="text-[#1A1A1A] font-bold text-xs">!</span>
          </button>
        )}
      </div>

      {/* 제목 */}
      <span className={`text-sm font-bold text-center px-1 truncate w-full ${isSelectMode && !isSelected ? 'text-[#5C5C5C]' : 'text-[#1A1A1A]'}`}>
        {title}
      </span>

      {/* 문제 수 */}
      <span className="text-xs text-center text-[#5C5C5C]">
        {count}문제
      </span>
    </motion.div>
  );
}

/**
 * 찜한 퀴즈 카드 컴포넌트 (하트 아이콘 포함)
 * 아이콘 순서: [업데이트 뱃지] [지구 아이콘 (AI 공개)] [찜]
 */
function BookmarkedQuizCard({
  quiz,
  onClick,
  onUnbookmark,
  hasUpdate = false,
  onUpdateClick,
}: {
  quiz: BookmarkedQuiz;
  onClick: () => void;
  onUnbookmark: () => void;
  hasUpdate?: boolean;
  onUpdateClick?: () => void;
}) {
  // AI 생성 퀴즈 여부
  const isAiGenerated = quiz.isAiGenerated;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileTap={TAP_SCALE}
      transition={SPRING_TAP}
      onClick={onClick}
      className="relative border border-[#1A1A1A] bg-[#F5F0E8] p-3 cursor-pointer hover:bg-[#EDEAE4] transition-all rounded-xl"
    >
      {/* 우측 상단 아이콘 그룹: [업데이트] [지구] [찜] */}
      <div className="absolute top-2 right-2 flex items-start gap-1 z-10">
        {/* 업데이트 뱃지 */}
        {hasUpdate && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onUpdateClick?.();
            }}
            className="w-5 h-5 bg-[#F5C518] rounded-full flex items-center justify-center border-2 border-[#1A1A1A] hover:scale-110 transition-transform"
          >
            <span className="text-[#1A1A1A] font-bold text-xs">!</span>
          </button>
        )}

        {/* 지구 아이콘 (AI 생성 공개 퀴즈) - 상호작용 없음 */}
        {isAiGenerated && (
          <div className="w-5 h-5 flex items-center justify-center text-[#5C5C5C]">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.6 9h16.8M3.6 15h16.8" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3a15.3 15.3 0 0 1 4 9 15.3 15.3 0 0 1-4 9 15.3 15.3 0 0 1-4-9 15.3 15.3 0 0 1 4-9z" />
            </svg>
          </div>
        )}

        {/* 하트 아이콘 (북마크 해제) + 찜한 수 */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onUnbookmark();
          }}
          className="flex flex-col items-center transition-transform hover:scale-110"
        >
          <svg className="w-5 h-5 text-[#8B1A1A]" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          </svg>
          {(quiz.bookmarkCount ?? 0) > 0 && (
            <span className="text-[10px] text-[#5C5C5C] font-bold mt-0.5">
              {quiz.bookmarkCount}
            </span>
          )}
        </button>
      </div>

      {/* 퀴즈 카드 스타일 아이콘 */}
      <div className="flex justify-center mb-2">
        <div className="w-12 h-12 border-2 border-[#1A1A1A] flex items-center justify-center rounded-lg">
          <svg className="w-6 h-6 text-[#1A1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
      </div>

      {/* 제목 */}
      <h3 className="font-bold text-xs text-center line-clamp-2 mb-1 text-[#1A1A1A] pr-4">
        {quiz.title}
      </h3>

      {/* 문제 수 */}
      <p className="text-xs text-center text-[#5C5C5C]">
        {quiz.questionCount}문제
      </p>
    </motion.div>
  );
}

/** 난이도별 이미지 */
const DIFFICULTY_IMAGES: Record<string, string> = {
  easy: '/images/difficulty-easy.png',
  normal: '/images/difficulty-normal.png',
  hard: '/images/difficulty-hard.png',
};

/** 난이도 라벨 */
const DIFFICULTY_LABELS: Record<string, string> = {
  easy: '쉬움',
  normal: '보통',
  hard: '어려움',
};

/** 명언 목록 (뉴스 스타일 dead space 채우기용) */
const MOTIVATIONAL_QUOTES = [
  "Success is not final, failure is not fatal.",
  "The secret of getting ahead is getting started.",
  "Believe you can and you're halfway there.",
  "Education is the passport to the future.",
  "The harder you work, the luckier you get.",
  "Knowledge is power, wisdom is freedom.",
  "Every expert was once a beginner.",
  "Dream big, work hard, stay focused.",
];

/** 신문 배경 텍스트 (생물학 관련 영어) */
const NEWSPAPER_BG_TEXT = `The cell membrane, also known as the plasma membrane, is a biological membrane that separates and protects the interior of all cells from the outside environment. The cell membrane consists of a lipid bilayer, including cholesterols that sit between phospholipids to maintain their fluidity at various temperatures. The membrane also contains membrane proteins, including integral proteins that span the membrane serving as membrane transporters, and peripheral proteins that loosely attach to the outer side of the cell membrane, acting as enzymes to facilitate interaction with the cell's environment. Glycolipids embedded in the outer lipid layer serve a similar purpose. The cell membrane controls the movement of substances in and out of cells and organelles, being selectively permeable to ions and organic molecules. In addition, cell membranes are involved in a variety of cellular processes such as cell adhesion, ion conductivity, and cell signaling.`;

/** 랜덤 명언 가져오기 */
function getRandomQuote(): string {
  return MOTIVATIONAL_QUOTES[Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length)];
}

/** 문제 유형 라벨 생성 */
function getQuestionTypeLabel(quiz: CompletedQuizData): string {
  const multiple = quiz.multipleChoiceCount || 0;
  const subjective = quiz.subjectiveCount || 0;
  if (multiple > 0 && subjective > 0) {
    return `객관 ${multiple} · 주관 ${subjective}`;
  }
  if (multiple > 0) return `객관 ${multiple}문제`;
  if (subjective > 0) return `주관 ${subjective}문제`;
  return `${quiz.questionCount}문제`;
}

/**
 * 큰 찜한 퀴즈 카드 컴포넌트 (전체 너비, 강조 표시)
 * 아이콘 순서: [업데이트 뱃지] [지구 아이콘 (AI 공개)] [찜]
 */
function LargeBookmarkedQuizCard({
  quiz,
  onClick,
  onUnbookmark,
  chapterName,
  hasUpdate = false,
  onUpdateClick,
}: {
  quiz: BookmarkedQuiz;
  onClick: () => void;
  onUnbookmark: () => void;
  chapterName?: string;
  hasUpdate?: boolean;
  onUpdateClick?: () => void;
}) {
  const difficulty = quiz.difficulty || 'normal';
  const isAiGenerated = quiz.isAiGenerated;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileTap={TAP_SCALE}
      transition={SPRING_TAP}
      onClick={onClick}
      className="relative border-2 border-[#1A1A1A] bg-[#F5F0E8] cursor-pointer hover:bg-[#EDEAE4] transition-all rounded-xl overflow-hidden"
    >
      {/* 우측 상단 아이콘 그룹: [업데이트] [지구] [찜] */}
      <div className="absolute top-3 right-3 flex items-start gap-1.5 z-10">
        {/* 업데이트 뱃지 */}
        {hasUpdate && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onUpdateClick?.();
            }}
            className="w-6 h-6 bg-[#F5C518] rounded-full flex items-center justify-center border-2 border-[#1A1A1A] hover:scale-110 transition-transform"
          >
            <span className="text-[#1A1A1A] font-bold text-xs">!</span>
          </button>
        )}

        {/* 지구 아이콘 (AI 생성 공개 퀴즈) - 상호작용 없음 */}
        {isAiGenerated && (
          <div className="w-6 h-6 flex items-center justify-center text-[#F5F0E8]">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.6 9h16.8M3.6 15h16.8" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3a15.3 15.3 0 0 1 4 9 15.3 15.3 0 0 1-4 9 15.3 15.3 0 0 1-4-9 15.3 15.3 0 0 1 4-9z" />
            </svg>
          </div>
        )}

        {/* 하트 아이콘 (북마크 해제) + 찜한 수 */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onUnbookmark();
          }}
          className="flex flex-col items-center transition-transform hover:scale-110"
        >
          <svg className="w-6 h-6 text-[#8B1A1A]" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          </svg>
          {(quiz.bookmarkCount ?? 0) > 0 && (
            <span className="text-[10px] text-[#F5F0E8] font-bold mt-0.5">
              {quiz.bookmarkCount}
            </span>
          )}
        </button>
      </div>

      {/* 상단: 검정색 박스 + 제목 */}
      <div className="bg-[#1A1A1A] px-4 py-3">
        <h3 className="font-serif-display text-lg font-bold text-[#F5F0E8] line-clamp-1 pr-8">
          {quiz.title}
        </h3>
      </div>

      {/* 중앙: 난이도 이미지 (반응형, 빈틈없이 채움) */}
      <div className="relative w-full aspect-[2/1]">
        <Image
          src={DIFFICULTY_IMAGES[difficulty]}
          alt={DIFFICULTY_LABELS[difficulty]}
          fill
          className="object-fill"
        />
      </div>

      {/* 하단: 문제지 정보 */}
      {/* 하단: 문제 정보 (한 줄, 가운데 정렬) */}
      <div className="px-4 pb-4">
        <div className="flex items-center justify-center gap-2 text-sm text-[#5C5C5C]">
          {chapterName && (
            <>
              <span>{chapterName}</span>
              <span>•</span>
            </>
          )}
          <span className="font-bold text-[#1A1A1A]">{quiz.questionCount}문제</span>
          <span>•</span>
          <span>{DIFFICULTY_LABELS[difficulty]}</span>
          <span>•</span>
          <span>{quiz.creatorNickname || '익명'}</span>
        </div>
      </div>
    </motion.div>
  );
}

/**
 * 큰 찜한 퀴즈 플레이스홀더 (빈 상태)
 */
function LargeBookmarkedQuizPlaceholder() {
  return (
    <div className="border-2 border-dashed border-[#D4CFC4] bg-[#EDEAE4] rounded-xl overflow-hidden">
      {/* 상단: 검정색 박스 플레이스홀더 */}
      <div className="bg-[#D4CFC4] px-4 py-3">
        <div className="h-6 w-3/4 bg-[#C4BFB4]" />
      </div>

      {/* 중앙: 이미지 플레이스홀더 */}
      <div className="flex items-center justify-center py-6">
        <div className="w-[200px] h-[200px] border-2 border-dashed border-[#C4BFB4] flex items-center justify-center">
          <svg className="w-12 h-12 text-[#C4BFB4]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
      </div>

      {/* 하단: 정보 플레이스홀더 */}
      <div className="px-4 pb-4 space-y-2">
        <div className="h-4 w-1/2 bg-[#C4BFB4]" />
        <div className="h-3 w-1/3 bg-[#C4BFB4]" />
      </div>
    </div>
  );
}

/**
 * 퀴즈 상세 정보 타입
 */
interface QuizDetails {
  difficulty?: 'easy' | 'normal' | 'hard';
  chapterId?: string;
  creatorNickname?: string;
}

/**
 * 큰 푼 문제지 카드 컴포넌트 (전체 너비, 강조 표시)
 */
function LargeSolvedQuizCard({
  quizId,
  title,
  count,
  onClick,
  courseId,
}: {
  quizId: string;
  title: string;
  count: number;
  onClick: () => void;
  courseId?: string;
}) {
  const [quizDetails, setQuizDetails] = useState<QuizDetails>({});
  const [loading, setLoading] = useState(true);

  // 퀴즈 상세 정보 가져오기
  useEffect(() => {
    const fetchQuizDetails = async () => {
      try {
        const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
        if (quizDoc.exists()) {
          const data = quizDoc.data();
          setQuizDetails({
            difficulty: data.difficulty || 'normal',
            chapterId: data.chapterId,
            creatorNickname: data.creatorNickname || '익명',
          });
        }
      } catch (err) {
        console.error('퀴즈 상세 정보 로드 실패:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchQuizDetails();
  }, [quizId]);

  const difficulty = quizDetails.difficulty || 'normal';
  const chapterName = quizDetails.chapterId && courseId
    ? getChapterById(courseId, quizDetails.chapterId)?.name
    : undefined;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileTap={TAP_SCALE}
      transition={SPRING_TAP}
      onClick={onClick}
      className="relative border-2 border-[#1A1A1A] bg-[#F5F0E8] cursor-pointer hover:bg-[#EDEAE4] transition-all"
    >
      {/* 상단: 검정색 박스 + 제목 */}
      <div className="bg-[#1A1A1A] px-4 py-3">
        <h3 className="font-serif-display text-lg font-bold text-[#F5F0E8] line-clamp-1">
          {title}
        </h3>
      </div>

      {/* 중앙: 난이도 이미지 (반응형, 빈틈없이 채움) */}
      <div className="relative w-full aspect-[2/1]">
        {loading ? (
          <div className="w-full h-full bg-[#EDEAE4] flex items-center justify-center">
            <Skeleton className="w-full h-full rounded-none" />
          </div>
        ) : (
          <Image
            src={DIFFICULTY_IMAGES[difficulty]}
            alt={DIFFICULTY_LABELS[difficulty]}
            fill
            className="object-fill"
          />
        )}
      </div>

      {/* 하단: 문제 정보 (한 줄, 가운데 정렬) */}
      <div className="px-4 pb-4 pt-2">
        <div className="flex items-center justify-center gap-2 text-sm text-[#5C5C5C]">
          {chapterName && (
            <>
              <span>{chapterName}</span>
              <span>•</span>
            </>
          )}
          <span className="font-bold text-[#1A1A1A]">{count}문제</span>
          <span>•</span>
          <span>{DIFFICULTY_LABELS[difficulty]}</span>
          <span>•</span>
          <span>{quizDetails.creatorNickname || '익명'}</span>
        </div>
      </div>
    </motion.div>
  );
}

/**
 * 큰 푼 문제지 플레이스홀더 (빈 상태)
 */
function LargeSolvedQuizPlaceholder() {
  return (
    <div className="border-2 border-dashed border-[#D4CFC4] bg-[#EDEAE4] rounded-xl overflow-hidden">
      {/* 상단: 검정색 박스 플레이스홀더 */}
      <div className="bg-[#D4CFC4] px-4 py-3">
        <div className="h-6 w-3/4 bg-[#C4BFB4]" />
      </div>

      {/* 중앙: 이미지 플레이스홀더 */}
      <div className="relative w-full aspect-[2/1] flex items-center justify-center border-y border-dashed border-[#C4BFB4]">
        <svg className="w-12 h-12 text-[#C4BFB4]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </div>

      {/* 하단: 정보 플레이스홀더 */}
      <div className="px-4 py-3 flex justify-center">
        <div className="h-4 w-2/3 bg-[#C4BFB4]" />
      </div>
    </div>
  );
}

// ============================================================
// 뉴스 스타일 컴포넌트 (문제 탭용)
// ============================================================

/**
 * 뉴스 기사 컴포넌트 (복습용 퀴즈)
 */
function ReviewNewsArticle({
  quiz,
  size = 'normal',
  onReview,
  onDetails,
  isBookmarked,
  onToggleBookmark,
}: {
  quiz: CompletedQuizData;
  size?: 'large' | 'normal' | 'small';
  onReview: () => void;
  onDetails?: () => void;
  isBookmarked?: boolean;
  onToggleBookmark?: () => void;
}) {
  // 크기별 스타일
  const sizeStyles = {
    large: {
      container: 'col-span-2 row-span-2',
      title: 'text-lg font-black',
      meta: 'text-sm',
      tags: 'text-xs',
      button: 'py-2.5 px-4 text-sm',
      image: 'w-20 h-28',
    },
    normal: {
      container: 'col-span-1 row-span-2',
      title: 'text-base font-bold',
      meta: 'text-xs',
      tags: 'text-[10px]',
      button: 'py-2 px-3 text-xs',
      image: 'w-14 h-20',
    },
    small: {
      container: 'col-span-1 row-span-1',
      title: 'text-sm font-bold',
      meta: 'text-[10px]',
      tags: 'text-[10px]',
      button: 'py-1.5 px-2 text-[10px]',
      image: 'w-10 h-14',
    },
  };

  const styles = sizeStyles[size];

  return (
    <div
      onClick={onDetails}
      className={`relative border border-[#1A1A1A] bg-[#F5F0E8] overflow-hidden cursor-pointer ${styles.container}`}
    >
      {/* 신문 배경 텍스트 */}
      <div className="absolute inset-0 p-2 overflow-hidden pointer-events-none">
        <p className="text-[6px] text-[#D0D0D0] leading-tight break-words">
          {NEWSPAPER_BG_TEXT.slice(0, size === 'large' ? 800 : size === 'normal' ? 400 : 200)}
        </p>
      </div>

      {/* 북마크 버튼 */}
      {onToggleBookmark && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleBookmark();
          }}
          className="absolute top-2 right-2 z-30 flex flex-col items-center transition-transform hover:scale-110"
        >
          {isBookmarked ? (
            <svg className="w-5 h-5 text-[#8B1A1A]" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
          ) : (
            <svg className="w-5 h-5 text-[#5C5C5C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
          )}
        </button>
      )}

      {/* 기사 내용 */}
      <div className={`relative z-10 p-3 h-full flex ${size === 'small' ? 'flex-col' : 'gap-3'}`}>
        {/* 난이도 이미지 */}
        {quiz.difficultyImageUrl && size !== 'small' && (
          <div className={`${styles.image} flex-shrink-0 border border-[#1A1A1A] bg-white`}>
            <img
              src={quiz.difficultyImageUrl}
              alt="난이도"
              className="w-full h-full object-cover"
            />
          </div>
        )}

        {/* 텍스트 영역 */}
        <div className="flex-1 flex flex-col justify-between bg-[#F5F0E8]/60 p-2">
          <div>
            {/* 제목 */}
            <h3 className={`${styles.title} text-[#1A1A1A] mb-1 line-clamp-2`}>
              {quiz.title}
            </h3>

            {/* 문제 양식 */}
            <p className={`${styles.meta} text-[#5C5C5C] mb-1`}>
              {getQuestionTypeLabel(quiz)}
            </p>

            {/* 태그 */}
            {quiz.tags && quiz.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {quiz.tags.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className={`${styles.tags} px-1.5 py-0.5 bg-[#1A1A1A] text-[#F5F0E8] font-medium`}
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 복습하기 버튼 */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onReview();
            }}
            className={`${styles.button} font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors self-start`}
          >
            복습하기
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 명언 기사 컴포넌트 (dead space 채우기용)
 */
function ReviewQuoteArticle({ size = 'small' }: { size?: 'normal' | 'small' }) {
  const quote = useMemo(() => getRandomQuote(), []);

  return (
    <div className={`relative border border-[#1A1A1A] bg-[#EDEAE4] p-3 flex items-center justify-center ${
      size === 'small' ? 'col-span-1 row-span-1' : 'col-span-1 row-span-2'
    }`}>
      <p className={`text-center italic text-[#1A1A1A] font-serif ${
        size === 'small' ? 'text-xs' : 'text-sm'
      }`}>
        &quot;{quote}&quot;
      </p>
    </div>
  );
}

/**
 * 뉴스 카드 컴포넌트 (중간/기말 복습용)
 */
function ReviewNewsCard({
  type,
  title,
  subtitle,
  quizzes,
  isLoading,
  onReview,
  onShowDetails,
  isQuizBookmarked,
  onToggleBookmark,
}: {
  type: 'midterm' | 'final';
  title: string;
  subtitle: string;
  quizzes: CompletedQuizData[];
  isLoading: boolean;
  onReview: (quizId: string) => void;
  onShowDetails?: (quiz: CompletedQuizData) => void;
  isQuizBookmarked?: (quizId: string) => boolean;
  onToggleBookmark?: (quizId: string) => void;
}) {
  // 기사 크기 배분 (가지각색)
  const getArticleSize = (index: number, total: number): 'large' | 'normal' | 'small' => {
    if (total === 1) return 'large';
    if (total === 2) return index === 0 ? 'large' : 'normal';
    if (index === 0) return 'large';
    if (index === 1 || index === 2) return 'normal';
    return 'small';
  };

  return (
    <div className="w-full h-full border-4 border-[#1A1A1A] bg-[#F5F0E8] flex flex-col overflow-hidden">
      {/* 헤더 */}
      <div className="bg-[#1A1A1A] text-[#F5F0E8] px-4 py-3 text-center flex-shrink-0">
        <p className="text-[8px] tracking-[0.3em] mb-1">━━━━━━━━━━━━━━━━━━━━</p>
        <h1 className="font-serif text-2xl font-black tracking-tight">{title}</h1>
        <p className="text-[10px] tracking-widest mt-1">{subtitle}</p>
      </div>

      {/* 기사 영역 (스크롤 가능) */}
      <div className="flex-1 overflow-y-auto p-3">
        {isLoading ? (
          <div className="h-full" />
        ) : quizzes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <h3 className="font-bold text-lg mb-2 text-[#1A1A1A]">완료한 퀴즈가 없습니다</h3>
            <p className="text-sm text-[#5C5C5C]">퀴즈를 풀면 여기에 표시됩니다.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 auto-rows-[minmax(80px,auto)] gap-2">
            {quizzes.slice(0, 4).map((quiz, index) => (
              <ReviewNewsArticle
                key={quiz.id}
                quiz={quiz}
                size={getArticleSize(index, Math.min(quizzes.length, 4))}
                onReview={() => onReview(quiz.id)}
                onDetails={onShowDetails ? () => onShowDetails(quiz) : undefined}
                isBookmarked={isQuizBookmarked?.(quiz.id)}
                onToggleBookmark={onToggleBookmark ? () => onToggleBookmark(quiz.id) : undefined}
              />
            ))}
            {/* Dead space를 명언으로 채우기 */}
            {quizzes.length === 1 && <ReviewQuoteArticle size="normal" />}
            {quizzes.length === 3 && <ReviewQuoteArticle size="small" />}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 기출 뉴스 카드 컴포넌트 (복습용)
 */
function ReviewPastExamNewsCard({
  quiz,
  selectedPastExam,
  pastExamOptions,
  onSelectPastExam,
  isLoading,
  onReview,
  onShowDetails,
}: {
  quiz: CompletedQuizData | null;
  selectedPastExam: string;
  pastExamOptions: PastExamOption[];
  onSelectPastExam: (value: string) => void;
  isLoading: boolean;
  onReview: () => void;
  onShowDetails?: (quiz: CompletedQuizData) => void;
}) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const selectedOption = pastExamOptions.find((opt) => opt.value === selectedPastExam);

  return (
    <div className="w-full h-full border-4 border-[#1A1A1A] bg-[#F5F0E8] flex flex-col overflow-hidden">
      {/* 헤더 + 드롭다운 */}
      <div className="bg-[#1A1A1A] text-[#F5F0E8] px-4 py-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[8px] tracking-[0.3em] mb-1">━━━━━━━━━━━━</p>
            <h1 className="font-serif text-2xl font-black tracking-tight">PAST EXAM</h1>
          </div>

          {/* 드롭다운 */}
          <div className="relative">
            <button
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="px-3 py-1.5 bg-[#F5F0E8] text-[#1A1A1A] text-sm font-bold flex items-center justify-between gap-2 min-w-[100px]"
            >
              <span>{selectedOption?.label || '선택'}</span>
              <svg
                className={`w-3 h-3 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`}
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>

            <AnimatePresence>
              {isDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setIsDropdownOpen(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="absolute right-0 top-full mt-1 z-20 bg-[#F5F0E8] border border-[#1A1A1A] shadow-lg min-w-[100px]"
                  >
                    {pastExamOptions.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => {
                          onSelectPastExam(option.value);
                          setIsDropdownOpen(false);
                        }}
                        className={`w-full px-3 py-2 text-left text-sm font-medium transition-colors ${
                          selectedPastExam === option.value
                            ? 'bg-[#1A1A1A] text-[#F5F0E8]'
                            : 'text-[#1A1A1A] hover:bg-[#EDEAE4]'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>
        <p className="text-[10px] tracking-widest mt-1">Official Archive · {selectedOption?.label}</p>
      </div>

      {/* 큰 기사 하나 */}
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="h-full" />
        ) : !quiz ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <h3 className="font-bold text-lg mb-2 text-[#1A1A1A]">완료한 기출문제가 없습니다</h3>
            <p className="text-sm text-[#5C5C5C]">해당 시험의 기출문제를 풀면 여기에 표시됩니다.</p>
          </div>
        ) : (
          <div
            onClick={() => onShowDetails?.(quiz)}
            className="relative border-2 border-[#1A1A1A] bg-[#F5F0E8] h-full cursor-pointer"
          >
            {/* 신문 배경 텍스트 */}
            <div className="absolute inset-0 p-3 overflow-hidden pointer-events-none">
              <p className="text-[7px] text-[#D8D8D8] leading-tight break-words">
                {NEWSPAPER_BG_TEXT}
              </p>
            </div>

            {/* 기사 내용 */}
            <div className="relative z-10 p-4 h-full flex flex-col">
              <div className="flex gap-4 flex-1">
                {/* 난이도 이미지 */}
                {quiz.difficultyImageUrl && (
                  <div className="w-28 h-40 flex-shrink-0 border-2 border-[#1A1A1A] bg-white">
                    <img
                      src={quiz.difficultyImageUrl}
                      alt="난이도"
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}

                {/* 텍스트 */}
                <div className="flex-1 bg-[#F5F0E8]/95 p-3">
                  <h2 className="text-xl font-black text-[#1A1A1A] mb-2">
                    {quiz.title}
                  </h2>

                  <p className="text-sm text-[#5C5C5C] mb-2">
                    객관 {quiz.multipleChoiceCount || 0} · 주관 {quiz.subjectiveCount || 0} · 총 {quiz.questionCount}문제
                  </p>

                  <p className="text-sm text-[#5C5C5C] mb-3">
                    {quiz.participantCount}명 참여
                  </p>

                  {quiz.tags && quiz.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-3">
                      {quiz.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 bg-[#1A1A1A] text-[#F5F0E8] text-xs font-medium"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {quiz.oneLineSummary && (
                    <p className="text-sm italic text-[#5C5C5C] border-l-2 border-[#1A1A1A] pl-2 mb-3">
                      &quot;{quiz.oneLineSummary}&quot;
                    </p>
                  )}
                </div>
              </div>

              {/* 버튼 영역 */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onReview();
                }}
                className="w-full py-3 font-bold text-sm bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors mt-4"
              >
                복습하기
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 뉴스 캐러셀 컴포넌트 (복습용)
 */
function ReviewNewsCarousel({
  midtermQuizzes,
  finalQuizzes,
  pastQuiz,
  pastExamOptions,
  selectedPastExam,
  onSelectPastExam,
  isLoading,
  onReview,
  onShowDetails,
  isQuizBookmarked,
  onToggleBookmark,
}: {
  midtermQuizzes: CompletedQuizData[];
  finalQuizzes: CompletedQuizData[];
  pastQuiz: CompletedQuizData | null;
  pastExamOptions: PastExamOption[];
  selectedPastExam: string;
  onSelectPastExam: (value: string) => void;
  isLoading: { midterm: boolean; final: boolean; past: boolean };
  onReview: (quizId: string) => void;
  onShowDetails?: (quiz: CompletedQuizData) => void;
  isQuizBookmarked?: (quizId: string) => boolean;
  onToggleBookmark?: (quizId: string) => void;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const goToPrev = () => setCurrentIndex((prev) => Math.max(0, prev - 1));
  const goToNext = () => setCurrentIndex((prev) => Math.min(2, prev + 1));

  const handleDragEnd = (e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (info.offset.x > 50) {
      goToPrev();
    } else if (info.offset.x < -50) {
      goToNext();
    }
  };

  return (
    <div className="relative px-4">
      {/* 좌측 화살표 */}
      <button
        onClick={goToPrev}
        disabled={currentIndex === 0}
        className={`absolute left-0 top-1/2 -translate-y-1/2 z-20 w-10 h-10 flex items-center justify-center rounded-full border-2 border-[#1A1A1A] bg-[#F5F0E8] shadow-md transition-all ${
          currentIndex === 0 ? 'opacity-30 cursor-not-allowed' : 'hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
        }`}
      >
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      </button>

      {/* 우측 화살표 */}
      <button
        onClick={goToNext}
        disabled={currentIndex === 2}
        className={`absolute right-0 top-1/2 -translate-y-1/2 z-20 w-10 h-10 flex items-center justify-center rounded-full border-2 border-[#1A1A1A] bg-[#F5F0E8] shadow-md transition-all ${
          currentIndex === 2 ? 'opacity-30 cursor-not-allowed' : 'hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
        }`}
      >
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
        </svg>
      </button>

      {/* 카드 컨테이너 */}
      <div ref={containerRef} className="overflow-hidden mx-6">
        <motion.div
          className="flex"
          animate={{ x: `${-currentIndex * 100}%` }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          onDragEnd={handleDragEnd}
        >
          {/* 중간 카드 */}
          <motion.div
            className="w-full flex-shrink-0 px-2"
            style={{ perspective: 1000 }}
          >
            <motion.div
              animate={{
                rotateY: currentIndex === 0 ? 0 : currentIndex < 0 ? 15 : -15,
                scale: currentIndex === 0 ? 1 : 0.9,
                opacity: currentIndex === 0 ? 1 : 0.7,
              }}
              transition={{ duration: 0.3 }}
              className="h-[420px]"
            >
              <ReviewNewsCard
                type="midterm"
                title="MIDTERM REVIEW"
                subtitle="Vol.1 · Midterm Edition"
                quizzes={midtermQuizzes}
                isLoading={isLoading.midterm}
                onReview={onReview}
                onShowDetails={onShowDetails}
                isQuizBookmarked={isQuizBookmarked}
                onToggleBookmark={onToggleBookmark}
              />
            </motion.div>
          </motion.div>

          {/* 기말 카드 */}
          <motion.div
            className="w-full flex-shrink-0 px-2"
            style={{ perspective: 1000 }}
          >
            <motion.div
              animate={{
                rotateY: currentIndex === 1 ? 0 : currentIndex < 1 ? 15 : -15,
                scale: currentIndex === 1 ? 1 : 0.9,
                opacity: currentIndex === 1 ? 1 : 0.7,
              }}
              transition={{ duration: 0.3 }}
              className="h-[420px]"
            >
              <ReviewNewsCard
                type="final"
                title="FINAL REVIEW"
                subtitle="Vol.2 · Final Edition"
                quizzes={finalQuizzes}
                isLoading={isLoading.final}
                onReview={onReview}
                onShowDetails={onShowDetails}
                isQuizBookmarked={isQuizBookmarked}
                onToggleBookmark={onToggleBookmark}
              />
            </motion.div>
          </motion.div>

          {/* 기출 카드 */}
          <motion.div
            className="w-full flex-shrink-0 px-2"
            style={{ perspective: 1000 }}
          >
            <motion.div
              animate={{
                rotateY: currentIndex === 2 ? 0 : currentIndex < 2 ? 15 : -15,
                scale: currentIndex === 2 ? 1 : 0.9,
                opacity: currentIndex === 2 ? 1 : 0.7,
              }}
              transition={{ duration: 0.3 }}
              className="h-[420px]"
            >
              <ReviewPastExamNewsCard
                quiz={pastQuiz}
                selectedPastExam={selectedPastExam}
                pastExamOptions={pastExamOptions}
                onSelectPastExam={onSelectPastExam}
                isLoading={isLoading.past}
                onReview={() => pastQuiz && onReview(pastQuiz.id)}
                onShowDetails={onShowDetails}
              />
            </motion.div>
          </motion.div>
        </motion.div>
      </div>

      {/* 인디케이터 */}
      <div className="flex justify-center gap-2 mt-4">
        {[0, 1, 2].map((index) => (
          <button
            key={index}
            onClick={() => setCurrentIndex(index)}
            className={`w-2 h-2 rounded-full transition-all ${
              currentIndex === index ? 'bg-[#1A1A1A] w-4' : 'bg-[#D4CFC4]'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * 자작 복습 카드 컴포넌트 (뉴스 스타일)
 */
function CustomReviewQuizCard({
  quiz,
  onCardClick,
  onDetails,
  onReview,
  onReviewWrongOnly,
  isBookmarked,
  onToggleBookmark,
  isSelectMode = false,
  isSelected = false,
}: {
  quiz: CompletedQuizData;
  onCardClick: () => void;
  onDetails: () => void;
  onReview: () => void;
  onReviewWrongOnly?: () => void;
  isBookmarked?: boolean;
  onToggleBookmark?: () => void;
  isSelectMode?: boolean;
  isSelected?: boolean;
}) {
  const tags = quiz.tags || [];
  const [showReviewMenu, setShowReviewMenu] = useState(false);
  const reviewMenuRef = useRef<HTMLDivElement>(null);

  // 외부 클릭 시 메뉴 닫기
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (reviewMenuRef.current && !reviewMenuRef.current.contains(event.target as Node)) {
        setShowReviewMenu(false);
      }
    };
    if (showReviewMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showReviewMenu]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={isSelectMode ? {} : { y: -4, boxShadow: '0 8px 20px rgba(0, 0, 0, 0.08)' }}
      whileTap={!isSelectMode ? TAP_SCALE : undefined}
      transition={{ duration: 0.2 }}
      onClick={onCardClick}
      className={`relative border bg-[#F5F0E8]/70 backdrop-blur-sm overflow-hidden cursor-pointer shadow-[0_2px_8px_rgba(0,0,0,0.06)] ${
        isSelectMode
          ? isSelected
            ? 'border-2 border-dashed border-[#1A1A1A] bg-[#EDEAE4]'
            : 'border border-dashed border-[#5C5C5C] hover:border-[#1A1A1A]'
          : 'border-[#999]'
      }`}
    >
      {/* 신문 배경 텍스트 */}
      <div className="absolute inset-0 p-2 overflow-hidden pointer-events-none">
        <p className="text-[5px] text-[#E8E8E8] leading-tight break-words">
          {NEWSPAPER_BG_TEXT.slice(0, 300)}
        </p>
      </div>

      {/* 선택 모드 체크 아이콘 또는 아이콘 그룹 */}
      {isSelectMode ? (
        <div className={`absolute top-2 right-2 z-30 w-5 h-5 flex items-center justify-center ${
          isSelected ? 'bg-[#1A1A1A]' : 'border-2 border-[#5C5C5C] bg-white/80'
        }`}>
          {isSelected && (
            <svg className="w-3 h-3 text-[#F5F0E8]" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          )}
        </div>
      ) : (
        /* 우측 상단 아이콘 그룹: [지구 (AI 공개)] [북마크] */
        <div className="absolute top-2 right-2 z-30 flex items-center gap-1.5">
          {/* 지구 아이콘 (AI 생성 공개 퀴즈) - 상호작용 없음 */}
          {quiz.isAiGenerated && (
            <div className="w-5 h-5 flex items-center justify-center text-[#5C5C5C]">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.6 9h16.8M3.6 15h16.8" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3a15.3 15.3 0 0 1 4 9 15.3 15.3 0 0 1-4 9 15.3 15.3 0 0 1-4-9 15.3 15.3 0 0 1 4-9z" />
              </svg>
            </div>
          )}

          {/* 북마크 버튼 */}
          {onToggleBookmark && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleBookmark();
              }}
              className="flex flex-col items-center transition-transform hover:scale-110"
            >
              {isBookmarked ? (
                <svg className="w-5 h-5 text-[#8B1A1A]" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-[#5C5C5C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                </svg>
              )}
            </button>
          )}
        </div>
      )}

      {/* 카드 내용 */}
      <div className="relative z-10 p-3 bg-[#F5F0E8]/60">
        {/* 제목 (2줄 고정 높이) */}
        <div className="h-[36px] mb-1.5">
          <h3 className="font-bold text-sm line-clamp-2 text-[#1A1A1A] leading-snug">
            {quiz.title}
          </h3>
        </div>

        {/* 메타 정보 */}
        <p className="text-xs text-[#5C5C5C] mb-1">
          {quiz.questionCount}문제 · {quiz.participantCount}명 참여
        </p>

        {/* 태그 (2줄 고정 높이) */}
        <div className="h-[38px] mb-1.5 overflow-hidden">
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-0.5">
              {tags.slice(0, 8).map((tag) => (
                <span
                  key={tag}
                  className="px-1 py-0.5 bg-[#1A1A1A] text-[#F5F0E8] text-[10px] font-normal"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 버튼 */}
        {!isSelectMode && (
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDetails();
              }}
              className="flex-1 py-1.5 text-[11px] font-bold border border-[#1A1A1A] text-[#1A1A1A] bg-transparent hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors rounded-lg"
            >
              Details
            </button>
            {/* Review 버튼 with 드롭다운 */}
            <div className="relative flex-1" ref={reviewMenuRef}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (onReviewWrongOnly) {
                    setShowReviewMenu(!showReviewMenu);
                  } else {
                    onReview();
                  }
                }}
                className="w-full py-1.5 text-[11px] font-semibold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors flex items-center justify-center gap-0.5 rounded-lg"
              >
                Review
                {onReviewWrongOnly && (
                  <svg className={`w-3 h-3 transition-transform ${showReviewMenu ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
              {/* 드롭다운 메뉴 */}
              <AnimatePresence>
                {showReviewMenu && onReviewWrongOnly && (
                  <motion.div
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    className="absolute bottom-full left-0 right-0 mb-1 bg-[#F5F0E8] border border-[#1A1A1A] shadow-lg z-50 rounded-lg overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowReviewMenu(false);
                        onReview();
                      }}
                      className="w-full px-2 py-1.5 text-xs font-bold text-[#1A1A1A] hover:bg-[#EDEAE4] text-center border-b border-[#EDEAE4]"
                    >
                      모두
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowReviewMenu(false);
                        onReviewWrongOnly();
                      }}
                      className="w-full px-2 py-1.5 text-xs font-bold text-[#8B1A1A] hover:bg-[#FDEAEA] text-center"
                    >
                      오답만
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

/**
 * 스켈레톤 퀴즈 카드 (찜/서재 탭용)
 */
function SkeletonQuizCard() {
  return (
    <div className="border border-[#D4CFC4] bg-[#F5F0E8] p-4 shadow-sm">
      {/* 상단: 제목 + 하트 */}
      <div className="flex justify-between items-start mb-3">
        <Skeleton className="w-2/3 h-5 rounded-none" />
        <Skeleton className="w-5 h-5 rounded-none" />
      </div>

      {/* 정보 텍스트 */}
      <Skeleton className="w-24 h-3 mb-3 rounded-none" />

      {/* 태그들 */}
      <div className="flex flex-wrap gap-1 mb-4">
        <Skeleton className="w-16 h-5 rounded-none" />
        <Skeleton className="w-20 h-5 rounded-none" />
      </div>

      {/* 버튼들 */}
      <div className="flex gap-2">
        <Skeleton className="flex-1 h-9 rounded-none" />
        <Skeleton className="flex-1 h-9 rounded-none" />
      </div>
    </div>
  );
}

/**
 * 빈 상태 컴포넌트
 */
function EmptyState({ filter, type, fullHeight = false }: { filter: ReviewFilter | 'solved'; type?: 'quiz' | 'question'; fullHeight?: boolean }) {
  const messages: Record<ReviewFilter | 'solved', { title: string; desc: string }> = {
    library: { title: '서재가 비어있습니다', desc: 'AI 퀴즈로 학습하면 여기에 저장돼요.' },
    wrong: { title: '오답이 없습니다', desc: '퀴즈를 풀면 틀린 문제가 자동으로 저장됩니다.' },
    bookmark: { title: '찜한 항목이 없습니다', desc: '퀴즈나 문제를 찜해보세요.' },
    custom: { title: '폴더가 없습니다', desc: '나만의 폴더를 만들어보세요.' },
    solved: { title: '푼 문제가 없습니다', desc: '퀴즈를 풀면 여기에 표시됩니다.' },
  };

  // 찜 탭에서 퀴즈/문제 구분
  if (filter === 'bookmark' && type) {
    if (type === 'quiz') {
      return (
        <div className="py-6 text-center">
          <p className="text-sm text-[#5C5C5C]">찜한 퀴즈가 없습니다</p>
        </div>
      );
    } else {
      return (
        <div className="py-6 text-center">
          <p className="text-sm text-[#5C5C5C]">찜한 문제가 없습니다</p>
        </div>
      );
    }
  }

  const { title, desc } = messages[filter];

  // 전체 높이 모드: 헤더와 네비게이션을 제외한 공간의 정중앙
  if (fullHeight) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex items-center justify-center text-center"
        style={{ height: 'calc(100vh - 340px - 100px)' }} // 헤더(~340px) + 네비게이션(~100px) 제외
      >
        <div>
          <h3 className="font-serif-display text-xl font-black mb-2 text-[#1A1A1A]">
            {title}
          </h3>
          <p className="text-sm text-[#3A3A3A]">
            {desc}
          </p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="py-16 text-center"
    >
      <h3 className="font-serif-display text-xl font-black mb-2 text-[#1A1A1A]">
        {title}
      </h3>
      <p className="text-sm text-[#3A3A3A]">
        {desc}
      </p>
    </motion.div>
  );
}

/**
 * 스크롤 인디케이터 컴포넌트
 */
function ScrollIndicator({
  containerRef,
  itemCount,
  itemsPerRow = 3,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  itemCount: number;
  itemsPerRow?: number;
}) {
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const calculatePages = () => {
      const scrollHeight = container.scrollHeight;
      const clientHeight = container.clientHeight;
      if (scrollHeight <= clientHeight) {
        setTotalPages(1);
        setCurrentPage(0);
        return;
      }
      // 대략적인 페이지 수 계산
      const rowHeight = 120; // 대략적인 한 행 높이
      const rowsPerPage = Math.floor(clientHeight / rowHeight) || 1;
      const totalRows = Math.ceil(itemCount / itemsPerRow);
      const pages = Math.ceil(totalRows / rowsPerPage) || 1;
      setTotalPages(Math.min(pages, 5)); // 최대 5개
    };

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const maxScroll = scrollHeight - clientHeight;
      if (maxScroll <= 0) {
        setCurrentPage(0);
        return;
      }
      const scrollRatio = scrollTop / maxScroll;
      const page = Math.round(scrollRatio * (totalPages - 1));
      setCurrentPage(page);
    };

    calculatePages();
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [containerRef, itemCount, itemsPerRow, totalPages]);

  if (totalPages <= 1) return null;

  return (
    <div className="flex justify-center gap-1.5 py-2">
      {Array.from({ length: totalPages }).map((_, i) => (
        <div
          key={i}
          className={`w-1.5 h-1.5 rounded-full transition-colors ${
            i === currentPage ? 'bg-[#1A1A1A]' : 'bg-[#D4CFC4]'
          }`}
        />
      ))}
    </div>
  );
}

/**
 * 서재 퀴즈 카드 (CustomReviewQuizCard와 동일한 스타일)
 * - 카드 클릭: 상세 페이지로 이동
 * - Details 버튼: 상세 페이지로 이동
 * - Review 버튼: 복습 시작
 * - 지구 아이콘: 공개 전환
 */
function LibraryQuizCard({
  quiz,
  onCardClick,
  onDetails,
  onReview,
  onReviewWrongOnly,
  onPublish,
  isSelectMode = false,
  isSelected = false,
}: {
  quiz: { id: string; title: string; questionCount: number; score: number; totalQuestions: number; tags?: string[]; myScore?: number; myFirstReviewScore?: number };
  onCardClick: () => void;
  onDetails: () => void;
  onReview: () => void;
  onReviewWrongOnly?: () => void;
  onPublish: () => void;
  isSelectMode?: boolean;
  isSelected?: boolean;
}) {
  const [showReviewMenu, setShowReviewMenu] = useState(false);
  const reviewMenuRef = useRef<HTMLDivElement>(null);

  // 외부 클릭 시 메뉴 닫기
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (reviewMenuRef.current && !reviewMenuRef.current.contains(event.target as Node)) {
        setShowReviewMenu(false);
      }
    };
    if (showReviewMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showReviewMenu]);

  const tags = quiz.tags || [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4, boxShadow: '0 8px 20px rgba(0, 0, 0, 0.08)' }}
      whileTap={TAP_SCALE}
      transition={{ duration: 0.2 }}
      onClick={onCardClick}
      className={`relative border bg-[#F5F0E8]/70 backdrop-blur-sm overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.06)] cursor-pointer rounded-xl ${
        isSelectMode
          ? isSelected
            ? 'border-2 border-[#8B1A1A] bg-[#FDEAEA]'
            : 'border border-[#999] hover:bg-[#EDEAE4]'
          : 'border-[#999]'
      }`}
    >
      {/* 신문 배경 텍스트 */}
      <div className="absolute inset-0 p-2 overflow-hidden pointer-events-none">
        <p className="text-[5px] text-[#E8E8E8] leading-tight break-words">
          {NEWSPAPER_BG_TEXT.slice(0, 300)}
        </p>
      </div>

      {/* 선택 모드 체크 아이콘 */}
      {isSelectMode && (
        <div className={`absolute top-2 right-2 w-6 h-6 border-2 flex items-center justify-center z-20 ${
          isSelected
            ? 'border-[#8B1A1A] bg-[#8B1A1A]'
            : 'border-[#5C5C5C] bg-white'
        }`}>
          {isSelected && (
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
      )}

      {/* 공개 버튼 (자물쇠 아이콘 - 비공개 상태) - 선택 모드가 아닐 때만 표시 */}
      {!isSelectMode && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPublish();
          }}
          className="absolute top-2 right-2 z-20 w-7 h-7 flex items-center justify-center text-[#5C5C5C] hover:text-[#1A1A1A] hover:scale-110 transition-all"
          title="공개로 전환"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </button>
      )}

      {/* 카드 내용 */}
      <div className="relative z-10 p-3 bg-[#F5F0E8]/60">
        {/* 제목 (2줄 고정 높이) */}
        <div className="h-[36px] mb-1.5">
          <h3 className="font-bold text-sm line-clamp-2 text-[#1A1A1A] leading-snug pr-8">
            {quiz.title}
          </h3>
        </div>

        {/* 메타 정보 */}
        <p className="text-xs text-[#5C5C5C] mb-1">
          {quiz.questionCount}문제
        </p>

        {/* 태그 (2줄 고정 높이) */}
        <div className="h-[38px] mb-1.5 overflow-hidden">
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-0.5">
              {tags.slice(0, 8).map((tag) => (
                <span
                  key={tag}
                  className="px-1 py-0.5 bg-[#1A1A1A] text-[#F5F0E8] text-[10px] font-normal"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 버튼 (선택 모드가 아닐 때만 표시) */}
        {!isSelectMode && (
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDetails();
              }}
              className="flex-1 py-1.5 text-[11px] font-bold border border-[#1A1A1A] text-[#1A1A1A] bg-transparent hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors rounded-lg"
            >
              Details
            </button>
            {/* Review 버튼 with 드롭다운 */}
            <div className="relative flex-1" ref={reviewMenuRef}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (onReviewWrongOnly) {
                    setShowReviewMenu(!showReviewMenu);
                  } else {
                    onReview();
                  }
                }}
                className="w-full py-1.5 text-[11px] font-semibold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors flex items-center justify-center gap-0.5 rounded-lg"
              >
                Review
                {onReviewWrongOnly && (
                  <svg className={`w-3 h-3 transition-transform ${showReviewMenu ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
              {/* 드롭다운 메뉴 */}
              <AnimatePresence>
                {showReviewMenu && onReviewWrongOnly && (
                  <motion.div
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    className="absolute bottom-full left-0 right-0 mb-1 bg-[#F5F0E8] border border-[#1A1A1A] shadow-lg z-50 rounded-lg overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowReviewMenu(false);
                        onReview();
                      }}
                      className="w-full px-2 py-1.5 text-xs font-bold text-[#1A1A1A] hover:bg-[#EDEAE4] text-center border-b border-[#EDEAE4]"
                    >
                      모두
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowReviewMenu(false);
                        onReviewWrongOnly();
                      }}
                      className="w-full px-2 py-1.5 text-xs font-bold text-[#8B1A1A] hover:bg-[#FDEAEA] text-center"
                    >
                      오답만
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

/**
 * 찜한 퀴즈 카드 (자작 탭 QuizCard와 동일한 스타일)
 */
function BookmarkQuizCard({
  quiz,
  onCardClick,
  onDetails,
  onStartQuiz,
  onStartReview,
  onStartReviewWrongOnly,
  onUnbookmark,
  isSelectMode = false,
  isSelected = false,
  hasUpdate = false,
  onUpdateClick,
}: {
  quiz: BookmarkedQuiz;
  onCardClick: () => void;
  onDetails: () => void;
  onStartQuiz: () => void;
  onStartReview: () => void;
  onStartReviewWrongOnly?: () => void;
  onUnbookmark: () => void;
  isSelectMode?: boolean;
  isSelected?: boolean;
  hasUpdate?: boolean;
  onUpdateClick?: () => void;
}) {
  const tags = quiz.tags || [];
  const [showReviewMenu, setShowReviewMenu] = useState(false);
  const reviewMenuRef = useRef<HTMLDivElement>(null);

  // 퀴즈 완료 여부 (quiz_completions에 있거나 myScore가 있으면 퀴즈 완료)
  const hasCompletedQuiz = quiz.hasCompleted || quiz.myScore !== undefined;

  // 외부 클릭 시 메뉴 닫기
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (reviewMenuRef.current && !reviewMenuRef.current.contains(event.target as Node)) {
        setShowReviewMenu(false);
      }
    };
    if (showReviewMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showReviewMenu]);

  // 카드 클릭 핸들러 (퀴즈 미완료 시 아무 일도 안 함)
  const handleCardClick = () => {
    if (isSelectMode) {
      onCardClick();
    } else if (hasCompletedQuiz) {
      onCardClick();
    }
    // 퀴즈 미완료 + 선택모드 아님: 아무 일도 안 함
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={isSelectMode ? {} : { y: -4, boxShadow: '0 8px 20px rgba(0, 0, 0, 0.08)' }}
      transition={{ duration: 0.2 }}
      onClick={handleCardClick}
      className={`relative border bg-[#F5F0E8]/70 backdrop-blur-sm p-3 shadow-[0_2px_8px_rgba(0,0,0,0.06)] rounded-xl ${
        isSelectMode
          ? isSelected
            ? 'border-2 border-dashed border-[#1A1A1A] bg-[#EDEAE4] cursor-pointer'
            : 'border border-dashed border-[#5C5C5C] hover:border-[#1A1A1A] cursor-pointer'
          : hasCompletedQuiz
            ? 'border-[#999] cursor-pointer'
            : 'border-[#999] cursor-default'
      }`}
    >
      {/* 선택 모드 체크 아이콘 */}
      {isSelectMode ? (
        <div className={`absolute top-2 right-2 w-5 h-5 flex items-center justify-center ${
          isSelected ? 'bg-[#1A1A1A]' : 'border-2 border-[#5C5C5C] bg-white/80'
        }`}>
          {isSelected && (
            <svg className="w-3 h-3 text-[#F5F0E8]" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          )}
        </div>
      ) : (
        <>
          {/* 업데이트 뱃지 (하트 아이콘 왼쪽) */}
          {hasUpdate && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUpdateClick?.();
              }}
              className="absolute top-2 right-9 z-30 w-5 h-5 bg-[#F5C518] rounded-full flex items-center justify-center border-2 border-[#1A1A1A] hover:scale-110 transition-transform"
            >
              <span className="text-[#1A1A1A] font-bold text-xs">!</span>
            </button>
          )}
          {/* 하트 아이콘 (북마크 해제) */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onUnbookmark();
            }}
            className="absolute top-2 right-2 flex flex-col items-center transition-transform hover:scale-110"
          >
            <svg className="w-5 h-5 text-[#8B1A1A]" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
            {(quiz.bookmarkCount ?? 0) > 0 && (
              <span className="text-[10px] text-[#5C5C5C] font-bold mt-0.5">
                {quiz.bookmarkCount}
              </span>
            )}
          </button>
        </>
      )}

      {/* 제목 (2줄 고정 높이) - 가독성 향상 */}
      <div className="h-[36px] mb-1.5">
        <h3 className="font-bold text-sm line-clamp-2 text-[#1A1A1A] pr-6 leading-snug">
          {quiz.title}
        </h3>
      </div>

      {/* 메타 정보 - 가독성 향상 */}
      <p className="text-xs text-[#5C5C5C] mb-1">
        {quiz.questionCount}문제 · {quiz.participantCount}명 참여
      </p>

      {/* 태그 (2줄 고정 높이) */}
      <div className="h-[38px] mb-1.5 overflow-hidden">
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-0.5">
            {tags.slice(0, 8).map((tag) => (
              <span
                key={tag}
                className="px-1 py-0.5 bg-[#1A1A1A] text-[#F5F0E8] text-[10px] font-normal"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 버튼 영역 - 상태에 따라 버튼 텍스트와 동작 변경 */}
      {!isSelectMode && (
        <div className="flex gap-2 mt-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDetails();
            }}
            className="flex-1 py-1.5 text-[11px] font-bold border border-[#1A1A1A] text-[#1A1A1A] bg-transparent hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors rounded-lg"
          >
            Details
          </button>
          {hasCompletedQuiz ? (
            /* Review 버튼 with 드롭다운 */
            <div className="relative flex-1" ref={reviewMenuRef}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (onStartReviewWrongOnly) {
                    setShowReviewMenu(!showReviewMenu);
                  } else {
                    onStartReview();
                  }
                }}
                className="w-full py-1.5 text-[11px] font-semibold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors flex items-center justify-center gap-0.5 rounded-lg"
              >
                Review
                {onStartReviewWrongOnly && (
                  <svg className={`w-3 h-3 transition-transform ${showReviewMenu ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
              {/* 드롭다운 메뉴 */}
              <AnimatePresence>
                {showReviewMenu && onStartReviewWrongOnly && (
                  <motion.div
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    className="absolute bottom-full left-0 right-0 mb-1 bg-[#F5F0E8] border border-[#1A1A1A] shadow-lg z-50 rounded-lg overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowReviewMenu(false);
                        onStartReview();
                      }}
                      className="w-full px-2 py-1.5 text-xs font-bold text-[#1A1A1A] hover:bg-[#EDEAE4] text-center border-b border-[#EDEAE4]"
                    >
                      모두
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowReviewMenu(false);
                        onStartReviewWrongOnly();
                      }}
                      className="w-full px-2 py-1.5 text-xs font-bold text-[#8B1A1A] hover:bg-[#FDEAEA] text-center"
                    >
                      오답만
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            /* Start 버튼 (드롭다운 없음) */
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onStartQuiz();
              }}
              className="flex-1 py-1.5 text-[11px] font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors rounded-lg"
            >
              Start
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}

/**
 * 찜 탭 그리드 뷰 (자작 탭과 동일한 2열 그리드 배치)
 */
function BookmarkGridView({
  bookmarkedQuizzes,
  onQuizCardClick,
  onQuizDetails,
  onStartQuiz,
  onStartReview,
  onStartReviewWrongOnly,
  onUnbookmark,
  isSelectMode = false,
  selectedFolderIds,
  onSelectToggle,
  getQuizUpdateInfo,
  onUpdateClick,
}: {
  bookmarkedQuizzes: BookmarkedQuiz[];
  onQuizCardClick: (quizId: string) => void;
  onQuizDetails: (quiz: BookmarkedQuiz) => void;
  onStartQuiz: (quizId: string) => void;
  onStartReview: (quizId: string) => void;
  onStartReviewWrongOnly?: (quizId: string) => void;
  onUnbookmark: (quizId: string) => void;
  isSelectMode?: boolean;
  selectedFolderIds?: Set<string>;
  onSelectToggle?: (quizId: string) => void;
  getQuizUpdateInfo?: (quizId: string) => { hasUpdate: boolean; updatedCount: number } | null;
  onUpdateClick?: (quizId: string) => void;
}) {
  // 빈 상태
  if (bookmarkedQuizzes.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex flex-col items-center justify-center text-center"
        style={{ minHeight: 'calc(100vh - 380px)' }}
      >
        <div className="mb-4">
          <svg className="w-16 h-16 mx-auto text-[#D4CFC4]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
          </svg>
        </div>
        <h3 className="font-serif-display text-xl font-black mb-2 text-[#1A1A1A]">
          찜한 문제지가 없습니다
        </h3>
        <p className="text-sm text-[#5C5C5C]">
          마음에 드는 문제지를 찜해보세요
        </p>
      </motion.div>
    );
  }

  // 2열 그리드 레이아웃 (자작 탭과 동일)
  return (
    <div className="grid grid-cols-2 gap-3">
      {bookmarkedQuizzes.map((quiz, index) => (
        <motion.div
          key={quiz.id}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.03 }}
        >
          <BookmarkQuizCard
            quiz={quiz}
            onCardClick={() => {
              if (isSelectMode && onSelectToggle) {
                onSelectToggle(quiz.quizId);
              } else {
                onQuizCardClick(quiz.quizId);
              }
            }}
            onDetails={() => onQuizDetails(quiz)}
            onStartQuiz={() => onStartQuiz(quiz.quizId)}
            onStartReview={() => onStartReview(quiz.quizId)}
            onStartReviewWrongOnly={onStartReviewWrongOnly ? () => onStartReviewWrongOnly(quiz.quizId) : undefined}
            onUnbookmark={() => onUnbookmark(quiz.quizId)}
            isSelectMode={isSelectMode}
            isSelected={selectedFolderIds?.has(`bookmark-${quiz.quizId}`) || false}
            hasUpdate={getQuizUpdateInfo?.(quiz.quizId)?.hasUpdate || false}
            onUpdateClick={() => onUpdateClick?.(quiz.quizId)}
          />
        </motion.div>
      ))}
    </div>
  );
}

/**
 * 문제 탭 서브필터 컴포넌트
 */
/**
 * 문제 탭 레이아웃 (뉴스 스타일 캐러셀)
 */
function SolvedQuizLayout({
  userId,
  courseId,
  onQuizClick,
  onQuizClickWrongOnly,
  onShowDetails,
  onQuizCardClick,
  isQuizBookmarked,
  onToggleBookmark,
  isSelectMode = false,
  selectedFolderIds,
  onSelectToggle,
  quizAttempts = [],
}: {
  userId: string;
  courseId: string | null;
  onQuizClick: (quizId: string) => void;
  onQuizClickWrongOnly?: (quizId: string) => void;
  onShowDetails: (quiz: CompletedQuizData) => void;
  onQuizCardClick: (quizId: string) => void;
  isQuizBookmarked: (quizId: string) => boolean;
  onToggleBookmark: (quizId: string) => void;
  isSelectMode?: boolean;
  selectedFolderIds?: Set<string>;
  onSelectToggle?: (quizId: string) => void;
  quizAttempts?: QuizAttempt[];
}) {
  // 각 타입별 퀴즈 상태
  const [midtermQuizzes, setMidtermQuizzes] = useState<CompletedQuizData[]>([]);
  const [finalQuizzes, setFinalQuizzes] = useState<CompletedQuizData[]>([]);
  const [pastQuizzes, setPastQuizzes] = useState<CompletedQuizData[]>([]);
  const [customQuizzes, setCustomQuizzes] = useState<CompletedQuizData[]>([]);

  const [isLoading, setIsLoading] = useState({
    midterm: true,
    final: true,
    past: true,
    custom: true,
  });

  // 기출 드롭다운 상태
  const pastExamOptions = useMemo(() => getPastExamOptions(courseId), [courseId]);
  const [selectedPastExam, setSelectedPastExam] = useState<string>(() => {
    return pastExamOptions.length > 0 ? pastExamOptions[0].value : '2025-midterm';
  });

  // 자작 퀴즈 태그 필터 상태
  const [selectedCustomTags, setSelectedCustomTags] = useState<string[]>([]);
  const [showTagFilter, setShowTagFilter] = useState(false);

  // 모든 완료된 퀴즈 통합 로드 (quiz_completions 기반 - hotspot 제거)
  useEffect(() => {
    if (!userId) {
      setIsLoading({ midterm: false, final: false, past: false, custom: false });
      return;
    }

    // quiz_completions 구독 → 완료된 퀴즈 ID 목록 → 퀴즈 문서 조회
    const q = query(
      collection(db, 'quiz_completions'),
      where('userId', '==', userId)
    );

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const completions = new Map<string, number>();
      snapshot.forEach(d => {
        const data = d.data();
        completions.set(data.quizId, data.score ?? 0);
      });

      const quizIds = Array.from(completions.keys());

      if (quizIds.length === 0) {
        setMidtermQuizzes([]);
        setFinalQuizzes([]);
        setPastQuizzes([]);
        setCustomQuizzes([]);
        setIsLoading({ midterm: false, final: false, past: false, custom: false });
        return;
      }

      // 퀴즈 문서 배치 조회 (10개씩 병렬)
      const midterm: CompletedQuizData[] = [];
      const final: CompletedQuizData[] = [];
      const past: CompletedQuizData[] = [];
      const custom: CompletedQuizData[] = [];

      for (let i = 0; i < quizIds.length; i += 10) {
        const batch = quizIds.slice(i, i + 10);
        const docs = await Promise.all(
          batch.map(id => getDoc(doc(db, 'quizzes', id)))
        );

        for (const quizDoc of docs) {
          if (!quizDoc.exists()) continue;
          const data = quizDoc.data();
          const completionScore = completions.get(quizDoc.id);

          const quizData: CompletedQuizData = {
            id: quizDoc.id,
            title: data.title || '제목 없음',
            type: data.type || 'custom',
            questionCount: data.questionCount || 0,
            participantCount: data.participantCount || 0,
            tags: data.tags || [],
            creatorNickname: data.creatorNickname,
            attachmentUrl: data.attachmentUrl,
            oneLineSummary: data.oneLineSummary,
            difficultyImageUrl: data.difficultyImageUrl,
            multipleChoiceCount: data.multipleChoiceCount || 0,
            subjectiveCount: data.subjectiveCount || 0,
            oxCount: data.oxCount || 0,
            difficulty: data.difficulty || 'normal',
            pastYear: data.pastYear,
            pastExamType: data.pastExamType,
            myScore: completionScore ?? data.userScores?.[userId],
            myFirstReviewScore: data.userFirstReviewScores?.[userId],
            isAiGenerated: data.isAiGenerated || data.type === 'ai-generated',
            averageScore: data.averageScore || (() => {
              if (data.userScores) {
                const scores = Object.values(data.userScores) as number[];
                return scores.length > 0 ? Math.round((scores.reduce((s: number, v: number) => s + v, 0) / scores.length) * 10) / 10 : 0;
              }
              return 0;
            })(),
          };

          switch (data.type) {
            case 'midterm':
              if (data.courseId === courseId) midterm.push(quizData);
              break;
            case 'final':
              if (data.courseId === courseId) final.push(quizData);
              break;
            case 'past':
              if (data.courseId === courseId) past.push(quizData);
              break;
            case 'custom':
              custom.push(quizData);
              break;
          }
        }
      }

      setMidtermQuizzes(midterm);
      setFinalQuizzes(final);
      setPastQuizzes(past);
      setCustomQuizzes(custom);
      setIsLoading({ midterm: false, final: false, past: false, custom: false });
    });

    return () => unsubscribe();
  }, [userId, courseId]);

  // 기출 퀴즈 필터링 (selectedPastExam 변경 시 클라이언트에서 필터)
  const filteredPastQuizzes = useMemo(() => {
    const [yearStr, examType] = selectedPastExam.split('-');
    const year = parseInt(yearStr, 10);
    return pastQuizzes.filter(q => q.pastYear === year && q.pastExamType === examType);
  }, [pastQuizzes, selectedPastExam]);

  // 자작 퀴즈를 최근 푼 순서로 정렬
  const sortedCustomQuizzes = useMemo(() => {
    if (!quizAttempts || quizAttempts.length === 0) return customQuizzes;

    // 퀴즈별 가장 최근 완료 시간 맵 생성
    const latestCompletionMap = new Map<string, number>();
    quizAttempts.forEach(attempt => {
      const time = attempt.completedAt?.toMillis?.() || 0;
      const existing = latestCompletionMap.get(attempt.quizId) || 0;
      if (time > existing) {
        latestCompletionMap.set(attempt.quizId, time);
      }
    });

    // 최근 푼 순서로 정렬 (최신이 먼저)
    return [...customQuizzes].sort((a, b) => {
      const aTime = latestCompletionMap.get(a.id) || 0;
      const bTime = latestCompletionMap.get(b.id) || 0;
      return bTime - aTime;
    });
  }, [customQuizzes, quizAttempts]);

  // 과목별 동적 태그 목록 (공통 태그 + 챕터 태그)
  const fixedTagOptions = useMemo(() => {
    const courseTags = generateCourseTags(courseId);
    // 태그 값만 추출 (label이 아닌 value 사용)
    return [...COMMON_TAGS.map(t => t.value), ...courseTags.map(t => t.value)];
  }, [courseId]);

  // 태그 필터링된 자작 퀴즈
  const filteredCustomQuizzes = useMemo(() => {
    if (selectedCustomTags.length === 0) return sortedCustomQuizzes;
    // 선택된 모든 태그를 포함하는 퀴즈만 필터링 (AND 조건)
    return sortedCustomQuizzes.filter(quiz =>
      selectedCustomTags.every(tag => quiz.tags?.includes(tag))
    );
  }, [sortedCustomQuizzes, selectedCustomTags]);

  return (
    <div className="flex flex-col">
      {/* 뉴스 캐러셀 (중간/기말/기출) */}
      <section className="mb-8">
        <ReviewNewsCarousel
          midtermQuizzes={midtermQuizzes}
          finalQuizzes={finalQuizzes}
          pastQuiz={filteredPastQuizzes.length > 0 ? filteredPastQuizzes[0] : null}
          pastExamOptions={pastExamOptions}
          selectedPastExam={selectedPastExam}
          onSelectPastExam={setSelectedPastExam}
          isLoading={isLoading}
          onReview={onQuizClick}
          onShowDetails={onShowDetails}
          isQuizBookmarked={isQuizBookmarked}
          onToggleBookmark={onToggleBookmark}
        />
      </section>

      {/* 자작 섹션 */}
      <section className="px-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-serif-display text-xl font-black text-[#1A1A1A] shrink-0">자작</h2>

          {/* 선택된 태그들 + 태그 아이콘 (우측) */}
          <div className="flex items-center gap-2">
            {/* 선택된 태그들 (태그 아이콘 왼쪽에 배치) */}
            {selectedCustomTags.map((tag) => (
              <div
                key={tag}
                className="flex items-center gap-1 px-2 py-1 bg-[#F5F0E8] text-[#1A1A1A] text-sm font-bold border border-[#1A1A1A]"
              >
                #{tag}
                <button
                  onClick={() => setSelectedCustomTags(prev => prev.filter(t => t !== tag))}
                  className="ml-0.5 hover:text-[#5C5C5C]"
                >
                  ✕
                </button>
              </div>
            ))}

            {/* 태그 검색 버튼 */}
            <button
              onClick={() => setShowTagFilter(!showTagFilter)}
              className={`flex items-center justify-center w-9 h-9 border transition-colors shrink-0 rounded-lg ${
                showTagFilter
                  ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                  : 'bg-[#F5F0E8] text-[#1A1A1A] border-[#1A1A1A]'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
            </button>
          </div>
        </div>

        {/* 태그 필터 목록 */}
        <AnimatePresence>
          {showTagFilter && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden mb-4"
            >
              <div className="flex flex-wrap gap-1.5 p-2 bg-[#EDEAE4] border border-[#D4CFC4]">
                {/* 태그 버튼들 (이미 선택된 태그 제외) */}
                {fixedTagOptions
                  .filter(tag => !selectedCustomTags.includes(tag))
                  .map((tag) => (
                    <button
                      key={tag}
                      onClick={() => {
                        setSelectedCustomTags(prev => [...prev, tag]);
                        setShowTagFilter(false);
                      }}
                      className="px-2 py-1 text-xs font-bold bg-[#F5F0E8] text-[#1A1A1A] border border-[#1A1A1A] hover:bg-[#E5E0D8] transition-colors"
                    >
                      #{tag}
                    </button>
                  ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 전체 퀴즈가 없을 때 */}
        {!isLoading.custom && sortedCustomQuizzes.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center text-center py-12"
          >
            <h3 className="font-serif-display text-lg font-black mb-2 text-[#1A1A1A]">
              완료한 자작 퀴즈가 없습니다
            </h3>
            <p className="text-sm text-[#5C5C5C]">
              퀴즈를 풀면 여기서 복습할 수 있습니다
            </p>
          </motion.div>
        )}

        {/* 필터링 결과가 없을 때 */}
        {!isLoading.custom && sortedCustomQuizzes.length > 0 && filteredCustomQuizzes.length === 0 && selectedCustomTags.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center text-center py-8"
          >
            <p className="text-sm text-[#5C5C5C]">
              {selectedCustomTags.map(t => `#${t}`).join(' ')} 태그가 있는 퀴즈가 없습니다
            </p>
            <button
              onClick={() => setSelectedCustomTags([])}
              className="mt-2 px-4 py-2 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
            >
              필터 해제
            </button>
          </motion.div>
        )}

        {/* 퀴즈 목록 */}
        {!isLoading.custom && filteredCustomQuizzes.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {filteredCustomQuizzes.map((quiz, index) => (
              <motion.div
                key={quiz.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03 }}
              >
                <CustomReviewQuizCard
                  quiz={quiz}
                  onCardClick={() => {
                    if (isSelectMode && onSelectToggle) {
                      onSelectToggle(quiz.id);
                    } else {
                      onQuizCardClick(quiz.id);
                    }
                  }}
                  onDetails={() => onShowDetails(quiz)}
                  onReview={() => onQuizClick(quiz.id)}
                  onReviewWrongOnly={onQuizClickWrongOnly ? () => onQuizClickWrongOnly(quiz.id) : undefined}
                  isBookmarked={isQuizBookmarked(quiz.id)}
                  onToggleBookmark={() => onToggleBookmark(quiz.id)}
                  isSelectMode={isSelectMode}
                  isSelected={selectedFolderIds?.has(`solved-${quiz.id}`) || false}
                />
              </motion.div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * 문제 상세보기 모달 (문제 목록 표시)
 */
function QuestionListModal({
  quiz,
  onClose,
  onReview,
  groupedSolvedItems,
}: {
  quiz: CompletedQuizData;
  onClose: () => void;
  onReview: () => void;
  groupedSolvedItems: GroupedReviewItems[];
}) {
  // 해당 퀴즈의 문제 목록 찾기
  const solvedGroup = groupedSolvedItems.find(g => g.quizId === quiz.id);
  const questions = solvedGroup?.items || [];

  // 문제 유형 라벨
  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'ox': return 'OX';
      case 'multiple': return '객관식';
      case 'short_answer': return '주관식';
      case 'essay': return '서술형';
      case 'combined': return '결합형';
      default: return type;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.88 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.88 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[340px] max-h-[80vh] bg-[#F5F0E8] border-2 border-[#1A1A1A] flex flex-col"
      >
        {/* 헤더 */}
        <div className="p-3 border-b border-[#1A1A1A]">
          {/* 문제지 이름 */}
          <h3 className="font-bold text-sm text-[#1A1A1A] mb-1.5">
            {quiz.title}
          </h3>
          {/* 점수 표시: 퀴즈 점수 / 첫번째 복습 점수 (숫자만 크게) */}
          <div className="flex items-center gap-2 text-[#5C5C5C]">
            <span className="text-xs">점수:</span>
            <span className="text-lg font-black text-[#1A1A1A]">
              {quiz.myScore !== undefined ? quiz.myScore : '-'}
            </span>
            <span className="text-sm text-[#5C5C5C]">/</span>
            <span className="text-lg font-black text-[#1A1A1A]">
              {quiz.myFirstReviewScore !== undefined ? quiz.myFirstReviewScore : '-'}
            </span>
          </div>
          <p className="text-[10px] text-[#5C5C5C] mt-0.5">퀴즈 점수 / 첫번째 복습 점수</p>
        </div>

        {/* 문제 목록 */}
        <div className="flex-1 overflow-y-auto p-4">
          {questions.length === 0 ? (
            <div className="text-center py-8 text-[#5C5C5C]">
              문제를 불러오는 중...
            </div>
          ) : (
            <div className="space-y-2">
              {questions.map((item, index) => (
                <div
                  key={item.id}
                  className={`p-3 border ${
                    item.isCorrect ? 'border-[#1A6B1A] bg-[#1A6B1A]/5' : 'border-[#8B1A1A] bg-[#8B1A1A]/5'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-sm font-bold text-[#5C5C5C] shrink-0">
                      Q{index + 1}.
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[#1A1A1A] line-clamp-2">
                        {item.question}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-[#5C5C5C]">
                          {getTypeLabel(item.type)}
                        </span>
                        <span className={`text-xs font-bold ${
                          item.isCorrect ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'
                        }`}>
                          {item.isCorrect ? '정답' : '오답'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 버튼 영역 */}
        <div className="p-4 border-t border-[#1A1A1A] flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors"
          >
            닫기
          </button>
          <button
            onClick={onReview}
            className="flex-1 py-3 font-bold bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors"
          >
            복습하기
          </button>
        </div>
      </motion.div>
    </div>
  );
}

/**
 * 새 폴더 생성 모달
 */
function CreateFolderModal({
  isOpen,
  onClose,
  onCreate,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string) => void;
}) {
  const [folderName, setFolderName] = useState('');

  // 키보드 올라올 때 body 스크롤 방지
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCreate = () => {
    if (folderName.trim()) {
      onCreate(folderName.trim());
      setFolderName('');
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      style={{ position: 'fixed', touchAction: 'none' }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-[#F5F0E8] border-2 border-[#1A1A1A] p-3 mx-4 max-w-sm w-full rounded-2xl"
      >
        <h3 className="font-bold text-base text-[#1A1A1A] mb-3">새 폴더 만들기</h3>

        <input
          type="text"
          value={folderName}
          onChange={(e) => setFolderName(e.target.value)}
          placeholder="폴더 이름"
          className="w-full px-2.5 py-1.5 text-sm border border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A] mb-3 outline-none focus:border-2 rounded-lg"
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          inputMode="text"
          data-form-type="other"
          data-lpignore="true"
        />

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-1.5 text-xs font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors rounded-lg"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!folderName.trim()}
            className="flex-1 py-1.5 text-xs font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors disabled:opacity-50 rounded-lg"
          >
            만들기
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function ReviewPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { userCourseId, semesterSettings } = useCourse();
  const { profile } = useUser();

  // 과목별 리본 이미지
  const currentCourse = userCourseId && COURSES[userCourseId] ? COURSES[userCourseId] : null;
  const ribbonImage = currentCourse?.reviewRibbonImage || '/images/biology-review-ribbon.png';
  const ribbonScale = currentCourse?.reviewRibbonScale || 1;

  // URL 쿼리 파라미터에서 초기 필터값 가져오기 (기본값: 서재)
  const initialFilter = (searchParams.get('filter') as ReviewFilter) || 'library';
  const [activeFilter, setActiveFilter] = useState<ReviewFilter>(initialFilter);
  const [practiceItems, setPracticeItems] = useState<ReviewItem[] | null>(null);
  // 복습 모드: 'all' (모두) vs 'wrongOnly' (오답만) - 첫 복습 점수 저장 여부 결정에 사용
  const [practiceMode, setPracticeMode] = useState<'all' | 'wrongOnly' | null>(null);
  const [showCreateFolder, setShowCreateFolder] = useState(false);

  // 폴더 삭제 선택 모드 (모든 탭에서 통합 사용)
  const [isFolderDeleteMode, setIsFolderDeleteMode] = useState(false);
  const [deleteFolderIds, setDeleteFolderIds] = useState<Set<string>>(new Set());

  // 복습 선택 모드
  const [isReviewSelectMode, setIsReviewSelectMode] = useState(false);
  const [reviewSelectedIds, setReviewSelectedIds] = useState<Set<string>>(new Set());

  // 서재 공개 업로드 선택 모드
  const [isLibrarySelectMode, setIsLibrarySelectMode] = useState(false);
  const [librarySelectedIds, setLibrarySelectedIds] = useState<Set<string>>(new Set());

  // 서재 퀴즈 공개 확인 모달
  const [publishConfirmQuizId, setPublishConfirmQuizId] = useState<string | null>(null);

  // 서재 퀴즈 상세 모달
  const [selectedLibraryQuiz, setSelectedLibraryQuiz] = useState<typeof libraryQuizzesRaw[number] | null>(null);
  const { sourceRect: librarySourceRect, registerRef: registerLibraryRef, captureRect: captureLibraryRect, clearRect: clearLibraryRect } = useExpandSource();

  // 서재 태그 필터 상태
  const [librarySelectedTags, setLibrarySelectedTags] = useState<string[]>([]);
  const [showLibraryTagFilter, setShowLibraryTagFilter] = useState(false);

  // 찜 태그 필터 상태
  const [bookmarkSelectedTags, setBookmarkSelectedTags] = useState<string[]>([]);
  const [showBookmarkTagFilter, setShowBookmarkTagFilter] = useState(false);

  // 삭제 확인 바텀시트 (휴지통)
  const [showDeleteConfirmSheet, setShowDeleteConfirmSheet] = useState(false);

  // 빈 폴더 메시지
  const [showEmptyMessage, setShowEmptyMessage] = useState(false);

  // 찜한 퀴즈 상세보기 모달
  const [selectedBookmarkedQuiz, setSelectedBookmarkedQuiz] = useState<BookmarkedQuiz | null>(null);


  // 문제 상세보기 모달 (문제 목록 표시)
  const [questionListQuiz, setQuestionListQuiz] = useState<CompletedQuizData | null>(null);

  // PDF 폴더 선택 모드
  const [isPdfSelectMode, setIsPdfSelectMode] = useState(false);
  const [selectedPdfFolders, setSelectedPdfFolders] = useState<Set<string>>(new Set());

  // 폴더 정렬(카테고리) 관련 상태
  const [isSortMode, setIsSortMode] = useState(false);
  const [folderCategories, setFolderCategories] = useState<{ id: string; name: string }[]>([]);
  const [folderCategoryMap, setFolderCategoryMap] = useState<Record<string, string>>({});
  const [folderOrderMap, setFolderOrderMap] = useState<Record<string, number>>({}); // 폴더 순서
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isAssignMode, setIsAssignMode] = useState(false);
  const [selectedFolderForAssign, setSelectedFolderForAssign] = useState<string | null>(null);

  // 네비게이션 숨김 (폴더생성/정렬모드/서재상세/공개전환모달)
  useEffect(() => {
    if (showCreateFolder || isSortMode || selectedLibraryQuiz || publishConfirmQuizId) {
      document.body.setAttribute('data-hide-nav', '');
    } else {
      document.body.removeAttribute('data-hide-nav');
    }
    return () => document.body.removeAttribute('data-hide-nav');
  }, [showCreateFolder, isSortMode, selectedLibraryQuiz, publishConfirmQuizId]);

  // 카테고리 설정 모달 열릴 때 body 스크롤 방지 (키보드 올라올 때 자유 스크롤 방지)
  useEffect(() => {
    if (isSortMode) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [isSortMode]);

  // 로컬 스토리지에서 카테고리 정보 로드
  useEffect(() => {
    const savedCategories = localStorage.getItem('review_folder_categories');
    const savedMap = localStorage.getItem('review_folder_category_map');
    const savedOrder = localStorage.getItem('review_folder_order_map');
    if (savedCategories) {
      try {
        setFolderCategories(JSON.parse(savedCategories));
      } catch (e) {
        console.error('카테고리 로드 실패:', e);
      }
    }
    if (savedMap) {
      try {
        setFolderCategoryMap(JSON.parse(savedMap));
      } catch (e) {
        console.error('카테고리 맵 로드 실패:', e);
      }
    }
    if (savedOrder) {
      try {
        setFolderOrderMap(JSON.parse(savedOrder));
      } catch (e) {
        console.error('폴더 순서 로드 실패:', e);
      }
    }
  }, []);

  // 카테고리 정보를 로컬 스토리지에 저장
  const saveFolderCategories = (
    categories: { id: string; name: string }[],
    map: Record<string, string>,
    order?: Record<string, number>
  ) => {
    localStorage.setItem('review_folder_categories', JSON.stringify(categories));
    localStorage.setItem('review_folder_category_map', JSON.stringify(map));
    if (order) {
      localStorage.setItem('review_folder_order_map', JSON.stringify(order));
    }
  };

  // 카테고리 추가 (최대 8개)
  const handleAddFolderCategory = () => {
    if (!newCategoryName.trim()) return;
    if (folderCategories.length >= 8) {
      alert('카테고리는 최대 8개까지 추가할 수 있습니다.');
      return;
    }
    const newCategory = {
      id: `fcat_${Date.now()}`,
      name: newCategoryName.trim(),
    };
    const newCategories = [...folderCategories, newCategory];
    setFolderCategories(newCategories);
    saveFolderCategories(newCategories, folderCategoryMap, folderOrderMap);
    setNewCategoryName('');
  };

  // 카테고리 삭제
  const handleRemoveFolderCategory = (categoryId: string) => {
    const newCategories = folderCategories.filter(c => c.id !== categoryId);
    // 해당 카테고리의 폴더들은 미분류로 변경
    const newMap = { ...folderCategoryMap };
    Object.keys(newMap).forEach(folderId => {
      if (newMap[folderId] === categoryId) {
        delete newMap[folderId];
      }
    });
    setFolderCategories(newCategories);
    setFolderCategoryMap(newMap);
    saveFolderCategories(newCategories, newMap, folderOrderMap);
  };

  // 폴더를 카테고리에 배정 (분류 모드 유지)
  const handleAssignFolderToCategory = (folderId: string, categoryId: string | null) => {
    const newMap = { ...folderCategoryMap };
    if (categoryId) {
      newMap[folderId] = categoryId;
    } else {
      delete newMap[folderId];
    }
    setFolderCategoryMap(newMap);
    saveFolderCategories(folderCategories, newMap, folderOrderMap);
    setSelectedFolderForAssign(null);
    // 분류 모드는 유지 (사용자가 종료 버튼 클릭 시에만 종료)
  };

  // 두 폴더의 카테고리 또는 위치 교환
  const handleSwapFolderCategories = (folderId1: string, folderId2: string) => {
    const cat1 = folderCategoryMap[folderId1];
    const cat2 = folderCategoryMap[folderId2];

    // 같은 카테고리 내에 있으면 순서만 교환
    if (cat1 === cat2 || (!cat1 && !cat2)) {
      const newOrderMap = { ...folderOrderMap };
      // 순서가 없으면 현재 인덱스 기반으로 초기화
      const sameCategoryFolders = customFolders
        .filter(f => (cat1 ? folderCategoryMap[f.id] === cat1 : !folderCategoryMap[f.id]))
        .sort((a, b) => (folderOrderMap[a.id] ?? 999) - (folderOrderMap[b.id] ?? 999));

      // 현재 인덱스 찾기
      const idx1 = sameCategoryFolders.findIndex(f => f.id === folderId1);
      const idx2 = sameCategoryFolders.findIndex(f => f.id === folderId2);

      if (idx1 !== -1 && idx2 !== -1) {
        // 실제 인덱스로 순서 교환
        newOrderMap[folderId1] = idx2;
        newOrderMap[folderId2] = idx1;
        setFolderOrderMap(newOrderMap);
        saveFolderCategories(folderCategories, folderCategoryMap, newOrderMap);
      }
      setSelectedFolderForAssign(null);
      return;
    }

    // 다른 카테고리면 카테고리 교환
    const newMap = { ...folderCategoryMap };
    if (cat2) {
      newMap[folderId1] = cat2;
    } else {
      delete newMap[folderId1];
    }
    if (cat1) {
      newMap[folderId2] = cat1;
    } else {
      delete newMap[folderId2];
    }

    setFolderCategoryMap(newMap);
    saveFolderCategories(folderCategories, newMap, folderOrderMap);
    setSelectedFolderForAssign(null);
  };

  // 분류 모드에서 폴더 클릭 핸들러
  const handleFolderClickInAssignMode = (folderId: string) => {
    if (!selectedFolderForAssign) {
      // 선택된 폴더가 없으면 이 폴더를 선택
      setSelectedFolderForAssign(folderId);
    } else if (selectedFolderForAssign === folderId) {
      // 같은 폴더를 다시 클릭하면 선택 해제
      setSelectedFolderForAssign(null);
    } else {
      // 다른 폴더를 클릭하면 카테고리 교환
      handleSwapFolderCategories(selectedFolderForAssign, folderId);
    }
  };


  const {
    wrongItems,
    bookmarkedItems,
    solvedItems,
    groupedWrongItems,
    groupedBookmarkedItems,
    groupedSolvedItems,
    chapterGroupedWrongItems,
    quizAttempts,
    customFolders: customFoldersData,
    privateQuizzes,
    updatedQuizzes,
    loading,
    createCustomFolder,
    deleteCustomFolder,
    deleteWrongQuiz,
    deleteWrongQuizByChapter,
    deleteBookmarkQuiz,
    updateReviewItemsFromQuiz,
    refresh,
    deletedItems,
    restoreDeletedItem,
    permanentlyDeleteItem,
    markAsReviewed,
  } = useReview();

  // 퀴즈 북마크 훅
  const {
    bookmarkedQuizzes,
    toggleBookmark: toggleQuizBookmark,
    isBookmarked: isQuizBookmarked,
    loading: bookmarkLoading,
  } = useQuizBookmark();

  // 서재 (AI 학습 퀴즈) 훅
  const {
    quizzes: libraryQuizzesRaw,
    loading: libraryLoading,
    deleteQuiz: deleteLibraryQuiz,
    uploadToPublic,
  } = useLearningQuizzes();

  // 서재 고정 태그 목록
  // 과목별 동적 태그 목록 (공통 태그 + 챕터 태그)
  const libraryTagOptions = useMemo(() => {
    const courseTags = generateCourseTags(userCourseId);
    return [...COMMON_TAGS.map(t => t.value), ...courseTags.map(t => t.value)];
  }, [userCourseId]);

  // 태그 필터링된 서재 퀴즈
  const libraryQuizzes = useMemo(() => {
    if (librarySelectedTags.length === 0) return libraryQuizzesRaw;
    // 선택된 모든 태그를 포함하는 퀴즈만 필터링 (AND 조건)
    return libraryQuizzesRaw.filter(quiz =>
      librarySelectedTags.every(tag => quiz.tags?.includes(tag))
    );
  }, [libraryQuizzesRaw, librarySelectedTags]);

  // 찜 고정 태그 목록 (서재와 동일)
  // 찜 태그 목록 (서재와 동일)
  const bookmarkTagOptions = libraryTagOptions;

  // 태그 필터링된 찜 퀴즈
  const filteredBookmarkedQuizzes = useMemo(() => {
    if (bookmarkSelectedTags.length === 0) return bookmarkedQuizzes;
    // 선택된 모든 태그를 포함하는 퀴즈만 필터링 (AND 조건)
    return bookmarkedQuizzes.filter(quiz =>
      bookmarkSelectedTags.every(tag => quiz.tags?.includes(tag))
    );
  }, [bookmarkedQuizzes, bookmarkSelectedTags]);

  // 퀴즈 업데이트 감지 훅 (상세 정보 포함)
  const {
    checkQuizUpdate,
    refresh: refreshQuizUpdate,
  } = useQuizUpdate();

  // 업데이트 확인 모달
  const [updateModalInfo, setUpdateModalInfo] = useState<{
    quizId: string;
    quizTitle: string;
    filterType: string;
  } | null>(null);

  // UpdateQuizModal용 상세 업데이트 정보
  const [detailedUpdateInfo, setDetailedUpdateInfo] = useState<DetailedQuizUpdateInfo | null>(null);
  const [updateModalLoading, setUpdateModalLoading] = useState(false);
  const [totalQuestionCount, setTotalQuestionCount] = useState(0);

  // 업데이트 모달이 열릴 때 네비게이션 숨김
  useEffect(() => {
    if (updateModalInfo || detailedUpdateInfo) {
      document.body.setAttribute('data-hide-nav', 'true');
    } else {
      document.body.removeAttribute('data-hide-nav');
    }
    return () => {
      document.body.removeAttribute('data-hide-nav');
    };
  }, [updateModalInfo, detailedUpdateInfo]);

  // 커스텀 폴더 (결합형 문제는 1개로 계산)
  const customFolders = customFoldersData.map(f => ({
    id: f.id,
    title: f.name,
    count: calculateCustomFolderQuestionCount(f.questions),
    type: 'custom' as const,
  }));

  // 현재 필터에 따른 데이터
  const getCurrentFolders = () => {
    switch (activeFilter) {
      case 'library':
        // 서재 탭은 LibraryGridView에서 별도 처리 (폴더 목록 불필요)
        return [];
      case 'wrong':
        return groupedWrongItems.map(g => ({
          id: g.quizId,
          title: g.quizTitle,
          count: g.questionCount,
          filterType: 'wrong' as const,
        }));
      case 'bookmark':
        // 찜 탭은 BookmarkGridView에서 별도 처리 (폴더 목록 불필요)
        return [];
      case 'custom':
        return customFolders.map(f => ({ ...f, filterType: 'custom' as const }));
      default:
        return [];
    }
  };

  const currentFolders = getCurrentFolders();

  // 선택된 폴더 수
  const selectedCount = deleteFolderIds.size;

  // URL 파라미터 변경 시 필터 업데이트
  useEffect(() => {
    const filterParam = searchParams.get('filter') as ReviewFilter;
    if (filterParam && ['library', 'wrong', 'bookmark', 'custom'].includes(filterParam)) {
      setActiveFilter(filterParam);
    }
  }, [searchParams]);

  // 필터 변경 시 삭제 선택 모드는 유지 (다른 탭에서도 추가 선택 가능)

  const handleFolderClick = (folder: { id: string; title: string; count: number; filterType: string }) => {
    if (isFolderDeleteMode) {
      // 폴더 삭제 선택 모드 - 모든 타입 삭제 가능
      const newSelected = new Set(deleteFolderIds);
      const folderId = `${folder.filterType}-${folder.id}`;

      if (newSelected.has(folderId)) {
        newSelected.delete(folderId);
      } else {
        newSelected.add(folderId);
      }
      setDeleteFolderIds(newSelected);
    } else {
      // 일반 모드에서는 폴더 상세로 이동
      router.push(`/review/${folder.filterType}/${folder.id}`);
    }
  };

  // 폴더 삭제 핸들러
  const handleDeleteFolder = async (folder: { id: string; filterType: string }) => {
    const confirmed = window.confirm('이 폴더를 삭제하시겠습니까?\n삭제 시 퀴즈 목록에서 다시 풀 수 있습니다.');
    if (!confirmed) return;

    try {
      if (folder.filterType === 'custom') {
        await deleteCustomFolder(folder.id);
      }
    } catch (err) {
      console.error('폴더 삭제 실패:', err);
      alert('삭제에 실패했습니다.');
    }
  };

  // 복습하기 버튼 클릭 - 전체 복습 시작
  const handleReviewButtonClick = () => {
    // 현재 탭의 모든 문제로 복습 시작
    let items: ReviewItem[] = [];

    if (activeFilter === 'wrong') {
      items = wrongItems;
    } else if (activeFilter === 'bookmark') {
      // 찜한 문제만 복습 (bookmarkedItems 사용)
      items = bookmarkedItems;
    }

    if (items.length > 0) {
      setPracticeItems(items);
    }
  };

  const handleCreateFolder = async (name: string) => {
    const folderId = await createCustomFolder(name);
    if (folderId) {
      // 폴더 생성 성공 - onSnapshot이 자동으로 업데이트
      console.log('폴더 생성 성공:', folderId);
    } else {
      alert('폴더 생성에 실패했습니다.');
    }
  };

  // 선택된 폴더들 삭제 (바텀시트에서 확인 후 호출)
  const handleDeleteSelectedFolders = async () => {
    if (deleteFolderIds.size === 0) return;

    try {
      // 중복 삭제 방지를 위한 Set (wrong은 quizId+chapterId 조합으로)
      const deletedWrongKeys = new Set<string>();
      const deletedBookmarkQuizIds = new Set<string>();

      for (const folderId of deleteFolderIds) {
        if (folderId.startsWith('custom-')) {
          const id = folderId.replace('custom-', '');
          await deleteCustomFolder(id);
        } else if (folderId.startsWith('wrong-')) {
          // wrong-{quizId}-chapter-{chapterId} 형식 처리
          const withoutPrefix = folderId.replace('wrong-', '');
          const parts = withoutPrefix.split('-chapter-');
          const quizId = parts[0];
          const chapterId = parts[1] === 'uncategorized' ? null : parts[1];

          // 중복 체크 (quizId + chapterId 조합)
          const key = `${quizId}-${chapterId || 'null'}`;
          if (!deletedWrongKeys.has(key)) {
            deletedWrongKeys.add(key);

            // 챕터 이름 가져오기
            let chapterName: string | undefined;
            if (chapterId && userCourseId) {
              const chapter = getChapterById(userCourseId, chapterId);
              chapterName = chapter?.name;
            }

            await deleteWrongQuizByChapter(quizId, chapterId, chapterName);
          }
        } else if (folderId.startsWith('bookmark-')) {
          const id = folderId.replace('bookmark-', '');
          if (!deletedBookmarkQuizIds.has(id)) {
            deletedBookmarkQuizIds.add(id);
            // 퀴즈 북마크 해제 (useQuizBookmark 사용)
            await toggleQuizBookmark(id);
          }
        }
      }
    } catch (err) {
      console.error('폴더 삭제 실패:', err);
      alert('삭제에 실패했습니다.');
    } finally {
      // 성공/실패 여부와 관계없이 삭제 모드 해제
      setDeleteFolderIds(new Set());
      setIsFolderDeleteMode(false);
      setShowDeleteConfirmSheet(false);
    }
  };

  // 삭제 확인 바텀시트에서 개별 항목 제거 (되살리기)
  const handleRemoveFromDeleteList = (folderId: string) => {
    const newSelected = new Set(deleteFolderIds);
    newSelected.delete(folderId);
    setDeleteFolderIds(newSelected);
  };

  // 선택한 폴더/문제지로 복습 시작
  const handleStartSelectedReview = useCallback(async () => {
    if (reviewSelectedIds.size === 0) return;

    const items: ReviewItem[] = [];
    const libraryQuizIds: string[] = [];

    reviewSelectedIds.forEach(folderId => {
      if (folderId.startsWith('wrong-')) {
        // wrong-quizId-chapter-chapterId 형식 처리
        const parts = folderId.replace('wrong-', '').split('-chapter-');
        const quizId = parts[0];
        const chapterKey = parts[1]; // 'uncategorized' 또는 실제 chapterId

        // chapterGroupedWrongItems에서 해당 챕터 그룹 찾기
        const chapterGroup = chapterGroupedWrongItems.find(cg =>
          (cg.chapterId || 'uncategorized') === chapterKey
        );
        if (chapterGroup) {
          // 해당 퀴즈의 아이템만 추가
          const folder = chapterGroup.folders.find(f => f.quizId === quizId);
          if (folder) {
            items.push(...folder.items);
          }
        }
      } else if (folderId.startsWith('bookmark-')) {
        const quizId = folderId.replace('bookmark-', '');
        // 찜한 퀴즈의 문제들은 bookmarkedItems에서 가져옴
        const bookmarkGroup = groupedBookmarkedItems.find(g => g.quizId === quizId);
        if (bookmarkGroup) {
          items.push(...bookmarkGroup.items);
        }
      } else if (folderId.startsWith('custom-')) {
        const id = folderId.replace('custom-', '');
        const folder = customFoldersData.find(f => f.id === id);
        if (folder) {
          // 커스텀 폴더의 문제들을 solvedItems에서 찾아서 추가
          folder.questions.forEach(q => {
            const solvedItem = solvedItems.find(s => s.questionId === q.questionId && s.quizId === q.quizId);
            if (solvedItem) {
              items.push(solvedItem);
            }
          });
        }
      } else if (folderId.startsWith('library-')) {
        // 서재 퀴즈 ID 수집 (나중에 일괄 처리)
        const quizId = folderId.replace('library-', '');
        libraryQuizIds.push(quizId);
      }
    });

    // 서재 퀴즈들의 문제 가져오기
    for (const quizId of libraryQuizIds) {
      try {
        const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
        if (quizDoc.exists()) {
          const quizData = quizDoc.data();
          const questions = quizData.questions || [];
          const quizTitle = quizData.title || '서재 퀴즈';

          questions.forEach((q: any, idx: number) => {
            // ReviewItem 형식으로 변환
            let correctAnswer = '';
            if (q.type === 'multiple') {
              if (Array.isArray(q.answer)) {
                correctAnswer = q.answer.map((a: number) => String(a + 1)).join(',');
              } else {
                correctAnswer = String((q.answer ?? 0) + 1);
              }
            } else if (q.type === 'ox') {
              correctAnswer = q.answer === 0 ? 'O' : 'X';
            } else {
              correctAnswer = String(q.answer ?? '');
            }

            items.push({
              id: `library-${quizId}-${q.id || idx}`,
              userId: user?.uid || '',
              quizId,
              quizTitle,
              questionId: q.id || `q${idx}`,
              question: q.text || '',
              type: q.type === 'short' ? 'short_answer' : (q.type || 'multiple'),
              options: q.choices || [],
              correctAnswer,
              userAnswer: correctAnswer, // 서재 퀴즈는 정답으로 설정
              explanation: q.explanation || '',
              isCorrect: true,
              reviewType: 'solved',
              isBookmarked: false,
              reviewCount: 0,
              lastReviewedAt: null,
              createdAt: new Date() as any, // 클라이언트 사이드 임시 데이터
              // 선택적 필드들
              courseId: userCourseId || null,
              image: q.image || null,
              chapterId: q.chapterId || null,
              imageUrl: q.imageUrl || null,
            } as any);
          });
        }
      } catch (error) {
        console.error('서재 퀴즈 로드 오류:', error);
      }
    }

    if (items.length > 0) {
      setPracticeMode('all'); // 선택 복습도 "모두" 복습으로 취급
      setPracticeItems(items);
      setIsReviewSelectMode(false);
      setReviewSelectedIds(new Set());
    } else {
      alert('선택한 항목에 복습할 문제가 없습니다.');
    }
  }, [reviewSelectedIds, groupedSolvedItems, groupedBookmarkedItems, chapterGroupedWrongItems, customFoldersData, solvedItems, user?.uid, userCourseId]);

  // 선택한 폴더 정보 가져오기 (바텀시트 표시용)
  const getSelectedFolderInfo = useCallback(() => {
    const info: { id: string; title: string; type: string; count: number }[] = [];

    deleteFolderIds.forEach(folderId => {
      if (folderId.startsWith('wrong-')) {
        // wrong-quizId-chapter-chapterId 형식 처리
        const parts = folderId.replace('wrong-', '').split('-chapter-');
        const quizId = parts[0];
        const chapterKey = parts[1]; // 'uncategorized' 또는 실제 chapterId

        // chapterGroupedWrongItems에서 해당 챕터 그룹 찾기
        const chapterGroup = chapterGroupedWrongItems.find(cg =>
          (cg.chapterId || 'uncategorized') === chapterKey
        );
        if (chapterGroup) {
          const folder = chapterGroup.folders.find(f => f.quizId === quizId);
          if (folder) {
            // 챕터명 · 퀴즈명 형식
            const displayTitle = chapterGroup.chapterName !== '기타'
              ? `${chapterGroup.chapterName} · ${folder.quizTitle}`
              : folder.quizTitle;
            info.push({ id: folderId, title: displayTitle, type: '오답', count: folder.questionCount });
          }
        }
      } else if (folderId.startsWith('bookmark-')) {
        const quizId = folderId.replace('bookmark-', '');
        const quiz = bookmarkedQuizzes.find(bq => bq.quizId === quizId);
        if (quiz) {
          info.push({ id: folderId, title: quiz.title, type: '찜', count: quiz.questionCount });
        }
      } else if (folderId.startsWith('custom-')) {
        const id = folderId.replace('custom-', '');
        const folder = customFoldersData.find(f => f.id === id);
        if (folder) {
          info.push({ id: folderId, title: folder.name, type: '커스텀', count: calculateCustomFolderQuestionCount(folder.questions) });
        }
      }
    });

    return info;
  }, [deleteFolderIds, chapterGroupedWrongItems, bookmarkedQuizzes, customFoldersData]);

  // 퀴즈 ID로 복습 시작 (찜탭, 문제탭에서 Review 버튼 클릭 시)
  const handleStartReviewByQuizId = useCallback((quizId: string) => {
    // solved에서 해당 퀴즈의 문제들 찾기
    const solvedGroup = groupedSolvedItems.find(g => g.quizId === quizId);
    if (solvedGroup && solvedGroup.items.length > 0) {
      setPracticeMode('all'); // 모두 복습 모드
      setPracticeItems(solvedGroup.items);
    } else {
      // 복습할 문제가 없으면 퀴즈 페이지로 이동
      router.push(`/quiz/${quizId}`);
    }
  }, [groupedSolvedItems, router]);

  // 퀴즈 ID로 오답만 복습 시작
  const handleStartReviewWrongOnlyByQuizId = useCallback((quizId: string) => {
    // wrong에서 해당 퀴즈의 오답 문제들 찾기
    const wrongGroup = groupedWrongItems.find(g => g.quizId === quizId);
    if (wrongGroup && wrongGroup.items.length > 0) {
      setPracticeMode('wrongOnly'); // 오답만 복습 모드
      setPracticeItems(wrongGroup.items);
    } else {
      alert('이 문제지에 오답이 없습니다.');
    }
  }, [groupedWrongItems]);

  const handleEndPractice = useCallback(async (results?: PracticeResult[]) => {
    // 복습 완료된 문제 reviewCount 증가 (복습력 측정용)
    if (results && results.length > 0) {
      for (const r of results) {
        try {
          await markAsReviewed(r.reviewId);
        } catch {
          // 개별 실패 무시
        }
      }
    }

    // 복습 결과가 있고, "모두" 복습 모드일 때만 첫번째 복습 점수 저장
    // "오답만" 복습은 첫 복습 점수에 포함되지 않음
    if (results && results.length > 0 && user && practiceMode === 'all') {
      // 퀴즈별로 그룹화
      const scoresByQuiz = new Map<string, { correct: number; total: number }>();
      results.forEach(r => {
        const existing = scoresByQuiz.get(r.quizId) || { correct: 0, total: 0 };
        existing.total++;
        if (r.isCorrect) existing.correct++;
        scoresByQuiz.set(r.quizId, existing);
      });

      // 각 퀴즈에 대해 첫번째 복습 점수 저장 (아직 없는 경우에만)
      for (const [quizId, { correct, total }] of scoresByQuiz) {
        try {
          const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
          if (quizDoc.exists()) {
            const quizData = quizDoc.data();
            // 첫번째 복습 점수가 없는 경우에만 저장
            if (!quizData.userFirstReviewScores?.[user.uid]) {
              const score = Math.round((correct / total) * 100);
              await updateDoc(doc(db, 'quizzes', quizId), {
                [`userFirstReviewScores.${user.uid}`]: score,
              });
            }
          }
        } catch (err) {
          console.error('복습 점수 저장 실패:', err);
        }
      }
    }
    setPracticeItems(null);
    setPracticeMode(null);
  }, [user, practiceMode, markAsReviewed]);

  // 연습 모드
  if (practiceItems) {
    return (
      <ReviewPractice
        items={practiceItems}
        onComplete={(results) => handleEndPractice(results)}
        onClose={() => handleEndPractice()}
        currentUserId={user?.uid}
      />
    );
  }

  return (
    <div className="min-h-screen pb-28" style={{ backgroundColor: '#F5F0E8' }}>
      {/* 헤더 - 배너 이미지 */}
      <header className="flex flex-col items-center">
        <div className="w-full h-[160px] mt-2">
          <img
            src={ribbonImage}
            alt="Review"
            className="w-full h-full object-contain"
            style={{ transform: `scale(${ribbonScale}) scaleX(1.15)` }}
          />
        </div>

        {/* 필터 + 버튼 영역 */}
        <div className="w-full px-4 py-1 flex items-center justify-between gap-4">
          {/* 슬라이드 필터 - 좌측 */}
          <SlideFilter
            activeFilter={activeFilter}
            onFilterChange={(filter) => {
              setActiveFilter(filter);
              // 필터 변경 시 선택 모드 유지하되 선택 초기화
            }}
          />

          {/* 버튼 영역 - 우측 */}
          <div className="flex gap-2">
            <AnimatePresence mode="wait">
              {isFolderDeleteMode ? (
                // 삭제 선택 모드 버튼들
                <>
                  <motion.button
                    key="cancel-delete"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    onClick={() => {
                      setIsFolderDeleteMode(false);
                      setDeleteFolderIds(new Set());
                    }}
                    className="px-4 py-3 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] whitespace-nowrap hover:bg-[#EDEAE4] transition-colors"
                  >
                    취소
                  </motion.button>
                  {/* 휴지통 버튼 */}
                  <motion.button
                    key="trash-button"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    onClick={() => setShowDeleteConfirmSheet(true)}
                    className="px-4 py-3 text-sm font-bold border-2 border-[#8B1A1A] text-[#8B1A1A] hover:bg-[#FDEAEA] whitespace-nowrap transition-colors flex items-center justify-center"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </motion.button>
                  {/* 삭제 버튼 */}
                  <motion.button
                    key="delete-button"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    onClick={async () => {
                      if (deleteFolderIds.size > 0) {
                        const confirmed = window.confirm(`${deleteFolderIds.size}개 항목을 삭제하시겠습니까?`);
                        if (confirmed) {
                          await handleDeleteSelectedFolders();
                        }
                      }
                    }}
                    disabled={deleteFolderIds.size === 0}
                    className={`px-4 py-3 text-sm font-bold whitespace-nowrap transition-colors ${
                      deleteFolderIds.size > 0
                        ? 'bg-[#8B1A1A] text-[#F5F0E8] hover:bg-[#7A1717]'
                        : 'bg-[#D4CFC4] text-[#EDEAE4] cursor-not-allowed'
                    }`}
                  >
                    삭제{deleteFolderIds.size > 0 && ` (${deleteFolderIds.size})`}
                  </motion.button>
                </>
              ) : isLibrarySelectMode ? (
                // 서재 삭제 선택 모드 버튼들
                <>
                  <motion.button
                    key="cancel-library"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    onClick={() => {
                      setIsLibrarySelectMode(false);
                      setLibrarySelectedIds(new Set());
                    }}
                    className="px-4 py-3 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] whitespace-nowrap hover:bg-[#EDEAE4] transition-colors"
                  >
                    취소
                  </motion.button>
                  {/* 삭제 버튼 */}
                  <motion.button
                    key="delete-library"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    onClick={async () => {
                      if (librarySelectedIds.size > 0) {
                        const confirmed = window.confirm(`${librarySelectedIds.size}개 퀴즈를 삭제하시겠습니까?`);
                        if (confirmed) {
                          for (const quizId of librarySelectedIds) {
                            try {
                              await deleteLibraryQuiz(quizId);
                            } catch (err) {
                              console.error('삭제 오류:', err);
                            }
                          }
                          setIsLibrarySelectMode(false);
                          setLibrarySelectedIds(new Set());
                        }
                      }
                    }}
                    disabled={librarySelectedIds.size === 0}
                    className={`px-4 py-3 text-sm font-bold whitespace-nowrap transition-colors ${
                      librarySelectedIds.size > 0
                        ? 'bg-[#8B1A1A] text-[#F5F0E8] hover:bg-[#7A1717]'
                        : 'bg-[#D4CFC4] text-[#EDEAE4] cursor-not-allowed'
                    }`}
                  >
                    삭제 {librarySelectedIds.size > 0 && `(${librarySelectedIds.size})`}
                  </motion.button>
                </>
              ) : isPdfSelectMode ? (
                // PDF 폴더 선택 모드 버튼들
                <>
                  <motion.button
                    key="cancel-pdf"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    onClick={() => {
                      setIsPdfSelectMode(false);
                      setSelectedPdfFolders(new Set());
                    }}
                    className="px-3 py-2 text-xs font-bold border border-[#1A1A1A] text-[#1A1A1A] whitespace-nowrap hover:bg-[#EDEAE4] transition-colors rounded-lg"
                  >
                    취소
                  </motion.button>
                  <motion.button
                    key="download-pdf"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    disabled={selectedPdfFolders.size === 0}
                    onClick={async () => {
                      const includeAnswers = true;
                      const includeExplanations = true;

                      try {
                        const { exportQuestionsToPdf } = await import('@/lib/utils/questionPdfExport');
                        const allQuestions: PdfQuestionData[] = [];

                        const selectedFolders = customFoldersData.filter(f => selectedPdfFolders.has(f.id));

                        // 고유 quizId 수집 → 한 번씩만 fetch
                        const quizIdSet = new Set<string>();
                        for (const folder of selectedFolders) {
                          for (const q of folder.questions) quizIdSet.add(q.quizId);
                        }

                        // 배치 fetch → Map 캐시
                        const quizCache = new Map<string, any>();
                        let fetchFailed = 0;
                        for (const quizId of quizIdSet) {
                          try {
                            const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
                            if (quizDoc.exists()) quizCache.set(quizId, quizDoc.data());
                            else fetchFailed++;
                          } catch { fetchFailed++; }
                        }

                        // 문제 매핑 (누락 카운트)
                        let skippedCount = 0;
                        const quizIndexCounters: Record<string, number> = {};
                        for (const folder of selectedFolders) {
                          for (const q of folder.questions) {
                            const quizData = quizCache.get(q.quizId);
                            if (!quizData) { skippedCount++; continue; }
                            const quizQuestions = (quizData.questions as any[]) || [];
                            // questionId로 매칭 시도
                            let question: any = q.questionId
                              ? quizQuestions.find((qq: any, idx: number) => (qq.id || `q${idx}`) === q.questionId)
                              : null;
                            // 폴백: questionId 누락/매칭 실패 시 같은 퀴즈 내 순서대로 매칭
                            if (!question) {
                              const counter = quizIndexCounters[q.quizId] || 0;
                              if (counter < quizQuestions.length) question = quizQuestions[counter];
                              quizIndexCounters[q.quizId] = counter + 1;
                            }
                            if (!question) { skippedCount++; continue; }
                            // answer 안전 변환 (배열/숫자/문자열 모두 대응)
                            const rawAnswer = question.answer;
                            const answerStr = Array.isArray(rawAnswer)
                              ? rawAnswer.map((a: any) => String(a)).join(',')
                              : String(rawAnswer ?? '');

                            // AI 퀴즈(0-indexed) vs 수동 퀴즈(1-indexed) 구분
                            const isAiQuiz = quizData.type === 'professor-ai' || quizData.type === 'ai-generated' || quizData.originalType === 'professor-ai';

                            allQuestions.push({
                              text: question.text || '',
                              type: question.type || 'multiple',
                              choices: Array.isArray(question.choices) ? question.choices : undefined,
                              answer: answerStr,
                              explanation: question.explanation || '',
                              imageUrl: question.imageUrl || undefined,
                              passage: question.passage || undefined,
                              passageType: question.passageType || undefined,
                              koreanAbcItems: question.koreanAbcItems || undefined,
                              bogi: question.bogi || undefined,
                              passagePrompt: question.commonQuestion || question.passagePrompt || undefined,
                              hasMultipleAnswers: answerStr.includes(','),
                              answerZeroIndexed: isAiQuiz,
                              // 결합형 문제 필드
                              passageImage: question.passageImage || undefined,
                              combinedGroupId: question.combinedGroupId || undefined,
                              combinedIndex: question.combinedIndex ?? undefined,
                              combinedTotal: question.combinedTotal ?? undefined,
                              // 복합 제시문
                              passageMixedExamples: question.passageMixedExamples || undefined,
                              mixedExamples: question.mixedExamples || undefined,
                            });
                          }
                        }

                        // 누락 알림
                        if (skippedCount > 0) {
                          alert(`${skippedCount}개 문제를 찾을 수 없어 제외되었습니다.`);
                        }
                        if (allQuestions.length === 0) {
                          alert('내보낼 문제가 없습니다.');
                          return;
                        }

                        const folderName = selectedFolders.length === 1 ? selectedFolders[0].name : '커스텀 문제집';
                        await exportQuestionsToPdf(allQuestions, {
                          includeAnswers,
                          includeExplanations,
                          folderName,
                          userName: profile?.nickname || '',
                          studentId: profile?.studentId || '',
                          courseName: userCourseId ? COURSES[userCourseId]?.name : undefined,
                        });
                      } catch (err) {
                        console.error('PDF 다운로드 실패:', err);
                      } finally {
                        setIsPdfSelectMode(false);
                        setSelectedPdfFolders(new Set());
                      }
                    }}
                    className={`px-3 py-2 text-xs font-bold whitespace-nowrap transition-colors rounded-lg ${
                      selectedPdfFolders.size > 0
                        ? 'bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A]'
                        : 'bg-[#D4CFC4] text-[#EDEAE4] cursor-not-allowed'
                    }`}
                  >
                    PDF 다운 {selectedPdfFolders.size > 0 && `(${selectedPdfFolders.size})`}
                  </motion.button>
                </>
              ) : isReviewSelectMode ? (
                // 복습 선택 모드 버튼들
                <>
                  <motion.button
                    key="cancel-review"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    onClick={() => {
                      setIsReviewSelectMode(false);
                      setReviewSelectedIds(new Set());
                    }}
                    className="px-3 py-2 text-xs font-bold border border-[#1A1A1A] text-[#1A1A1A] whitespace-nowrap hover:bg-[#EDEAE4] transition-colors rounded-lg"
                  >
                    취소
                  </motion.button>
                  {/* 복습 시작 버튼 */}
                  <motion.button
                    key="start-review"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    onClick={() => {
                      if (reviewSelectedIds.size > 0) {
                        handleStartSelectedReview();
                      }
                    }}
                    disabled={reviewSelectedIds.size === 0}
                    className={`px-3 py-2 text-xs font-bold whitespace-nowrap transition-colors rounded-lg ${
                      reviewSelectedIds.size > 0
                        ? 'bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A]'
                        : 'bg-[#D4CFC4] text-[#EDEAE4] cursor-not-allowed'
                    }`}
                  >
                    복습 시작 {reviewSelectedIds.size > 0 && `(${reviewSelectedIds.size})`}
                  </motion.button>
                </>
              ) : (
                // 일반 모드 버튼들
                <>
                  {/* 선택 복습 버튼 */}
                  <motion.button
                    key="review"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    onClick={() => {
                      setIsReviewSelectMode(true);
                    }}
                    className="px-3 py-2 text-xs font-bold bg-[#1A1A1A] text-[#F5F0E8] whitespace-nowrap hover:bg-[#3A3A3A] transition-colors flex items-center gap-1 overflow-visible rounded-lg"
                  >
                    선택 복습
                  </motion.button>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* 선택 모드 안내 */}
        <AnimatePresence>
          {(isFolderDeleteMode || isReviewSelectMode || isAssignMode || isLibrarySelectMode) && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="w-full px-4 mt-3"
            >
              {isReviewSelectMode ? (
                <p className="text-center text-xs text-[#5C5C5C]">
                  {reviewSelectedIds.size > 0
                    ? `${reviewSelectedIds.size}개 선택됨 (다른 탭에서도 추가 선택 가능)`
                    : '복습할 폴더나 문제지를 선택하세요 (다른 탭에서도 추가 선택 가능)'
                  }
                </p>
              ) : (
                <div className={`p-2 border border-dashed text-center ${
                  isFolderDeleteMode || isLibrarySelectMode
                    ? 'bg-[#FDEAEA] border-[#8B1A1A]'
                    : 'bg-[#E8F5E9] border-[#1A6B1A]'
                }`}>
                  <p className={`text-xs ${
                    isFolderDeleteMode || isLibrarySelectMode
                      ? 'text-[#8B1A1A]'
                      : 'text-[#1A6B1A]'
                  }`}>
                    {isFolderDeleteMode
                      ? deleteFolderIds.size > 0
                        ? `${deleteFolderIds.size}개 선택됨 (다른 탭에서도 추가 선택 가능)`
                        : '삭제할 폴더나 문제지를 선택하세요 (다른 탭에서도 추가 선택 가능)'
                      : isLibrarySelectMode
                        ? librarySelectedIds.size > 0
                          ? `${librarySelectedIds.size}개 선택됨`
                          : '삭제할 퀴즈를 선택하세요'
                        : selectedFolderForAssign
                          ? '카테고리 영역 또는 다른 폴더를 탭하세요'
                          : '이동할 폴더를 선택하세요'
                    }
                  </p>
                  {isAssignMode && (
                    <button
                      onClick={() => {
                        setIsAssignMode(false);
                        setSelectedFolderForAssign(null);
                      }}
                      className="mt-2 px-3 py-1 text-xs font-bold border border-[#1A6B1A] text-[#1A6B1A] hover:bg-[#C8E6C9] transition-colors"
                    >
                      카테고리 배정 종료
                    </button>
                  )}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* 내맘대로 탭일 때 폴더 만들기 + 정렬 + PDF 버튼 */}
        {activeFilter === 'custom' && !isAssignMode && !isFolderDeleteMode && !isPdfSelectMode && !isReviewSelectMode && (
          <div className="w-full px-4 mt-3 flex gap-2">
            <button
              onClick={() => setShowCreateFolder(true)}
              className="flex-1 py-1.5 text-xs font-bold border border-dashed border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
            >
              + 새 폴더
            </button>
            <button
              onClick={() => setIsSortMode(true)}
              className="flex-1 py-1.5 text-xs font-bold border border-dashed border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors flex items-center justify-center gap-1"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              카테고리 설정
            </button>
            <button
              onClick={() => {
                if (customFoldersData.length === 0) return;
                setIsPdfSelectMode(true);
                setSelectedPdfFolders(new Set());
              }}
              className="flex-1 py-1.5 text-xs font-bold border border-dashed border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors flex items-center justify-center gap-1"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              PDF 다운
            </button>
          </div>
        )}
      </header>

      <main className="px-4 mt-3">
        {/* 로딩 스켈레톤 (2열 카드 그리드) */}
        {(loading || (activeFilter === 'bookmark' && bookmarkLoading) || (activeFilter === 'library' && libraryLoading)) && (
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <SkeletonQuizCard key={i} />
            ))}
          </div>
        )}

        {/* 서재 탭 - AI 학습 퀴즈 */}
        {!loading && !libraryLoading && activeFilter === 'library' && (
          <div className="space-y-4">
            {/* 태그 검색 헤더 (3개 이상일 때만 표시) */}
            {libraryQuizzesRaw.length >= 3 && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="font-serif-display text-lg font-black text-[#1A1A1A]">서재</h2>

                  {/* 선택된 태그들 + 태그 아이콘 (우측) */}
                  <div className="flex items-center gap-2">
                    {/* 선택된 태그들 (태그 아이콘 왼쪽에 배치) */}
                    {librarySelectedTags.map((tag) => (
                      <div
                        key={tag}
                        className="flex items-center gap-1 px-2 py-1 bg-[#F5F0E8] text-[#1A1A1A] text-sm font-bold border border-[#1A1A1A]"
                      >
                        #{tag}
                        <button
                          onClick={() => setLibrarySelectedTags(prev => prev.filter(t => t !== tag))}
                          className="ml-0.5 hover:text-[#5C5C5C]"
                        >
                          ✕
                        </button>
                      </div>
                    ))}

                    {/* 태그 검색 버튼 */}
                    <button
                      onClick={() => setShowLibraryTagFilter(!showLibraryTagFilter)}
                      className={`flex items-center justify-center w-9 h-9 border transition-colors shrink-0 rounded-lg ${
                        showLibraryTagFilter
                          ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                          : 'bg-[#F5F0E8] text-[#1A1A1A] border-[#1A1A1A]'
                      }`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* 태그 필터 목록 */}
                <AnimatePresence>
                  {showLibraryTagFilter && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="flex flex-wrap gap-1.5 p-2 bg-[#EDEAE4] border border-[#D4CFC4]">
                        {/* 태그 버튼들 (이미 선택된 태그 제외) */}
                        {libraryTagOptions
                          .filter(tag => !librarySelectedTags.includes(tag))
                          .map((tag) => (
                            <button
                              key={tag}
                              onClick={() => {
                                setLibrarySelectedTags(prev => [...prev, tag]);
                                setShowLibraryTagFilter(false);
                              }}
                              className="px-2 py-1 text-xs font-bold bg-[#F5F0E8] text-[#1A1A1A] border border-[#1A1A1A] hover:bg-[#E5E0D8] transition-colors"
                            >
                              #{tag}
                            </button>
                          ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* 필터링 결과가 없을 때 (원본에는 퀴즈가 있지만 필터링 결과가 없을 때) */}
            {libraryQuizzesRaw.length > 0 && libraryQuizzes.length === 0 && librarySelectedTags.length > 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center text-center py-8"
              >
                <p className="text-sm text-[#5C5C5C]">
                  {librarySelectedTags.map(t => `#${t}`).join(' ')} 태그가 있는 퀴즈가 없습니다
                </p>
                <button
                  onClick={() => setLibrarySelectedTags([])}
                  className="mt-2 px-4 py-2 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
                >
                  필터 해제
                </button>
              </motion.div>
            ) : libraryQuizzes.length === 0 ? (
              <EmptyState filter="library" fullHeight />
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {libraryQuizzes.map((quiz, index) => {
                  const libraryKey = `library-${quiz.id}`;
                  const isSelected = isLibrarySelectMode
                    ? librarySelectedIds.has(quiz.id)
                    : isReviewSelectMode
                      ? reviewSelectedIds.has(libraryKey)
                      : false;
                  return (
                    <motion.div
                      key={quiz.id}
                      ref={(el) => registerLibraryRef(quiz.id, el)}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.03 }}
                    >
                      <LibraryQuizCard
                        quiz={quiz}
                        onCardClick={() => {
                          if (isLibrarySelectMode) {
                            // 삭제 선택 모드일 때는 체크박스 토글
                            const newSelected = new Set(librarySelectedIds);
                            if (newSelected.has(quiz.id)) {
                              newSelected.delete(quiz.id);
                            } else {
                              newSelected.add(quiz.id);
                            }
                            setLibrarySelectedIds(newSelected);
                          } else if (isReviewSelectMode) {
                            // 복습 선택 모드일 때는 reviewSelectedIds 토글
                            const newSelected = new Set(reviewSelectedIds);
                            if (newSelected.has(libraryKey)) {
                              newSelected.delete(libraryKey);
                            } else {
                              newSelected.add(libraryKey);
                            }
                            setReviewSelectedIds(newSelected);
                          } else {
                            // 일반 모드일 때는 상세 페이지로 이동
                            router.push(`/review/library/${quiz.id}`);
                          }
                        }}
                        onDetails={() => {
                          // 모달 열기
                          captureLibraryRect(quiz.id);
                          setSelectedLibraryQuiz(quiz);
                        }}
                        onReview={() => {
                          // 전체 복습 시작
                          router.push(`/review/library/${quiz.id}?mode=review`);
                        }}
                        onReviewWrongOnly={() => {
                          // 오답만 복습 시작
                          router.push(`/review/library/${quiz.id}?mode=review&wrongOnly=true`);
                        }}
                        onPublish={() => {
                          setPublishConfirmQuizId(quiz.id);
                        }}
                        isSelectMode={isLibrarySelectMode || isReviewSelectMode}
                        isSelected={isSelected}
                      />
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 찜 탭 - 2열 그리드 레이아웃 (자작 탭과 동일) */}
        {!loading && !bookmarkLoading && activeFilter === 'bookmark' && (
          <div className="space-y-4">
            {/* 태그 검색 헤더 (3개 이상일 때만 표시) */}
            {bookmarkedQuizzes.length >= 3 && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="font-serif-display text-lg font-black text-[#1A1A1A]">찜</h2>

                  {/* 선택된 태그들 + 태그 아이콘 (우측) */}
                  <div className="flex items-center gap-2">
                    {/* 선택된 태그들 */}
                    {bookmarkSelectedTags.map((tag) => (
                      <div
                        key={tag}
                        className="flex items-center gap-1 px-2 py-1 bg-[#F5F0E8] text-[#1A1A1A] text-sm font-bold border border-[#1A1A1A]"
                      >
                        #{tag}
                        <button
                          onClick={() => setBookmarkSelectedTags(prev => prev.filter(t => t !== tag))}
                          className="ml-0.5 hover:text-[#5C5C5C]"
                        >
                          ✕
                        </button>
                      </div>
                    ))}

                    {/* 태그 검색 버튼 */}
                    <button
                      onClick={() => setShowBookmarkTagFilter(!showBookmarkTagFilter)}
                      className={`flex items-center justify-center w-9 h-9 border transition-colors shrink-0 rounded-lg ${
                        showBookmarkTagFilter
                          ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                          : 'bg-[#F5F0E8] text-[#1A1A1A] border-[#1A1A1A]'
                      }`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* 태그 필터 목록 */}
                <AnimatePresence>
                  {showBookmarkTagFilter && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="flex flex-wrap gap-1.5 p-2 bg-[#EDEAE4] border border-[#D4CFC4]">
                        {bookmarkTagOptions
                          .filter(tag => !bookmarkSelectedTags.includes(tag))
                          .map((tag) => (
                            <button
                              key={tag}
                              onClick={() => {
                                setBookmarkSelectedTags(prev => [...prev, tag]);
                                setShowBookmarkTagFilter(false);
                              }}
                              className="px-2 py-1 text-xs font-bold bg-[#F5F0E8] text-[#1A1A1A] border border-[#1A1A1A] hover:bg-[#E5E0D8] transition-colors"
                            >
                              #{tag}
                            </button>
                          ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* 필터링 결과가 없을 때 */}
            {bookmarkedQuizzes.length > 0 && filteredBookmarkedQuizzes.length === 0 && bookmarkSelectedTags.length > 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center text-center py-8"
              >
                <p className="text-sm text-[#5C5C5C]">
                  {bookmarkSelectedTags.map(t => `#${t}`).join(' ')} 태그가 있는 퀴즈가 없습니다
                </p>
                <button
                  onClick={() => setBookmarkSelectedTags([])}
                  className="mt-2 px-4 py-2 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
                >
                  필터 해제
                </button>
              </motion.div>
            ) : (
              <BookmarkGridView
                bookmarkedQuizzes={filteredBookmarkedQuizzes}
                onQuizCardClick={(quizId) => router.push(`/review/bookmark/${quizId}`)}
                onQuizDetails={(quiz) => setSelectedBookmarkedQuiz(quiz)}
                onStartQuiz={(quizId) => router.push(`/quiz/${quizId}`)}
                onStartReview={(quizId) => handleStartReviewByQuizId(quizId)}
                onStartReviewWrongOnly={(quizId) => handleStartReviewWrongOnlyByQuizId(quizId)}
                onUnbookmark={(quizId) => toggleQuizBookmark(quizId)}
                isSelectMode={isFolderDeleteMode || isReviewSelectMode}
                selectedFolderIds={isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds}
                onSelectToggle={(quizId) => {
                  const key = `bookmark-${quizId}`;
                  if (isFolderDeleteMode) {
                    const newSelected = new Set(deleteFolderIds);
                    if (newSelected.has(key)) {
                      newSelected.delete(key);
                    } else {
                      newSelected.add(key);
                    }
                    setDeleteFolderIds(newSelected);
                  } else if (isReviewSelectMode) {
                    const newSelected = new Set(reviewSelectedIds);
                    if (newSelected.has(key)) {
                      newSelected.delete(key);
                    } else {
                      newSelected.add(key);
                    }
                    setReviewSelectedIds(newSelected);
                  }
                }}
                getQuizUpdateInfo={(quizId) => {
                  const updateKey = `quiz-${quizId}`;
                  const info = updatedQuizzes.get(updateKey);
                  if (info && info.hasUpdate) {
                    return { hasUpdate: true, updatedCount: 0 };
                  }
                  return null;
                }}
                onUpdateClick={(quizId) => {
                  const updateKey = `quiz-${quizId}`;
                  const info = updatedQuizzes.get(updateKey);
                  if (info) {
                    setUpdateModalInfo({
                      quizId,
                      quizTitle: info.quizTitle,
                      filterType: 'bookmark',
                    });
                  }
                }}
              />
            )}
          </div>
        )}

        {/* 빈 상태 (서재/찜 탭 제외) - 화면 중앙 배치 */}
        {!loading && activeFilter !== 'library' && activeFilter !== 'bookmark' && currentFolders.length === 0 && (
          <EmptyState filter={activeFilter} fullHeight />
        )}

        {/* 폴더 그리드 (3열) - 서재/찜 탭 제외 */}
        {!loading && activeFilter !== 'library' && activeFilter !== 'bookmark' && currentFolders.length > 0 && (
          <>
            {/* 오답 탭에서 챕터별로 그룹화 */}
            {activeFilter === 'wrong' && chapterGroupedWrongItems.length > 0 ? (
              <div className="space-y-4">
                {chapterGroupedWrongItems.map((chapterGroup) => (
                  <div key={chapterGroup.chapterId || 'uncategorized'} className="border-b border-dashed border-[#EDEAE4] pb-3">
                    {/* 챕터 헤더 (내맘대로 스타일) */}
                    <div
                      onClick={() => {
                        if (isFolderDeleteMode || isReviewSelectMode) {
                          // 해당 챕터의 모든 폴더 키 가져오기 (챕터 ID 포함)
                          const chapterFolderKeys = chapterGroup.folders.map(f =>
                            `wrong-${f.quizId}-chapter-${chapterGroup.chapterId || 'uncategorized'}`
                          );
                          const currentSelectedIds = isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds;
                          const setSelectedIds = isFolderDeleteMode ? setDeleteFolderIds : setReviewSelectedIds;
                          // 모든 폴더가 선택되어 있는지 확인
                          const allSelected = chapterFolderKeys.every(key => currentSelectedIds.has(key));
                          const newSelected = new Set(currentSelectedIds);
                          if (allSelected) {
                            // 모두 선택되어 있으면 모두 해제
                            chapterFolderKeys.forEach(key => newSelected.delete(key));
                          } else {
                            // 하나라도 선택 안되어 있으면 모두 선택
                            chapterFolderKeys.forEach(key => newSelected.add(key));
                          }
                          setSelectedIds(newSelected);
                        }
                      }}
                      className={`flex items-center mb-2 ${
                        (isFolderDeleteMode || isReviewSelectMode) ? 'cursor-pointer' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-[60px]">
                        {/* 선택 모드일 때 체크박스 표시 */}
                        {(isFolderDeleteMode || isReviewSelectMode) && (() => {
                          const chapterKey = chapterGroup.chapterId || 'uncategorized';
                          const currentSelectedIds = isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds;
                          const allSelected = chapterGroup.folders.every(f =>
                            currentSelectedIds.has(`wrong-${f.quizId}-chapter-${chapterKey}`)
                          );
                          const someSelected = chapterGroup.folders.some(f =>
                            currentSelectedIds.has(`wrong-${f.quizId}-chapter-${chapterKey}`)
                          );
                          return (
                            <div className={`w-4 h-4 border-2 flex items-center justify-center ${
                              allSelected
                                ? 'bg-[#1A1A1A] border-[#1A1A1A]'
                                : someSelected
                                  ? 'bg-[#5C5C5C] border-[#1A1A1A]'
                                  : 'border-[#1A1A1A]'
                            }`}>
                              {allSelected && (
                                <svg className="w-3 h-3 text-[#F5F0E8]" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                              )}
                              {!allSelected && someSelected && (
                                <div className="w-2 h-0.5 bg-[#F5F0E8]" />
                              )}
                            </div>
                          );
                        })()}
                        <span className="font-bold text-sm text-[#1A1A1A]">{chapterGroup.chapterName}</span>
                      </div>
                      <div className="flex-1 border-t border-dashed border-[#5C5C5C] mx-2" />
                      <span className="text-xs text-[#5C5C5C] min-w-[30px] text-right">{chapterGroup.totalCount}문제</span>
                    </div>
                    {/* 챕터 내 퀴즈 폴더들 */}
                    <div>
                      {chapterGroup.folders.length >= 4 ? (
                        /* 4개 이상: 가로 스크롤 */
                        <div className="overflow-x-auto pb-2 -mx-4 px-4">
                          <div className="flex gap-3" style={{ minWidth: 'min-content' }}>
                            {chapterGroup.folders.map((folder) => {
                              const chapterKey = chapterGroup.chapterId || 'uncategorized';
                              const selectKey = `wrong-${folder.quizId}-chapter-${chapterKey}`;
                              const quizUpdateKey = `wrong-${folder.quizId}`;
                              const hasUpdate = updatedQuizzes.has(quizUpdateKey);
                              return (
                                <div key={selectKey} className="w-[100px] flex-shrink-0">
                                  <FolderCard
                                    title={folder.quizTitle}
                                    count={folder.questionCount}
                                    onClick={() => {
                                      if (isFolderDeleteMode) {
                                        const newSelected = new Set(deleteFolderIds);
                                        if (newSelected.has(selectKey)) {
                                          newSelected.delete(selectKey);
                                        } else {
                                          newSelected.add(selectKey);
                                        }
                                        setDeleteFolderIds(newSelected);
                                      } else if (isReviewSelectMode) {
                                        const newSelected = new Set(reviewSelectedIds);
                                        if (newSelected.has(selectKey)) {
                                          newSelected.delete(selectKey);
                                        } else {
                                          newSelected.add(selectKey);
                                        }
                                        setReviewSelectedIds(newSelected);
                                      } else {
                                        // 챕터별 필터링을 위해 chapterId 쿼리 파라미터 추가
                                        const url = chapterGroup.chapterId
                                          ? `/review/wrong/${folder.quizId}?chapter=${chapterGroup.chapterId}`
                                          : `/review/wrong/${folder.quizId}`;
                                        router.push(url);
                                      }
                                    }}
                                    isSelectMode={isFolderDeleteMode || isReviewSelectMode}
                                    isSelected={(isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds).has(selectKey)}
                                    showDelete={false}
                                    hasUpdate={hasUpdate}
                                    onUpdateClick={() => {
                                      setUpdateModalInfo({
                                        quizId: folder.quizId,
                                        quizTitle: folder.quizTitle,
                                        filterType: 'wrong',
                                      });
                                    }}
                                    variant="folder"
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        /* 3개 이하: 그리드 */
                        <div className="grid grid-cols-3 gap-3">
                          {chapterGroup.folders.map((folder) => {
                            const chapterKey = chapterGroup.chapterId || 'uncategorized';
                            const selectKey = `wrong-${folder.quizId}-chapter-${chapterKey}`;
                            const quizUpdateKey = `wrong-${folder.quizId}`;
                            const hasUpdate = updatedQuizzes.has(quizUpdateKey);
                            return (
                              <FolderCard
                                key={selectKey}
                                title={folder.quizTitle}
                                count={folder.questionCount}
                                onClick={() => {
                                  if (isFolderDeleteMode) {
                                    const newSelected = new Set(deleteFolderIds);
                                    if (newSelected.has(selectKey)) {
                                      newSelected.delete(selectKey);
                                    } else {
                                      newSelected.add(selectKey);
                                    }
                                    setDeleteFolderIds(newSelected);
                                  } else if (isReviewSelectMode) {
                                    const newSelected = new Set(reviewSelectedIds);
                                    if (newSelected.has(selectKey)) {
                                      newSelected.delete(selectKey);
                                    } else {
                                      newSelected.add(selectKey);
                                    }
                                    setReviewSelectedIds(newSelected);
                                  } else {
                                    // 챕터별 필터링을 위해 chapterId 쿼리 파라미터 추가
                                    const url = chapterGroup.chapterId
                                      ? `/review/wrong/${folder.quizId}?chapter=${chapterGroup.chapterId}`
                                      : `/review/wrong/${folder.quizId}`;
                                    router.push(url);
                                  }
                                }}
                                isSelectMode={isFolderDeleteMode || isReviewSelectMode}
                                isSelected={(isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds).has(selectKey)}
                                showDelete={false}
                                hasUpdate={hasUpdate}
                                onUpdateClick={() => {
                                  setUpdateModalInfo({
                                    quizId: folder.quizId,
                                    quizTitle: folder.quizTitle,
                                    filterType: 'wrong',
                                  });
                                }}
                                variant="folder"
                              />
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : activeFilter === 'custom' && folderCategories.length > 0 ? (
              (() => {
                // 총 카테고리 수 = 사용자 카테고리 + 미분류(1)
                const totalCategories = folderCategories.length + 1;
                const uncategorizedFolders = currentFolders.filter(
                  (f) => !folderCategoryMap[f.id]
                );

                // 카테고리가 2개 이하일 때: 찜 탭처럼 수직 리스트
                if (totalCategories <= 2) {
                  const firstCategoryFolders = folderCategories[0]
                    ? [...currentFolders.filter(f => folderCategoryMap[f.id] === folderCategories[0].id)]
                        .sort((a, b) => (folderOrderMap[a.id] ?? 0) - (folderOrderMap[b.id] ?? 0))
                    : [...uncategorizedFolders].sort((a, b) => (folderOrderMap[a.id] ?? 0) - (folderOrderMap[b.id] ?? 0));
                  const sortedUncategorized = [...uncategorizedFolders].sort((a, b) => (folderOrderMap[a.id] ?? 0) - (folderOrderMap[b.id] ?? 0));
                  const hasUncategorized = sortedUncategorized.length > 0;

                  return (
                    <div
                      className="flex flex-col"
                      style={{ height: 'calc(100vh - 340px - 100px)' }}
                    >
                      {/* 첫 번째 카테고리 */}
                      <section className={`flex flex-col min-h-0 ${hasUncategorized ? 'flex-1 border-b border-[#D4CFC4]' : 'flex-1'}`}>
                        {/* 헤더 - 클릭으로 폴더 이동/선택 가능 */}
                        <div
                          onClick={() => {
                            if (isFolderDeleteMode || isReviewSelectMode) {
                              // 선택/삭제 모드: 해당 카테고리 폴더 전체 선택/해제
                              const categoryFolderKeys = firstCategoryFolders.map(f => `${f.filterType}-${f.id}`);
                              const currentSelectedIds = isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds;
                              const setSelectedIds = isFolderDeleteMode ? setDeleteFolderIds : setReviewSelectedIds;
                              const allSelected = categoryFolderKeys.length > 0 && categoryFolderKeys.every(key => currentSelectedIds.has(key));
                              const newSelected = new Set(currentSelectedIds);
                              if (allSelected) {
                                categoryFolderKeys.forEach(key => newSelected.delete(key));
                              } else {
                                categoryFolderKeys.forEach(key => newSelected.add(key));
                              }
                              setSelectedIds(newSelected);
                            } else if (isAssignMode && selectedFolderForAssign && folderCategories[0]) {
                              handleAssignFolderToCategory(selectedFolderForAssign, folderCategories[0].id);
                            }
                          }}
                          className={`flex items-center gap-2 py-2 flex-shrink-0 transition-all ${
                            (isFolderDeleteMode || isReviewSelectMode)
                              ? 'cursor-pointer'
                              : isAssignMode && selectedFolderForAssign
                                ? 'cursor-pointer px-2 -mx-2 border-2 border-dashed border-[#1A6B1A] bg-[#E8F5E9]'
                                : ''
                          }`}
                        >
                          {/* 선택/삭제 모드일 때 체크박스 */}
                          {(isFolderDeleteMode || isReviewSelectMode) && (() => {
                            const categoryFolderKeys = firstCategoryFolders.map(f => `${f.filterType}-${f.id}`);
                            const currentSelectedIds = isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds;
                            const allSelected = categoryFolderKeys.length > 0 && categoryFolderKeys.every(key => currentSelectedIds.has(key));
                            const someSelected = categoryFolderKeys.some(key => currentSelectedIds.has(key));
                            return (
                              <div className={`w-4 h-4 border-2 flex items-center justify-center ${
                                allSelected
                                  ? 'bg-[#1A1A1A] border-[#1A1A1A]'
                                  : someSelected
                                    ? 'bg-[#5C5C5C] border-[#1A1A1A]'
                                    : 'border-[#1A1A1A]'
                              }`}>
                                {allSelected && (
                                  <svg className="w-3 h-3 text-[#F5F0E8]" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                  </svg>
                                )}
                                {!allSelected && someSelected && (
                                  <div className="w-2 h-0.5 bg-[#F5F0E8]" />
                                )}
                              </div>
                            );
                          })()}
                          <h3 className={`font-serif-display font-bold text-sm ${
                            isAssignMode && selectedFolderForAssign ? 'text-[#1A6B1A]' : 'text-[#1A1A1A]'
                          }`}>
                            {folderCategories[0]?.name || '미분류'}
                          </h3>
                          <span className={`text-xs ${
                            isAssignMode && selectedFolderForAssign ? 'text-[#1A6B1A]' : 'text-[#5C5C5C]'
                          }`}>
                            ({firstCategoryFolders.length})
                          </span>
                        </div>
                        <div className="flex-1 overflow-y-auto min-h-0">
                          {firstCategoryFolders.length === 0 ? (
                            <div className="h-full flex items-center justify-center">
                              <p className="text-sm text-[#5C5C5C]">폴더가 없습니다</p>
                            </div>
                          ) : firstCategoryFolders.length >= 4 ? (
                            <FolderSlider>
                              {firstCategoryFolders.map((folder) => {
                                const canDelete = true;
                                const updateKey = `${folder.filterType}-${folder.id}`;
                                const hasUpdate = updatedQuizzes.has(updateKey);
                                const isPdfMode = isPdfSelectMode && activeFilter === 'custom';
                                return (
                                  <FolderCard
                                    key={updateKey}
                                    title={folder.title}
                                    count={folder.count}
                                    onClick={() => {
                                      if (isPdfMode) {
                                        const newSelected = new Set(selectedPdfFolders);
                                        if (newSelected.has(folder.id)) newSelected.delete(folder.id);
                                        else newSelected.add(folder.id);
                                        setSelectedPdfFolders(newSelected);
                                      } else if (isFolderDeleteMode) {
                                        const newSelected = new Set(deleteFolderIds);
                                        if (newSelected.has(updateKey)) {
                                          newSelected.delete(updateKey);
                                        } else {
                                          newSelected.add(updateKey);
                                        }
                                        setDeleteFolderIds(newSelected);
                                      } else if (isReviewSelectMode) {
                                        const newSelected = new Set(reviewSelectedIds);
                                        if (newSelected.has(updateKey)) {
                                          newSelected.delete(updateKey);
                                        } else {
                                          newSelected.add(updateKey);
                                        }
                                        setReviewSelectedIds(newSelected);
                                      } else if (isAssignMode) {
                                        handleFolderClickInAssignMode(folder.id);
                                      } else {
                                        handleFolderClick(folder);
                                      }
                                    }}
                                    isSelectMode={(isFolderDeleteMode && canDelete) || isReviewSelectMode || isAssignMode || isPdfMode}
                                    isSelected={
                                      isPdfMode
                                        ? selectedPdfFolders.has(folder.id)
                                        : isAssignMode
                                          ? selectedFolderForAssign === folder.id
                                          : (isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds).has(updateKey)
                                    }
                                    showDelete={false}
                                    hasUpdate={hasUpdate}
                                    onUpdateClick={() => {
                                      setUpdateModalInfo({
                                        quizId: folder.id,
                                        quizTitle: folder.title,
                                        filterType: folder.filterType,
                                      });
                                    }}
                                    variant="folder"
                                  />
                                );
                              })}
                            </FolderSlider>
                          ) : (
                            <div className="grid grid-cols-3 gap-3 pb-2">
                              {firstCategoryFolders.map((folder) => {
                                const canDelete = true;
                                const updateKey = `${folder.filterType}-${folder.id}`;
                                const hasUpdate = updatedQuizzes.has(updateKey);
                                const isPdfMode = isPdfSelectMode && activeFilter === 'custom';
                                return (
                                  <FolderCard
                                    key={updateKey}
                                    title={folder.title}
                                    count={folder.count}
                                    onClick={() => {
                                      if (isPdfMode) {
                                        const newSelected = new Set(selectedPdfFolders);
                                        if (newSelected.has(folder.id)) newSelected.delete(folder.id);
                                        else newSelected.add(folder.id);
                                        setSelectedPdfFolders(newSelected);
                                      } else if (isFolderDeleteMode) {
                                        const newSelected = new Set(deleteFolderIds);
                                        if (newSelected.has(updateKey)) {
                                          newSelected.delete(updateKey);
                                        } else {
                                          newSelected.add(updateKey);
                                        }
                                        setDeleteFolderIds(newSelected);
                                      } else if (isReviewSelectMode) {
                                        const newSelected = new Set(reviewSelectedIds);
                                        if (newSelected.has(updateKey)) {
                                          newSelected.delete(updateKey);
                                        } else {
                                          newSelected.add(updateKey);
                                        }
                                        setReviewSelectedIds(newSelected);
                                      } else if (isAssignMode) {
                                        handleFolderClickInAssignMode(folder.id);
                                      } else {
                                        handleFolderClick(folder);
                                      }
                                    }}
                                    isSelectMode={(isFolderDeleteMode && canDelete) || isReviewSelectMode || isAssignMode || isPdfMode}
                                    isSelected={
                                      isPdfMode
                                        ? selectedPdfFolders.has(folder.id)
                                        : isAssignMode
                                          ? selectedFolderForAssign === folder.id
                                          : (isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds).has(updateKey)
                                    }
                                    showDelete={false}
                                    hasUpdate={hasUpdate}
                                    onUpdateClick={() => {
                                      setUpdateModalInfo({
                                        quizId: folder.id,
                                        quizTitle: folder.title,
                                        filterType: folder.filterType,
                                      });
                                    }}
                                    variant="folder"
                                  />
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </section>

                      {/* 미분류 섹션 - 폴더가 있을 때만 표시 */}
                      {hasUncategorized && (
                        <section className="flex-1 flex flex-col min-h-0">
                          {/* 헤더 - 클릭으로 폴더 이동/선택 가능 */}
                          <div
                            onClick={() => {
                              if (isFolderDeleteMode || isReviewSelectMode) {
                                // 선택 모드: 미분류 폴더 전체 선택/해제
                                const uncategorizedKeys = sortedUncategorized.map(f => `${f.filterType}-${f.id}`);
                                const currentSelectedIds = isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds;
                                const setSelectedIds = isFolderDeleteMode ? setDeleteFolderIds : setReviewSelectedIds;
                                const allSelected = uncategorizedKeys.length > 0 && uncategorizedKeys.every(key => currentSelectedIds.has(key));
                                const newSelected = new Set(currentSelectedIds);
                                if (allSelected) {
                                  uncategorizedKeys.forEach(key => newSelected.delete(key));
                                } else {
                                  uncategorizedKeys.forEach(key => newSelected.add(key));
                                }
                                setSelectedIds(newSelected);
                              } else if (isAssignMode && selectedFolderForAssign) {
                                handleAssignFolderToCategory(selectedFolderForAssign, null);
                              }
                            }}
                            className={`flex items-center gap-2 py-2 flex-shrink-0 transition-all ${
                              (isFolderDeleteMode || isReviewSelectMode)
                                ? 'cursor-pointer'
                                : isAssignMode && selectedFolderForAssign
                                  ? 'cursor-pointer px-2 -mx-2 border-2 border-dashed border-[#1A6B1A] bg-[#E8F5E9]'
                                  : ''
                            }`}
                          >
                            {/* 선택 모드일 때 체크박스 */}
                            {(isFolderDeleteMode || isReviewSelectMode) && (() => {
                              const uncategorizedKeys = sortedUncategorized.map(f => `${f.filterType}-${f.id}`);
                              const currentSelectedIds = isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds;
                              const allSelected = uncategorizedKeys.length > 0 && uncategorizedKeys.every(key => currentSelectedIds.has(key));
                              const someSelected = uncategorizedKeys.some(key => currentSelectedIds.has(key));
                              return (
                                <div className={`w-4 h-4 border-2 flex items-center justify-center ${
                                  allSelected
                                    ? 'bg-[#1A1A1A] border-[#1A1A1A]'
                                    : someSelected
                                      ? 'bg-[#5C5C5C] border-[#1A1A1A]'
                                      : 'border-[#1A1A1A]'
                                }`}>
                                  {allSelected && (
                                    <svg className="w-3 h-3 text-[#F5F0E8]" fill="currentColor" viewBox="0 0 20 20">
                                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                    </svg>
                                  )}
                                  {!allSelected && someSelected && (
                                    <div className="w-2 h-0.5 bg-[#F5F0E8]" />
                                  )}
                                </div>
                              );
                            })()}
                            <h3 className={`font-serif-display font-bold text-sm ${
                              isAssignMode && selectedFolderForAssign ? 'text-[#1A6B1A]' : 'text-[#1A1A1A]'
                            }`}>
                              미분류
                            </h3>
                            <span className={`text-xs ${
                              isAssignMode && selectedFolderForAssign ? 'text-[#1A6B1A]' : 'text-[#5C5C5C]'
                            }`}>
                              ({sortedUncategorized.length})
                            </span>
                          </div>
                          <div className="flex-1 overflow-y-auto min-h-0">
                            {sortedUncategorized.length >= 4 ? (
                            <FolderSlider>
                              {sortedUncategorized.map((folder) => {
                                const canDelete = true;
                                const updateKey = `${folder.filterType}-${folder.id}`;
                                const hasUpdate = updatedQuizzes.has(updateKey);
                                const isPdfMode = isPdfSelectMode && activeFilter === 'custom';
                                return (
                                  <FolderCard
                                    key={updateKey}
                                    title={folder.title}
                                    count={folder.count}
                                    onClick={() => {
                                      if (isPdfMode) {
                                        const newSelected = new Set(selectedPdfFolders);
                                        if (newSelected.has(folder.id)) newSelected.delete(folder.id);
                                        else newSelected.add(folder.id);
                                        setSelectedPdfFolders(newSelected);
                                      } else if (isFolderDeleteMode) {
                                        const newSelected = new Set(deleteFolderIds);
                                        if (newSelected.has(updateKey)) {
                                          newSelected.delete(updateKey);
                                        } else {
                                          newSelected.add(updateKey);
                                        }
                                        setDeleteFolderIds(newSelected);
                                      } else if (isReviewSelectMode) {
                                        const newSelected = new Set(reviewSelectedIds);
                                        if (newSelected.has(updateKey)) {
                                          newSelected.delete(updateKey);
                                        } else {
                                          newSelected.add(updateKey);
                                        }
                                        setReviewSelectedIds(newSelected);
                                      } else if (isAssignMode) {
                                        handleFolderClickInAssignMode(folder.id);
                                      } else {
                                        handleFolderClick(folder);
                                      }
                                    }}
                                    isSelectMode={(isFolderDeleteMode && canDelete) || isReviewSelectMode || isAssignMode || isPdfMode}
                                    isSelected={
                                      isPdfMode
                                        ? selectedPdfFolders.has(folder.id)
                                        : isAssignMode
                                          ? selectedFolderForAssign === folder.id
                                          : (isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds).has(updateKey)
                                    }
                                    showDelete={false}
                                    hasUpdate={hasUpdate}
                                    onUpdateClick={() => {
                                      setUpdateModalInfo({
                                        quizId: folder.id,
                                        quizTitle: folder.title,
                                        filterType: folder.filterType,
                                      });
                                    }}
                                    variant="folder"
                                  />
                                );
                              })}
                            </FolderSlider>
                            ) : (
                            <div className="grid grid-cols-3 gap-3 pb-2">
                              {sortedUncategorized.map((folder) => {
                                const canDelete = true;
                                const updateKey = `${folder.filterType}-${folder.id}`;
                                const hasUpdate = updatedQuizzes.has(updateKey);
                                const isPdfMode = isPdfSelectMode && activeFilter === 'custom';
                                return (
                                  <FolderCard
                                    key={updateKey}
                                    title={folder.title}
                                    count={folder.count}
                                    onClick={() => {
                                      if (isPdfMode) {
                                        const newSelected = new Set(selectedPdfFolders);
                                        if (newSelected.has(folder.id)) newSelected.delete(folder.id);
                                        else newSelected.add(folder.id);
                                        setSelectedPdfFolders(newSelected);
                                      } else if (isFolderDeleteMode) {
                                        const newSelected = new Set(deleteFolderIds);
                                        if (newSelected.has(updateKey)) {
                                          newSelected.delete(updateKey);
                                        } else {
                                          newSelected.add(updateKey);
                                        }
                                        setDeleteFolderIds(newSelected);
                                      } else if (isReviewSelectMode) {
                                        const newSelected = new Set(reviewSelectedIds);
                                        if (newSelected.has(updateKey)) {
                                          newSelected.delete(updateKey);
                                        } else {
                                          newSelected.add(updateKey);
                                        }
                                        setReviewSelectedIds(newSelected);
                                      } else if (isAssignMode) {
                                        handleFolderClickInAssignMode(folder.id);
                                      } else {
                                        handleFolderClick(folder);
                                      }
                                    }}
                                    isSelectMode={(isFolderDeleteMode && canDelete) || isReviewSelectMode || isAssignMode || isPdfMode}
                                    isSelected={
                                      isPdfMode
                                        ? selectedPdfFolders.has(folder.id)
                                        : isAssignMode
                                          ? selectedFolderForAssign === folder.id
                                          : (isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds).has(updateKey)
                                    }
                                    showDelete={false}
                                    hasUpdate={hasUpdate}
                                    onUpdateClick={() => {
                                      setUpdateModalInfo({
                                        quizId: folder.id,
                                        quizTitle: folder.title,
                                        filterType: folder.filterType,
                                      });
                                    }}
                                    variant="folder"
                                  />
                                );
                              })}
                            </div>
                            )}
                          </div>
                        </section>
                      )}
                    </div>
                  );
                }

                // 카테고리가 3개 이상일 때: 고정 높이 + 가로 스크롤
                const sortedUncategorizedForMany = [...uncategorizedFolders].sort(
                  (a, b) => (folderOrderMap[a.id] ?? 0) - (folderOrderMap[b.id] ?? 0)
                );

                return (
                  <div className="space-y-3">
                    {/* 사용자 카테고리들 */}
                    {folderCategories.map((cat) => {
                      const categoryFolders = currentFolders
                        .filter((f) => folderCategoryMap[f.id] === cat.id)
                        .sort((a, b) => (folderOrderMap[a.id] ?? 0) - (folderOrderMap[b.id] ?? 0));

                      // 사용자 생성 카테고리는 폴더가 없어도 표시 (미분류만 폴더가 없을 때 생략)

                      return (
                        <div
                          key={cat.id}
                          data-category-id={cat.id}
                          className="border-b border-dashed border-[#EDEAE4] pb-3"
                        >
                          {/* 카테고리 헤더 */}
                          <div
                            onClick={() => {
                              if (isFolderDeleteMode || isReviewSelectMode) {
                                // 선택/삭제 모드: 카테고리 내 모든 폴더 선택/해제
                                const categoryFolderKeys = categoryFolders.map(f => `${f.filterType}-${f.id}`);
                                const currentSelectedIds = isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds;
                                const setSelectedIds = isFolderDeleteMode ? setDeleteFolderIds : setReviewSelectedIds;
                                const allSelected = categoryFolderKeys.every(key => currentSelectedIds.has(key));
                                const newSelected = new Set(currentSelectedIds);
                                if (allSelected) {
                                  categoryFolderKeys.forEach(key => newSelected.delete(key));
                                } else {
                                  categoryFolderKeys.forEach(key => newSelected.add(key));
                                }
                                setSelectedIds(newSelected);
                              } else if (isAssignMode && selectedFolderForAssign) {
                                handleAssignFolderToCategory(selectedFolderForAssign, cat.id);
                              }
                            }}
                            className={`flex items-center mb-2 transition-all ${
                              (isFolderDeleteMode || isReviewSelectMode)
                                ? 'cursor-pointer'
                                : isAssignMode && selectedFolderForAssign
                                  ? 'cursor-pointer p-2 -mx-2 border-2 border-dashed border-[#1A6B1A] bg-[#E8F5E9]'
                                  : ''
                            }`}
                          >
                            {/* 선택/삭제 모드일 때 체크박스 */}
                            {(isFolderDeleteMode || isReviewSelectMode) && (() => {
                              const categoryFolderKeys = categoryFolders.map(f => `${f.filterType}-${f.id}`);
                              const currentSelectedIds = isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds;
                              const allSelected = categoryFolderKeys.length > 0 && categoryFolderKeys.every(key => currentSelectedIds.has(key));
                              const someSelected = categoryFolderKeys.some(key => currentSelectedIds.has(key));
                              return (
                                <div className={`w-4 h-4 border-2 flex items-center justify-center mr-2 ${
                                  allSelected
                                    ? 'bg-[#1A1A1A] border-[#1A1A1A]'
                                    : someSelected
                                      ? 'bg-[#5C5C5C] border-[#1A1A1A]'
                                      : 'border-[#1A1A1A]'
                                }`}>
                                  {allSelected && (
                                    <svg className="w-3 h-3 text-[#F5F0E8]" fill="currentColor" viewBox="0 0 20 20">
                                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                    </svg>
                                  )}
                                  {!allSelected && someSelected && (
                                    <div className="w-2 h-0.5 bg-[#F5F0E8]" />
                                  )}
                                </div>
                              );
                            })()}
                            <span className={`font-bold text-sm min-w-[60px] ${
                              isAssignMode && selectedFolderForAssign ? 'text-[#1A6B1A]' : 'text-[#1A1A1A]'
                            }`}>{cat.name}</span>
                            <div className={`flex-1 border-t border-dashed mx-2 ${
                              isAssignMode && selectedFolderForAssign ? 'border-[#1A6B1A]' : 'border-[#5C5C5C]'
                            }`} />
                            <span className={`text-xs min-w-[30px] text-right ${
                              isAssignMode && selectedFolderForAssign ? 'text-[#1A6B1A]' : 'text-[#5C5C5C]'
                            }`}>{categoryFolders.length}개</span>
                          </div>

                          {/* 폴더들 - 4개 이상이면 좌우 슬라이드 */}
                          {categoryFolders.length === 0 ? (
                            // 빈 카테고리
                            <div className="py-4 text-center text-[#5C5C5C] text-sm border border-dashed border-[#EDEAE4]">
                              폴더가 없습니다
                            </div>
                          ) : categoryFolders.length >= 4 ? (
                            // 4개 이상: 슬라이더
                            <FolderSlider>
                              {categoryFolders.map((folder) => {
                                const canDelete = true;
                                const updateKey = `${folder.filterType}-${folder.id}`;
                                const hasUpdate = updatedQuizzes.has(updateKey);
                                const isPdfMode = isPdfSelectMode && activeFilter === 'custom';
                                return (
                                  <FolderCard
                                    key={updateKey}
                                    title={folder.title}
                                    count={folder.count}
                                    onClick={() => {
                                      if (isPdfMode) {
                                        const newSelected = new Set(selectedPdfFolders);
                                        if (newSelected.has(folder.id)) newSelected.delete(folder.id);
                                        else newSelected.add(folder.id);
                                        setSelectedPdfFolders(newSelected);
                                      } else if (isFolderDeleteMode) {
                                        const newSelected = new Set(deleteFolderIds);
                                        if (newSelected.has(updateKey)) {
                                          newSelected.delete(updateKey);
                                        } else {
                                          newSelected.add(updateKey);
                                        }
                                        setDeleteFolderIds(newSelected);
                                      } else if (isReviewSelectMode) {
                                        const newSelected = new Set(reviewSelectedIds);
                                        if (newSelected.has(updateKey)) {
                                          newSelected.delete(updateKey);
                                        } else {
                                          newSelected.add(updateKey);
                                        }
                                        setReviewSelectedIds(newSelected);
                                      } else if (isAssignMode) {
                                        handleFolderClickInAssignMode(folder.id);
                                      } else {
                                        handleFolderClick(folder);
                                      }
                                    }}
                                    isSelectMode={(isFolderDeleteMode && canDelete) || isReviewSelectMode || isAssignMode || isPdfMode}
                                    isSelected={
                                      isPdfMode
                                        ? selectedPdfFolders.has(folder.id)
                                        : isAssignMode
                                          ? selectedFolderForAssign === folder.id
                                          : (isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds).has(updateKey)
                                    }
                                    showDelete={false}
                                    hasUpdate={hasUpdate}
                                    onUpdateClick={() => {
                                      setUpdateModalInfo({
                                        quizId: folder.id,
                                        quizTitle: folder.title,
                                        filterType: folder.filterType,
                                      });
                                    }}
                                    variant="folder"
                                  />
                                );
                              })}
                            </FolderSlider>
                          ) : (
                            // 3개 이하: 일반 그리드
                            <div className="grid grid-cols-3 gap-3">
                              {categoryFolders.map((folder) => {
                                const canDelete = true;
                                const updateKey = `${folder.filterType}-${folder.id}`;
                                const hasUpdate = updatedQuizzes.has(updateKey);
                                const isPdfMode = isPdfSelectMode && activeFilter === 'custom';
                                return (
                                  <FolderCard
                                    key={updateKey}
                                    title={folder.title}
                                    count={folder.count}
                                    onClick={() => {
                                      if (isPdfMode) {
                                        const newSelected = new Set(selectedPdfFolders);
                                        if (newSelected.has(folder.id)) newSelected.delete(folder.id);
                                        else newSelected.add(folder.id);
                                        setSelectedPdfFolders(newSelected);
                                      } else if (isFolderDeleteMode) {
                                        const newSelected = new Set(deleteFolderIds);
                                        if (newSelected.has(updateKey)) {
                                          newSelected.delete(updateKey);
                                        } else {
                                          newSelected.add(updateKey);
                                        }
                                        setDeleteFolderIds(newSelected);
                                      } else if (isReviewSelectMode) {
                                        const newSelected = new Set(reviewSelectedIds);
                                        if (newSelected.has(updateKey)) {
                                          newSelected.delete(updateKey);
                                        } else {
                                          newSelected.add(updateKey);
                                        }
                                        setReviewSelectedIds(newSelected);
                                      } else if (isAssignMode) {
                                        handleFolderClickInAssignMode(folder.id);
                                      } else {
                                        handleFolderClick(folder);
                                      }
                                    }}
                                    isSelectMode={(isFolderDeleteMode && canDelete) || isReviewSelectMode || isAssignMode || isPdfMode}
                                    isSelected={
                                      isPdfMode
                                        ? selectedPdfFolders.has(folder.id)
                                        : isAssignMode
                                          ? selectedFolderForAssign === folder.id
                                          : (isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds).has(updateKey)
                                    }
                                    showDelete={false}
                                    hasUpdate={hasUpdate}
                                    onUpdateClick={() => {
                                      setUpdateModalInfo({
                                        quizId: folder.id,
                                        quizTitle: folder.title,
                                        filterType: folder.filterType,
                                      });
                                    }}
                                    variant="folder"
                                  />
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* 미분류 폴더 - 폴더가 있을 때만 표시 */}
                    {sortedUncategorizedForMany.length > 0 && (
                      <div data-category-id="uncategorized">
                        {/* 미분류 헤더 */}
                        <div
                          onClick={() => {
                            if (isFolderDeleteMode || isReviewSelectMode) {
                              // 선택 모드: 미분류 폴더 전체 선택/해제
                              const uncategorizedFolderKeys = sortedUncategorizedForMany.map(f => `${f.filterType}-${f.id}`);
                              const currentSelectedIds = isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds;
                              const setSelectedIds = isFolderDeleteMode ? setDeleteFolderIds : setReviewSelectedIds;
                              const allSelected = uncategorizedFolderKeys.every(key => currentSelectedIds.has(key));
                              const newSelected = new Set(currentSelectedIds);
                              if (allSelected) {
                                uncategorizedFolderKeys.forEach(key => newSelected.delete(key));
                              } else {
                                uncategorizedFolderKeys.forEach(key => newSelected.add(key));
                              }
                              setSelectedIds(newSelected);
                            } else if (isAssignMode && selectedFolderForAssign) {
                              handleAssignFolderToCategory(selectedFolderForAssign, null);
                            }
                          }}
                          className={`flex items-center mb-2 transition-all ${
                            (isFolderDeleteMode || isReviewSelectMode)
                              ? 'cursor-pointer'
                              : isAssignMode && selectedFolderForAssign
                                ? 'cursor-pointer p-2 -mx-2 border-2 border-dashed border-[#1A6B1A] bg-[#E8F5E9]'
                                : ''
                          }`}
                        >
                          {/* 선택 모드일 때 체크박스 */}
                          {(isFolderDeleteMode || isReviewSelectMode) && (() => {
                            const uncategorizedFolderKeys = sortedUncategorizedForMany.map(f => `${f.filterType}-${f.id}`);
                            const currentSelectedIds = isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds;
                            const allSelected = uncategorizedFolderKeys.length > 0 && uncategorizedFolderKeys.every(key => currentSelectedIds.has(key));
                            const someSelected = uncategorizedFolderKeys.some(key => currentSelectedIds.has(key));
                            return (
                              <div className={`w-4 h-4 border-2 flex items-center justify-center mr-2 ${
                                allSelected
                                  ? 'bg-[#1A1A1A] border-[#1A1A1A]'
                                  : someSelected
                                    ? 'bg-[#5C5C5C] border-[#1A1A1A]'
                                    : 'border-[#1A1A1A]'
                              }`}>
                                {allSelected && (
                                  <svg className="w-3 h-3 text-[#F5F0E8]" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                  </svg>
                                )}
                                {!allSelected && someSelected && (
                                  <div className="w-2 h-0.5 bg-[#F5F0E8]" />
                                )}
                              </div>
                            );
                          })()}
                          <span className={`font-bold text-sm min-w-[60px] ${
                            isAssignMode && selectedFolderForAssign ? 'text-[#1A6B1A]' : 'text-[#1A1A1A]'
                          }`}>미분류</span>
                          <div className={`flex-1 border-t border-dashed mx-2 ${
                            isAssignMode && selectedFolderForAssign ? 'border-[#1A6B1A]' : 'border-[#5C5C5C]'
                          }`} />
                          <span className={`text-xs min-w-[30px] text-right ${
                            isAssignMode && selectedFolderForAssign ? 'text-[#1A6B1A]' : 'text-[#5C5C5C]'
                          }`}>{sortedUncategorizedForMany.length}개</span>
                        </div>

                        {/* 미분류 폴더들 */}
                        {sortedUncategorizedForMany.length >= 4 ? (
                        // 4개 이상: 슬라이더
                        <FolderSlider>
                          {sortedUncategorizedForMany.map((folder) => {
                            const canDelete = true;
                            const updateKey = `${folder.filterType}-${folder.id}`;
                            const hasUpdate = updatedQuizzes.has(updateKey);
                            const isPdfMode = isPdfSelectMode && activeFilter === 'custom';
                            return (
                              <FolderCard
                                key={updateKey}
                                title={folder.title}
                                count={folder.count}
                                onClick={() => {
                                  if (isPdfMode) {
                                    const newSelected = new Set(selectedPdfFolders);
                                    if (newSelected.has(folder.id)) newSelected.delete(folder.id);
                                    else newSelected.add(folder.id);
                                    setSelectedPdfFolders(newSelected);
                                  } else if (isFolderDeleteMode) {
                                    const newSelected = new Set(deleteFolderIds);
                                    if (newSelected.has(updateKey)) {
                                      newSelected.delete(updateKey);
                                    } else {
                                      newSelected.add(updateKey);
                                    }
                                    setDeleteFolderIds(newSelected);
                                  } else if (isReviewSelectMode) {
                                    const newSelected = new Set(reviewSelectedIds);
                                    if (newSelected.has(updateKey)) {
                                      newSelected.delete(updateKey);
                                    } else {
                                      newSelected.add(updateKey);
                                    }
                                    setReviewSelectedIds(newSelected);
                                  } else if (isAssignMode) {
                                    handleFolderClickInAssignMode(folder.id);
                                  } else {
                                    handleFolderClick(folder);
                                  }
                                }}
                                isSelectMode={(isFolderDeleteMode && canDelete) || isReviewSelectMode || isAssignMode || isPdfMode}
                                isSelected={
                                  isPdfMode
                                    ? selectedPdfFolders.has(folder.id)
                                    : isAssignMode
                                      ? selectedFolderForAssign === folder.id
                                      : (isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds).has(updateKey)
                                }
                                showDelete={false}
                                hasUpdate={hasUpdate}
                                onUpdateClick={() => {
                                  setUpdateModalInfo({
                                    quizId: folder.id,
                                    quizTitle: folder.title,
                                    filterType: folder.filterType,
                                  });
                                }}
                                variant="folder"
                              />
                            );
                          })}
                        </FolderSlider>
                      ) : (
                        // 3개 이하: 일반 그리드
                        <div className="grid grid-cols-3 gap-3">
                          {sortedUncategorizedForMany.map((folder) => {
                            const canDelete = true;
                            const updateKey = `${folder.filterType}-${folder.id}`;
                            const hasUpdate = updatedQuizzes.has(updateKey);
                            const isPdfMode = isPdfSelectMode && activeFilter === 'custom';
                            return (
                              <FolderCard
                                key={updateKey}
                                title={folder.title}
                                count={folder.count}
                                onClick={() => {
                                  if (isPdfMode) {
                                    const newSelected = new Set(selectedPdfFolders);
                                    if (newSelected.has(folder.id)) newSelected.delete(folder.id);
                                    else newSelected.add(folder.id);
                                    setSelectedPdfFolders(newSelected);
                                  } else if (isFolderDeleteMode) {
                                    const newSelected = new Set(deleteFolderIds);
                                    if (newSelected.has(updateKey)) {
                                      newSelected.delete(updateKey);
                                    } else {
                                      newSelected.add(updateKey);
                                    }
                                    setDeleteFolderIds(newSelected);
                                  } else if (isReviewSelectMode) {
                                    const newSelected = new Set(reviewSelectedIds);
                                    if (newSelected.has(updateKey)) {
                                      newSelected.delete(updateKey);
                                    } else {
                                      newSelected.add(updateKey);
                                    }
                                    setReviewSelectedIds(newSelected);
                                  } else if (isAssignMode) {
                                    handleFolderClickInAssignMode(folder.id);
                                  } else {
                                    handleFolderClick(folder);
                                  }
                                }}
                                isSelectMode={(isFolderDeleteMode && canDelete) || isReviewSelectMode || isAssignMode || isPdfMode}
                                isSelected={
                                  isPdfMode
                                    ? selectedPdfFolders.has(folder.id)
                                    : isAssignMode
                                      ? selectedFolderForAssign === folder.id
                                      : (isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds).has(updateKey)
                                }
                                showDelete={false}
                                hasUpdate={hasUpdate}
                                onUpdateClick={() => {
                                  setUpdateModalInfo({
                                    quizId: folder.id,
                                    quizTitle: folder.title,
                                    filterType: folder.filterType,
                                  });
                                }}
                                variant="folder"
                              />
                            );
                          })}
                        </div>
                      )}
                      </div>
                    )}
                  </div>
                );
              })()
            ) : (
              // 기본 그리드 (카테고리 없을 때)
              currentFolders.length >= 4 ? (
                <FolderSlider>
                  {currentFolders.map((folder) => {
                    const canDelete = true;
                    const updateKey = `${folder.filterType}-${folder.id}`;
                    const hasUpdate = updatedQuizzes.has(updateKey);
                    const isPdfMode = isPdfSelectMode && activeFilter === 'custom';
                    return (
                      <FolderCard
                        key={updateKey}
                        title={folder.title}
                        count={folder.count}
                        onClick={() => {
                          if (isPdfMode) {
                            const newSelected = new Set(selectedPdfFolders);
                            if (newSelected.has(folder.id)) {
                              newSelected.delete(folder.id);
                            } else {
                              newSelected.add(folder.id);
                            }
                            setSelectedPdfFolders(newSelected);
                          } else if (isFolderDeleteMode) {
                            const newSelected = new Set(deleteFolderIds);
                            if (newSelected.has(updateKey)) {
                              newSelected.delete(updateKey);
                            } else {
                              newSelected.add(updateKey);
                            }
                            setDeleteFolderIds(newSelected);
                          } else if (isReviewSelectMode) {
                            const newSelected = new Set(reviewSelectedIds);
                            if (newSelected.has(updateKey)) {
                              newSelected.delete(updateKey);
                            } else {
                              newSelected.add(updateKey);
                            }
                            setReviewSelectedIds(newSelected);
                          } else {
                            handleFolderClick(folder);
                          }
                        }}
                        isSelectMode={(isFolderDeleteMode && canDelete) || isReviewSelectMode || isPdfMode}
                        isSelected={
                          isPdfMode
                            ? selectedPdfFolders.has(folder.id)
                            : (isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds).has(updateKey)
                        }
                        showDelete={false}
                        hasUpdate={hasUpdate}
                        onUpdateClick={() => {
                          setUpdateModalInfo({
                            quizId: folder.id,
                            quizTitle: folder.title,
                            filterType: folder.filterType,
                          });
                        }}
                        variant="folder"
                      />
                    );
                  })}
                </FolderSlider>
              ) : (
              <div className="grid grid-cols-3 gap-3">
                {currentFolders.map((folder) => {
                  const canDelete = true;
                  const updateKey = `${folder.filterType}-${folder.id}`;
                  const hasUpdate = updatedQuizzes.has(updateKey);
                  const isPdfMode = isPdfSelectMode && activeFilter === 'custom';
                  return (
                    <FolderCard
                      key={updateKey}
                      title={folder.title}
                      count={folder.count}
                      onClick={() => {
                        if (isPdfMode) {
                          const newSelected = new Set(selectedPdfFolders);
                          if (newSelected.has(folder.id)) {
                            newSelected.delete(folder.id);
                          } else {
                            newSelected.add(folder.id);
                          }
                          setSelectedPdfFolders(newSelected);
                        } else if (isFolderDeleteMode) {
                          const newSelected = new Set(deleteFolderIds);
                          if (newSelected.has(updateKey)) {
                            newSelected.delete(updateKey);
                          } else {
                            newSelected.add(updateKey);
                          }
                          setDeleteFolderIds(newSelected);
                        } else if (isReviewSelectMode) {
                          const newSelected = new Set(reviewSelectedIds);
                          if (newSelected.has(updateKey)) {
                            newSelected.delete(updateKey);
                          } else {
                            newSelected.add(updateKey);
                          }
                          setReviewSelectedIds(newSelected);
                        } else {
                          handleFolderClick(folder);
                        }
                      }}
                      isSelectMode={(isFolderDeleteMode && canDelete) || isReviewSelectMode || isPdfMode}
                      isSelected={
                        isPdfMode
                          ? selectedPdfFolders.has(folder.id)
                          : (isFolderDeleteMode ? deleteFolderIds : reviewSelectedIds).has(updateKey)
                      }
                      showDelete={false}
                      hasUpdate={hasUpdate}
                      onUpdateClick={() => {
                        setUpdateModalInfo({
                          quizId: folder.id,
                          quizTitle: folder.title,
                          filterType: folder.filterType,
                        });
                      }}
                      variant="folder"
                    />
                  );
                })}
              </div>
              )
            )}
          </>
        )}
      </main>

      {/* 새 폴더 생성 모달 */}
      <CreateFolderModal
        isOpen={showCreateFolder}
        onClose={() => setShowCreateFolder(false)}
        onCreate={handleCreateFolder}
      />

      {/* 찜한 퀴즈 상세보기 모달 */}
      {selectedBookmarkedQuiz && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
          onClick={() => setSelectedBookmarkedQuiz(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.88 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.88 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[280px] bg-[#F5F0E8] border-2 border-[#1A1A1A] p-3"
          >
            <h2 className="text-xs font-bold text-[#1A1A1A] mb-2">
              {selectedBookmarkedQuiz.title}
            </h2>

            {/* 미완료 퀴즈: 평균 점수 대형 표시 (Start 버전) */}
            {!selectedBookmarkedQuiz.hasCompleted && (
              <div className="text-center py-1.5 mb-1.5 border-2 border-dashed border-[#1A1A1A] bg-[#EDEAE4]">
                <p className="text-[9px] text-[#5C5C5C] mb-0.5">평균 점수</p>
                <p className="text-xl font-black text-[#1A1A1A]">
                  {selectedBookmarkedQuiz.participantCount > 0
                    ? <>{(selectedBookmarkedQuiz.averageScore ?? 0).toFixed(0)}<span className="text-[10px] font-bold">점</span></>
                    : '-'}
                </p>
              </div>
            )}

            <div className="space-y-1 mb-3">
              <div className="flex justify-between text-[11px]">
                <span className="text-[#5C5C5C]">문제 수</span>
                <span className="font-bold text-[#1A1A1A]">{selectedBookmarkedQuiz.questionCount}문제</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-[#5C5C5C]">참여자</span>
                <span className="font-bold text-[#1A1A1A]">{selectedBookmarkedQuiz.participantCount}명</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-[#5C5C5C]">난이도</span>
                <span className="font-bold text-[#1A1A1A]">
                  {selectedBookmarkedQuiz.difficulty === 'easy' ? '쉬움' : selectedBookmarkedQuiz.difficulty === 'hard' ? '어려움' : '보통'}
                </span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-[#5C5C5C]">문제 유형</span>
                <span className="font-bold text-[#1A1A1A]">
                  {formatQuestionTypes(
                    selectedBookmarkedQuiz.oxCount || 0,
                    selectedBookmarkedQuiz.multipleChoiceCount || 0,
                    selectedBookmarkedQuiz.subjectiveCount || 0
                  )}
                </span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-[#5C5C5C]">제작자</span>
                <span className="font-bold text-[#1A1A1A]">
                  {selectedBookmarkedQuiz.creatorNickname || '익명'}
                </span>
              </div>

              {/* 완료된 퀴즈: 평균 점수 행 + 점수 표시 (Review 버전) */}
              {selectedBookmarkedQuiz.hasCompleted && (
                <>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-[#5C5C5C]">평균 점수</span>
                    <span className="font-bold text-[#1A1A1A]">
                      {selectedBookmarkedQuiz.participantCount > 0
                        ? `${(selectedBookmarkedQuiz.averageScore ?? 0).toFixed(0)}점`
                        : '-'}
                    </span>
                  </div>
                  <div className="py-1.5 border-t border-[#A0A0A0]">
                    <div className="flex items-center justify-center gap-2">
                      <span className="text-xl font-black text-[#1A1A1A]">
                        {selectedBookmarkedQuiz.myScore !== undefined ? selectedBookmarkedQuiz.myScore : '-'}
                      </span>
                      <span className="text-xs text-[#5C5C5C]">/</span>
                      <span className="text-2xl font-black text-[#1A1A1A]">
                        {selectedBookmarkedQuiz.myFirstReviewScore !== undefined ? selectedBookmarkedQuiz.myFirstReviewScore : '-'}
                      </span>
                    </div>
                    <div className="flex items-center justify-center gap-6 mt-0.5">
                      <span className="text-[9px] text-[#5C5C5C]">퀴즈</span>
                      <span className="text-[9px] text-[#5C5C5C]">복습</span>
                    </div>
                  </div>
                </>
              )}

              {selectedBookmarkedQuiz.tags && selectedBookmarkedQuiz.tags.length > 0 && (
                <div className="pt-1.5 border-t border-[#A0A0A0]">
                  <div className="flex flex-wrap gap-1">
                    {selectedBookmarkedQuiz.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-1 py-0.5 bg-[#1A1A1A] text-[#F5F0E8] text-[10px] font-medium"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setSelectedBookmarkedQuiz(null)}
                className="flex-1 py-1.5 text-[11px] font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors"
              >
                닫기
              </button>
              <button
                onClick={() => {
                  router.push(`/quiz/${selectedBookmarkedQuiz.quizId}`);
                  setSelectedBookmarkedQuiz(null);
                }}
                className="flex-1 py-1.5 text-[11px] font-bold bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors"
              >
                {selectedBookmarkedQuiz.hasCompleted ? '복습하기' : '시작하기'}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* 문제 상세보기 모달 (문제 목록 표시) */}
      {questionListQuiz && (
        <QuestionListModal
          quiz={questionListQuiz}
          onClose={() => setQuestionListQuiz(null)}
          onReview={() => {
            handleStartReviewByQuizId(questionListQuiz.id);
            setQuestionListQuiz(null);
          }}
          groupedSolvedItems={groupedSolvedItems}
        />
      )}

      {/* 빈 폴더 임시 메시지 */}
      <AnimatePresence>
        {showEmptyMessage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="bg-[#F5F0E8] border-2 border-[#1A1A1A] px-6 py-4 text-center"
            >
              <p className="text-sm font-bold text-[#1A1A1A]">
                선택된 폴더에 복습할 문제가 없습니다
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 퀴즈 업데이트 확인 모달 */}
      {updateModalInfo && !detailedUpdateInfo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !updateModalLoading && setUpdateModalInfo(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.88 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.88 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[280px] bg-[#F5F0E8] border-2 border-[#1A1A1A] p-4"
          >
            {/* 아이콘 */}
            <div className="flex justify-center mb-3">
              <div className="w-9 h-9 flex items-center justify-center border-2 border-[#1A1A1A] bg-[#EDEAE4]">
                <svg
                  className="w-4 h-4 text-[#1A1A1A]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              </div>
            </div>

            <h3 className="text-center font-bold text-sm text-[#1A1A1A] mb-2">
              수정된 문제를 풀까요?
            </h3>
            <p className="text-xs text-[#5C5C5C] mb-1">
              - 수정된 문제만 다시 풀 수 있습니다.
            </p>
            <p className="text-xs text-[#5C5C5C] mb-1">
              - 새로운 답변이 복습 기록에 반영됩니다.
            </p>
            <p className="text-xs text-[#5C5C5C] mb-4">
              - 정답 여부와 복습 횟수가 업데이트됩니다.
            </p>

            <div className="flex gap-2">
              <button
                onClick={() => setUpdateModalInfo(null)}
                disabled={updateModalLoading}
                className="flex-1 py-1.5 text-xs font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={async () => {
                  try {
                    setUpdateModalLoading(true);
                    const info = await checkQuizUpdate(updateModalInfo.quizId);
                    if (info && info.hasUpdate && info.updatedQuestions.length > 0) {
                      const quizDoc = await getDoc(doc(db, 'quizzes', updateModalInfo.quizId));
                      if (quizDoc.exists()) {
                        const quizData = quizDoc.data();
                        setTotalQuestionCount(quizData.questions?.length || 0);
                      }
                      setDetailedUpdateInfo(info);
                    } else {
                      alert('이미 최신 상태입니다.');
                      setUpdateModalInfo(null);
                    }
                  } catch (err) {
                    alert('업데이트 정보를 불러오는데 실패했습니다.');
                  } finally {
                    setUpdateModalLoading(false);
                  }
                }}
                disabled={updateModalLoading}
                className="flex-1 py-1.5 text-xs font-bold border-2 border-[#1A1A1A] bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#333] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {updateModalLoading ? (
                  <>
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    로딩...
                  </>
                ) : (
                  '풀기'
                )}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* 수정된 문제 풀기 모달 (UpdateQuizModal) */}
      {detailedUpdateInfo && (
        <UpdateQuizModal
          isOpen={!!detailedUpdateInfo}
          onClose={() => {
            setDetailedUpdateInfo(null);
            setUpdateModalInfo(null);
          }}
          updateInfo={detailedUpdateInfo}
          totalQuestionCount={totalQuestionCount}
          onComplete={(newScore, newCorrectCount) => {
            // 완료 후 새로고침
            refresh();
            refreshQuizUpdate();
            setDetailedUpdateInfo(null);
            setUpdateModalInfo(null);
          }}
        />
      )}

      {/* 폴더 카테고리 설정 모달 */}
      <AnimatePresence>
        {isSortMode && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-3"
            style={{ position: 'fixed', touchAction: 'none' }}
            onClick={() => {
              setIsSortMode(false);
              setNewCategoryName('');
            }}
          >
            {/* 배경 오버레이 */}
            <div className="absolute inset-0 bg-black/50" />

            {/* 모달 컨텐츠 */}
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="relative bg-[#F5F0E8] border-2 border-[#1A1A1A] w-full max-w-sm max-h-[80vh] overflow-y-auto rounded-2xl"
            >
              {/* 헤더 */}
              <div className="flex items-center justify-between p-3 border-b-2 border-[#1A1A1A]">
                <h3 className="font-bold text-base text-[#1A1A1A]">카테고리 설정</h3>
                <button
                  onClick={() => {
                    setIsSortMode(false);
                    setNewCategoryName('');
                  }}
                  className="w-7 h-7 flex items-center justify-center text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* 본문 */}
              <div className="p-3 space-y-3">
                {/* 카테고리 추가 */}
                <div>
                  <label className="block text-xs font-bold text-[#1A1A1A] mb-1.5">새 카테고리 추가</label>
                  {folderCategories.length >= 8 ? (
                    <div className="p-2.5 border-2 border-dashed border-[#5C5C5C] bg-[#EDEAE4] text-center">
                      <p className="text-xs text-[#5C5C5C]">카테고리는 최대 8개까지 추가할 수 있습니다.</p>
                    </div>
                  ) : (
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        placeholder="카테고리 이름 입력"
                        className="flex-1 px-2.5 py-1.5 border-2 border-[#1A1A1A] bg-[#F5F0E8] text-xs focus:outline-none rounded-lg"
                        maxLength={20}
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="off"
                        inputMode="text"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && newCategoryName.trim()) {
                            handleAddFolderCategory();
                          }
                        }}
                      />
                      <button
                        onClick={handleAddFolderCategory}
                        disabled={!newCategoryName.trim()}
                        className="px-3 py-1.5 bg-[#1A1A1A] text-[#F5F0E8] font-bold text-xs disabled:opacity-30 rounded-lg"
                      >
                        추가
                      </button>
                    </div>
                  )}
                </div>

                {/* 현재 카테고리 목록 */}
                <div>
                  <label className="block text-xs font-bold text-[#1A1A1A] mb-1.5">
                    현재 카테고리 ({folderCategories.length}/8개)
                  </label>
                  {folderCategories.length === 0 ? (
                    <p className="text-[11px] text-[#5C5C5C] py-3 text-center border border-dashed border-[#5C5C5C]">
                      아직 카테고리가 없습니다. 위에서 추가해주세요.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {folderCategories.map((cat) => {
                        const folderCount = Object.values(folderCategoryMap).filter(
                          (catId) => catId === cat.id
                        ).length;

                        return (
                          <div
                            key={cat.id}
                            className="flex items-center justify-between p-2.5 border-2 border-[#1A1A1A] bg-[#EDEAE4] rounded-lg"
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-xs text-[#1A1A1A]">{cat.name}</span>
                              <span className="text-[11px] text-[#5C5C5C]">({folderCount}개)</span>
                            </div>
                            <button
                              onClick={() => handleRemoveFolderCategory(cat.id)}
                              className="px-1.5 py-0.5 text-[11px] font-bold text-[#8B1A1A] border border-[#8B1A1A] hover:bg-[#FDEAEA] transition-colors rounded-md"
                            >
                              삭제
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 폴더 배정 모드 진입 버튼 */}
                {folderCategories.length > 0 && customFolders.length > 0 && (
                  <div className="pt-2.5 border-t-2 border-[#EDEAE4]">
                    <button
                      onClick={() => {
                        setIsSortMode(false);
                        setIsAssignMode(true);
                      }}
                      className="w-full py-2.5 font-bold text-xs bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#3A3A3A] transition-colors rounded-lg"
                    >
                      폴더 배정하기
                    </button>
                    <p className="text-[11px] text-[#5C5C5C] text-center mt-1.5">
                      폴더를 선택 → 원하는 카테고리 헤더를 탭하세요
                    </p>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 삭제 확인 바텀시트 */}
      <AnimatePresence>
        {showDeleteConfirmSheet && (
          <motion.div
            initial={{ opacity: 0, pointerEvents: 'auto' as const }}
            animate={{ opacity: 1, pointerEvents: 'auto' as const }}
            exit={{ opacity: 0, pointerEvents: 'none' as const }}
            className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50"
            onClick={() => setShowDeleteConfirmSheet(false)}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-h-[70vh] bg-[#F5F0E8] border-t-2 border-[#1A1A1A] overflow-hidden flex flex-col"
            >
              {/* 헤더 */}
              <div className="flex items-center justify-between p-4 border-b border-[#EDEAE4]">
                <h3 className="font-bold text-lg text-[#1A1A1A]">휴지통</h3>
                <button
                  onClick={() => setShowDeleteConfirmSheet(false)}
                  className="w-8 h-8 flex items-center justify-center text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* 삭제된 항목 목록 (휴지통) */}
              <div className="flex-1 overflow-y-auto p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm text-[#5C5C5C]">
                    삭제된 항목입니다.
                  </p>
                  {deletedItems.length > 0 && (
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (confirm(`휴지통의 모든 항목(${deletedItems.length}개)을 영구 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) {
                          try {
                            for (const item of deletedItems) {
                              await permanentlyDeleteItem(item.id);
                            }
                            setShowDeleteConfirmSheet(false);
                          } catch (err) {
                            alert('휴지통 비우기에 실패했습니다.');
                          }
                        }
                      }}
                      className="px-3 py-1.5 text-sm font-bold text-[#8B1A1A] border border-[#8B1A1A] hover:bg-[#8B1A1A] hover:text-white transition-colors"
                    >
                      휴지통 비우기
                    </button>
                  )}
                </div>
                {deletedItems.length > 0 ? (
                  <div className="space-y-2">
                    {deletedItems.map((item) => {
                      const typeLabels: Record<string, string> = {
                        solved: '문제',
                        wrong: '오답',
                        bookmark: '찜',
                        custom: '커스텀',
                      };
                      return (
                        <motion.div
                          key={item.id}
                          layout
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 20 }}
                          className="flex items-center justify-between p-3 border border-[#5C5C5C] bg-[#EDEAE4]"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-[#1A1A1A] truncate">{item.title}</p>
                            <p className="text-xs text-[#5C5C5C]">
                              {typeLabels[item.type] || item.type} · {item.questionCount}문제
                            </p>
                          </div>
                          <div className="flex items-center gap-2 ml-2">
                            {/* 되살리기 버튼 */}
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                try {
                                  await restoreDeletedItem(item.id);
                                  // 복원 성공 시 모든 모드 해제 및 상태 초기화
                                  setShowDeleteConfirmSheet(false);
                                  setIsFolderDeleteMode(false);
                                  setDeleteFolderIds(new Set());
                                  setIsReviewSelectMode(false);
                                  setReviewSelectedIds(new Set());
                                } catch (err) {
                                  alert('복원에 실패했습니다.');
                                }
                              }}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-[#1A6B1A] font-bold border border-[#1A6B1A] hover:bg-[#1A6B1A] hover:text-white transition-colors"
                            >
                              되살리기
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                              </svg>
                            </button>
                            {/* 삭제 버튼 */}
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                try {
                                  await permanentlyDeleteItem(item.id);
                                } catch (err) {
                                  alert('삭제에 실패했습니다.');
                                }
                              }}
                              className="px-3 py-1.5 text-sm text-[#8B1A1A] font-bold border border-[#8B1A1A] hover:bg-[#8B1A1A] hover:text-white transition-colors"
                            >
                              삭제
                            </button>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <svg className="w-12 h-12 text-[#D4CFC4] mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    <p className="text-sm text-[#5C5C5C]">휴지통이 비어있습니다.</p>
                  </div>
                )}
              </div>

              {/* 하단 버튼 */}
              <div className="p-4 border-t border-[#EDEAE4]">
                <button
                  onClick={() => setShowDeleteConfirmSheet(false)}
                  className="w-full py-3 font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors"
                >
                  닫기
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 서재 퀴즈 공개 확인 모달 */}
      <AnimatePresence>
        {publishConfirmQuizId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
            onClick={() => setPublishConfirmQuizId(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-[85%] max-w-[280px] bg-[#F5F0E8] border-2 border-[#1A1A1A] p-4 rounded-2xl"
            >
              {/* 아이콘 */}
              <div className="flex justify-center mb-3">
                <div className="w-10 h-10 flex items-center justify-center border-2 border-[#1A1A1A] bg-[#EDEAE4] rounded-lg">
                  <svg className="w-5 h-5 text-[#1A1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.6 9h16.8M3.6 15h16.8" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3a15.3 15.3 0 0 1 4 9 15.3 15.3 0 0 1-4 9 15.3 15.3 0 0 1-4-9 15.3 15.3 0 0 1 4-9z" />
                  </svg>
                </div>
              </div>

              {/* 텍스트 */}
              <h3 className="text-center font-bold text-base text-[#1A1A1A] mb-1.5">
                퀴즈를 공개할까요?
              </h3>
              <p className="text-center text-xs text-[#5C5C5C] mb-0.5">
                공개하면 다른 학생들도 풀 수 있어요.
              </p>
              <p className="text-center text-xs text-[#5C5C5C] mb-4">
                참여 통계도 확인할 수 있어요.
              </p>

              {/* 버튼 */}
              <div className="flex gap-3">
                <button
                  onClick={() => setPublishConfirmQuizId(null)}
                  className="flex-1 py-2.5 text-sm font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors rounded-lg"
                >
                  취소
                </button>
                <button
                  onClick={() => {
                    uploadToPublic(publishConfirmQuizId);
                    setPublishConfirmQuizId(null);
                  }}
                  className="flex-1 py-2.5 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors rounded-lg"
                >
                  공개
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 서재 퀴즈 상세 모달 */}
      <ExpandModal
        isOpen={!!selectedLibraryQuiz}
        onClose={() => { setSelectedLibraryQuiz(null); clearLibraryRect(); }}
        sourceRect={librarySourceRect}
        className="w-full max-w-[300px] bg-[#F5F0E8] border-2 border-[#1A1A1A] p-4 rounded-2xl"
        zIndex={60}
      >
        {selectedLibraryQuiz && (
          <>
            <h2 className="text-sm font-bold text-[#1A1A1A] mb-3">
              {selectedLibraryQuiz.title}
            </h2>

            <div className="space-y-1.5 mb-4">
              <div className="flex justify-between text-xs">
                <span className="text-[#5C5C5C]">문제 수</span>
                <span className="font-bold text-[#1A1A1A]">{selectedLibraryQuiz.questionCount}문제</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-[#5C5C5C]">난이도</span>
                <span className="font-bold text-[#1A1A1A]">
                  {selectedLibraryQuiz.difficulty === 'easy' ? '쉬움' :
                   selectedLibraryQuiz.difficulty === 'hard' ? '어려움' : '보통'}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-[#5C5C5C]">문제 유형</span>
                <span className="font-bold text-[#1A1A1A]">
                  {formatQuestionTypes(
                    selectedLibraryQuiz.oxCount || 0,
                    selectedLibraryQuiz.multipleChoiceCount || 0,
                    selectedLibraryQuiz.subjectiveCount || 0
                  )}
                </span>
              </div>
              {/* 점수 표시: 퀴즈 점수 / 첫번째 복습 점수 */}
              <div className="py-2 border-t border-[#A0A0A0]">
                <div className="flex items-center justify-center gap-2">
                  <span className="text-2xl font-black text-[#1A1A1A]">
                    {selectedLibraryQuiz.myScore !== undefined ? selectedLibraryQuiz.myScore : selectedLibraryQuiz.score}
                  </span>
                  <span className="text-sm text-[#5C5C5C]">/</span>
                  <span className="text-3xl font-black text-[#1A1A1A]">
                    {selectedLibraryQuiz.myFirstReviewScore !== undefined ? selectedLibraryQuiz.myFirstReviewScore : '-'}
                  </span>
                </div>
                <div className="flex items-center justify-center gap-6 mt-0.5">
                  <span className="text-[10px] text-[#5C5C5C]">퀴즈</span>
                  <span className="text-[10px] text-[#5C5C5C]">복습</span>
                </div>
              </div>
              {selectedLibraryQuiz.tags && selectedLibraryQuiz.tags.length > 0 && (
                <div className="pt-2 border-t border-[#A0A0A0]">
                  <div className="flex flex-wrap gap-1.5">
                    {selectedLibraryQuiz.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-1.5 py-0.5 bg-[#1A1A1A] text-[#F5F0E8] text-xs font-medium"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => { setSelectedLibraryQuiz(null); clearLibraryRect(); }}
                className="flex-1 py-2 text-xs font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors rounded-lg"
              >
                닫기
              </button>
              <button
                onClick={() => {
                  const quiz = selectedLibraryQuiz;
                  setSelectedLibraryQuiz(null);
                  clearLibraryRect();
                  router.push(`/review/library/${quiz.id}?mode=review`);
                }}
                className="flex-1 py-2 text-xs font-bold bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors rounded-lg"
              >
                복습하기
              </button>
            </div>
          </>
        )}
      </ExpandModal>

    </div>
  );
}

// useSearchParams를 Suspense로 감싸서 export
export default function ReviewPage() {
  return (
    <Suspense
      fallback={
        <div
          className="min-h-screen flex items-center justify-center"
          style={{ backgroundColor: '#F5F0E8' }}
        >
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-[#1A1A1A] border-t-transparent animate-spin mx-auto mb-4" />
            <p className="text-sm text-[#5C5C5C]">로딩 중...</p>
          </div>
        </div>
      }
    >
      <ReviewPageContent />
    </Suspense>
  );
}
