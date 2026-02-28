'use client';

import { motion } from 'framer-motion';
import { useThemeColors } from '@/styles/themes/useTheme';

/**
 * QuizNavigation Props 타입
 */
interface QuizNavigationProps {
  /** 현재 문제 번호 (1부터 시작) */
  currentQuestion: number;
  /** 총 문제 수 */
  totalQuestions: number;
  /** 이전 버튼 클릭 핸들러 */
  onPrev: () => void;
  /** 다음 버튼 클릭 핸들러 */
  onNext: () => void;
  /** 제출 버튼 클릭 핸들러 */
  onSubmit: () => void;
  /** 현재 문제에 답변했는지 여부 */
  hasAnswered: boolean;
  /** 제출 로딩 상태 */
  isSubmitting?: boolean;
}

/**
 * 퀴즈 네비게이션 컴포넌트
 *
 * [이전] [다음] 버튼을 표시하고, 마지막 문제에서는 [제출] 버튼을 표시합니다.
 *
 * @example
 * ```tsx
 * <QuizNavigation
 *   currentQuestion={3}
 *   totalQuestions={10}
 *   onPrev={() => goToPrev()}
 *   onNext={() => goToNext()}
 *   onSubmit={() => submitQuiz()}
 *   hasAnswered={!!answers[currentQuestion]}
 * />
 * ```
 */
export default function QuizNavigation({
  currentQuestion,
  totalQuestions,
  onPrev,
  onNext,
  onSubmit,
  hasAnswered,
  isSubmitting = false,
}: QuizNavigationProps) {
  const colors = useThemeColors();

  const isFirstQuestion = currentQuestion === 1;
  const isLastQuestion = currentQuestion === totalQuestions;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.2 }}
      className="fixed bottom-0 left-0 right-0 bg-[#F5F0E8] border-t-2 border-[#1A1A1A] px-4 py-3 pb-safe"
      style={{
        paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
      }}
    >
      <div className="max-w-lg mx-auto flex gap-3">
        {/* 이전 버튼 */}
        <motion.button
          whileHover={!isFirstQuestion ? { scale: 1.02 } : undefined}
          whileTap={!isFirstQuestion ? { scale: 0.98 } : undefined}
          onClick={onPrev}
          disabled={isFirstQuestion}
          className={`
            flex-1 py-2 font-bold text-xs
            border-2 transition-all duration-200
            ${isFirstQuestion
              ? 'bg-[#EDEAE4] text-[#5C5C5C] border-[#5C5C5C] cursor-not-allowed'
              : 'bg-[#EDEAE4] text-[#1A1A1A] border-[#1A1A1A] hover:bg-[#E5E0D8] active:bg-[#DDD8D0]'
            }
          `}
          aria-label="이전 문제"
        >
          <span className="flex items-center justify-center gap-2">
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
            이전
          </span>
        </motion.button>

        {/* 다음/제출 버튼 */}
        {isLastQuestion ? (
          // 제출 버튼
          <motion.button
            whileHover={!isSubmitting ? { scale: 1.02 } : undefined}
            whileTap={!isSubmitting ? { scale: 0.98 } : undefined}
            onClick={onSubmit}
            disabled={isSubmitting}
            className={`
              flex-1 py-2 font-bold text-xs
              border-2 border-[#1A1A1A] transition-all duration-200
              bg-[#1A1A1A] text-[#F5F0E8]
              ${isSubmitting ? 'cursor-not-allowed opacity-70' : 'hover:bg-[#2A2A2A]'}
            `}
            aria-label="퀴즈 제출"
          >
            <span className="flex items-center justify-center gap-2">
              {isSubmitting ? (
                <>
                  <svg
                    className="animate-spin w-5 h-5"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  제출 중...
                </>
              ) : (
                <>
                  제출하기
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </>
              )}
            </span>
          </motion.button>
        ) : (
          // 다음 버튼
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onNext}
            className="flex-1 py-2 font-bold text-xs border-2 border-[#1A1A1A] bg-[#1A1A1A] text-[#F5F0E8] transition-all duration-200 hover:bg-[#2A2A2A]"
            aria-label="다음 문제"
          >
            <span className="flex items-center justify-center gap-2">
              다음
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </span>
          </motion.button>
        )}
      </div>
    </motion.div>
  );
}
