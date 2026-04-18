'use client';

import { useState, useEffect, useCallback, useRef, type RefObject } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWideMode } from '@/lib/hooks/useViewportScale';

interface ScrollToTopButtonProps {
  /** 이 요소가 화면에서 사라지면 버튼 표시 */
  targetRef: RefObject<HTMLElement | null>;
  /** 네비 바 위 기준 bottom offset (px). 기본 24 */
  bottomPx?: number;
  /** 좌/우 배치 (기본: 'right') */
  side?: 'left' | 'right';
  /** dark: 검정, glass: 반투명 (기본: 'dark') */
  variant?: 'dark' | 'glass';
  /** 외부에서 강제 숨김 */
  hidden?: boolean;
}

export default function ScrollToTopButton({
  targetRef,
  bottomPx = 96,
  side = 'right' as const,
  variant = 'dark',
  hidden = false,
}: ScrollToTopButtonProps) {
  const [show, setShow] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const isWide = useWideMode();

  // 레이아웃 안정 후 IntersectionObserver 시작 (초기 깜빡임 방지)
  useEffect(() => {
    setShow(false);
    observerRef.current?.disconnect();

    const startObserving = () => {
      const el = targetRef.current;
      if (!el) return;

      const obs = new IntersectionObserver(
        ([entry]) => setShow(!entry.isIntersecting),
        { threshold: 0 }
      );
      obs.observe(el);
      observerRef.current = obs;
    };

    // 마운트 직후 레이아웃이 안정될 때까지 대기
    const timer = setTimeout(startObserving, 800);

    return () => {
      clearTimeout(timer);
      observerRef.current?.disconnect();
    };
  }, [targetRef]);

  const scrollToTop = useCallback(() => {
    // 가로모드: <main> 등 개별 스크롤 컨테이너를 찾아 스크롤
    const el = targetRef.current;
    if (el) {
      let parent = el.parentElement;
      while (parent) {
        const style = getComputedStyle(parent);
        if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && parent.scrollTop > 0) {
          parent.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }
        parent = parent.parentElement;
      }
    }
    // 폴백: window 스크롤
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [targetRef]);

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
          className={`fixed z-40 w-10 h-10 ${variantClass} rounded-full shadow-lg flex items-center justify-center transition-colors`}
          style={{
            bottom: isWide
              ? `${Math.max(16, bottomPx - 68)}px`
              : `calc(4.25rem + env(safe-area-inset-bottom, 0px) + ${bottomPx - 68}px)`,
            ...(side === 'left'
              ? { left: isWide ? 'calc(var(--modal-left, 240px) + 1rem)' : '1rem' }
              // fallback: 2쪽 메인 우측 경계(calc(50% - 120px))
              // 라우트 사이드바 있는 페이지(/quiz/[id] 등)는 layout이 --modal-right: 0px 명시
              : { right: isWide ? 'calc(var(--modal-right, calc(50% - 120px)) + 1rem)' : '1rem' }),
            WebkitTapHighlightColor: 'transparent',
            touchAction: 'manipulation',
          }}
          aria-label="맨 위로"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
          </svg>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
