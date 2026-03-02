'use client';

import { motion } from 'framer-motion';
import { SPRING_TAP, TAP_SCALE } from '@/lib/constants/springs';
import type { BookmarkedQuiz } from '@/lib/hooks/useQuizBookmark';

/**
 * 찜한 퀴즈 카드 컴포넌트 (하트 아이콘 포함)
 * 아이콘 순서: [업데이트 뱃지] [지구 아이콘 (AI 공개)] [찜]
 */
export default function BookmarkedQuizCard({
  quiz,
  onClick,
  onUnbookmark,
  hasUpdate = false,
  onUpdateClick,
}: {
  quiz: BookmarkedQuiz;
  onClick: () => void;
  onUnbookmark: () => void;
  hasUpdate?: boolean;
  onUpdateClick?: () => void;
}) {
  // AI 생성 퀴즈 여부
  const isAiGenerated = quiz.isAiGenerated;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileTap={TAP_SCALE}
      transition={SPRING_TAP}
      onClick={onClick}
      className="relative border border-[#1A1A1A] bg-[#F5F0E8] p-3 cursor-pointer hover:bg-[#EDEAE4] transition-all rounded-xl"
    >
      {/* 우측 상단 아이콘 그룹: [업데이트] [지구] [찜] — items-start로 찜버튼 카운트에 의한 밀림 방지 */}
      <div className="absolute top-2 right-2 flex items-start gap-1 z-10">
        {/* 업데이트 뱃지 */}
        {hasUpdate && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onUpdateClick?.();
            }}
            className="w-5 h-5 bg-[#F5C518] rounded-full flex items-center justify-center border-2 border-[#1A1A1A] hover:scale-110 transition-transform"
          >
            <span className="text-[#1A1A1A] font-bold text-xs">!</span>
          </button>
        )}

        {/* 지구 아이콘 (AI 생성 공개 퀴즈) - 상호작용 없음 */}
        {isAiGenerated && (
          <div className="w-5 h-5 flex items-center justify-center text-[#5C5C5C]">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
          <svg className="w-5 h-5 text-[#8B1A1A]" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          </svg>
          {(quiz.bookmarkCount ?? 0) > 0 && (
            <span className="text-[10px] text-[#5C5C5C] font-bold mt-0.5">
              {quiz.bookmarkCount}
            </span>
          )}
        </button>
      </div>

      {/* 퀴즈 카드 스타일 아이콘 */}
      <div className="flex justify-center mb-2">
        <div className="w-12 h-12 border-2 border-[#1A1A1A] flex items-center justify-center rounded-lg">
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
