'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import QuizCard, { QuizCardData } from './QuizCard';
import { SkeletonQuizCard } from '../common';

interface QuizGridProps {
  /** 퀴즈 데이터 배열 */
  quizzes: QuizCardData[];
  /** 로딩 상태 */
  isLoading?: boolean;
  /** 더 불러오기 중 여부 */
  isFetchingMore?: boolean;
  /** 더 불러올 데이터가 있는지 여부 */
  hasMore?: boolean;
  /** 더 불러오기 함수 */
  onLoadMore?: () => void;
  /** 퀴즈 카드 클릭 핸들러 */
  onQuizClick?: (quizId: string) => void;
  /** 추가 클래스명 */
  className?: string;
}

// 무한 스크롤 관찰 옵션
const INTERSECTION_OPTIONS: IntersectionObserverInit = {
  root: null,
  rootMargin: '100px',
  threshold: 0,
};

/**
 * 퀴즈 그리드 컴포넌트
 *
 * 퀴즈 카드를 2열 그리드로 배치하고, 무한 스크롤을 지원합니다.
 * IntersectionObserver를 사용하여 스크롤 시 추가 데이터를 로드합니다.
 *
 * @example
 * ```tsx
 * <QuizGrid
 *   quizzes={quizList}
 *   isLoading={isLoading}
 *   hasMore={hasNextPage}
 *   onLoadMore={fetchNextPage}
 * />
 * ```
 */
export default function QuizGrid({
  quizzes,
  isLoading = false,
  isFetchingMore = false,
  hasMore = false,
  onLoadMore,
  onQuizClick,
  className = '',
}: QuizGridProps) {
  // 무한 스크롤 감지용 ref
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Intersection Observer 콜백
  const handleIntersect = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [entry] = entries;
      if (entry.isIntersecting && hasMore && !isFetchingMore && onLoadMore) {
        onLoadMore();
      }
    },
    [hasMore, isFetchingMore, onLoadMore]
  );

  // Intersection Observer 설정
  useEffect(() => {
    const observer = new IntersectionObserver(handleIntersect, INTERSECTION_OPTIONS);
    const currentRef = loadMoreRef.current;

    if (currentRef) {
      observer.observe(currentRef);
    }

    return () => {
      if (currentRef) {
        observer.unobserve(currentRef);
      }
    };
  }, [handleIntersect]);

  // 초기 로딩 상태
  if (isLoading && quizzes.length === 0) {
    return (
      <div className={`grid grid-cols-2 gap-4 ${className}`}>
        {Array.from({ length: 6 }).map((_, index) => (
          <SkeletonQuizCard key={index} />
        ))}
      </div>
    );
  }

  // 데이터 없음 상태
  if (!isLoading && quizzes.length === 0) {
    return (
      <div className={`py-12 text-center ${className}`}>
        <div className="text-6xl mb-4">📚</div>
        <p className="text-gray-600 font-medium">퀴즈가 없습니다.</p>
        <p className="text-gray-400 text-sm mt-1">
          곧 새로운 퀴즈가 등록될 예정이에요!
        </p>
      </div>
    );
  }

  // 컨테이너 애니메이션 variants
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.05,
      },
    },
  };

  // 개별 아이템 애니메이션 variants
  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        type: 'spring',
        stiffness: 300,
        damping: 25,
      },
    },
  };

  return (
    <div className={className}>
      {/* 퀴즈 그리드 */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-2 gap-4"
      >
        <AnimatePresence mode="popLayout">
          {quizzes.map((quiz) => (
            <motion.div
              key={quiz.id}
              variants={itemVariants}
              layout
              exit={{ opacity: 0, scale: 0.9 }}
            >
              <QuizCard
                quiz={quiz}
                onClick={onQuizClick ? () => onQuizClick(quiz.id) : undefined}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>

      {/* 더 불러오기 중 스켈레톤 */}
      {isFetchingMore && (
        <div className="grid grid-cols-2 gap-4 mt-4">
          {Array.from({ length: 2 }).map((_, index) => (
            <SkeletonQuizCard key={`loading-${index}`} />
          ))}
        </div>
      )}

      {/* 무한 스크롤 감지 요소 */}
      {hasMore && (
        <div
          ref={loadMoreRef}
          className="h-4 w-full"
          aria-hidden="true"
        />
      )}

      {/* 마지막 페이지 메시지 */}
      {!hasMore && quizzes.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-8 text-gray-400 text-sm"
        >
          모든 퀴즈를 불러왔습니다.
        </motion.div>
      )}
    </div>
  );
}
