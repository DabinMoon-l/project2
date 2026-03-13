'use client';

import { motion, AnimatePresence } from 'framer-motion';
import type { DeletedItem } from '@/lib/hooks/useReview';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  deletedItems: DeletedItem[];
  permanentlyDeleteItem: (id: string) => Promise<void>;
  restoreDeletedItem: (id: string) => Promise<void>;
  /** 복원 성공 시 관련 모드 초기화 콜백 */
  onRestoreSuccess?: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  solved: '문제',
  wrong: '오답',
  bookmark: '찜',
  custom: '커스텀',
};

export default function ReviewDeleteSheet({
  isOpen,
  onClose,
  deletedItems,
  permanentlyDeleteItem,
  restoreDeletedItem,
  onRestoreSuccess,
}: Props) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, pointerEvents: 'auto' as const }}
          animate={{ opacity: 1, pointerEvents: 'auto' as const }}
          exit={{ opacity: 0, pointerEvents: 'none' as const }}
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50"
          style={{ left: 'var(--modal-left, 0px)' }}
          onClick={onClose}
        >
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-h-[70vh] bg-[#F5F0E8] border-t-2 border-[#1A1A1A] overflow-hidden flex flex-col"
          >
            {/* 헤더 */}
            <div className="flex items-center justify-between p-4 border-b border-[#EDEAE4]">
              <h3 className="font-bold text-lg text-[#1A1A1A]">휴지통</h3>
              <button
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* 삭제된 항목 목록 */}
            <div className="flex-1 overflow-y-auto p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm text-[#5C5C5C]">
                  삭제된 항목입니다.
                </p>
                {deletedItems.length > 0 && (
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (confirm(`휴지통의 모든 항목(${deletedItems.length}개)을 영구 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) {
                        try {
                          for (const item of deletedItems) {
                            await permanentlyDeleteItem(item.id);
                          }
                          onClose();
                        } catch (err) {
                          alert('휴지통 비우기에 실패했습니다.');
                        }
                      }
                    }}
                    className="px-3 py-1.5 text-sm font-bold text-[#8B1A1A] border border-[#8B1A1A] hover:bg-[#8B1A1A] hover:text-white transition-colors"
                  >
                    휴지통 비우기
                  </button>
                )}
              </div>
              {deletedItems.length > 0 ? (
                <div className="space-y-2">
                  {deletedItems.map((item) => (
                    <motion.div
                      key={item.id}
                      layout
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      className="flex items-center justify-between p-3 border border-[#5C5C5C] bg-[#EDEAE4]"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-[#1A1A1A] truncate">{item.title}</p>
                        <p className="text-xs text-[#5C5C5C]">
                          {TYPE_LABELS[item.type] || item.type} · {item.questionCount}문제
                        </p>
                      </div>
                      <div className="flex items-center gap-2 ml-2">
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              await restoreDeletedItem(item.id);
                              onClose();
                              onRestoreSuccess?.();
                            } catch (err) {
                              alert('복원에 실패했습니다.');
                            }
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-[#1A6B1A] font-bold border border-[#1A6B1A] hover:bg-[#1A6B1A] hover:text-white transition-colors"
                        >
                          되살리기
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                          </svg>
                        </button>
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              await permanentlyDeleteItem(item.id);
                            } catch (err) {
                              alert('삭제에 실패했습니다.');
                            }
                          }}
                          className="px-3 py-1.5 text-sm text-[#8B1A1A] font-bold border border-[#8B1A1A] hover:bg-[#8B1A1A] hover:text-white transition-colors"
                        >
                          삭제
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <svg className="w-12 h-12 text-[#D4CFC4] mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  <p className="text-sm text-[#5C5C5C]">휴지통이 비어있습니다.</p>
                </div>
              )}
            </div>

            {/* 하단 버튼 */}
            <div className="p-4 border-t border-[#EDEAE4]">
              <button
                onClick={onClose}
                className="w-full py-3 font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors"
              >
                닫기
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
