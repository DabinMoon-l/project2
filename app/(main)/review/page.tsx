'use client';

import { useState, useCallback, useEffect, Suspense, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { Skeleton } from '@/components/common';
import ReviewPractice from '@/components/review/ReviewPractice';
import { useReview, type ReviewItem, type GroupedReviewItems, type QuizUpdateInfo } from '@/lib/hooks/useReview';
import { useQuizBookmark, type BookmarkedQuiz } from '@/lib/hooks/useQuizBookmark';
import { useCourse } from '@/lib/contexts';
import { COURSES } from '@/lib/types/course';

/** 필터 타입 */
type ReviewFilter = 'solved' | 'wrong' | 'bookmark' | 'custom';

/** 필터 옵션 */
const FILTER_OPTIONS: { value: ReviewFilter; line1: string; line2?: string }[] = [
  { value: 'solved', line1: '푼 문제' },
  { value: 'wrong', line1: '틀린', line2: '문제' },
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
          className={`relative z-10 w-1/4 px-3 py-2 text-xs font-bold transition-colors text-center flex flex-col items-center justify-center ${
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

/**
 * 스켈레톤 폴더 카드
 */
function SkeletonFolderCard() {
  return (
    <div className="border border-[#1A1A1A] bg-[#F5F0E8] p-3">
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
    solved: { title: '풀었던 퀴즈가 없습니다', desc: '퀴즈를 풀면 여기에 저장됩니다.' },
    wrong: { title: '틀린 문제가 없습니다', desc: '퀴즈를 풀면 틀린 문제가 자동으로 저장됩니다.' },
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
 * 찜 탭 1:1 분할 뷰 컴포넌트
 */
function BookmarkSplitView({
  bookmarkedQuizzes,
  groupedBookmarkedItems,
  updatedQuizzes,
  isSelectMode,
  selectedFolderIds,
  onQuizClick,
  onUnbookmark,
  onFolderClick,
  onUpdateClick,
}: {
  bookmarkedQuizzes: BookmarkedQuiz[];
  groupedBookmarkedItems: GroupedReviewItems[];
  updatedQuizzes: Map<string, QuizUpdateInfo>;
  isSelectMode: boolean;
  selectedFolderIds: Set<string>;
  onQuizClick: (quizId: string) => void;
  onUnbookmark: (quizId: string) => void;
  onFolderClick: (group: GroupedReviewItems) => void;
  onUpdateClick: (group: GroupedReviewItems) => void;
}) {
  const quizScrollRef = useRef<HTMLDivElement>(null);
  const questionScrollRef = useRef<HTMLDivElement>(null);

  return (
    <div
      className="flex flex-col"
      style={{ height: 'calc(100vh - 340px - 100px)' }} // 헤더(~340px) + 네비게이션(~100px) 제외
    >
      {/* 상단: 찜한 문제지 (50%) */}
      <section className="flex-1 flex flex-col min-h-0 border-b border-[#D4CFC4]">
        <div className="flex items-center gap-2 py-2 flex-shrink-0">
          <h3 className="font-serif-display font-bold text-sm text-[#1A1A1A]">찜한 문제지</h3>
          <span className="text-xs text-[#5C5C5C]">({bookmarkedQuizzes.length})</span>
        </div>

        <div
          ref={quizScrollRef}
          className="flex-1 overflow-y-auto min-h-0"
        >
          {bookmarkedQuizzes.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <p className="text-sm text-[#5C5C5C]">찜한 퀴즈가 없습니다</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3 pb-2">
              {bookmarkedQuizzes.map((quiz) => (
                <BookmarkedQuizCard
                  key={quiz.id}
                  quiz={quiz}
                  onClick={() => onQuizClick(quiz.quizId)}
                  onUnbookmark={() => onUnbookmark(quiz.quizId)}
                />
              ))}
            </div>
          )}
        </div>

        <ScrollIndicator
          containerRef={quizScrollRef}
          itemCount={bookmarkedQuizzes.length}
        />
      </section>

      {/* 하단: 찜한 문제 (50%) */}
      <section className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center gap-2 py-2 flex-shrink-0">
          <h3 className="font-serif-display font-bold text-sm text-[#1A1A1A]">찜한 문제</h3>
          <span className="text-xs text-[#5C5C5C]">({groupedBookmarkedItems.length})</span>
        </div>

        <div
          ref={questionScrollRef}
          className="flex-1 overflow-y-auto min-h-0"
        >
          {groupedBookmarkedItems.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <p className="text-sm text-[#5C5C5C]">찜한 문제가 없습니다</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3 pb-2">
              {groupedBookmarkedItems.map((group) => {
                const updateKey = `bookmark-${group.quizId}`;
                const hasUpdate = updatedQuizzes.has(updateKey);
                return (
                  <FolderCard
                    key={updateKey}
                    title={group.quizTitle}
                    count={group.items.length}
                    onClick={() => onFolderClick(group)}
                    isSelectMode={isSelectMode}
                    isSelected={selectedFolderIds.has(updateKey)}
                    showDelete={false}
                    hasUpdate={hasUpdate}
                    onUpdateClick={() => onUpdateClick(group)}
                  />
                );
              })}
            </div>
          )}
        </div>

        <ScrollIndicator
          containerRef={questionScrollRef}
          itemCount={groupedBookmarkedItems.length}
        />
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

  const {
    wrongItems,
    bookmarkedItems,
    solvedItems,
    groupedWrongItems,
    groupedBookmarkedItems,
    groupedSolvedItems,
    quizAttempts,
    customFolders: customFoldersData,
    updatedQuizzes,
    loading,
    createCustomFolder,
    deleteCustomFolder,
    deleteSolvedQuiz,
    updateReviewItemsFromQuiz,
    refresh,
  } = useReview();

  // 퀴즈 북마크 훅
  const {
    bookmarkedQuizzes,
    toggleBookmark: toggleQuizBookmark,
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
        return groupedBookmarkedItems.map(g => ({
          id: g.quizId,
          title: g.quizTitle,
          count: g.items.length,
          filterType: 'bookmark' as const,
        }));
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

  // 필터 변경 시 삭제 모드만 초기화 (복습 선택은 유지하여 다른 필터 폴더도 선택 가능)
  useEffect(() => {
    setDeleteFolderIds(new Set());
    setIsFolderDeleteMode(false);
  }, [activeFilter]);

  // 선택 모드 종료 시 선택 초기화
  useEffect(() => {
    if (!isSelectMode) {
      setSelectedFolderIds(new Set());
    }
  }, [isSelectMode]);

  const handleFolderClick = (folder: { id: string; title: string; count: number; filterType: string }) => {
    if (isFolderDeleteMode) {
      // 폴더 삭제 선택 모드 - custom과 solved만 삭제 가능
      if (folder.filterType !== 'custom' && folder.filterType !== 'solved') {
        return; // wrong, bookmark은 폴더 단위 삭제 불가
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

  // 복습하기 버튼 클릭 - 선택 모드 토글
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

    // 선택된 폴더의 문제들 가져오기
    let items: ReviewItem[] = [];

    selectedFolderIds.forEach(folderId => {
      if (folderId.startsWith('wrong-')) {
        const quizId = folderId.replace('wrong-', '');
        const group = groupedWrongItems.find(g => g.quizId === quizId);
        if (group) items = [...items, ...group.items];
      } else if (folderId.startsWith('bookmark-')) {
        const quizId = folderId.replace('bookmark-', '');
        const group = groupedBookmarkedItems.find(g => g.quizId === quizId);
        if (group) items = [...items, ...group.items];
      } else if (folderId.startsWith('solved-')) {
        const quizId = folderId.replace('solved-', '');
        const group = groupedSolvedItems.find(g => g.quizId === quizId);
        if (group) items = [...items, ...group.items];
      }
      // custom 폴더는 별도 페이지에서 처리
    });

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
        } else if (folderId.startsWith('solved-')) {
          const id = folderId.replace('solved-', '');
          await deleteSolvedQuiz(id);
        }
        // wrong, bookmark는 개별 폴더 삭제 없음 (문제 단위로만)
      }
      setDeleteFolderIds(new Set());
      setIsFolderDeleteMode(false);
    } catch (err) {
      console.error('폴더 삭제 실패:', err);
      alert('삭제에 실패했습니다.');
    }
  };

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
              ) : (
                // 일반 모드 버튼들
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
                  {/* 복습하기 버튼 */}
                  <motion.button
                    key="review"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    onClick={handleReviewButtonClick}
                    className="px-4 py-3 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] whitespace-nowrap hover:bg-[#3A3A3A] transition-colors"
                  >
                    복습하기
                  </motion.button>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* 선택 모드 안내 */}
        <AnimatePresence>
          {(isSelectMode || isFolderDeleteMode) && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="w-full px-4 mt-3"
            >
              <div className={`p-2 border border-dashed text-center ${
                isFolderDeleteMode
                  ? 'bg-[#FDEAEA] border-[#8B1A1A]'
                  : 'bg-[#EDEAE4] border-[#1A1A1A]'
              }`}>
                <p className={`text-xs ${isFolderDeleteMode ? 'text-[#8B1A1A]' : 'text-[#5C5C5C]'}`}>
                  {isFolderDeleteMode
                    ? (activeFilter === 'wrong' || activeFilter === 'bookmark')
                      ? '틀린 문제/찜한 문제는 폴더 안에서 개별 삭제하세요'
                      : '삭제할 폴더를 선택하세요'
                    : selectedCount > 0
                      ? `${selectedCount}개 선택됨 (다른 탭에서도 추가 선택 가능)`
                      : '복습할 폴더를 선택하세요 (다른 탭에서도 추가 선택 가능)'
                  }
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 내맘대로 탭일 때 폴더 만들기 버튼 */}
        {activeFilter === 'custom' && !isSelectMode && (
          <div className="w-full px-4 mt-3">
            <button
              onClick={() => setShowCreateFolder(true)}
              className="w-full py-2 text-sm font-bold border border-dashed border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
            >
              + 새 폴더 만들기
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

        {/* 찜 탭 - 상단/하단 1:1 고정 분할 */}
        {!loading && !bookmarkLoading && activeFilter === 'bookmark' && (
          <BookmarkSplitView
            bookmarkedQuizzes={bookmarkedQuizzes}
            groupedBookmarkedItems={groupedBookmarkedItems}
            updatedQuizzes={updatedQuizzes}
            isSelectMode={isSelectMode}
            selectedFolderIds={selectedFolderIds}
            onQuizClick={(quizId) => router.push(`/quiz/${quizId}`)}
            onUnbookmark={(quizId) => toggleQuizBookmark(quizId)}
            onFolderClick={(group) => handleFolderClick({ id: group.quizId, title: group.quizTitle, count: group.items.length, filterType: 'bookmark' })}
            onUpdateClick={(group) => {
              setUpdateModalInfo({
                quizId: group.quizId,
                quizTitle: group.quizTitle,
                filterType: 'bookmark',
              });
            }}
          />
        )}

        {/* 빈 상태 (찜 탭 제외) - 화면 중앙 배치 */}
        {!loading && activeFilter !== 'bookmark' && currentFolders.length === 0 && (
          <EmptyState filter={activeFilter} fullHeight />
        )}

        {/* 폴더 그리드 (3열) - 찜 탭 제외 */}
        {!loading && activeFilter !== 'bookmark' && currentFolders.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            {currentFolders.map((folder) => {
              const canDelete = folder.filterType === 'custom' || folder.filterType === 'solved';
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
      </main>

      {/* 새 폴더 생성 모달 */}
      <CreateFolderModal
        isOpen={showCreateFolder}
        onClose={() => setShowCreateFolder(false)}
        onCreate={handleCreateFolder}
      />

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
