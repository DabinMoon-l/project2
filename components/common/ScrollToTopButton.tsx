'use client';

import { useState, useEffect, useCallback, type RefObject } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface ScrollToTopButtonProps {
  /** 이 요소가 화면에서 사라지면 버튼 표시 */
  targetRef: RefObject<HTMLElement | null>;
  /** Tailwind bottom 클래스 (기본: 'bottom-24') */
  bottom?: string;
  /** 좌/우 배치 (기본: 'right') */
  side?: 'left' | 'right';
  /** dark: 검정, glass: 반투명 (기본: 'dark') */
  variant?: 'dark' | 'glass';
  /** 외부에서 강제 숨김 */
  hidden?: boolean;
}

export default function ScrollToTopButton({
  targetRef,
  bottom = 'bottom-24',
  side = 'right',
  variant = 'dark',
  hidden = false,
}: ScrollToTopButtonProps) {
  const [show, setShow] = useState(false);

  // 콜백 ref 패턴: targetRef.current가 나중에 마운트되어도 관찰 시작
  useEffect(() => {
    const el = targetRef.current;
    if (!el) {
      // ref가 아직 null → 짧은 간격으로 재시도
      const timer = setInterval(() => {
        const target = targetRef.current;
        if (!target) return;
        clearInterval(timer);

        const obs = new IntersectionObserver(
          ([entry]) => setShow(!entry.isIntersecting),
          { threshold: 0 }
        );
        obs.observe(target);
        // cleanup에서 disconnect할 수 있도록 외부 변수에 저장
        observerRef = obs;
      }, 200);

      let observerRef: IntersectionObserver | null = null;
      return () => {
        clearInterval(timer);
        observerRef?.disconnect();
      };
    }

    const observer = new IntersectionObserver(
      ([entry]) => setShow(!entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [targetRef]);

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const sideClass = side === 'left' ? 'left-4' : 'right-4';
  const variantClass =
    variant === 'glass'
      ? 'bg-white/20 backdrop-blur-sm text-white hover:bg-white/30'
      : 'bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A]';

  return (
    <AnimatePresence>
      {show && !hidden && (
        <motion.button
          key="scroll-top"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          whileTap={{ scale: 0.95, opacity: 0.7 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          onClick={scrollToTop}
          className={`fixed ${bottom} ${sideClass} z-40 w-12 h-12 ${variantClass} rounded-full shadow-lg flex items-center justify-center transition-colors`}
          style={{
            WebkitTapHighlightColor: 'transparent',
            touchAction: 'manipulation',
          }}
          aria-label="맨 위로"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
          </svg>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
