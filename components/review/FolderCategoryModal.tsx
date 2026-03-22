'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
interface FolderCategory {
  id: string;
  name: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  folderCategories: FolderCategory[];
  folderCategoryMap: Record<string, string>;
  hasCustomFolders: boolean;
  onAddCategory: (name: string) => void;
  onRemoveCategory: (categoryId: string) => void;
  onStartAssignMode: () => void;
}

export default function FolderCategoryModal({
  isOpen,
  onClose,
  folderCategories,
  folderCategoryMap,
  hasCustomFolders,
  onAddCategory,
  onRemoveCategory,
  onStartAssignMode,
}: Props) {
  const [newCategoryName, setNewCategoryName] = useState('');

  const handleAdd = () => {
    if (!newCategoryName.trim()) return;
    onAddCategory(newCategoryName.trim());
    setNewCategoryName('');
  };

  const handleClose = () => {
    setNewCategoryName('');
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-3"
          style={{ position: 'fixed', touchAction: 'none', left: 'var(--modal-left, 0px)', right: 'var(--modal-right, 0px)' }}
          onClick={handleClose}
        >
          {/* 배경 오버레이 */}
          <div className="absolute inset-0 bg-black/50" />

          {/* 모달 컨텐츠 */}
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="relative bg-[#F5F0E8] border-2 border-[#1A1A1A] w-full max-w-sm max-h-[80vh] overflow-y-auto rounded-2xl"
          >
            {/* 헤더 */}
            <div className="flex items-center justify-between p-3 border-b-2 border-[#1A1A1A]">
              <h3 className="font-bold text-base text-[#1A1A1A]">카테고리 설정</h3>
              <button
                onClick={handleClose}
                className="w-7 h-7 flex items-center justify-center text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* 본문 */}
            <div className="p-3 space-y-3">
              {/* 카테고리 추가 */}
              <div>
                <label className="block text-xs font-bold text-[#1A1A1A] mb-1.5">새 카테고리 추가</label>
                {folderCategories.length >= 8 ? (
                  <div className="p-2.5 border-2 border-dashed border-[#5C5C5C] bg-[#EDEAE4] text-center">
                    <p className="text-xs text-[#5C5C5C]">카테고리는 최대 8개까지 추가할 수 있습니다.</p>
                  </div>
                ) : (
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                      placeholder="카테고리 이름 입력"
                      className="flex-1 px-2.5 py-1.5 border-2 border-[#1A1A1A] bg-[#F5F0E8] text-xs focus:outline-none rounded-lg"
                      maxLength={20}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      inputMode="text"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newCategoryName.trim()) {
                          handleAdd();
                        }
                      }}
                    />
                    <button
                      onClick={handleAdd}
                      disabled={!newCategoryName.trim()}
                      className="px-3 py-1.5 bg-[#1A1A1A] text-[#F5F0E8] font-bold text-xs disabled:opacity-30 rounded-lg"
                    >
                      추가
                    </button>
                  </div>
                )}
              </div>

              {/* 현재 카테고리 목록 */}
              <div>
                <label className="block text-xs font-bold text-[#1A1A1A] mb-1.5">
                  현재 카테고리 ({folderCategories.length}/8개)
                </label>
                {folderCategories.length === 0 ? (
                  <p className="text-[11px] text-[#5C5C5C] py-3 text-center border border-dashed border-[#5C5C5C]">
                    아직 카테고리가 없습니다. 위에서 추가해주세요.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {folderCategories.map((cat) => {
                      const folderCount = Object.values(folderCategoryMap).filter(
                        (catId) => catId === cat.id
                      ).length;

                      return (
                        <div
                          key={cat.id}
                          className="flex items-center justify-between p-2.5 border-2 border-[#1A1A1A] bg-[#EDEAE4] rounded-lg"
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-xs text-[#1A1A1A]">{cat.name}</span>
                            <span className="text-[11px] text-[#5C5C5C]">({folderCount}개)</span>
                          </div>
                          <button
                            onClick={() => onRemoveCategory(cat.id)}
                            className="px-1.5 py-0.5 text-[11px] font-bold text-[#8B1A1A] border border-[#8B1A1A] hover:bg-[#FDEAEA] transition-colors rounded-md"
                          >
                            삭제
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 폴더 배정 모드 진입 버튼 */}
              {folderCategories.length > 0 && hasCustomFolders && (
                <div className="pt-2.5 border-t-2 border-[#EDEAE4]">
                  <button
                    onClick={onStartAssignMode}
                    className="w-full py-2.5 font-bold text-xs bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#3A3A3A] transition-colors rounded-lg"
                  >
                    폴더 배정하기
                  </button>
                  <p className="text-[11px] text-[#5C5C5C] text-center mt-1.5">
                    폴더를 선택 → 원하는 카테고리 헤더를 탭하세요
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
