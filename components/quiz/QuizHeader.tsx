'use client';

import { motion } from 'framer-motion';
import { useThemeColors } from '@/styles/themes/useTheme';

/**
 * QuizHeader Props 타입
 */
interface QuizHeaderProps {
  /** 퀴즈 제목 */
  title: string;
  /** 현재 문제 번호 (1부터 시작) */
  currentQuestion: number;
  /** 총 문제 수 */
  totalQuestions: number;
  /** 뒤로가기 핸들러 (확인 모달 표시용) */
  onBack: () => void;
}

/**
 * 퀴즈 풀이 헤더 컴포넌트
 *
 * 뒤로가기 버튼, 퀴즈 제목, 진행도를 표시합니다.
 * 뒤로가기 클릭 시 확인 모달을 표시하기 위한 콜백을 호출합니다.
 *
 * @example
 * ```tsx
 * <QuizHeader
 *   title="1주차 복습 퀴즈"
 *   currentQuestion={3}
 *   totalQuestions={10}
 *   onBack={() => setShowExitModal(true)}
 * />
 * ```
 */
export default function QuizHeader({
  title,
  currentQuestion,
  totalQuestions,
  onBack,
}: QuizHeaderProps) {
  // 진행률 계산 (0 ~ 100)
  const progress = (currentQuestion / totalQuestions) * 100;

  return (
    <header
      className="sticky z-50 w-full border-b-2 border-[#1A1A1A]"
      style={{ top: 'env(safe-area-inset-top, 0px)', backgroundColor: '#F5F0E8' }}
    >
      {/* 헤더 컨텐츠 */}
      <div className="flex items-center justify-between h-14 px-4">
        {/* 뒤로가기 버튼 */}
        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
          onClick={onBack}
          className="p-2 -ml-2 transition-colors duration-200 text-[#1A1A1A] hover:bg-[#EDEAE4]"
          aria-label="나가기"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
        </motion.button>

        {/* 퀴즈 제목 */}
        <h1 className="text-base font-bold truncate max-w-[50%] text-center text-[#1A1A1A]">
          {title}
        </h1>

        {/* 진행도 표시 */}
        <div className="text-sm font-bold min-w-[3rem] text-right text-[#1A1A1A]">
          {currentQuestion}/{totalQuestions}
        </div>
      </div>

      {/* 진행률 바 */}
      <div className="h-1.5 w-full bg-[#EDEAE4]">
        <motion.div
          className="h-full bg-[#1A1A1A]"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        />
      </div>
    </header>
  );
}
