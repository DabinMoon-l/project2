'use client';

import { motion } from 'framer-motion';
import Image from 'next/image';
import { SPRING_TAP, TAP_SCALE } from '@/lib/constants/springs';
import { DIFFICULTY_IMAGES, DIFFICULTY_LABELS } from './types';
import type { BookmarkedQuiz } from '@/lib/hooks/useQuizBookmark';

/**
 * 큰 찜한 퀴즈 카드 컴포넌트 (전체 너비, 강조 표시)
 * 아이콘 순서: [업데이트 뱃지] [지구 아이콘 (AI 공개)] [찜]
 */
export function LargeBookmarkedQuizCard({
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
export function LargeBookmarkedQuizPlaceholder() {
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
