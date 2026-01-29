'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';

interface LikeButtonProps {
  /** 좋아요 수 */
  count: number;
  /** 현재 사용자가 좋아요 했는지 여부 */
  isLiked: boolean;
  /** 좋아요 토글 핸들러 */
  onToggle: () => void;
  /** 로딩 상태 */
  loading?: boolean;
  /** 크기 */
  size?: 'sm' | 'md';
}

/**
 * 좋아요 버튼 컴포넌트
 *
 * 하트 아이콘과 좋아요 수를 표시합니다.
 * 클릭 시 좋아요를 토글하고, 애니메이션 효과를 제공합니다.
 */
export default function LikeButton({
  count,
  isLiked,
  onToggle,
  loading = false,
  size = 'md',
}: LikeButtonProps) {
  const [isAnimating, setIsAnimating] = useState(false);

  const handleClick = () => {
    if (loading) return;

    // 좋아요 애니메이션
    if (!isLiked) {
      setIsAnimating(true);
      setTimeout(() => setIsAnimating(false), 300);
    }

    onToggle();
  };

  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-5 w-5',
  };

  const textSizeClasses = {
    sm: 'text-xs',
    md: 'text-sm',
  };

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className={`
        flex items-center gap-1.5
        ${loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        ${isLiked ? 'text-red-500' : 'text-theme-text-secondary'}
        hover:text-red-500 transition-colors
      `}
      aria-label={isLiked ? '좋아요 취소' : '좋아요'}
    >
      <motion.div
        animate={isAnimating ? { scale: [1, 1.3, 1] } : {}}
        transition={{ duration: 0.3 }}
      >
        {isLiked ? (
          // 채워진 하트 아이콘
          <svg
            className={sizeClasses[size]}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z"
              clipRule="evenodd"
            />
          </svg>
        ) : (
          // 빈 하트 아이콘
          <svg
            className={sizeClasses[size]}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
            />
          </svg>
        )}
      </motion.div>
      <span className={textSizeClasses[size]}>{count}</span>
    </button>
  );
}
