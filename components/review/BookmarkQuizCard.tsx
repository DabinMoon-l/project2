'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { BookmarkedQuiz } from '@/lib/hooks/useQuizBookmark';

/**
 * 찜한 퀴즈 카드 (자작 탭 QuizCard와 동일한 스타일)
 */
export default function BookmarkQuizCard({
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
