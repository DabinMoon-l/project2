'use client';

import { useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence, useDragControls, PanInfo } from 'framer-motion';
import { createPortal } from 'react-dom';
import { useReducedMotion } from '@/lib/hooks/useReducedMotion';
import { lockScroll, unlockScroll } from '@/lib/utils/scrollLock';

// BottomSheet 높이 타입
type SheetHeight = 'auto' | 'half' | 'full';

// BottomSheet Props 타입
interface BottomSheetProps {
  /** 시트 열림 상태 */
  isOpen: boolean;
  /** 시트 닫기 핸들러 */
  onClose: () => void;
  /** 시트 제목 */
  title?: string;
  /** 시트 기본 높이 */
  height?: SheetHeight;
  /** 드래그로 닫기 허용 */
  enableDrag?: boolean;
  /** 백드롭 클릭으로 닫기 허용 */
  closeOnBackdropClick?: boolean;
  /** 시트 내용 */
  children: React.ReactNode;
  /** z-index 클래스 (기본: z-50) */
  zIndex?: string;
}

// 높이별 스타일
const heightStyles: Record<SheetHeight, string> = {
  auto: 'max-h-[90vh]',
  half: 'h-[50vh]',
  full: 'h-[90vh]',
};

// 애니메이션 설정
const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

const sheetVariants = {
  hidden: { y: '100%' },
  visible: {
    y: 0,
    transition: {
      type: 'spring',
      stiffness: 300,
      damping: 30,
    },
  },
  exit: {
    y: '100%',
    transition: {
      duration: 0.2,
    },
  },
};

// reduce-motion 사용자를 위한 variants
const reducedMotionVariants = {
  hidden: { opacity: 0, y: 0 },
  visible: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 0 },
};

/**
 * 공통 BottomSheet 컴포넌트
 *
 * @example
 * // 기본 사용
 * <BottomSheet isOpen={isOpen} onClose={() => setIsOpen(false)} title="옵션">
 *   시트 내용
 * </BottomSheet>
 *
 * // 전체 높이
 * <BottomSheet isOpen={isOpen} onClose={() => setIsOpen(false)} height="full">
 *   긴 내용...
 * </BottomSheet>
 */
export default function BottomSheet({
  isOpen,
  onClose,
  title,
  height = 'auto',
  enableDrag = true,
  closeOnBackdropClick = true,
  children,
  zIndex = 'z-50',
}: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragControls = useDragControls();
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const prefersReducedMotion = useReducedMotion();

  // 접근성 설정에 따라 애니메이션 선택
  const activeSheetVariants = prefersReducedMotion ? reducedMotionVariants : sheetVariants;
  const activeBackdropVariants = prefersReducedMotion ? reducedMotionVariants : backdropVariants;

  // 드래그 종료 핸들러
  const handleDragEnd = useCallback(
    (_: any, info: PanInfo) => {
      // 아래로 100px 이상 드래그하거나 빠르게 스와이프하면 닫기
      if (info.offset.y > 100 || info.velocity.y > 500) {
        onClose();
      }
    },
    [onClose]
  );

  // 포커스 트랩 및 스크롤 방지
  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement;
      sheetRef.current?.focus();
      lockScroll();
    }

    return () => {
      unlockScroll();
      if (previousActiveElement.current) {
        previousActiveElement.current.focus();
      }
    };
  }, [isOpen]);

  // ESC 키로 닫기
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  // 백드롭 클릭 핸들러
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (closeOnBackdropClick && e.target === e.currentTarget) {
      onClose();
    }
  };

  // 드래그 핸들 시작
  const startDrag = (e: React.PointerEvent) => {
    if (enableDrag) {
      dragControls.start(e);
    }
  };

  // SSR 대응
  if (typeof window === 'undefined') {
    return null;
  }

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div
          className={`fixed inset-0 ${zIndex}`}
          style={{ left: 'var(--modal-left, 0px)' }}
        >
          {/* 백드롭 */}
          <motion.div
            variants={activeBackdropVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={handleBackdropClick}
            className="absolute inset-0 bg-black/50"
            aria-hidden="true"
          />

          {/* 시트 */}
          <motion.div
            ref={sheetRef}
            variants={activeSheetVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            drag={enableDrag ? 'y' : false}
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            onDragEnd={handleDragEnd}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? 'sheet-title' : undefined}
            tabIndex={-1}
            className={`
              absolute bottom-0 left-0 right-0
              bg-white rounded-t-3xl shadow-xl
              overflow-hidden
              focus:outline-none
              ${heightStyles[height]}
            `}
          >
            {/* 드래그 핸들 */}
            {enableDrag && (
              <div
                onPointerDown={startDrag}
                className="flex justify-center py-3 cursor-grab active:cursor-grabbing touch-none"
              >
                <div className="w-10 h-1 bg-gray-300 rounded-full" />
              </div>
            )}

            {/* 헤더 */}
            {title && (
              <div className="px-6 pb-3 border-b border-gray-100">
                <h2
                  id="sheet-title"
                  className="text-lg font-semibold text-gray-900 text-center"
                >
                  {title}
                </h2>
              </div>
            )}

            {/* 본문 */}
            <div
              className={`
                px-6 py-4 overflow-y-auto overscroll-contain
                ${height === 'auto' ? 'max-h-[70vh]' : 'flex-1'}
              `}
            >
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
