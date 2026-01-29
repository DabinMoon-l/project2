'use client';

import { useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Skeleton } from '@/components/common';
import QuizListItem from './QuizListItem';
import type { ProfessorQuiz, QuizFilterOptions, TargetClass } from '@/lib/hooks/useProfessorQuiz';

// ============================================================
// 타입 정의
// ============================================================

interface QuizListProps {
  /** 퀴즈 목록 */
  quizzes: ProfessorQuiz[];
  /** 로딩 상태 */
  loading: boolean;
  /** 더 불러오기 로딩 상태 */
  loadingMore: boolean;
  /** 더 불러올 데이터 있는지 */
  hasMore: boolean;
  /** 현재 필터 */
  filter: QuizFilterOptions;
  /** 필터 변경 시 콜백 */
  onFilterChange: (filter: QuizFilterOptions) => void;
  /** 더 불러오기 함수 */
  onLoadMore: () => void;
  /** 퀴즈 클릭 시 콜백 */
  onQuizClick: (quiz: ProfessorQuiz) => void;
  /** 퀴즈 수정 시 콜백 */
  onQuizEdit: (quiz: ProfessorQuiz) => void;
  /** 퀴즈 삭제 시 콜백 */
  onQuizDelete: (quiz: ProfessorQuiz) => void;
  /** 퀴즈 공개 상태 토글 시 콜백 */
  onQuizTogglePublish: (quiz: ProfessorQuiz) => void;
  /** 추가 클래스명 */
  className?: string;
}

// ============================================================
// 상수
// ============================================================

/** 공개 상태 필터 탭 */
const PUBLISH_TABS: { value: boolean | 'all'; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: true, label: '공개' },
  { value: false, label: '비공개' },
];

/** 반 필터 옵션 */
const CLASS_OPTIONS: { value: TargetClass | 'all'; label: string }[] = [
  { value: 'all', label: '전체 반' },
  { value: 'A', label: 'A반' },
  { value: 'B', label: 'B반' },
  { value: 'C', label: 'C반' },
  { value: 'D', label: 'D반' },
];

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 퀴즈 목록 컴포넌트
 *
 * 퀴즈 목록을 그리드 형태로 표시하고,
 * 필터링 및 무한 스크롤 기능을 제공합니다.
 *
 * @example
 * ```tsx
 * <QuizList
 *   quizzes={quizzes}
 *   loading={loading}
 *   loadingMore={loadingMore}
 *   hasMore={hasMore}
 *   filter={filter}
 *   onFilterChange={setFilter}
 *   onLoadMore={fetchMore}
 *   onQuizClick={(quiz) => router.push(`/professor/quiz/${quiz.id}`)}
 *   onQuizEdit={(quiz) => router.push(`/professor/quiz/${quiz.id}/edit`)}
 *   onQuizDelete={(quiz) => setDeleteTarget(quiz)}
 *   onQuizTogglePublish={(quiz) => togglePublish(quiz.id, !quiz.isPublished)}
 * />
 * ```
 */
export default function QuizList({
  quizzes,
  loading,
  loadingMore,
  hasMore,
  filter,
  onFilterChange,
  onLoadMore,
  onQuizClick,
  onQuizEdit,
  onQuizDelete,
  onQuizTogglePublish,
  className = '',
}: QuizListProps) {
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // 무한 스크롤 감지
  useEffect(() => {
    if (!hasMore || loadingMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          onLoadMore();
        }
      },
      { threshold: 0.1 }
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => observer.disconnect();
  }, [hasMore, loadingMore, onLoadMore]);

  // 공개 상태 필터 변경
  const handlePublishFilterChange = useCallback(
    (value: boolean | 'all') => {
      onFilterChange({
        ...filter,
        isPublished: value,
      });
    },
    [filter, onFilterChange]
  );

  // 반 필터 변경
  const handleClassFilterChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onFilterChange({
        ...filter,
        targetClass: e.target.value as TargetClass | 'all',
      });
    },
    [filter, onFilterChange]
  );

  // 로딩 중 스켈레톤
  if (loading) {
    return (
      <div className={`space-y-4 ${className}`}>
        {/* 필터 스켈레톤 */}
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="w-16 h-9 rounded-xl" />
            ))}
          </div>
          <Skeleton className="w-24 h-9 rounded-xl" />
        </div>

        {/* 퀴즈 카드 스켈레톤 */}
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      {/* 필터 영역 */}
      <div className="flex items-center justify-between mb-4">
        {/* 공개 상태 탭 */}
        <div className="flex gap-1 p-1 bg-gray-100 rounded-xl">
          {PUBLISH_TABS.map((tab) => (
            <button
              key={String(tab.value)}
              type="button"
              onClick={() => handlePublishFilterChange(tab.value)}
              className={`
                px-3 py-1.5 rounded-lg text-sm font-medium
                transition-all duration-200
                ${
                  filter.isPublished === tab.value
                    ? 'bg-white text-gray-800 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }
              `}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 반 필터 */}
        <select
          value={filter.targetClass || 'all'}
          onChange={handleClassFilterChange}
          className="
            px-3 py-1.5 rounded-xl border border-gray-200
            text-sm text-gray-700
            focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500
            bg-white
          "
        >
          {CLASS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {/* 퀴즈 목록 */}
      <AnimatePresence mode="wait">
        {quizzes.length === 0 ? (
          // 빈 상태
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center py-16 px-4"
          >
            <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-4">
              <svg
                className="w-10 h-10 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-gray-800 mb-2">
              퀴즈가 없습니다
            </h3>
            <p className="text-sm text-gray-500 text-center">
              {filter.isPublished === true
                ? '공개된 퀴즈가 없습니다.'
                : filter.isPublished === false
                  ? '비공개 퀴즈가 없습니다.'
                  : '아직 출제한 퀴즈가 없습니다.'}
              <br />
              새로운 퀴즈를 출제해보세요!
            </p>
          </motion.div>
        ) : (
          // 퀴즈 목록
          <motion.div
            key="list"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-3"
          >
            {quizzes.map((quiz) => (
              <QuizListItem
                key={quiz.id}
                quiz={quiz}
                onClick={() => onQuizClick(quiz)}
                onEdit={() => onQuizEdit(quiz)}
                onDelete={() => onQuizDelete(quiz)}
                onTogglePublish={() => onQuizTogglePublish(quiz)}
              />
            ))}

            {/* 더 불러오기 감지 영역 */}
            {hasMore && (
              <div ref={loadMoreRef} className="py-4">
                {loadingMore && (
                  <div className="flex justify-center">
                    <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
