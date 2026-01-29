'use client';

import { motion } from 'framer-motion';

/**
 * FeedbackButton Props 타입
 */
interface FeedbackButtonProps {
  /** 클릭 핸들러 */
  onClick: () => void;
  /** 이미 피드백을 남겼는지 여부 */
  hasSubmittedFeedback?: boolean;
  /** 피드백 보상 골드 */
  rewardGold?: number;
  /** 비활성화 여부 */
  disabled?: boolean;
  /** 추가 클래스명 */
  className?: string;
}

/**
 * 피드백 입력 버튼 컴포넌트
 *
 * 퀴즈 결과 화면에서 피드백 페이지로 이동하는 버튼입니다.
 * 피드백 보상 골드를 표시하고, 이미 제출한 경우 다른 UI를 보여줍니다.
 *
 * @example
 * ```tsx
 * <FeedbackButton
 *   onClick={() => router.push(`/quiz/${quizId}/feedback`)}
 *   rewardGold={15}
 * />
 * ```
 */
export default function FeedbackButton({
  onClick,
  hasSubmittedFeedback = false,
  rewardGold = 15,
  disabled = false,
  className = '',
}: FeedbackButtonProps) {
  // 이미 피드백을 남긴 경우
  if (hasSubmittedFeedback) {
    return (
      <div
        className={`
          flex items-center justify-center gap-2
          py-3 px-6 rounded-2xl
          bg-gray-100 text-gray-500
          ${className}
        `}
      >
        <span className="text-lg">✅</span>
        <span className="font-medium">피드백 완료</span>
      </div>
    );
  }

  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      whileHover={{ scale: disabled ? 1 : 1.02 }}
      whileTap={{ scale: disabled ? 1 : 0.98 }}
      className={`
        relative overflow-hidden
        flex items-center justify-center gap-2
        w-full py-4 px-6 rounded-2xl
        bg-gradient-to-r from-indigo-500 to-purple-600
        text-white font-bold text-lg
        shadow-lg shadow-indigo-500/30
        transition-all duration-200
        disabled:opacity-50 disabled:cursor-not-allowed
        ${className}
      `}
    >
      {/* 반짝이 효과 */}
      <motion.div
        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
        initial={{ x: '-100%' }}
        animate={{ x: '100%' }}
        transition={{
          repeat: Infinity,
          repeatDelay: 3,
          duration: 1,
          ease: 'easeInOut',
        }}
      />

      {/* 버튼 텍스트 */}
      <span className="relative">피드백 남기고</span>

      {/* 골드 보상 */}
      <span className="relative flex items-center gap-1 bg-white/20 px-2 py-0.5 rounded-full">
        <span>💰</span>
        <span>+{rewardGold}</span>
      </span>

      {/* 받기 텍스트 */}
      <span className="relative">받기</span>
    </motion.button>
  );
}
