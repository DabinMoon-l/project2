'use client';

import { useState, useCallback, useEffect, Suspense, useRef, useMemo } from 'react';
import { motion, AnimatePresence, PanInfo } from 'framer-motion';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { doc, getDoc, collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Skeleton } from '@/components/common';
import ReviewPractice from '@/components/review/ReviewPractice';
import { useReview, type ReviewItem, type GroupedReviewItems, type QuizUpdateInfo, type PrivateQuiz, type CustomFolder } from '@/lib/hooks/useReview';
import { useQuizBookmark, type BookmarkedQuiz } from '@/lib/hooks/useQuizBookmark';
import { useAuth } from '@/lib/hooks/useAuth';
import { useCourse } from '@/lib/contexts';
import { COURSES, getPastExamOptions, type PastExamOption } from '@/lib/types/course';
import { getChapterById } from '@/lib/courseIndex';

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
type ReviewFilter = 'solved' | 'wrong' | 'bookmark' | 'custom';

/** 필터 옵션 */
const FILTER_OPTIONS: { value: ReviewFilter; line1: string; line2?: string }[] = [
  { value: 'solved', line1: '문제' },
  { value: 'wrong', line1: '오답' },
  { value: 'bookmark', line1: '찜' },
  { value: 'custom', line1: '내맘대로' },
];

/**
 * 슬라이드 필터 컴포넌트
 */
function SlideFilter({
  activeFilter,
  onFilterChange,
}: {
  activeFilter: ReviewFilter;
  onFilterChange: (filter: ReviewFilter) => void;
}) {
  const activeIndex = FILTER_OPTIONS.findIndex((opt) => opt.value === activeFilter);

  return (
    <div className="relative flex items-stretch bg-[#EDEAE4] border border-[#1A1A1A] overflow-hidden min-w-[320px]">
      {/* 슬라이드 배경 */}
      <motion.div
        className="absolute h-full bg-[#1A1A1A]"
        initial={false}
        animate={{
          left: `${activeIndex * 25}%`,
        }}
        style={{
          width: '25%',
        }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      />

      {/* 필터 옵션들 */}
      {FILTER_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onFilterChange(option.value)}
          className={`relative z-10 w-1/4 px-3 py-3 text-xs font-bold transition-colors text-center flex flex-col items-center justify-center ${
            activeFilter === option.value ? 'text-[#F5F0E8]' : 'text-[#1A1A1A]'
          }`}
        >
          {option.line2 ? (
            <>
              <span className="leading-tight">{option.line1}</span>
              <span className="leading-tight">{option.line2}</span>
            </>
          ) : (
            <span className="whitespace-nowrap">{option.line1}</span>
          )}
        </button>
      ))}
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
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      className={`
        relative border bg-[#F5F0E8] p-3 cursor-pointer transition-all
        ${isSelectMode
          ? isSelected
            ? 'border-2 border-dashed border-[#1A1A1A] bg-[#EDEAE4]'
            : 'border border-dashed border-[#5C5C5C] hover:border-[#1A1A1A]'
          : 'border-[#1A1A1A] hover:bg-[#EDEAE4]'
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
          className="absolute top-1 right-1 w-6 h-6 border border-[#8B1A1A] text-[#8B1A1A] bg-[#F5F0E8] hover:bg-[#FDEAEA] flex items-center justify-center transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        </button>
      )}

      {/* 선택 표시 */}
      {isSelectMode && isSelected && (
        <div className="flex justify-end mb-1">
          <div className="w-5 h-5 bg-[#1A1A1A] flex items-center justify-center">
            <svg className="w-3 h-3 text-[#F5F0E8]" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          </div>
        </div>
      )}

      {/* 아이콘 영역 */}
      <div className="flex justify-center mb-2 relative">
        {variant === 'quiz' ? (
          // 퀴즈 카드 스타일 아이콘
          <div className={`w-12 h-12 border-2 flex items-center justify-center ${isSelectMode && !isSelected ? 'border-[#5C5C5C] text-[#5C5C5C]' : 'border-[#1A1A1A] text-[#1A1A1A]'}`}>
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
        ) : (
          // 폴더 아이콘 (기본)
          <svg className={`w-12 h-12 ${isSelectMode && !isSelected ? 'text-[#5C5C5C]' : 'text-[#1A1A1A]'}`} fill="currentColor" viewBox="0 0 24 24">
            <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
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
      <h3 className={`font-bold text-xs text-center line-clamp-2 mb-1 ${isSelectMode && !isSelected ? 'text-[#5C5C5C]' : 'text-[#1A1A1A]'}`}>
        {title}
      </h3>

      {/* 문제 수 */}
      <p className="text-xs text-center text-[#5C5C5C]">
        {count}문제
      </p>
    </motion.div>
  );
}

/**
 * 찜한 퀴즈 카드 컴포넌트 (하트 아이콘 포함)
 */
function BookmarkedQuizCard({
  quiz,
  onClick,
  onUnbookmark,
}: {
  quiz: BookmarkedQuiz;
  onClick: () => void;
  onUnbookmark: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      className="relative border border-[#1A1A1A] bg-[#F5F0E8] p-3 cursor-pointer hover:bg-[#EDEAE4] transition-all"
    >
      {/* 하트 아이콘 (북마크 해제) */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onUnbookmark();
        }}
        className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center transition-transform hover:scale-110"
      >
        <svg className="w-5 h-5 text-[#8B1A1A]" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>
      </button>

      {/* 퀴즈 카드 스타일 아이콘 */}
      <div className="flex justify-center mb-2">
        <div className="w-12 h-12 border-2 border-[#1A1A1A] flex items-center justify-center">
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
 */
function LargeBookmarkedQuizCard({
  quiz,
  onClick,
  onUnbookmark,
  chapterName,
}: {
  quiz: BookmarkedQuiz;
  onClick: () => void;
  onUnbookmark: () => void;
  chapterName?: string;
}) {
  const difficulty = quiz.difficulty || 'normal';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      className="relative border-2 border-[#1A1A1A] bg-[#F5F0E8] cursor-pointer hover:bg-[#EDEAE4] transition-all"
    >
      {/* 하트 아이콘 (북마크 해제) */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onUnbookmark();
        }}
        className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center transition-transform hover:scale-110 z-10"
      >
        <svg className="w-6 h-6 text-[#8B1A1A]" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>
      </button>

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
    <div className="border-2 border-dashed border-[#D4CFC4] bg-[#EDEAE4]">
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
    <div className="border-2 border-dashed border-[#D4CFC4] bg-[#EDEAE4]">
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
        <div className="flex-1 flex flex-col justify-between bg-[#F5F0E8]/90 p-2">
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

          {/* Review 버튼 */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onReview();
            }}
            className={`${styles.button} font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors self-start`}
          >
            Review
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
          <div className="flex items-center justify-center h-full">
            <div className="animate-pulse text-[#5C5C5C]">로딩 중...</div>
          </div>
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
          <div className="flex items-center justify-center h-full">
            <div className="animate-pulse text-[#5C5C5C]">로딩 중...</div>
          </div>
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
                Review
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
              currentIndex === index ? 'bg-[#1A1A1A] w-4' : 'bg-[#CCCCCC]'
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
  onDetails,
  onReview,
  isBookmarked,
  onToggleBookmark,
}: {
  quiz: CompletedQuizData;
  onDetails: () => void;
  onReview: () => void;
  isBookmarked?: boolean;
  onToggleBookmark?: () => void;
}) {
  const tags = quiz.tags || [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4, boxShadow: '0 8px 25px rgba(26, 26, 26, 0.15)' }}
      transition={{ duration: 0.2 }}
      onClick={onDetails}
      className="relative border border-[#1A1A1A] bg-[#F5F0E8] overflow-hidden cursor-pointer shadow-md"
    >
      {/* 신문 배경 텍스트 */}
      <div className="absolute inset-0 p-2 overflow-hidden pointer-events-none">
        <p className="text-[5px] text-[#E8E8E8] leading-tight break-words">
          {NEWSPAPER_BG_TEXT.slice(0, 300)}
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

      {/* 카드 내용 */}
      <div className="relative z-10 p-4 bg-[#F5F0E8]/90">
        {/* 제목 (2줄 고정 높이) */}
        <div className="h-[44px] mb-2">
          <h3 className="font-serif-display font-bold text-base line-clamp-2 text-[#1A1A1A] leading-snug">
            {quiz.title}
          </h3>
        </div>

        {/* 메타 정보 */}
        <p className="text-sm text-[#5C5C5C] mb-1">
          {quiz.questionCount}문제 · {quiz.participantCount}명 참여
        </p>

        {/* 태그 (2줄 고정 높이) */}
        <div className="h-[48px] mb-2 overflow-hidden">
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tags.slice(0, 8).map((tag) => (
                <span
                  key={tag}
                  className="px-1.5 py-0.5 bg-[#1A1A1A] text-[#F5F0E8] text-xs font-medium"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 버튼 */}
        <div className="flex gap-2 mt-3">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDetails();
            }}
            className="flex-1 py-2 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] bg-transparent hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
          >
            Details
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onReview();
            }}
            className="flex-1 py-2 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors"
          >
            Review
          </button>
        </div>
      </div>
    </motion.div>
  );
}

/**
 * 스켈레톤 폴더 카드
 */
function SkeletonFolderCard() {
  return (
    <div className="border border-[#1A1A1A] bg-[#F5F0E8] p-3 shadow-md">
      <div className="flex justify-center mb-2">
        <Skeleton className="w-12 h-12 rounded-none" />
      </div>
      <Skeleton className="w-full h-4 mb-1 rounded-none" />
      <Skeleton className="w-1/2 h-3 mx-auto rounded-none" />
    </div>
  );
}

/**
 * 빈 상태 컴포넌트
 */
function EmptyState({ filter, type, fullHeight = false }: { filter: ReviewFilter; type?: 'quiz' | 'question'; fullHeight?: boolean }) {
  const messages: Record<ReviewFilter, { title: string; desc: string }> = {
    solved: { title: '문제가 없습니다', desc: '퀴즈를 풀거나 비공개 퀴즈를 만들어보세요.' },
    wrong: { title: '오답이 없습니다', desc: '퀴즈를 풀면 틀린 문제가 자동으로 저장됩니다.' },
    bookmark: { title: '찜한 항목이 없습니다', desc: '퀴즈나 문제를 찜해보세요.' },
    custom: { title: '폴더가 없습니다', desc: '나만의 폴더를 만들어보세요.' },
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
 * 찜한 퀴즈 카드 (자작 탭 QuizCard와 동일한 스타일)
 */
function BookmarkQuizCard({
  quiz,
  onDetails,
  onStart,
  onUnbookmark,
  isSelectMode = false,
  isSelected = false,
}: {
  quiz: BookmarkedQuiz;
  onDetails: () => void;
  onStart: () => void;
  onUnbookmark: () => void;
  isSelectMode?: boolean;
  isSelected?: boolean;
}) {
  const tags = quiz.tags || [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={isSelectMode ? {} : { y: -4, boxShadow: '0 8px 25px rgba(26, 26, 26, 0.15)' }}
      transition={{ duration: 0.2 }}
      onClick={onDetails}
      className={`relative border bg-[#F5F0E8] p-4 cursor-pointer shadow-md ${
        isSelectMode
          ? isSelected
            ? 'border-2 border-dashed border-[#1A1A1A] bg-[#EDEAE4]'
            : 'border border-dashed border-[#5C5C5C] hover:border-[#1A1A1A]'
          : 'border-[#1A1A1A]'
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
        /* 하트 아이콘 (북마크 해제) */
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
        </button>
      )}

      {/* 제목 (2줄 고정 높이) - 가독성 향상 */}
      <div className="h-[44px] mb-2">
        <h3 className="font-serif-display font-bold text-base line-clamp-2 text-[#1A1A1A] pr-6 leading-snug">
          {quiz.title}
        </h3>
      </div>

      {/* 메타 정보 - 가독성 향상 */}
      <p className="text-sm text-[#5C5C5C] mb-1">
        {quiz.questionCount}문제 · {quiz.participantCount}명 참여
      </p>

      {/* 태그 (2줄 고정 높이) */}
      <div className="h-[48px] mb-2 overflow-hidden">
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.slice(0, 8).map((tag) => (
              <span
                key={tag}
                className="px-1.5 py-0.5 bg-[#1A1A1A] text-[#F5F0E8] text-xs font-medium"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 버튼 영역 */}
      {!isSelectMode && (
        <div className="flex gap-2 mt-3">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDetails();
            }}
            className="flex-1 py-2 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] bg-transparent hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
          >
            Details
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onStart();
            }}
            className="flex-1 py-2 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors"
          >
            Review
          </button>
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
  onQuizDetails,
  onQuizStart,
  onUnbookmark,
  isSelectMode = false,
  selectedFolderIds,
  onSelectToggle,
}: {
  bookmarkedQuizzes: BookmarkedQuiz[];
  onQuizDetails: (quiz: BookmarkedQuiz) => void;
  onQuizStart: (quizId: string) => void;
  onUnbookmark: (quizId: string) => void;
  isSelectMode?: boolean;
  selectedFolderIds?: Set<string>;
  onSelectToggle?: (quizId: string) => void;
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
            onDetails={() => {
              if (isSelectMode && onSelectToggle) {
                onSelectToggle(quiz.quizId);
              } else {
                onQuizDetails(quiz);
              }
            }}
            onStart={() => onQuizStart(quiz.quizId)}
            onUnbookmark={() => onUnbookmark(quiz.quizId)}
            isSelectMode={isSelectMode}
            isSelected={selectedFolderIds?.has(`bookmark-${quiz.quizId}`) || false}
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
  onShowDetails,
  isQuizBookmarked,
  onToggleBookmark,
}: {
  userId: string;
  courseId: string | null;
  onQuizClick: (quizId: string) => void;
  onShowDetails: (quiz: CompletedQuizData) => void;
  isQuizBookmarked: (quizId: string) => boolean;
  onToggleBookmark: (quizId: string) => void;
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

  // 중간대비 퀴즈 로드
  useEffect(() => {
    if (!userId || !courseId) {
      setIsLoading(prev => ({ ...prev, midterm: false }));
      return;
    }

    const q = query(
      collection(db, 'quizzes'),
      where('type', '==', 'midterm'),
      where('courseId', '==', courseId),
      where('completedUsers', 'array-contains', userId)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const quizzes: CompletedQuizData[] = [];
      snapshot.forEach((docSnapshot) => {
        const data = docSnapshot.data();
        quizzes.push({
          id: docSnapshot.id,
          title: data.title || '제목 없음',
          type: data.type || 'midterm',
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
          myScore: data.userScores?.[userId],
        });
      });
      setMidtermQuizzes(quizzes);
      setIsLoading(prev => ({ ...prev, midterm: false }));
    });

    return () => unsubscribe();
  }, [userId, courseId]);

  // 기말대비 퀴즈 로드
  useEffect(() => {
    if (!userId || !courseId) {
      setIsLoading(prev => ({ ...prev, final: false }));
      return;
    }

    const q = query(
      collection(db, 'quizzes'),
      where('type', '==', 'final'),
      where('courseId', '==', courseId),
      where('completedUsers', 'array-contains', userId)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const quizzes: CompletedQuizData[] = [];
      snapshot.forEach((docSnapshot) => {
        const data = docSnapshot.data();
        quizzes.push({
          id: docSnapshot.id,
          title: data.title || '제목 없음',
          type: data.type || 'final',
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
          myScore: data.userScores?.[userId],
        });
      });
      setFinalQuizzes(quizzes);
      setIsLoading(prev => ({ ...prev, final: false }));
    });

    return () => unsubscribe();
  }, [userId, courseId]);

  // 기출 퀴즈 로드
  useEffect(() => {
    if (!userId || !courseId) {
      setIsLoading(prev => ({ ...prev, past: false }));
      return;
    }

    const [yearStr, examType] = selectedPastExam.split('-');
    const year = parseInt(yearStr, 10);

    const q = query(
      collection(db, 'quizzes'),
      where('type', '==', 'past'),
      where('courseId', '==', courseId),
      where('pastYear', '==', year),
      where('pastExamType', '==', examType),
      where('completedUsers', 'array-contains', userId)
    );

    setIsLoading(prev => ({ ...prev, past: true }));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const quizzes: CompletedQuizData[] = [];
      snapshot.forEach((docSnapshot) => {
        const data = docSnapshot.data();
        quizzes.push({
          id: docSnapshot.id,
          title: data.title || '제목 없음',
          type: data.type || 'past',
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
          myScore: data.userScores?.[userId],
        });
      });
      setPastQuizzes(quizzes);
      setIsLoading(prev => ({ ...prev, past: false }));
    });

    return () => unsubscribe();
  }, [userId, courseId, selectedPastExam]);

  // 자작 퀴즈 로드
  useEffect(() => {
    if (!userId) {
      setIsLoading(prev => ({ ...prev, custom: false }));
      return;
    }

    const q = query(
      collection(db, 'quizzes'),
      where('type', '==', 'custom'),
      where('completedUsers', 'array-contains', userId)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const quizzes: CompletedQuizData[] = [];
      snapshot.forEach((docSnapshot) => {
        const data = docSnapshot.data();
        quizzes.push({
          id: docSnapshot.id,
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
          myScore: data.userScores?.[userId],
        });
      });
      setCustomQuizzes(quizzes);
      setIsLoading(prev => ({ ...prev, custom: false }));
    });

    return () => unsubscribe();
  }, [userId]);

  return (
    <div className="flex flex-col">
      {/* 뉴스 캐러셀 (중간/기말/기출) */}
      <section className="mb-8">
        <ReviewNewsCarousel
          midtermQuizzes={midtermQuizzes}
          finalQuizzes={finalQuizzes}
          pastQuiz={pastQuizzes.length > 0 ? pastQuizzes[0] : null}
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
          <h2 className="font-serif-display text-xl font-black text-[#1A1A1A]">자작</h2>
        </div>

        {isLoading.custom && (
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <SkeletonFolderCard key={i} />
            ))}
          </div>
        )}

        {!isLoading.custom && customQuizzes.length === 0 && (
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

        {!isLoading.custom && customQuizzes.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {customQuizzes.map((quiz, index) => (
              <motion.div
                key={quiz.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03 }}
              >
                <CustomReviewQuizCard
                    quiz={quiz}
                    onDetails={() => onShowDetails(quiz)}
                    onReview={() => onQuizClick(quiz.id)}
                    isBookmarked={isQuizBookmarked(quiz.id)}
                    onToggleBookmark={() => onToggleBookmark(quiz.id)}
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

  if (!isOpen) return null;

  const handleCreate = () => {
    if (folderName.trim()) {
      onCreate(folderName.trim());
      setFolderName('');
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-[#F5F0E8] border-2 border-[#1A1A1A] p-4 mx-4 max-w-sm w-full"
      >
        <h3 className="font-bold text-lg text-[#1A1A1A] mb-4">새 폴더 만들기</h3>

        <input
          type="text"
          value={folderName}
          onChange={(e) => setFolderName(e.target.value)}
          placeholder="폴더 이름"
          className="w-full px-3 py-2 border border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A] mb-4 outline-none focus:border-2"
          autoFocus
        />

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!folderName.trim()}
            className="flex-1 py-2 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors disabled:opacity-50"
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
  const { userCourseId } = useCourse();

  // 과목별 리본 이미지 및 스케일 (기본값: biology)
  const currentCourse = userCourseId && COURSES[userCourseId] ? COURSES[userCourseId] : null;
  const ribbonImage = currentCourse?.reviewRibbonImage || '/images/biology-review-ribbon.png';
  const ribbonScale = currentCourse?.reviewRibbonScale || 1;

  // URL 쿼리 파라미터에서 초기 필터값 가져오기
  const initialFilter = (searchParams.get('filter') as ReviewFilter) || 'solved';
  const [activeFilter, setActiveFilter] = useState<ReviewFilter>(initialFilter);
  const [practiceItems, setPracticeItems] = useState<ReviewItem[] | null>(null);
  const [showCreateFolder, setShowCreateFolder] = useState(false);

  // 선택 모드 상태
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(new Set());

  // 폴더 삭제 선택 모드
  const [isFolderDeleteMode, setIsFolderDeleteMode] = useState(false);
  const [deleteFolderIds, setDeleteFolderIds] = useState<Set<string>>(new Set());

  // 빈 폴더 메시지
  const [showEmptyMessage, setShowEmptyMessage] = useState(false);

  // 찜한 퀴즈 상세보기 모달
  const [selectedBookmarkedQuiz, setSelectedBookmarkedQuiz] = useState<BookmarkedQuiz | null>(null);

  // 완료된 퀴즈 상세보기 모달 (문제 탭용)
  const [selectedSolvedQuiz, setSelectedSolvedQuiz] = useState<CompletedQuizData | null>(null);

  // 폴더 정렬(카테고리) 관련 상태
  const [isSortMode, setIsSortMode] = useState(false);
  const [folderCategories, setFolderCategories] = useState<{ id: string; name: string }[]>([]);
  const [folderCategoryMap, setFolderCategoryMap] = useState<Record<string, string>>({});
  const [folderOrderMap, setFolderOrderMap] = useState<Record<string, number>>({}); // 폴더 순서
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isAssignMode, setIsAssignMode] = useState(false);
  const [selectedFolderForAssign, setSelectedFolderForAssign] = useState<string | null>(null);

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
    solvedItems,
    groupedWrongItems,
    groupedSolvedItems,
    chapterGroupedWrongItems,
    quizAttempts,
    customFolders: customFoldersData,
    privateQuizzes,
    updatedQuizzes,
    loading,
    createCustomFolder,
    deleteCustomFolder,
    deleteSolvedQuiz,
    deleteWrongQuiz,
    deleteBookmarkQuiz,
    updateReviewItemsFromQuiz,
    refresh,
  } = useReview();

  // 퀴즈 북마크 훅
  const {
    bookmarkedQuizzes,
    toggleBookmark: toggleQuizBookmark,
    isBookmarked: isQuizBookmarked,
    loading: bookmarkLoading,
  } = useQuizBookmark();

  // 업데이트 확인 모달
  const [updateModalInfo, setUpdateModalInfo] = useState<{
    quizId: string;
    quizTitle: string;
    filterType: string;
  } | null>(null);

  // 푼 문제 (solved 타입의 리뷰)
  const solvedQuizzes = groupedSolvedItems.map(g => ({
    id: g.quizId,
    title: g.quizTitle,
    count: g.items.length,
    type: 'solved' as const,
  }));

  // 커스텀 폴더
  const customFolders = customFoldersData.map(f => ({
    id: f.id,
    title: f.name,
    count: f.questions.length,
    type: 'custom' as const,
  }));

  // 현재 필터에 따른 데이터
  const getCurrentFolders = () => {
    switch (activeFilter) {
      case 'solved':
        return solvedQuizzes.map(f => ({ ...f, filterType: 'solved' as const }));
      case 'wrong':
        return groupedWrongItems.map(g => ({
          id: g.quizId,
          title: g.quizTitle,
          count: g.items.length,
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
  const selectedCount = selectedFolderIds.size;

  // URL 파라미터 변경 시 필터 업데이트
  useEffect(() => {
    const filterParam = searchParams.get('filter') as ReviewFilter;
    if (filterParam && ['solved', 'wrong', 'bookmark', 'custom'].includes(filterParam)) {
      setActiveFilter(filterParam);
    }
  }, [searchParams]);

  // 필터 변경 시 모드는 유지 (복습 선택, 삭제 선택 모두 다른 탭 이동 가능)

  // 선택 모드 종료 시 선택 초기화
  useEffect(() => {
    if (!isSelectMode) {
      setSelectedFolderIds(new Set());
    }
  }, [isSelectMode]);

  const handleFolderClick = (folder: { id: string; title: string; count: number; filterType: string }) => {
    if (isFolderDeleteMode) {
      // 폴더 삭제 선택 모드 - custom, wrong, bookmark 삭제 가능 (solved는 불가)
      if (folder.filterType === 'solved') {
        return; // 푼 문제지는 폴더 단위 삭제 불가
      }
      const newSelected = new Set(deleteFolderIds);
      const folderId = `${folder.filterType}-${folder.id}`;

      if (newSelected.has(folderId)) {
        newSelected.delete(folderId);
      } else {
        newSelected.add(folderId);
      }
      setDeleteFolderIds(newSelected);
    } else if (isSelectMode) {
      // 복습 선택 모드에서는 선택/해제
      const newSelected = new Set(selectedFolderIds);
      const folderId = `${folder.filterType}-${folder.id}`;

      if (newSelected.has(folderId)) {
        newSelected.delete(folderId);
      } else {
        newSelected.add(folderId);
      }
      setSelectedFolderIds(newSelected);
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
      if (folder.filterType === 'solved') {
        await deleteSolvedQuiz(folder.id);
      } else if (folder.filterType === 'custom') {
        await deleteCustomFolder(folder.id);
      }
    } catch (err) {
      console.error('폴더 삭제 실패:', err);
      alert('삭제에 실패했습니다.');
    }
  };

  // Review 버튼 클릭 - 선택 모드 토글
  const handleReviewButtonClick = () => {
    if (isSelectMode) {
      // 선택 모드 종료
      setIsSelectMode(false);
      setSelectedFolderIds(new Set());
    } else {
      // 선택 모드 시작
      setIsSelectMode(true);
      setIsFolderDeleteMode(false);
    }
  };

  // 재생 버튼 클릭 (선택된 폴더로 복습 시작)
  const handlePlayClick = () => {
    if (selectedFolderIds.size === 0) return;

    // 선택된 폴더의 문제들 가져오기 (중복 방지용 Map)
    const itemsMap = new Map<string, ReviewItem>();

    selectedFolderIds.forEach(folderId => {
      // 오답 폴더 (챕터별 구분: wrong-{quizId}-chapter-{chapterId})
      if (folderId.startsWith('wrong-')) {
        const match = folderId.match(/^wrong-(.+)-chapter-(.+)$/);
        if (match) {
          // 챕터별 구분된 키
          const [, quizId, chapterIdStr] = match;
          // 'uncategorized' 문자열은 null로 변환 (chapterGroupedWrongItems에서 미분류는 null)
          const chapterId = chapterIdStr === 'uncategorized' ? null : chapterIdStr;
          const chapterGroup = chapterGroupedWrongItems.find(cg => cg.chapterId === chapterId);
          if (chapterGroup) {
            const folder = chapterGroup.folders.find(f => f.quizId === quizId);
            if (folder) {
              folder.items.forEach(item => {
                const key = `${item.quizId}:${item.questionId}`;
                if (!itemsMap.has(key)) itemsMap.set(key, item);
              });
            }
          }
        } else {
          // 기존 키 형식 (하위 호환)
          const quizId = folderId.replace('wrong-', '');
          const group = groupedWrongItems.find(g => g.quizId === quizId);
          if (group) {
            group.items.forEach(item => {
              const key = `${item.quizId}:${item.questionId}`;
              if (!itemsMap.has(key)) itemsMap.set(key, item);
            });
          }
        }
      } else if (folderId.startsWith('solved-')) {
        const quizId = folderId.replace('solved-', '');
        const group = groupedSolvedItems.find(g => g.quizId === quizId);
        if (group) {
          group.items.forEach(item => {
            const key = `${item.quizId}:${item.questionId}`;
            if (!itemsMap.has(key)) itemsMap.set(key, item);
          });
        }
      } else if (folderId.startsWith('bookmark-')) {
        // 찜한 퀴즈의 문제들 가져오기 (solved에서 해당 퀴즈 문제 가져옴)
        const quizId = folderId.replace('bookmark-', '');
        const group = groupedSolvedItems.find(g => g.quizId === quizId);
        if (group) {
          group.items.forEach(item => {
            const key = `${item.quizId}:${item.questionId}`;
            if (!itemsMap.has(key)) itemsMap.set(key, item);
          });
        }
      }
      // custom 폴더는 별도 페이지에서 처리
    });

    const items = Array.from(itemsMap.values());
    if (items.length > 0) {
      setPracticeItems(items);
      setIsSelectMode(false);
      setSelectedFolderIds(new Set());
    } else {
      // 빈 폴더 임시 메시지 표시
      setShowEmptyMessage(true);
      setTimeout(() => setShowEmptyMessage(false), 500);
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

  // 선택된 폴더들 삭제
  const handleDeleteSelectedFolders = async () => {
    if (deleteFolderIds.size === 0) return;

    const confirmed = window.confirm(`선택한 ${deleteFolderIds.size}개의 폴더를 삭제하시겠습니까?`);
    if (!confirmed) return;

    try {
      for (const folderId of deleteFolderIds) {
        if (folderId.startsWith('custom-')) {
          const id = folderId.replace('custom-', '');
          await deleteCustomFolder(id);
        } else if (folderId.startsWith('wrong-')) {
          const id = folderId.replace('wrong-', '');
          await deleteWrongQuiz(id);
        } else if (folderId.startsWith('bookmark-')) {
          const id = folderId.replace('bookmark-', '');
          await deleteBookmarkQuiz(id);
        }
        // solved는 삭제 선택 불가 (문제지 종류)
      }
      setDeleteFolderIds(new Set());
      setIsFolderDeleteMode(false);
    } catch (err) {
      console.error('폴더 삭제 실패:', err);
      alert('삭제에 실패했습니다.');
    }
  };

  // 퀴즈 ID로 복습 시작 (찜탭, 문제탭에서 Review 버튼 클릭 시)
  const handleStartReviewByQuizId = useCallback((quizId: string) => {
    // solved에서 해당 퀴즈의 문제들 찾기
    const solvedGroup = groupedSolvedItems.find(g => g.quizId === quizId);
    if (solvedGroup && solvedGroup.items.length > 0) {
      setPracticeItems(solvedGroup.items);
    } else {
      // 복습할 문제가 없으면 퀴즈 페이지로 이동
      router.push(`/quiz/${quizId}`);
    }
  }, [groupedSolvedItems, router]);

  const handleEndPractice = useCallback(() => {
    setPracticeItems(null);
  }, []);

  // 연습 모드
  if (practiceItems) {
    return (
      <ReviewPractice
        items={practiceItems}
        onComplete={() => handleEndPractice()}
        onClose={handleEndPractice}
        currentUserId={user?.uid}
      />
    );
  }

  return (
    <div className="min-h-screen pb-28" style={{ backgroundColor: '#F5F0E8' }}>
      {/* 헤더 - 리본 이미지 */}
      <header className="pt-6 pb-4 flex flex-col items-center">
        {/* 리본 이미지 (퀴즈창과 동일) */}
        <div className="relative w-full px-4 h-32 sm:h-44 md:h-56 mb-4">
          <Image
            src={ribbonImage}
            alt="Review"
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 768px) 80vw, 60vw"
            className="object-contain"
            style={{ transform: `scale(${ribbonScale})` }}
            priority
          />
        </div>

        {/* 필터 + 버튼 영역 */}
        <div className="w-full px-4 flex items-center justify-between gap-4">
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
                // 폴더 삭제 모드 버튼들
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
                  {deleteFolderIds.size > 0 && (
                    <motion.button
                      key="delete-confirm"
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.8, opacity: 0 }}
                      onClick={handleDeleteSelectedFolders}
                      className="px-4 py-3 text-sm font-bold bg-[#8B1A1A] text-[#F5F0E8] whitespace-nowrap hover:bg-[#6B1414] transition-colors"
                    >
                      {deleteFolderIds.size}개 삭제
                    </motion.button>
                  )}
                </>
              ) : isSelectMode ? (
                // 복습 선택 모드 버튼들
                <>
                  <motion.button
                    key="cancel-select"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    onClick={handleReviewButtonClick}
                    className="px-4 py-3 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] whitespace-nowrap hover:bg-[#EDEAE4] transition-colors"
                  >
                    취소
                  </motion.button>
                  {selectedCount > 0 && (
                    <motion.button
                      key="play"
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.8, opacity: 0 }}
                      onClick={handlePlayClick}
                      className="px-4 py-3 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] whitespace-nowrap hover:bg-[#3A3A3A] transition-colors flex items-center gap-2"
                    >
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                      <span>{selectedCount}개 시작</span>
                    </motion.button>
                  )}
                </>
              ) : activeFilter === 'bookmark' ? null : (
                // 일반 모드 버튼들 (찜 탭 제외)
                <>
                  {/* 선택 버튼 (폴더 삭제용) */}
                  <motion.button
                    key="select"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    onClick={() => {
                      setIsFolderDeleteMode(true);
                    }}
                    className="px-4 py-3 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] whitespace-nowrap hover:bg-[#EDEAE4] transition-colors"
                  >
                    선택
                  </motion.button>
                  {/* Review 버튼 */}
                  <motion.button
                    key="review"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    onClick={handleReviewButtonClick}
                    className="px-4 py-3 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] whitespace-nowrap hover:bg-[#3A3A3A] transition-colors"
                  >
                    Review
                  </motion.button>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* 선택 모드 안내 */}
        <AnimatePresence>
          {(isSelectMode || isFolderDeleteMode || isAssignMode) && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="w-full px-4 mt-3"
            >
              <div className={`p-2 border border-dashed text-center ${
                isFolderDeleteMode
                  ? 'bg-[#FDEAEA] border-[#8B1A1A]'
                  : isAssignMode
                    ? 'bg-[#E8F5E9] border-[#1A6B1A]'
                    : 'bg-[#EDEAE4] border-[#1A1A1A]'
              }`}>
                <p className={`text-xs ${
                  isFolderDeleteMode
                    ? 'text-[#8B1A1A]'
                    : isAssignMode
                      ? 'text-[#1A6B1A]'
                      : 'text-[#5C5C5C]'
                }`}>
                  {isFolderDeleteMode
                    ? activeFilter === 'solved'
                      ? '문제지 종류는 삭제할 수 없습니다 (다른 탭 선택)'
                      : deleteFolderIds.size > 0
                        ? `${deleteFolderIds.size}개 선택됨 (다른 탭에서도 추가 선택 가능)`
                        : '삭제할 폴더를 선택하세요 (다른 탭에서도 추가 선택 가능)'
                    : isAssignMode
                      ? selectedFolderForAssign
                        ? '카테고리 영역 또는 다른 폴더를 탭하세요'
                        : '이동할 폴더를 선택하세요'
                      : selectedCount > 0
                        ? `${selectedCount}개 선택됨 (다른 탭에서도 추가 선택 가능)`
                        : '복습할 폴더를 선택하세요 (다른 탭에서도 추가 선택 가능)'
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
            </motion.div>
          )}
        </AnimatePresence>

        {/* 내맘대로 탭일 때 폴더 만들기 + 정렬 버튼 */}
        {activeFilter === 'custom' && !isSelectMode && !isAssignMode && !isFolderDeleteMode && (
          <div className="w-full px-4 mt-3 flex gap-2">
            <button
              onClick={() => setShowCreateFolder(true)}
              className="flex-1 py-2 text-sm font-bold border border-dashed border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
            >
              + 새 폴더
            </button>
            <button
              onClick={() => setIsSortMode(true)}
              className="flex-1 py-2 text-sm font-bold border border-dashed border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors flex items-center justify-center gap-1"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              카테고리 설정
            </button>
          </div>
        )}
      </header>

      <main className="px-4">
        {/* 로딩 스켈레톤 */}
        {(loading || (activeFilter === 'bookmark' && bookmarkLoading)) && (
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <SkeletonFolderCard key={i} />
            ))}
          </div>
        )}

        {/* 찜 탭 - 2열 그리드 레이아웃 (자작 탭과 동일) */}
        {!loading && !bookmarkLoading && activeFilter === 'bookmark' && (
          <BookmarkGridView
            bookmarkedQuizzes={bookmarkedQuizzes}
            onQuizDetails={(quiz) => setSelectedBookmarkedQuiz(quiz)}
            onQuizStart={(quizId) => handleStartReviewByQuizId(quizId)}
            onUnbookmark={(quizId) => toggleQuizBookmark(quizId)}
            isSelectMode={isSelectMode}
            selectedFolderIds={selectedFolderIds}
            onSelectToggle={(quizId) => {
              const newSelected = new Set(selectedFolderIds);
              const key = `bookmark-${quizId}`;
              if (newSelected.has(key)) {
                newSelected.delete(key);
              } else {
                newSelected.add(key);
              }
              setSelectedFolderIds(newSelected);
            }}
          />
        )}

        {/* 문제 탭 - 퀴즈 페이지와 동일한 레이아웃 (중간/기말/기출/자작) */}
        {!loading && activeFilter === 'solved' && user && (
          <SolvedQuizLayout
            userId={user.uid}
            courseId={userCourseId}
            onQuizClick={(quizId) => handleStartReviewByQuizId(quizId)}
            onShowDetails={(quiz) => setSelectedSolvedQuiz(quiz)}
            isQuizBookmarked={isQuizBookmarked}
            onToggleBookmark={toggleQuizBookmark}
          />
        )}

        {/* 빈 상태 (찜/문제 탭 제외) - 화면 중앙 배치 */}
        {!loading && activeFilter !== 'bookmark' && activeFilter !== 'solved' && currentFolders.length === 0 && (
          <EmptyState filter={activeFilter} fullHeight />
        )}

        {/* 폴더 그리드 (3열) - 찜/문제 탭 제외 */}
        {!loading && activeFilter !== 'bookmark' && activeFilter !== 'solved' && currentFolders.length > 0 && (
          <>
            {/* 오답 탭에서 챕터별로 그룹화 */}
            {activeFilter === 'wrong' && chapterGroupedWrongItems.length > 0 ? (
              <div className="space-y-4">
                {chapterGroupedWrongItems.map((chapterGroup) => (
                  <div key={chapterGroup.chapterId || 'uncategorized'} className="border-b border-dashed border-[#EDEAE4] pb-3">
                    {/* 챕터 헤더 (내맘대로 스타일) */}
                    <div
                      onClick={() => {
                        if (isSelectMode) {
                          // 해당 챕터의 모든 폴더 키 가져오기 (챕터 ID 포함)
                          const chapterFolderKeys = chapterGroup.folders.map(f =>
                            `wrong-${f.quizId}-chapter-${chapterGroup.chapterId || 'uncategorized'}`
                          );
                          // 모든 폴더가 선택되어 있는지 확인
                          const allSelected = chapterFolderKeys.every(key => selectedFolderIds.has(key));
                          const newSelected = new Set(selectedFolderIds);
                          if (allSelected) {
                            // 모두 선택되어 있으면 모두 해제
                            chapterFolderKeys.forEach(key => newSelected.delete(key));
                          } else {
                            // 하나라도 선택 안되어 있으면 모두 선택
                            chapterFolderKeys.forEach(key => newSelected.add(key));
                          }
                          setSelectedFolderIds(newSelected);
                        }
                      }}
                      className={`flex items-center mb-2 ${
                        isSelectMode ? 'cursor-pointer' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-[60px]">
                        {/* 선택 모드일 때 체크박스 표시 */}
                        {isSelectMode && (() => {
                          const chapterKey = chapterGroup.chapterId || 'uncategorized';
                          const allSelected = chapterGroup.folders.every(f =>
                            selectedFolderIds.has(`wrong-${f.quizId}-chapter-${chapterKey}`)
                          );
                          const someSelected = chapterGroup.folders.some(f =>
                            selectedFolderIds.has(`wrong-${f.quizId}-chapter-${chapterKey}`)
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
                                    count={folder.items.length}
                                    onClick={() => {
                                      if (isSelectMode) {
                                        const newSelected = new Set(selectedFolderIds);
                                        if (newSelected.has(selectKey)) {
                                          newSelected.delete(selectKey);
                                        } else {
                                          newSelected.add(selectKey);
                                        }
                                        setSelectedFolderIds(newSelected);
                                      } else if (isFolderDeleteMode) {
                                        const newDeleted = new Set(deleteFolderIds);
                                        if (newDeleted.has(selectKey)) {
                                          newDeleted.delete(selectKey);
                                        } else {
                                          newDeleted.add(selectKey);
                                        }
                                        setDeleteFolderIds(newDeleted);
                                      } else {
                                        // 챕터별 필터링을 위해 chapterId 쿼리 파라미터 추가
                                        const url = chapterGroup.chapterId
                                          ? `/review/wrong/${folder.quizId}?chapter=${chapterGroup.chapterId}`
                                          : `/review/wrong/${folder.quizId}`;
                                        router.push(url);
                                      }
                                    }}
                                    isSelectMode={isSelectMode || isFolderDeleteMode}
                                    isSelected={
                                      isFolderDeleteMode
                                        ? deleteFolderIds.has(selectKey)
                                        : selectedFolderIds.has(selectKey)
                                    }
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
                                count={folder.items.length}
                                onClick={() => {
                                  if (isSelectMode) {
                                    const newSelected = new Set(selectedFolderIds);
                                    if (newSelected.has(selectKey)) {
                                      newSelected.delete(selectKey);
                                    } else {
                                      newSelected.add(selectKey);
                                    }
                                    setSelectedFolderIds(newSelected);
                                  } else if (isFolderDeleteMode) {
                                    const newDeleted = new Set(deleteFolderIds);
                                    if (newDeleted.has(selectKey)) {
                                      newDeleted.delete(selectKey);
                                    } else {
                                      newDeleted.add(selectKey);
                                    }
                                    setDeleteFolderIds(newDeleted);
                                  } else {
                                    // 챕터별 필터링을 위해 chapterId 쿼리 파라미터 추가
                                    const url = chapterGroup.chapterId
                                      ? `/review/wrong/${folder.quizId}?chapter=${chapterGroup.chapterId}`
                                      : `/review/wrong/${folder.quizId}`;
                                    router.push(url);
                                  }
                                }}
                                isSelectMode={isSelectMode || isFolderDeleteMode}
                                isSelected={
                                  isFolderDeleteMode
                                    ? deleteFolderIds.has(selectKey)
                                    : selectedFolderIds.has(selectKey)
                                }
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
                            if (isSelectMode || isFolderDeleteMode) {
                              // 선택/삭제 모드: 해당 카테고리 폴더 전체 선택/해제
                              const categoryFolderKeys = firstCategoryFolders.map(f => `${f.filterType}-${f.id}`);
                              const allSelected = categoryFolderKeys.length > 0 && categoryFolderKeys.every(key => selectedFolderIds.has(key));
                              const newSelected = new Set(selectedFolderIds);
                              if (allSelected) {
                                categoryFolderKeys.forEach(key => newSelected.delete(key));
                              } else {
                                categoryFolderKeys.forEach(key => newSelected.add(key));
                              }
                              setSelectedFolderIds(newSelected);
                            } else if (isAssignMode && selectedFolderForAssign && folderCategories[0]) {
                              handleAssignFolderToCategory(selectedFolderForAssign, folderCategories[0].id);
                            }
                          }}
                          className={`flex items-center gap-2 py-2 flex-shrink-0 transition-all ${
                            isSelectMode || isFolderDeleteMode
                              ? 'cursor-pointer'
                              : isAssignMode && selectedFolderForAssign
                                ? 'cursor-pointer px-2 -mx-2 border-2 border-dashed border-[#1A6B1A] bg-[#E8F5E9]'
                                : ''
                          }`}
                        >
                          {/* 선택/삭제 모드일 때 체크박스 */}
                          {(isSelectMode || isFolderDeleteMode) && (() => {
                            const categoryFolderKeys = firstCategoryFolders.map(f => `${f.filterType}-${f.id}`);
                            const allSelected = categoryFolderKeys.length > 0 && categoryFolderKeys.every(key => selectedFolderIds.has(key));
                            const someSelected = categoryFolderKeys.some(key => selectedFolderIds.has(key));
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
                          ) : (
                            <div className="grid grid-cols-3 gap-3 pb-2">
                              {firstCategoryFolders.map((folder) => {
                                const canDelete = folder.filterType !== 'solved';
                                const updateKey = `${folder.filterType}-${folder.id}`;
                                const hasUpdate = updatedQuizzes.has(updateKey);
                                return (
                                  <FolderCard
                                    key={updateKey}
                                    title={folder.title}
                                    count={folder.count}
                                    onClick={() => {
                                      if (isAssignMode) {
                                        handleFolderClickInAssignMode(folder.id);
                                      } else {
                                        handleFolderClick(folder);
                                      }
                                    }}
                                    isSelectMode={isSelectMode || (isFolderDeleteMode && canDelete) || isAssignMode}
                                    isSelected={
                                      isAssignMode
                                        ? selectedFolderForAssign === folder.id
                                        : isFolderDeleteMode
                                          ? deleteFolderIds.has(updateKey)
                                          : selectedFolderIds.has(updateKey)
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
                              if (isSelectMode) {
                                // 선택 모드: 미분류 폴더 전체 선택/해제
                                const uncategorizedKeys = sortedUncategorized.map(f => `${f.filterType}-${f.id}`);
                                const allSelected = uncategorizedKeys.length > 0 && uncategorizedKeys.every(key => selectedFolderIds.has(key));
                                const newSelected = new Set(selectedFolderIds);
                                if (allSelected) {
                                  uncategorizedKeys.forEach(key => newSelected.delete(key));
                                } else {
                                  uncategorizedKeys.forEach(key => newSelected.add(key));
                                }
                                setSelectedFolderIds(newSelected);
                              } else if (isAssignMode && selectedFolderForAssign) {
                                handleAssignFolderToCategory(selectedFolderForAssign, null);
                              }
                            }}
                            className={`flex items-center gap-2 py-2 flex-shrink-0 transition-all ${
                              isSelectMode
                                ? 'cursor-pointer'
                                : isAssignMode && selectedFolderForAssign
                                  ? 'cursor-pointer px-2 -mx-2 border-2 border-dashed border-[#1A6B1A] bg-[#E8F5E9]'
                                  : ''
                            }`}
                          >
                            {/* 선택 모드일 때 체크박스 */}
                            {isSelectMode && (() => {
                              const uncategorizedKeys = sortedUncategorized.map(f => `${f.filterType}-${f.id}`);
                              const allSelected = uncategorizedKeys.length > 0 && uncategorizedKeys.every(key => selectedFolderIds.has(key));
                              const someSelected = uncategorizedKeys.some(key => selectedFolderIds.has(key));
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
                            <div className="grid grid-cols-3 gap-3 pb-2">
                              {sortedUncategorized.map((folder) => {
                                const canDelete = folder.filterType !== 'solved';
                                const updateKey = `${folder.filterType}-${folder.id}`;
                                const hasUpdate = updatedQuizzes.has(updateKey);
                                return (
                                  <FolderCard
                                    key={updateKey}
                                    title={folder.title}
                                    count={folder.count}
                                    onClick={() => {
                                      if (isAssignMode) {
                                        handleFolderClickInAssignMode(folder.id);
                                      } else {
                                        handleFolderClick(folder);
                                      }
                                    }}
                                    isSelectMode={isSelectMode || (isFolderDeleteMode && canDelete) || isAssignMode}
                                    isSelected={
                                      isAssignMode
                                        ? selectedFolderForAssign === folder.id
                                        : isFolderDeleteMode
                                          ? deleteFolderIds.has(updateKey)
                                          : selectedFolderIds.has(updateKey)
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
                              if (isSelectMode || isFolderDeleteMode) {
                                // 선택/삭제 모드: 카테고리 내 모든 폴더 선택/해제
                                const categoryFolderKeys = categoryFolders.map(f => `${f.filterType}-${f.id}`);
                                const allSelected = categoryFolderKeys.every(key => selectedFolderIds.has(key));
                                const newSelected = new Set(selectedFolderIds);
                                if (allSelected) {
                                  categoryFolderKeys.forEach(key => newSelected.delete(key));
                                } else {
                                  categoryFolderKeys.forEach(key => newSelected.add(key));
                                }
                                setSelectedFolderIds(newSelected);
                              } else if (isAssignMode && selectedFolderForAssign) {
                                handleAssignFolderToCategory(selectedFolderForAssign, cat.id);
                              }
                            }}
                            className={`flex items-center mb-2 transition-all ${
                              isSelectMode || isFolderDeleteMode
                                ? 'cursor-pointer'
                                : isAssignMode && selectedFolderForAssign
                                  ? 'cursor-pointer p-2 -mx-2 border-2 border-dashed border-[#1A6B1A] bg-[#E8F5E9]'
                                  : ''
                            }`}
                          >
                            {/* 선택/삭제 모드일 때 체크박스 */}
                            {(isSelectMode || isFolderDeleteMode) && (() => {
                              const categoryFolderKeys = categoryFolders.map(f => `${f.filterType}-${f.id}`);
                              const allSelected = categoryFolderKeys.length > 0 && categoryFolderKeys.every(key => selectedFolderIds.has(key));
                              const someSelected = categoryFolderKeys.some(key => selectedFolderIds.has(key));
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

                          {/* 폴더들 - 4개 이상이면 가로 스크롤 */}
                          {categoryFolders.length === 0 ? (
                            // 빈 카테고리
                            <div className="py-4 text-center text-[#5C5C5C] text-sm border border-dashed border-[#EDEAE4]">
                              폴더가 없습니다
                            </div>
                          ) : categoryFolders.length >= 4 ? (
                            // 4개 이상: 가로 스크롤
                            <div className="overflow-x-auto pb-2 -mx-4 px-4">
                              <div className="flex gap-3" style={{ minWidth: 'min-content' }}>
                                {categoryFolders.map((folder) => {
                                  const canDelete = folder.filterType !== 'solved';
                                  const updateKey = `${folder.filterType}-${folder.id}`;
                                  const hasUpdate = updatedQuizzes.has(updateKey);
                                  return (
                                    <div key={updateKey} className="w-[100px] flex-shrink-0">
                                      <FolderCard
                                        title={folder.title}
                                        count={folder.count}
                                        onClick={() => {
                                          if (isAssignMode) {
                                            handleFolderClickInAssignMode(folder.id);
                                          } else {
                                            handleFolderClick(folder);
                                          }
                                        }}
                                        isSelectMode={isSelectMode || (isFolderDeleteMode && canDelete) || isAssignMode}
                                        isSelected={
                                          isAssignMode
                                            ? selectedFolderForAssign === folder.id
                                            : isFolderDeleteMode
                                              ? deleteFolderIds.has(updateKey)
                                              : selectedFolderIds.has(updateKey)
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
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ) : (
                            // 3개 이하: 일반 그리드
                            <div className="grid grid-cols-3 gap-3">
                              {categoryFolders.map((folder) => {
                                const canDelete = folder.filterType !== 'solved';
                                const updateKey = `${folder.filterType}-${folder.id}`;
                                const hasUpdate = updatedQuizzes.has(updateKey);
                                return (
                                  <FolderCard
                                    key={updateKey}
                                    title={folder.title}
                                    count={folder.count}
                                    onClick={() => {
                                      if (isAssignMode) {
                                        handleFolderClickInAssignMode(folder.id);
                                      } else {
                                        handleFolderClick(folder);
                                      }
                                    }}
                                    isSelectMode={isSelectMode || (isFolderDeleteMode && canDelete) || isAssignMode}
                                    isSelected={
                                      isAssignMode
                                        ? selectedFolderForAssign === folder.id
                                        : isFolderDeleteMode
                                          ? deleteFolderIds.has(updateKey)
                                          : selectedFolderIds.has(updateKey)
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
                            if (isSelectMode) {
                              // 선택 모드: 미분류 폴더 전체 선택/해제
                              const uncategorizedFolderKeys = sortedUncategorizedForMany.map(f => `${f.filterType}-${f.id}`);
                              const allSelected = uncategorizedFolderKeys.every(key => selectedFolderIds.has(key));
                              const newSelected = new Set(selectedFolderIds);
                              if (allSelected) {
                                uncategorizedFolderKeys.forEach(key => newSelected.delete(key));
                              } else {
                                uncategorizedFolderKeys.forEach(key => newSelected.add(key));
                              }
                              setSelectedFolderIds(newSelected);
                            } else if (isAssignMode && selectedFolderForAssign) {
                              handleAssignFolderToCategory(selectedFolderForAssign, null);
                            }
                          }}
                          className={`flex items-center mb-2 transition-all ${
                            isSelectMode
                              ? 'cursor-pointer'
                              : isAssignMode && selectedFolderForAssign
                                ? 'cursor-pointer p-2 -mx-2 border-2 border-dashed border-[#1A6B1A] bg-[#E8F5E9]'
                                : ''
                          }`}
                        >
                          {/* 선택 모드일 때 체크박스 */}
                          {isSelectMode && (() => {
                            const uncategorizedFolderKeys = sortedUncategorizedForMany.map(f => `${f.filterType}-${f.id}`);
                            const allSelected = uncategorizedFolderKeys.length > 0 && uncategorizedFolderKeys.every(key => selectedFolderIds.has(key));
                            const someSelected = uncategorizedFolderKeys.some(key => selectedFolderIds.has(key));
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
                        // 4개 이상: 가로 스크롤
                        <div className="overflow-x-auto pb-2 -mx-4 px-4">
                          <div className="flex gap-3" style={{ minWidth: 'min-content' }}>
                            {sortedUncategorizedForMany.map((folder) => {
                              const canDelete = folder.filterType !== 'solved';
                              const updateKey = `${folder.filterType}-${folder.id}`;
                              const hasUpdate = updatedQuizzes.has(updateKey);
                              return (
                                <div key={updateKey} className="w-[100px] flex-shrink-0">
                                  <FolderCard
                                    title={folder.title}
                                    count={folder.count}
                                    onClick={() => {
                                      if (isAssignMode) {
                                        handleFolderClickInAssignMode(folder.id);
                                      } else {
                                        handleFolderClick(folder);
                                      }
                                    }}
                                    isSelectMode={isSelectMode || (isFolderDeleteMode && canDelete) || isAssignMode}
                                    isSelected={
                                      isAssignMode
                                        ? selectedFolderForAssign === folder.id
                                        : isFolderDeleteMode
                                          ? deleteFolderIds.has(updateKey)
                                          : selectedFolderIds.has(updateKey)
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
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        // 3개 이하: 일반 그리드
                        <div className="grid grid-cols-3 gap-3">
                          {sortedUncategorizedForMany.map((folder) => {
                            const canDelete = folder.filterType !== 'solved';
                            const updateKey = `${folder.filterType}-${folder.id}`;
                            const hasUpdate = updatedQuizzes.has(updateKey);
                            return (
                              <FolderCard
                                key={updateKey}
                                title={folder.title}
                                count={folder.count}
                                onClick={() => {
                                  if (isAssignMode) {
                                    handleFolderClickInAssignMode(folder.id);
                                  } else {
                                    handleFolderClick(folder);
                                  }
                                }}
                                isSelectMode={isSelectMode || (isFolderDeleteMode && canDelete) || isAssignMode}
                                isSelected={
                                  isAssignMode
                                    ? selectedFolderForAssign === folder.id
                                    : isFolderDeleteMode
                                      ? deleteFolderIds.has(updateKey)
                                      : selectedFolderIds.has(updateKey)
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
              <div className="grid grid-cols-3 gap-3">
                {currentFolders.map((folder) => {
                  const canDelete = folder.filterType !== 'solved';
                  const updateKey = `${folder.filterType}-${folder.id}`;
                  const hasUpdate = updatedQuizzes.has(updateKey);
                  // 푼 문제(solved)는 퀴즈 카드 스타일로, 나머지는 폴더 스타일
                  const variant = folder.filterType === 'solved' ? 'quiz' : 'folder';
                  return (
                    <FolderCard
                      key={updateKey}
                      title={folder.title}
                      count={folder.count}
                      onClick={() => handleFolderClick(folder)}
                      isSelectMode={isSelectMode || (isFolderDeleteMode && canDelete)}
                      isSelected={
                        isFolderDeleteMode
                          ? deleteFolderIds.has(updateKey)
                          : selectedFolderIds.has(updateKey)
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
                      variant={variant}
                    />
                  );
                })}
              </div>
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
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => setSelectedBookmarkedQuiz(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-[#F5F0E8] border-2 border-[#1A1A1A] p-6"
          >
            <h2 className="font-serif-display text-lg font-bold text-[#1A1A1A] mb-4">
              {selectedBookmarkedQuiz.title}
            </h2>

            <div className="space-y-2 mb-6">
              <div className="flex justify-between text-sm">
                <span className="text-[#5C5C5C]">문제 수</span>
                <span className="font-bold text-[#1A1A1A]">{selectedBookmarkedQuiz.questionCount}문제</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#5C5C5C]">참여자</span>
                <span className="font-bold text-[#1A1A1A]">{selectedBookmarkedQuiz.participantCount}명</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#5C5C5C]">난이도</span>
                <span className="font-bold text-[#1A1A1A]">
                  {selectedBookmarkedQuiz.difficulty === 'easy' ? '쉬움' : selectedBookmarkedQuiz.difficulty === 'hard' ? '어려움' : '보통'}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#5C5C5C]">문제 유형</span>
                <span className="font-bold text-[#1A1A1A]">
                  {formatQuestionTypes(
                    selectedBookmarkedQuiz.oxCount || 0,
                    selectedBookmarkedQuiz.multipleChoiceCount || 0,
                    selectedBookmarkedQuiz.subjectiveCount || 0
                  )}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#5C5C5C]">제작자</span>
                <span className="font-bold text-[#1A1A1A]">
                  {selectedBookmarkedQuiz.creatorNickname || '익명'}
                </span>
              </div>
              {selectedBookmarkedQuiz.myScore !== undefined && (
                <div className="flex justify-between text-sm pt-2 border-t border-[#EDEAE4]">
                  <span className="text-[#5C5C5C]">처음 푼 점수</span>
                  <span className="font-bold text-[#1A6B1A]">{selectedBookmarkedQuiz.myScore}점</span>
                </div>
              )}
              {selectedBookmarkedQuiz.tags && selectedBookmarkedQuiz.tags.length > 0 && (
                <div className={`pt-2 ${selectedBookmarkedQuiz.myScore === undefined ? 'border-t border-[#EDEAE4]' : ''}`}>
                  <div className="flex flex-wrap gap-1">
                    {selectedBookmarkedQuiz.tags.map((tag) => (
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

            <div className="flex gap-3">
              <button
                onClick={() => setSelectedBookmarkedQuiz(null)}
                className="flex-1 py-3 font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors"
              >
                닫기
              </button>
              <button
                onClick={() => {
                  router.push(`/quiz/${selectedBookmarkedQuiz.quizId}`);
                  setSelectedBookmarkedQuiz(null);
                }}
                className="flex-1 py-3 font-bold bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors"
              >
                Review
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* 완료된 퀴즈 상세보기 모달 (문제 탭용) */}
      {selectedSolvedQuiz && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => setSelectedSolvedQuiz(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-[#F5F0E8] border-2 border-[#1A1A1A] p-6"
          >
            <h2 className="font-serif-display text-lg font-bold text-[#1A1A1A] mb-4">
              {selectedSolvedQuiz.title}
            </h2>

            <div className="space-y-2 mb-6">
              <div className="flex justify-between text-sm">
                <span className="text-[#5C5C5C]">문제 수</span>
                <span className="font-bold text-[#1A1A1A]">{selectedSolvedQuiz.questionCount}문제</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#5C5C5C]">참여자</span>
                <span className="font-bold text-[#1A1A1A]">{selectedSolvedQuiz.participantCount}명</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#5C5C5C]">난이도</span>
                <span className="font-bold text-[#1A1A1A]">
                  {selectedSolvedQuiz.difficulty === 'easy' ? '쉬움' : selectedSolvedQuiz.difficulty === 'hard' ? '어려움' : '보통'}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#5C5C5C]">문제 유형</span>
                <span className="font-bold text-[#1A1A1A]">
                  {formatQuestionTypes(
                    selectedSolvedQuiz.oxCount || 0,
                    selectedSolvedQuiz.multipleChoiceCount || 0,
                    selectedSolvedQuiz.subjectiveCount || 0
                  )}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#5C5C5C]">제작자</span>
                <span className="font-bold text-[#1A1A1A]">
                  {selectedSolvedQuiz.creatorNickname || '익명'}
                </span>
              </div>
              {selectedSolvedQuiz.myScore !== undefined && (
                <div className="flex justify-between text-sm pt-2 border-t border-[#EDEAE4]">
                  <span className="text-[#5C5C5C]">처음 푼 점수</span>
                  <span className="font-bold text-[#1A6B1A]">{selectedSolvedQuiz.myScore}점</span>
                </div>
              )}
              {selectedSolvedQuiz.tags && selectedSolvedQuiz.tags.length > 0 && (
                <div className={`pt-2 ${selectedSolvedQuiz.myScore === undefined ? 'border-t border-[#EDEAE4]' : ''}`}>
                  <div className="flex flex-wrap gap-1">
                    {selectedSolvedQuiz.tags.map((tag) => (
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

            <div className="flex gap-3">
              <button
                onClick={() => setSelectedSolvedQuiz(null)}
                className="flex-1 py-3 font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors"
              >
                닫기
              </button>
              <button
                onClick={() => {
                  router.push(`/quiz/${selectedSolvedQuiz.id}`);
                  setSelectedSolvedQuiz(null);
                }}
                className="flex-1 py-3 font-bold bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors"
              >
                Review
              </button>
            </div>
          </motion.div>
        </div>
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
      <AnimatePresence>
        {updateModalInfo && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={() => setUpdateModalInfo(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-[#F5F0E8] border-2 border-[#1A1A1A] p-4 max-w-sm w-full"
            >
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 bg-[#F5C518] rounded-full flex items-center justify-center border-2 border-[#1A1A1A]">
                  <span className="text-[#1A1A1A] font-bold text-xs">!</span>
                </div>
                <h3 className="font-bold text-lg text-[#1A1A1A]">문제가 수정됨</h3>
              </div>

              <p className="text-sm text-[#5C5C5C] mb-2">
                <span className="font-bold text-[#1A1A1A]">{updateModalInfo.quizTitle}</span>
              </p>
              <p className="text-sm text-[#5C5C5C] mb-4">
                이 퀴즈의 문제가 수정되었습니다.
                수정된 문제 내용으로 업데이트하시겠습니까?
              </p>
              <p className="text-xs text-[#1A6B1A] mb-4">
                * 기존에 저장된 내 답과 복습 기록은 유지됩니다.
              </p>

              <div className="flex gap-2">
                <button
                  onClick={() => setUpdateModalInfo(null)}
                  className="flex-1 py-2 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
                >
                  나중에
                </button>
                <button
                  onClick={async () => {
                    try {
                      await updateReviewItemsFromQuiz(updateModalInfo.quizId);
                      setUpdateModalInfo(null);
                      alert('문제가 업데이트되었습니다.');
                    } catch (err) {
                      alert('업데이트에 실패했습니다.');
                    }
                  }}
                  className="flex-1 py-2 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors"
                >
                  업데이트
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 폴더 카테고리 설정 모달 */}
      <AnimatePresence>
        {isSortMode && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
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
              className="relative bg-[#F5F0E8] border-2 border-[#1A1A1A] w-full max-w-sm max-h-[80vh] overflow-y-auto"
            >
              {/* 헤더 */}
              <div className="flex items-center justify-between p-4 border-b-2 border-[#1A1A1A]">
                <h3 className="font-bold text-lg text-[#1A1A1A]">카테고리 설정</h3>
                <button
                  onClick={() => {
                    setIsSortMode(false);
                    setNewCategoryName('');
                  }}
                  className="w-8 h-8 flex items-center justify-center text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* 본문 */}
              <div className="p-4 space-y-4">
                {/* 카테고리 추가 */}
                <div>
                  <label className="block text-sm font-bold text-[#1A1A1A] mb-2">새 카테고리 추가</label>
                  {folderCategories.length >= 8 ? (
                    <div className="p-3 border-2 border-dashed border-[#5C5C5C] bg-[#EDEAE4] text-center">
                      <p className="text-sm text-[#5C5C5C]">카테고리는 최대 8개까지 추가할 수 있습니다.</p>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        placeholder="카테고리 이름 입력"
                        className="flex-1 px-3 py-2 border-2 border-[#1A1A1A] bg-[#F5F0E8] text-sm focus:outline-none"
                        maxLength={20}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && newCategoryName.trim()) {
                            handleAddFolderCategory();
                          }
                        }}
                      />
                      <button
                        onClick={handleAddFolderCategory}
                        disabled={!newCategoryName.trim()}
                        className="px-4 py-2 bg-[#1A1A1A] text-[#F5F0E8] font-bold text-sm disabled:opacity-30"
                      >
                        추가
                      </button>
                    </div>
                  )}
                </div>

                {/* 현재 카테고리 목록 */}
                <div>
                  <label className="block text-sm font-bold text-[#1A1A1A] mb-2">
                    현재 카테고리 ({folderCategories.length}/8개)
                  </label>
                  {folderCategories.length === 0 ? (
                    <p className="text-xs text-[#5C5C5C] py-4 text-center border border-dashed border-[#5C5C5C]">
                      아직 카테고리가 없습니다. 위에서 추가해주세요.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {folderCategories.map((cat) => {
                        const folderCount = Object.values(folderCategoryMap).filter(
                          (catId) => catId === cat.id
                        ).length;

                        return (
                          <div
                            key={cat.id}
                            className="flex items-center justify-between p-3 border-2 border-[#1A1A1A] bg-[#EDEAE4]"
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-sm text-[#1A1A1A]">{cat.name}</span>
                              <span className="text-xs text-[#5C5C5C]">({folderCount}개)</span>
                            </div>
                            <button
                              onClick={() => handleRemoveFolderCategory(cat.id)}
                              className="px-2 py-1 text-xs font-bold text-[#8B1A1A] border border-[#8B1A1A] hover:bg-[#FDEAEA] transition-colors"
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
                  <div className="pt-3 border-t-2 border-[#EDEAE4]">
                    <button
                      onClick={() => {
                        setIsSortMode(false);
                        setIsAssignMode(true);
                      }}
                      className="w-full py-3 font-bold text-sm bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#3A3A3A] transition-colors"
                    >
                      폴더 배정하기
                    </button>
                    <p className="text-xs text-[#5C5C5C] text-center mt-2">
                      폴더를 선택 → 원하는 카테고리 헤더를 탭하세요
                    </p>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
