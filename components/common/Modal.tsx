'use client';

import { useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { useReducedMotion } from '@/lib/hooks/useReducedMotion';

// Modal 크기 타입
type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

// Modal Props 타입
interface ModalProps {
  /** 모달 열림 상태 */
  isOpen: boolean;
  /** 모달 닫기 핸들러 */
  onClose: () => void;
  /** 모달 제목 */
  title?: string;
  /** 모달 크기 */
  size?: ModalSize;
  /** 백드롭 클릭으로 닫기 허용 */
  closeOnBackdropClick?: boolean;
  /** ESC 키로 닫기 허용 */
  closeOnEsc?: boolean;
  /** 닫기 버튼 표시 */
  showCloseButton?: boolean;
  /** 모달 내용 */
  children: React.ReactNode;
  /** 푸터 영역 */
  footer?: React.ReactNode;
}

// 크기별 스타일
const sizeStyles: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  full: 'max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)]',
};

// 애니메이션 설정
const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

const modalVariants = {
  hidden: {
    opacity: 0,
    scale: 0.95,
    y: 10,
  },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      type: 'spring',
      stiffness: 300,
      damping: 25,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    y: 10,
    transition: {
      duration: 0.15,
    },
  },
};

// reduce-motion 사용자를 위한 variants
const reducedMotionVariants = {
  hidden: { opacity: 1 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

/**
 * 공통 Modal 컴포넌트
 *
 * @example
 * // 기본 사용
 * <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="확인">
 *   모달 내용
 * </Modal>
 *
 * // 푸터와 함께
 * <Modal
 *   isOpen={isOpen}
 *   onClose={() => setIsOpen(false)}
 *   title="저장하시겠습니까?"
 *   footer={
 *     <>
 *       <Button variant="ghost" onClick={() => setIsOpen(false)}>취소</Button>
 *       <Button onClick={handleSave}>저장</Button>
 *     </>
 *   }
 * >
 *   변경사항을 저장합니다.
 * </Modal>
 */
export default function Modal({
  isOpen,
  onClose,
  title,
  size = 'md',
  closeOnBackdropClick = true,
  closeOnEsc = true,
  showCloseButton = true,
  children,
  footer,
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const prefersReducedMotion = useReducedMotion();

  // 접근성 설정에 따라 애니메이션 선택
  const activeModalVariants = prefersReducedMotion ? reducedMotionVariants : modalVariants;
  const activeBackdropVariants = prefersReducedMotion ? reducedMotionVariants : backdropVariants;

  // ESC 키 핸들러
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (closeOnEsc && e.key === 'Escape') {
        onClose();
      }
    },
    [closeOnEsc, onClose]
  );

  // 포커스 트랩
  useEffect(() => {
    if (isOpen) {
      // 이전 포커스 저장
      previousActiveElement.current = document.activeElement as HTMLElement;

      // 모달에 포커스
      modalRef.current?.focus();

      // 스크롤 방지
      document.body.style.overflow = 'hidden';

      // 키보드 이벤트 등록
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';

      // 이전 포커스 복원
      if (previousActiveElement.current) {
        previousActiveElement.current.focus();
      }
    };
  }, [isOpen, handleKeyDown]);

  // 백드롭 클릭 핸들러
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (closeOnBackdropClick && e.target === e.currentTarget) {
      onClose();
    }
  };

  // SSR 대응
  if (typeof window === 'undefined') {
    return null;
  }

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* 백드롭 */}
          <motion.div
            variants={activeBackdropVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={handleBackdropClick}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            aria-hidden="true"
          />

          {/* 모달 */}
          <motion.div
            ref={modalRef}
            variants={activeModalVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? 'modal-title' : undefined}
            tabIndex={-1}
            className={`
              relative w-full
              bg-white rounded-2xl shadow-xl
              overflow-hidden
              focus:outline-none
              ${sizeStyles[size]}
            `}
          >
            {/* 헤더 */}
            {(title || showCloseButton) && (
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                {title && (
                  <h2
                    id="modal-title"
                    className="text-lg font-semibold text-gray-900"
                  >
                    {title}
                  </h2>
                )}
                {showCloseButton && (
                  <button
                    onClick={onClose}
                    className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    aria-label="닫기"
                  >
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                )}
              </div>
            )}

            {/* 본문 */}
            <div className="px-6 py-4 max-h-[60vh] overflow-y-auto">
              {children}
            </div>

            {/* 푸터 */}
            {footer && (
              <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100 bg-gray-50">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
