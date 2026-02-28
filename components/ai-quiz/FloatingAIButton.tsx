'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePathname } from 'next/navigation';

interface FloatingAIButtonProps {
  onClick: () => void;
}

/**
 * AI 퀴즈 학습 시작 플로팅 버튼 (CTA)
 * 홈, 퀴즈, 복습 탭에서만 표시 (게시판 제외)
 *
 * 크기: 128x128px (2배)
 * 위치: 우측 하단, 네비게이션 바 위
 */
export default function FloatingAIButton({ onClick }: FloatingAIButtonProps) {
  const pathname = usePathname();
  const [isPressed, setIsPressed] = useState(false);

  // 퀴즈 페이지에서만 표시 (홈은 개편으로 제외)
  const shouldShow = pathname === '/quiz';

  // 퀴즈 풀이 중에는 숨김
  const isQuizPage = pathname?.match(/^\/quiz\/[^/]+/) !== null;

  if (!shouldShow || isQuizPage) {
    return null;
  }

  return (
    <AnimatePresence>
      <motion.button
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0, opacity: 0 }}
        whileTap={{ scale: 0.92 }}
        transition={{ type: 'spring', stiffness: 400, damping: 20 }}
        onClick={onClick}
        onMouseDown={() => setIsPressed(true)}
        onMouseUp={() => setIsPressed(false)}
        onMouseLeave={() => setIsPressed(false)}
        onTouchStart={() => setIsPressed(true)}
        onTouchEnd={() => setIsPressed(false)}
        className="fixed z-40 flex items-center justify-center"
        style={{
          right: '-20px',
          bottom: '76px',
          width: '160px',
          height: '160px',
          filter: isPressed
            ? 'brightness(0.9) drop-shadow(3px 3px 0px #1A1A1A)'
            : 'drop-shadow(5px 5px 0px rgba(26, 26, 26, 0.25))',
          transition: 'filter 0.1s ease',
        }}
        aria-label="AI 퀴즈로 학습 시작"
      >
        <img
          src="/images/letsstart.png"
          alt="AI 학습 시작"
          className="w-full h-full object-contain"
          style={{
            transform: isPressed ? 'translate(2px, 2px)' : 'none',
            transition: 'transform 0.1s ease',
          }}
        />
      </motion.button>
    </AnimatePresence>
  );
}
