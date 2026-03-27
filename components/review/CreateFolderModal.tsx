'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWideMode } from '@/lib/hooks/useViewportScale';
import { lockScroll, unlockScroll } from '@/lib/utils/scrollLock';

/**
 * 새 폴더 생성 모달
 * 가로모드: 2쪽 바텀시트 (오버레이 없이, 투명 클릭 영역으로 닫기)
 */
export default function CreateFolderModal({
  isOpen,
  onClose,
  onCreate,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string) => void;
}) {
  const [folderName, setFolderName] = useState('');
  const isWide = useWideMode();

  useEffect(() => {
    if (isOpen && !isWide) {
      lockScroll();
      return () => unlockScroll();
    }
  }, [isOpen, isWide]);

  if (!isOpen) return null;

  const handleCreate = () => {
    if (folderName.trim()) {
      onCreate(folderName.trim());
      setFolderName('');
      onClose();
    }
  };

  const content = (
    <>
      <h3 className="font-bold text-base text-[#1A1A1A] mb-3">새 폴더 만들기</h3>
      <input
        type="text"
        value={folderName}
        onChange={(e) => setFolderName(e.target.value)}
        placeholder="폴더 이름"
        className="w-full px-2.5 py-1.5 text-sm border border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A] mb-3 outline-none focus:border-2 rounded-lg"
        autoFocus
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        inputMode="text"
        data-form-type="other"
        data-lpignore="true"
      />
      <div className="flex gap-2">
        <button type="button" onClick={onClose} className="flex-1 py-1.5 text-xs font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors rounded-lg">취소</button>
        <button type="button" onClick={handleCreate} disabled={!folderName.trim()} className="flex-1 py-1.5 text-xs font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors disabled:opacity-50 rounded-lg">만들기</button>
      </div>
    </>
  );

  // 가로모드: 2쪽 바텀시트
  if (isWide) {
    return (
      <AnimatePresence>
        <div className="fixed inset-0 z-50" style={{ left: 'var(--modal-left, 240px)', right: 'var(--modal-right, 0px)' }} onClick={onClose} />
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', stiffness: 400, damping: 35 }}
          className="fixed z-[51] bg-[#F5F0E8] rounded-t-2xl shadow-[0_-4px_24px_rgba(0,0,0,0.15)] border-t-2 border-x-2 border-[#1A1A1A] p-4"
          style={{ left: 'var(--modal-left, 240px)', right: 'var(--modal-right, 0px)', bottom: 'var(--kb-offset, 0px)' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-center -mt-2 mb-2"><div className="w-8 h-1 rounded-full bg-[#D4CFC4]" /></div>
          {content}
        </motion.div>
      </AnimatePresence>
    );
  }

  // 모바일: 기존 센터 모달
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      style={{ touchAction: 'none', paddingBottom: 'var(--kb-offset, 0px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-[#F5F0E8] border-2 border-[#1A1A1A] p-3 mx-4 max-w-sm w-full rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {content}
      </motion.div>
    </div>
  );
}
