'use client';

import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import type { SourceRect } from '@/lib/hooks/useExpandSource';
import { useWideMode } from '@/lib/hooks/useViewportScale';
import { lockScroll, unlockScroll } from '@/lib/utils/scrollLock';

const SPRING_GENIE = { type: 'spring' as const, stiffness: 400, damping: 30 };

interface ExpandModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 클릭한 요소의 위치 — 요술지니 애니메이션 원점 */
  sourceRect?: SourceRect | null;
  children: React.ReactNode;
  className?: string;
  zIndex?: number;
}

/**
 * 요술지니 스타일 모달
 *
 * sourceRect가 있으면: 클릭한 버튼/카드 위치에서 모달이 나오고, 닫으면 다시 돌아감
 * sourceRect가 없으면: 중앙 scale 애니메이션 (fallback)
 */
export default function ExpandModal({
  isOpen,
  onClose,
  sourceRect,
  children,
  className = '',
  zIndex = 50,
}: ExpandModalProps) {
  const [mounted, setMounted] = useState(false);
  // 모달이 열릴 때 sourceRect를 캡처 (닫힐 때 부모가 clearRect해도 exit 애니메이션 유지)
  const capturedRef = useRef<SourceRect | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // 모달 열릴 때 sourceRect 캡처
  useEffect(() => {
    if (isOpen && sourceRect) {
      capturedRef.current = sourceRect;
    }
  }, [isOpen, sourceRect]);

  // 스크롤 잠금
  useEffect(() => {
    if (isOpen) {
      lockScroll();
      return () => unlockScroll();
    }
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

  const isWide = useWideMode();

  if (!mounted) return null;

  // 가로모드: 패널 전체 너비 바텀시트 + 투명 오버레이(클릭으로 닫기)
  if (isWide) {
    const wideContent = (
      <AnimatePresence>
        {isOpen && (
          <>
            {/* 투명 오버레이 — 바텀시트 외 영역 클릭 시 닫기 */}
            <motion.div
              key="expand-overlay-wide"
              className="fixed inset-0"
              style={{ zIndex, left: 'var(--modal-left, 240px)', right: 'var(--modal-right, 0px)' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
            />
            {/* 바텀시트 — 패널 전체 너비 */}
            <motion.div
              key="expand-content-wide"
              className="fixed bottom-0 bg-[#F5F0E8] rounded-t-2xl border-t-2 border-x-2 border-[#1A1A1A] shadow-[0_-4px_24px_rgba(0,0,0,0.15)] overflow-hidden"
              style={{ zIndex: zIndex + 1, left: 'var(--modal-left, 240px)', right: 'var(--modal-right, 0px)' }}
              onClick={(e) => e.stopPropagation()}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 400, damping: 35 }}
            >
              <div className="flex justify-center pt-2 pb-1">
                <div className="w-8 h-1 rounded-full bg-[#D4CFC4]" />
              </div>
              {children}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    );
    return createPortal(wideContent, document.body);
  }

  // 요술지니 initial/exit 계산
  const rect = capturedRef.current || sourceRect;
  let genieInitial: Record<string, number>;
  let genieAnimate: Record<string, number>;

  if (rect && typeof window !== 'undefined') {
    const viewCenterX = window.innerWidth / 2;
    const viewCenterY = window.innerHeight / 2;
    const srcCenterX = rect.x + rect.width / 2;
    const srcCenterY = rect.y + rect.height / 2;

    genieInitial = {
      opacity: 0,
      scale: 0.15,
      x: srcCenterX - viewCenterX,
      y: srcCenterY - viewCenterY,
    };
    genieAnimate = { opacity: 1, scale: 1, x: 0, y: 0 };
  } else {
    // sourceRect 없으면 중앙 scale fallback
    genieInitial = { opacity: 0, scale: 0.88 };
    genieAnimate = { opacity: 1, scale: 1 };
  }

  const modalContent = (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* 백드롭 */}
          <motion.div
            key="expand-backdrop"
            className="fixed inset-0"
            style={{ zIndex, left: 'var(--modal-left, 0px)', right: 'var(--modal-right, 0px)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          >
            {/* safe area 하단까지 커버 */}
            <div className="absolute inset-0 bg-black/50" style={{ bottom: 'calc(-1 * env(safe-area-inset-bottom, 0px))' }} />
          </motion.div>

          {/* 모달 콘텐츠 */}
          <div
            className="fixed inset-0 flex items-center justify-center pointer-events-none"
            style={{
              zIndex: zIndex + 1,
              left: 'var(--modal-left, 0px)',
              right: 'var(--modal-right, 0px)',
              padding: '1rem',
              paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))',
            }}
          >
            <motion.div
              key="expand-content"
              className={`pointer-events-auto ${className}`}
              onClick={(e) => e.stopPropagation()}
              initial={genieInitial}
              animate={genieAnimate}
              exit={genieInitial}
              transition={SPRING_GENIE}
            >
              {children}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );

  return createPortal(modalContent, document.body);
}
