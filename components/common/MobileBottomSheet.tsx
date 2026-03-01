'use client';

/**
 * 모바일 바텀시트 — 키보드 대체 패널용
 *
 * 키보드 위 플로팅 툴바에서 아이콘 탭 → 키보드 닫힘 → 바텀시트 슬라이드업.
 * 닫으면 다시 텍스트 입력 가능.
 * 드래그 핸들을 아래로 스와이프하면 닫힘.
 */

import { type ReactNode, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';

interface MobileBottomSheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** 최대 높이 (기본 60vh) */
  maxHeight?: string;
}

export default function MobileBottomSheet({ open, onClose, children, maxHeight = '60vh' }: MobileBottomSheetProps) {
  // 80px 이상 아래로 드래그하거나, 빠르게 스와이프하면 닫기
  const handleDragEnd = useCallback((_: any, info: PanInfo) => {
    if (info.offset.y > 80 || info.velocity.y > 300) {
      onClose();
    }
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end"
          onClick={onClose}
        >
          {/* 배경 딤 */}
          <div className="absolute inset-0 bg-black/30" />

          {/* 시트 */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            drag="y"
            dragConstraints={{ top: 0 }}
            dragElastic={0.2}
            onDragEnd={handleDragEnd}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full bg-[#F5F0E8] rounded-t-2xl shadow-[0_-8px_32px_rgba(0,0,0,0.12)] border border-[#D4CFC4]/60 border-b-0 overflow-y-auto"
            style={{ maxHeight, touchAction: 'pan-x' }}
          >
            {/* 드래그 핸들 */}
            <div className="flex justify-center pt-3 pb-1 sticky top-0 bg-[#F5F0E8] z-10 rounded-t-2xl cursor-grab active:cursor-grabbing">
              <div className="w-10 h-1 bg-[#D4CFC4]/80 rounded-full" />
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
