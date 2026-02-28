'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { useEffect, useRef } from 'react';

/**
 * ExitConfirmModal Props 타입
 */
interface ExitConfirmModalProps {
  /** 모달 열림 상태 */
  isOpen: boolean;
  /** 모달 닫기 핸들러 */
  onClose: () => void;
  /** 저장하고 나가기 핸들러 */
  onSaveAndExit: () => void;
  /** 저장하지 않고 나가기 핸들러 */
  onExitWithoutSave: () => void;
  /** 현재 진행도 (답변한 문제 수) */
  answeredCount: number;
  /** 총 문제 수 */
  totalQuestions: number;
  /** 저장 중 상태 */
  isSaving?: boolean;
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
 * 진행 상황을 저장할지 선택할 수 있습니다.
 */
export default function ExitConfirmModal({
  isOpen,
  onClose,
  onSaveAndExit,
  onExitWithoutSave,
  answeredCount,
  totalQuestions,
  isSaving = false,
}: ExitConfirmModalProps) {
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
      if (e.key === 'Escape' && !isSaving) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose, isSaving]);

  // 백드롭 클릭 핸들러
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !isSaving) {
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
            className="relative w-full max-w-sm bg-[#F5F0E8] border-2 border-[#1A1A1A] shadow-xl overflow-hidden focus:outline-none"
          >
            {/* 경고 아이콘 */}
            <div className="flex justify-center pt-4">
              <div className="w-10 h-10 border-2 border-[#8B6914] bg-[#FFF8E1] flex items-center justify-center">
                <svg
                  className="w-5 h-5 text-[#8B6914]"
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
            <div className="px-4 py-2.5 text-center">
              <h2
                id="exit-modal-title"
                className="text-sm font-bold text-[#1A1A1A] mb-2"
              >
                퀴즈를 나가시겠습니까?
              </h2>
              <p
                id="exit-modal-description"
                className="text-xs text-[#5C5C5C] leading-relaxed"
              >
                진행 상황을 저장하면 나중에
                <br />
                이어서 풀 수 있습니다.
              </p>

              {/* 진행 상황 표시 */}
              <div className="mt-4 p-2 bg-[#EDEAE4] border border-[#1A1A1A]">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#5C5C5C]">현재 진행도</span>
                  <span className="font-bold text-[#1A1A1A]">
                    {answeredCount}/{totalQuestions} 문제 답변 완료
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 bg-[#DDD8D0] overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{
                      width: `${(answeredCount / totalQuestions) * 100}%`,
                    }}
                    transition={{ duration: 0.5 }}
                    className="h-full bg-[#1A1A1A]"
                  />
                </div>
              </div>
            </div>

            {/* 버튼 영역 */}
            <div className="flex flex-col gap-1.5 px-4 py-2.5 border-t-2 border-[#1A1A1A] bg-[#EDEAE4]">
              {/* 계속 풀기 버튼 */}
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onClose}
                disabled={isSaving}
                className="w-full py-2 text-xs font-bold text-[#F5F0E8] bg-[#1A1A1A] border-2 border-[#1A1A1A] transition-all duration-200 hover:bg-[#2A2A2A] disabled:opacity-50"
              >
                계속 풀기
              </motion.button>

              {/* 저장하고 나가기 버튼 */}
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onSaveAndExit}
                disabled={isSaving}
                className="w-full py-2 text-xs font-bold bg-[#F5F0E8] text-[#1A1A1A] border-2 border-[#1A1A1A] hover:bg-[#E5E0D8] transition-all duration-200 disabled:opacity-50 flex items-center justify-center"
              >
                {isSaving ? (
                  <>
                    <svg
                      className="animate-spin w-4 h-4 mr-2"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    저장 중...
                  </>
                ) : (
                  '저장하고 나가기'
                )}
              </motion.button>

              {/* 저장하지 않고 나가기 버튼 */}
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onExitWithoutSave}
                disabled={isSaving}
                className="w-full py-2 text-xs font-bold bg-[#F5F0E8] text-[#8B1A1A] border-2 border-[#8B1A1A] hover:bg-[#FDEAEA] transition-all duration-200 disabled:opacity-50"
              >
                저장하지 않고 나가기
              </motion.button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
