'use client';

/**
 * WideBottomSheet — 가로모드에서 모달을 바텀시트로 변환하는 래퍼
 *
 * 모바일: children을 그대로 렌더 (기존 모달)
 * 가로모드: 투명 오버레이 + 하단 바텀시트 (해당 패널 영역)
 *
 * @param panel - '2' (2쪽/메인), '3' (3쪽/디테일)
 */

import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { useWideMode } from '@/lib/hooks/useViewportScale';

interface WideBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** 어느 패널에서 열린 모달인지: '2' = 메인(2쪽), '3' = 디테일(3쪽) */
  panel?: '2' | '3';
  zIndex?: number;
}

export default function WideBottomSheet({
  isOpen,
  onClose,
  children,
  panel = '2',
  zIndex = 50,
}: WideBottomSheetProps) {
  const isWide = useWideMode();

  if (typeof window === 'undefined') return null;

  // 모바일: 기존 모달 그대로
  if (!isWide) {
    return (
      <AnimatePresence>
        {isOpen && children}
      </AnimatePresence>
    );
  }

  // 가로모드: 투명 오버레이 + 바텀시트
  const panelStyle = panel === '3'
    ? { left: 'var(--detail-panel-left, calc(50% + 120px))', right: '0' }
    : { left: 'var(--modal-left, 240px)', right: 'var(--modal-right, 0px)' };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          {/* 투명 오버레이 — 패널 영역, 클릭 시 닫기 */}
          <motion.div
            key="wbs-overlay"
            className="fixed inset-0"
            style={{ zIndex, ...panelStyle }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          {/* 바텀시트 */}
          <motion.div
            key="wbs-sheet"
            className="fixed bottom-0 bg-[#F5F0E8] rounded-t-2xl shadow-[0_-4px_24px_rgba(0,0,0,0.15)] overflow-hidden border-t-2 border-x-2 border-[#1A1A1A]"
            style={{ zIndex: zIndex + 1, ...panelStyle }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 400, damping: 35 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center pt-2 pb-1">
              <div className="w-8 h-1 rounded-full bg-[#D4CFC4]" />
            </div>
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
