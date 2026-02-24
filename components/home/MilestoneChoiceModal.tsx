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
 * 마일스톤 선택 모달 — 홈 스타일 (home-bg + 글래스모피즘)
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
          className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/40"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="w-full max-w-xs relative overflow-hidden rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 배경 이미지 + 글래스 오버레이 */}
            <div className="absolute inset-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/images/home-bg.jpg" alt="" className="w-full h-full object-cover" />
            </div>
            <div className="absolute inset-0 bg-white/10 backdrop-blur-2xl" />

            {/* 컨텐츠 */}
            <div className="relative z-10 p-6">
              <div className="text-center">
                {/* 아이콘 */}
                <div className="w-12 h-12 mx-auto mb-3 flex items-center justify-center">
                  <svg className="w-8 h-8" viewBox="0 0 24 24">
                    <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="#D4AF37" />
                  </svg>
                </div>

                {/* 타이틀 */}
                <h2 className="text-lg font-bold text-white mb-1">마일스톤 달성!</h2>
                <p className="text-sm text-white/60 mb-5">
                  사용 가능: <span className="font-bold text-white">{pendingCount}개</span>
                </p>

                {/* 버튼들 */}
                <div className="flex flex-col gap-2.5">
                  {/* 레벨업 */}
                  <button
                    onClick={onChooseLevelUp}
                    className="w-full py-3 bg-white/25 text-white font-bold border border-white/30 rounded-full active:scale-[0.98] transition-transform"
                  >
                    토끼 레벨업
                  </button>

                  {/* 뽑기 */}
                  <button
                    onClick={onChooseGacha}
                    disabled={allRabbitsDiscovered}
                    className="w-full py-3 bg-white/15 text-white font-bold border border-white/20 rounded-full active:scale-[0.98] transition-transform disabled:opacity-40 disabled:active:scale-100"
                  >
                    새 토끼 뽑기
                  </button>
                  {allRabbitsDiscovered && (
                    <p className="text-xs text-white/50 -mt-1">모든 토끼를 발견했어요!</p>
                  )}

                  {/* 나중에 */}
                  <button
                    onClick={onClose}
                    className="w-full py-2 text-white/50 text-sm hover:text-white/80 transition-colors"
                  >
                    나중에 하기
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
