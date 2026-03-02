'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TAP_SCALE } from '@/lib/constants/springs';
import type { CompletedQuizData } from './types';
import { NEWSPAPER_BG_TEXT } from './types';

/**
 * 자작 복습 카드 컴포넌트 (뉴스 스타일)
 */
export default function CustomReviewQuizCard({
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
