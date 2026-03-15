'use client';

import { memo } from 'react';
import { motion } from 'framer-motion';
import type { BookmarkedQuiz } from '@/lib/hooks/useQuizBookmark';
import BookmarkQuizCard from './BookmarkQuizCard';

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

export default memo(BookmarkGridView);
