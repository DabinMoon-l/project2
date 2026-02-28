'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import type { CustomFolder } from '@/lib/hooks/useCustomFolders';

interface FolderSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (folderId: string) => void;
  folders: CustomFolder[];
  onCreateFolder: (name: string) => Promise<string | null>;
}

export default function FolderSelectModal({
  isOpen,
  onClose,
  onSelect,
  folders,
  onCreateFolder,
}: FolderSelectModalProps) {
  const [newFolderName, setNewFolderName] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!newFolderName.trim() || creating) return;
    setCreating(true);
    try {
      const folderId = await onCreateFolder(newFolderName.trim());
      if (folderId) {
        setNewFolderName('');
        onSelect(folderId);
      }
    } finally {
      setCreating(false);
    }
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[105] flex items-center justify-center p-6 bg-black/50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[280px] bg-[#F5F0E8] border-2 border-[#1A1A1A] max-h-[60vh] flex flex-col rounded-xl"
          >
            {/* 헤더 */}
            <div className="p-3 border-b border-[#1A1A1A] flex items-center justify-between">
              <h2 className="text-sm font-bold text-[#1A1A1A]">폴더에 저장</h2>
              <button
                onClick={onClose}
                className="w-7 h-7 flex items-center justify-center border border-[#1A1A1A] hover:bg-[#EDEAE4] rounded-lg"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* 새 폴더 만들기 */}
            <div className="p-3 border-b border-[#D4CFC4] flex gap-2">
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                placeholder="새 폴더 이름"
                className="flex-1 px-3 py-2 text-xs border border-[#1A1A1A] bg-[#FDFBF7] text-[#1A1A1A] placeholder-[#5C5C5C] focus:outline-none rounded-lg"
              />
              <button
                onClick={handleCreate}
                disabled={!newFolderName.trim() || creating}
                className="px-3 py-2 text-xs font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#333] disabled:opacity-40 transition-colors rounded-lg"
              >
                {creating ? '...' : '생성'}
              </button>
            </div>

            {/* 폴더 목록 */}
            <div className="flex-1 overflow-y-auto overscroll-contain">
              {folders.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-sm text-[#5C5C5C]">폴더가 없습니다. 새 폴더를 만들어 주세요.</p>
                </div>
              ) : (
                <div className="divide-y divide-[#D4CFC4]">
                  {folders.map((folder) => (
                    <button
                      key={folder.id}
                      onClick={() => onSelect(folder.id)}
                      className="w-full px-4 py-3 flex items-center gap-3 hover:bg-[#EDEAE4] transition-colors text-left"
                    >
                      {/* 폴더 아이콘 */}
                      <svg className="w-5 h-5 text-[#8B6914] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-[#1A1A1A] truncate">{folder.name}</p>
                        <p className="text-[10px] text-[#5C5C5C]">{folder.questions.length}문제</p>
                      </div>
                      <svg className="w-4 h-4 text-[#5C5C5C] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
