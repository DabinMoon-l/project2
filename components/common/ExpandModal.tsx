'use client';

import { useRef, useLayoutEffect, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useReducedMotion } from '@/lib/hooks/useReducedMotion';
import { SPRING_EXPAND, SPRING_COLLAPSE } from '@/lib/constants/springs';
import type { SourceRect } from '@/lib/hooks/useExpandSource';

interface ExpandModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceRect: SourceRect | null; // null이면 센터 페이드인 폴백
  children: React.ReactNode;
  className?: string; // 모달 내부 스타일
  zIndex?: number; // 기본 50
}

/**
 * Apple Music 스타일 확장/축소 모달
 *
 * sourceRect가 있으면 해당 위치에서 확장, 없으면 센터 페이드인 폴백.
 * GPU 가속 transform만 사용 (top/left/width/height 애니메이션 NO).
 */
export default function ExpandModal({
  isOpen,
  onClose,
  sourceRect,
  children,
  className = '',
  zIndex = 50,
}: ExpandModalProps) {
  const prefersReducedMotion = useReducedMotion();
  const contentRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState<{
    dx: number;
    dy: number;
    scaleX: number;
    scaleY: number;
  } | null>(null);
  const [contentVisible, setContentVisible] = useState(false);
  const [mounted, setMounted] = useState(false);

  // 클라이언트 마운트 확인
  useEffect(() => {
    setMounted(true);
  }, []);

  // 네비게이션 숨김
  useEffect(() => {
    if (isOpen) {
      document.body.setAttribute('data-hide-nav', '');
    } else {
      document.body.removeAttribute('data-hide-nav');
    }
    return () => {
      document.body.removeAttribute('data-hide-nav');
    };
  }, [isOpen]);

  // ESC 키로 닫기
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // 소스 rect → 타겟 rect 간의 transform 계산
  useLayoutEffect(() => {
    if (!isOpen || !sourceRect || !contentRef.current || prefersReducedMotion) {
      setTransform(null);
      return;
    }

    // 약간의 지연으로 DOM 렌더 완료 보장
    const frame = requestAnimationFrame(() => {
      const targetEl = contentRef.current;
      if (!targetEl) return;

      const targetRect = targetEl.getBoundingClientRect();

      // 소스 중심점과 타겟 중심점의 차이
      const sourceCenterX = sourceRect.x + sourceRect.width / 2;
      const sourceCenterY = sourceRect.y + sourceRect.height / 2;
      const targetCenterX = targetRect.left + targetRect.width / 2;
      const targetCenterY = targetRect.top + targetRect.height / 2;

      const dx = sourceCenterX - targetCenterX;
      const dy = sourceCenterY - targetCenterY;

      // 크기 비율
      const scaleX = sourceRect.width / targetRect.width;
      const scaleY = sourceRect.height / targetRect.height;

      setTransform({ dx, dy, scaleX, scaleY });
    });

    return () => cancelAnimationFrame(frame);
  }, [isOpen, sourceRect, prefersReducedMotion]);

  // 콘텐츠 페이드인 (확장 완료 후)
  const handleAnimationComplete = useCallback(() => {
    if (isOpen) {
      setContentVisible(true);
    }
  }, [isOpen]);

  // 열릴 때 콘텐츠 숨기기 리셋
  useEffect(() => {
    if (isOpen && sourceRect && !prefersReducedMotion) {
      setContentVisible(false);
    } else if (isOpen) {
      // 폴백 또는 reduced motion: 즉시 표시
      setContentVisible(true);
    }
  }, [isOpen, sourceRect, prefersReducedMotion]);

  if (!mounted) return null;

  // 확장 애니메이션 사용 여부
  const useExpand = sourceRect && transform && !prefersReducedMotion;

  const modalContent = (
    <AnimatePresence
      mode="wait"
      onExitComplete={() => {
        setContentVisible(false);
        setTransform(null);
      }}
    >
      {isOpen && (
        <>
          {/* 백드롭 */}
          <motion.div
            key="expand-backdrop"
            className="fixed inset-0"
            style={{ zIndex }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          >
            <div className="absolute inset-0 bg-black/50" />
          </motion.div>

          {/* 모달 콘텐츠 */}
          <div
            className="fixed inset-0 flex items-center justify-center p-4 pointer-events-none"
            style={{ zIndex: zIndex + 1 }}
          >
            <motion.div
              ref={contentRef}
              key="expand-content"
              className={`pointer-events-auto ${className}`}
              onClick={(e) => e.stopPropagation()}
              initial={
                useExpand
                  ? {
                      x: transform.dx,
                      y: transform.dy,
                      scaleX: transform.scaleX,
                      scaleY: transform.scaleY,
                      opacity: 0.5,
                    }
                  : prefersReducedMotion
                    ? { opacity: 0 }
                    : { opacity: 0, scale: 0.95 }
              }
              animate={
                useExpand
                  ? { x: 0, y: 0, scaleX: 1, scaleY: 1, opacity: 1 }
                  : { opacity: 1, scale: 1 }
              }
              exit={
                useExpand
                  ? {
                      x: transform.dx,
                      y: transform.dy,
                      scaleX: transform.scaleX,
                      scaleY: transform.scaleY,
                      opacity: 0,
                    }
                  : prefersReducedMotion
                    ? { opacity: 0 }
                    : { opacity: 0, scale: 0.95 }
              }
              transition={
                prefersReducedMotion
                  ? { duration: 0.15 }
                  : isOpen
                    ? SPRING_EXPAND
                    : SPRING_COLLAPSE
              }
              onAnimationComplete={handleAnimationComplete}
              style={{ transformOrigin: 'center center', willChange: 'transform, opacity' }}
            >
              {/* 콘텐츠 페이드 래퍼: 확장 중에는 숨기고, 완료 후 표시 */}
              <div
                style={{
                  opacity: useExpand && !contentVisible ? 0 : 1,
                  transition: 'opacity 150ms ease-out',
                }}
              >
                {children}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );

  return createPortal(modalContent, document.body);
}
