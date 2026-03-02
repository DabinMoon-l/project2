'use client';

import { useMemo } from 'react';
import type { CompletedQuizData } from './types';
import { NEWSPAPER_BG_TEXT } from './types';
import { getQuestionTypeLabel, getRandomQuote } from './utils';

/**
 * 뉴스 기사 컴포넌트 (복습용 퀴즈)
 */
export function ReviewNewsArticle({
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
export function ReviewQuoteArticle({ size = 'small' }: { size?: 'normal' | 'small' }) {
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
