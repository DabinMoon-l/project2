'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

interface MilestoneChoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  pendingCount: number;
  onChooseLevelUp: () => void;
  onChooseGacha: () => void;
  /** 모든 토끼를 발견한 경우 뽑기 비활성화 */
  allRabbitsDiscovered?: boolean;
}

/**
 * 마일스톤 선택 모달 — 빈티지 신문 스타일
 */
export default function MilestoneChoiceModal({
  isOpen,
  onClose,
  pendingCount,
  onChooseLevelUp,
  onChooseGacha,
  allRabbitsDiscovered = false,
}: MilestoneChoiceModalProps) {
  // 네비게이션 숨김
  useEffect(() => {
    if (isOpen) {
      document.body.setAttribute('data-hide-nav', '');
    } else {
      document.body.removeAttribute('data-hide-nav');
    }
    return () => document.body.removeAttribute('data-hide-nav');
  }, [isOpen]);

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/50"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="w-full max-w-xs bg-[#F5F0E8] border-2 border-[#1A1A1A] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center">
              {/* 아이콘 */}
              <div className="w-12 h-12 mx-auto mb-3 flex items-center justify-center">
                <svg className="w-8 h-8 text-[#D4AF37]" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
                </svg>
              </div>

              {/* 타이틀 */}
              <h2 className="text-lg font-bold text-[#1A1A1A] mb-1">마일스톤 달성!</h2>
              <p className="text-sm text-[#5C5C5C] mb-5">
                사용 가능: <span className="font-bold text-[#1A1A1A]">{pendingCount}개</span>
              </p>

              {/* 버튼들 */}
              <div className="flex flex-col gap-2.5">
                {/* 레벨업 */}
                <button
                  onClick={onChooseLevelUp}
                  className="w-full py-3 bg-[#1A1A1A] text-[#F5F0E8] font-bold border-2 border-[#1A1A1A] flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
                  </svg>
                  토끼 레벨업
                </button>

                {/* 뽑기 */}
                <button
                  onClick={onChooseGacha}
                  disabled={allRabbitsDiscovered}
                  className="w-full py-3 bg-[#F5F0E8] text-[#1A1A1A] font-bold border-2 border-[#1A1A1A] flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-40 disabled:active:scale-100"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6z" />
                  </svg>
                  새 토끼 뽑기
                </button>
                {allRabbitsDiscovered && (
                  <p className="text-xs text-[#5C5C5C] -mt-1">모든 토끼를 발견했어요!</p>
                )}

                {/* 나중에 */}
                <button
                  onClick={onClose}
                  className="w-full py-2 text-[#5C5C5C] text-sm hover:text-[#1A1A1A] transition-colors"
                >
                  나중에 하기
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
