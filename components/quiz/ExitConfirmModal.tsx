'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { useEffect, useRef } from 'react';
import { useThemeColors } from '@/styles/themes/useTheme';

/**
 * ExitConfirmModal Props 타입
 */
interface ExitConfirmModalProps {
  /** 모달 열림 상태 */
  isOpen: boolean;
  /** 모달 닫기 핸들러 */
  onClose: () => void;
  /** 나가기 확인 핸들러 */
  onConfirm: () => void;
  /** 현재 진행도 (답변한 문제 수) */
  answeredCount: number;
  /** 총 문제 수 */
  totalQuestions: number;
}

// 애니메이션 variants
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

/**
 * 나가기 확인 모달 컴포넌트
 *
 * 퀴즈 풀이 중 나가기 버튼을 누르면 표시되는 확인 모달입니다.
 * 진행 상황을 잃어버린다는 경고 메시지를 보여줍니다.
 *
 * @example
 * ```tsx
 * <ExitConfirmModal
 *   isOpen={showExitModal}
 *   onClose={() => setShowExitModal(false)}
 *   onConfirm={() => router.back()}
 *   answeredCount={5}
 *   totalQuestions={10}
 * />
 * ```
 */
export default function ExitConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  answeredCount,
  totalQuestions,
}: ExitConfirmModalProps) {
  const colors = useThemeColors();
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  // 포커스 트랩 및 접근성
  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement;
      modalRef.current?.focus();
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.body.style.overflow = '';
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
    if (e.target === e.currentTarget) {
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
            variants={backdropVariants}
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
            variants={modalVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="exit-modal-title"
            aria-describedby="exit-modal-description"
            tabIndex={-1}
            className="relative w-full max-w-sm bg-white rounded-2xl shadow-xl overflow-hidden focus:outline-none"
          >
            {/* 경고 아이콘 */}
            <div className="flex justify-center pt-6">
              <div className="w-16 h-16 rounded-full bg-orange-100 flex items-center justify-center">
                <svg
                  className="w-8 h-8 text-orange-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>
            </div>

            {/* 본문 */}
            <div className="px-6 py-4 text-center">
              <h2
                id="exit-modal-title"
                className="text-lg font-bold text-gray-900 mb-2"
              >
                퀴즈를 나가시겠습니까?
              </h2>
              <p
                id="exit-modal-description"
                className="text-sm text-gray-600 leading-relaxed"
              >
                지금 나가면{' '}
                <span className="font-semibold text-orange-600">
                  {answeredCount}개
                </span>
                의 답변이 모두 사라집니다.
                <br />
                나중에 처음부터 다시 풀어야 해요.
              </p>

              {/* 진행 상황 표시 */}
              <div className="mt-4 p-3 bg-gray-50 rounded-xl">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">현재 진행도</span>
                  <span className="font-semibold text-gray-900">
                    {answeredCount}/{totalQuestions} 문제 답변 완료
                  </span>
                </div>
                <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{
                      width: `${(answeredCount / totalQuestions) * 100}%`,
                    }}
                    transition={{ duration: 0.5 }}
                    className="h-full rounded-full"
                    style={{ backgroundColor: colors.accent }}
                  />
                </div>
              </div>
            </div>

            {/* 버튼 영역 */}
            <div className="flex gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
              {/* 계속 풀기 버튼 */}
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onClose}
                style={{ backgroundColor: colors.accent }}
                className="flex-1 py-3 rounded-xl font-semibold text-white transition-all duration-200"
              >
                계속 풀기
              </motion.button>

              {/* 나가기 버튼 */}
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onConfirm}
                className="flex-1 py-3 rounded-xl font-semibold bg-gray-200 text-gray-700 hover:bg-gray-300 transition-all duration-200"
              >
                나가기
              </motion.button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
