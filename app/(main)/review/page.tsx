'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Header, Skeleton } from '@/components/common';
import ReviewTabs, { type ReviewTabType } from '@/components/review/ReviewTabs';
import ReviewQuestionCard from '@/components/review/ReviewQuestionCard';
import ReviewPractice from '@/components/review/ReviewPractice';
import { useReview, type ReviewItem, type GroupedReviewItems } from '@/lib/hooks/useReview';

// ============================================================
// 빈 상태 컴포넌트
// ============================================================

interface EmptyStateProps {
  type: ReviewTabType;
}

function EmptyState({ type }: EmptyStateProps) {
  const isWrong = type === 'wrong';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center py-16 px-4 text-center"
    >
      {/* 아이콘 */}
      <div className="w-24 h-24 mb-6 flex items-center justify-center text-6xl">
        {isWrong ? '🎉' : '📚'}
      </div>

      {/* 메시지 */}
      <h3 className="text-lg font-bold text-gray-800 mb-2">
        {isWrong ? '오답이 없어요!' : '찜한 문제가 없어요!'}
      </h3>
      <p className="text-sm text-gray-500">
        {isWrong
          ? '퀴즈를 풀면 틀린 문제가 자동으로 저장됩니다.'
          : '퀴즈 결과에서 📚 버튼을 눌러 문제를 찜해보세요.'}
      </p>
    </motion.div>
  );
}

// ============================================================
// 로딩 스켈레톤
// ============================================================

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-white rounded-2xl p-4 shadow-sm">
          <Skeleton className="w-32 h-4 mb-4" />
          <div className="space-y-3">
            <Skeleton className="w-full h-20 rounded-xl" />
            <Skeleton className="w-full h-20 rounded-xl" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// 퀴즈 그룹 컴포넌트
// ============================================================

interface QuizGroupProps {
  group: GroupedReviewItems;
  onPractice: (items: ReviewItem[]) => void;
  onDelete: (id: string) => void;
}

function QuizGroup({ group, onPractice, onDelete }: QuizGroupProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl shadow-sm overflow-hidden"
    >
      {/* 그룹 헤더 */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 flex items-center justify-center bg-theme-accent/10 text-theme-accent rounded-lg text-sm font-bold">
            {group.items.length}
          </span>
          <span className="font-medium text-gray-800">{group.quizTitle}</span>
        </div>

        <div className="flex items-center gap-2">
          {/* 연습 버튼 */}
          <motion.button
            type="button"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={(e) => {
              e.stopPropagation();
              onPractice(group.items);
            }}
            className="px-3 py-1.5 bg-theme-accent text-white text-sm font-medium rounded-lg"
          >
            연습하기
          </motion.button>

          {/* 펼치기/접기 아이콘 */}
          <motion.svg
            animate={{ rotate: isExpanded ? 180 : 0 }}
            className="w-5 h-5 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </motion.svg>
        </div>
      </button>

      {/* 문제 목록 */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-3">
              {group.items.map((item, index) => (
                <ReviewQuestionCard
                  key={item.id}
                  item={item}
                  number={index + 1}
                  onDelete={() => onDelete(item.id)}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ============================================================
// 메인 페이지 컴포넌트
// ============================================================

/**
 * 복습 페이지
 *
 * 오답노트와 찜한 문제를 관리하고 복습할 수 있는 화면입니다.
 * 퀴즈별로 그룹핑되어 표시되며, 연습 모드를 제공합니다.
 */
export default function ReviewPage() {
  // 상태 관리
  const [activeTab, setActiveTab] = useState<ReviewTabType>('wrong');
  const [practiceItems, setPracticeItems] = useState<ReviewItem[] | null>(null);

  // 복습 데이터 훅
  const {
    wrongItems,
    bookmarkedItems,
    groupedWrongItems,
    groupedBookmarkedItems,
    loading,
    deleteReviewItem,
    markAsReviewed,
  } = useReview();

  // 현재 탭에 따른 데이터
  const currentItems = activeTab === 'wrong' ? groupedWrongItems : groupedBookmarkedItems;

  /**
   * 연습 시작
   */
  const handleStartPractice = useCallback((items: ReviewItem[]) => {
    setPracticeItems(items);
  }, []);

  /**
   * 연습 종료
   */
  const handleEndPractice = useCallback(() => {
    setPracticeItems(null);
  }, []);

  /**
   * 문제 삭제
   */
  const handleDelete = useCallback(async (reviewId: string) => {
    if (window.confirm('이 문제를 삭제하시겠습니까?')) {
      try {
        await deleteReviewItem(reviewId);
      } catch {
        alert('삭제에 실패했습니다.');
      }
    }
  }, [deleteReviewItem]);

  /**
   * 복습 완료 처리
   */
  const handleReviewed = useCallback(async (reviewId: string) => {
    try {
      await markAsReviewed(reviewId);
    } catch {
      console.error('복습 완료 처리 실패');
    }
  }, [markAsReviewed]);

  // 연습 모드인 경우
  if (practiceItems) {
    return (
      <ReviewPractice
        items={practiceItems}
        onComplete={handleEndPractice}
        onReviewed={handleReviewed}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* 헤더 */}
      <Header title="복습" />

      {/* 메인 컨텐츠 */}
      <main className="px-4 py-4 space-y-4">
        {/* 탭 */}
        <ReviewTabs
          activeTab={activeTab}
          onTabChange={setActiveTab}
          wrongCount={wrongItems.length}
          bookmarkCount={bookmarkedItems.length}
        />

        {/* 전체 연습 버튼 */}
        {!loading && currentItems.length > 0 && (
          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              const allItems = currentItems.flatMap((g) => g.items);
              handleStartPractice(allItems);
            }}
            className="
              w-full py-3 px-4
              flex items-center justify-center gap-2
              bg-gradient-to-r from-theme-accent to-theme-accent/80
              text-white font-medium rounded-2xl
              shadow-md
            "
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            전체 {activeTab === 'wrong' ? wrongItems.length : bookmarkedItems.length}문제 연습하기
          </motion.button>
        )}

        {/* 로딩 */}
        {loading && <LoadingSkeleton />}

        {/* 빈 상태 */}
        {!loading && currentItems.length === 0 && <EmptyState type={activeTab} />}

        {/* 퀴즈 그룹 목록 */}
        {!loading && currentItems.length > 0 && (
          <div className="space-y-4">
            {currentItems.map((group) => (
              <QuizGroup
                key={group.quizId}
                group={group}
                onPractice={handleStartPractice}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
