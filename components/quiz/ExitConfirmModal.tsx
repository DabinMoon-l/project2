'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { useEffect, useRef } from 'react';
import { lockScroll, unlockScroll } from '@/lib/utils/scrollLock';

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
  /** 저장하지 않고 나가기 버튼 숨김 (퀴즈 점수 조작 방지) */
  hideExitWithoutSave?: boolean;
  /** 3쪽 패널 모드 — 모달을 3쪽 안에 배치 */
  isPanelMode?: boolean;
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
  hideExitWithoutSave = false,
  isPanelMode = false,
}: ExitConfirmModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  // 포커스 트랩 및 접근성
  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement;
      modalRef.current?.focus({ preventScroll: true });
      // 패널 모드: body 스크롤 잠금 불필요 (aside 자체 스크롤 컨텍스트)
      // lockScroll()이 body.overflow=hidden 설정 → vw 변경 → 3쪽 레이아웃 흔들림 방지
      if (!isPanelMode) lockScroll();
    }

    return () => {
      if (!isPanelMode) unlockScroll();
      if (previousActiveElement.current) {
        previousActiveElement.current.focus();
      }
    };
  }, [isOpen, isPanelMode]);

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

  // 패널 모드: 3쪽 하단 바텀시트 (오버레이 없이)
  if (isPanelMode) {
    return (
      <AnimatePresence>
        {isOpen && (
          <motion.div
            ref={modalRef}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 400, damping: 35 }}
            role="alertdialog"
            aria-modal="true"
            tabIndex={-1}
            className="absolute bottom-0 left-0 right-0 z-[70] w-full bg-[#F5F0E8] rounded-t-2xl shadow-[0_-4px_24px_rgba(0,0,0,0.15)] overflow-hidden focus:outline-none border-t-2 border-x-2 border-[#1A1A1A]"
          >
            <div className="flex justify-center pt-2 pb-1"><div className="w-8 h-1 rounded-full bg-[#D4CFC4]" /></div>
            <div className="px-5 pb-3 text-center">
              <h2 className="text-sm font-bold text-[#1A1A1A] mb-1">퀴즈를 나가시겠습니까?</h2>
              <p className="text-xs text-[#5C5C5C]">{answeredCount}/{totalQuestions} 문제 답변 완료</p>
              <div className="mt-2.5 h-1.5 bg-[#DDD8D0] rounded-full overflow-hidden">
                <motion.div initial={{ width: 0 }} animate={{ width: `${(answeredCount / totalQuestions) * 100}%` }} transition={{ duration: 0.5 }} className="h-full bg-[#1A1A1A] rounded-full" />
              </div>
            </div>
            <div className="flex flex-col gap-1.5 px-4 pb-4 pt-2">
              <motion.button whileTap={{ scale: 0.98 }} onClick={onClose} disabled={isSaving} className="w-full py-2 text-xs font-bold text-[#F5F0E8] bg-[#1A1A1A] rounded-xl disabled:opacity-50">계속 풀기</motion.button>
              <motion.button whileTap={{ scale: 0.98 }} onClick={onSaveAndExit} disabled={isSaving} className="w-full py-2 text-xs font-bold bg-white text-[#1A1A1A] rounded-xl border border-[#D4CFC4] disabled:opacity-50 flex items-center justify-center">
                {isSaving ? (<><svg className="animate-spin w-4 h-4 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>저장 중...</>) : '저장하고 나가기'}
              </motion.button>
              {!hideExitWithoutSave && (
                <motion.button whileTap={{ scale: 0.98 }} onClick={onExitWithoutSave} disabled={isSaving} className="w-full py-2 text-xs font-bold bg-white text-[#8B1A1A] rounded-xl border border-[#D4CFC4] disabled:opacity-50">저장하지 않고 나가기</motion.button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          style={{
            left: 'var(--modal-left, 0px)',
            right: 'var(--modal-right, 0px)',
          }}
        >
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
            className="relative w-full max-w-[280px] bg-[#F5F0E8] rounded-2xl shadow-xl overflow-hidden focus:outline-none"
          >
            {/* 본문 */}
            <div className="px-5 pt-5 pb-3 text-center">
              <h2
                id="exit-modal-title"
                className="text-sm font-bold text-[#1A1A1A] mb-1"
              >
                퀴즈를 나가시겠습니까?
              </h2>
              <p
                id="exit-modal-description"
                className="text-xs text-[#5C5C5C] leading-relaxed"
              >
                {answeredCount}/{totalQuestions} 문제 답변 완료
              </p>

              {/* 진행 바 */}
              <div className="mt-2.5 h-1.5 bg-[#DDD8D0] rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{
                    width: `${(answeredCount / totalQuestions) * 100}%`,
                  }}
                  transition={{ duration: 0.5 }}
                  className="h-full bg-[#1A1A1A] rounded-full"
                />
              </div>
            </div>

            {/* 버튼 영역 */}
            <div className="flex flex-col gap-1.5 px-4 pb-4 pt-2">
              {/* 계속 풀기 버튼 */}
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onClose}
                disabled={isSaving}
                className="w-full py-2 text-xs font-bold text-[#F5F0E8] bg-[#1A1A1A] rounded-xl transition-all duration-200 hover:bg-[#2A2A2A] disabled:opacity-50"
              >
                계속 풀기
              </motion.button>

              {/* 저장하고 나가기 버튼 */}
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onSaveAndExit}
                disabled={isSaving}
                className="w-full py-2 text-xs font-bold bg-white text-[#1A1A1A] rounded-xl border border-[#D4CFC4] hover:bg-[#F5F0E8] transition-all duration-200 disabled:opacity-50 flex items-center justify-center"
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

              {/* 저장하지 않고 나가기 버튼 (퀴즈에서는 점수 조작 방지를 위해 숨김) */}
              {!hideExitWithoutSave && (
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={onExitWithoutSave}
                  disabled={isSaving}
                  className="w-full py-2 text-xs font-bold bg-white text-[#8B1A1A] rounded-xl border border-[#D4CFC4] hover:bg-[#FDEAEA] transition-all duration-200 disabled:opacity-50"
                >
                  저장하지 않고 나가기
                </motion.button>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
