'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { lockScroll, unlockScroll } from '@/lib/utils/scrollLock';

/**
 * 새 폴더 생성 모달
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

  // 키보드 올라올 때 body 스크롤 방지
  useEffect(() => {
    if (isOpen) {
      lockScroll();
      return () => unlockScroll();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCreate = () => {
    if (folderName.trim()) {
      onCreate(folderName.trim());
      setFolderName('');
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      style={{ position: 'fixed', touchAction: 'none', left: 'var(--modal-left, 0px)', right: 'var(--modal-right, 0px)' }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-[#F5F0E8] border-2 border-[#1A1A1A] p-3 mx-4 max-w-sm w-full rounded-2xl"
      >
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
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-1.5 text-xs font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors rounded-lg"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!folderName.trim()}
            className="flex-1 py-1.5 text-xs font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors disabled:opacity-50 rounded-lg"
          >
            만들기
          </button>
        </div>
      </motion.div>
    </div>
  );
}
