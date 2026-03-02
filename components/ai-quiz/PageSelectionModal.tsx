'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { lockScroll, unlockScroll } from '@/lib/utils/scrollLock';

// 최대 페이지 선택 제한 (서버와 동일하게 유지)
const MAX_PAGES = 20;

interface DocumentPage {
  pageNum: number;
  thumbnail: string;
  selected: boolean;
}

interface PageSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (selectedPages: DocumentPage[]) => void;
  pages: DocumentPage[];
  title: string; // "PDF 페이지 선택" 또는 "PPT 이미지 선택"
  isLoading?: boolean;
  loadingMessage?: string;
}

/**
 * PDF/PPT 페이지 선택 모달
 * 2열 그리드로 큰 썸네일을 보여주며 페이지 선택 가능
 */
export default function PageSelectionModal({
  isOpen,
  onClose,
  onConfirm,
  pages: initialPages,
  title,
  isLoading = false,
  loadingMessage = '로딩 중...',
}: PageSelectionModalProps) {
  const [pages, setPages] = useState<DocumentPage[]>([]);

  // pages prop이 변경되면 상태 업데이트
  useEffect(() => {
    setPages(initialPages);
  }, [initialPages]);

  // 페이지 선택/해제 토글
  const togglePage = (pageNum: number) => {
    setPages(prev => {
      const page = prev.find(p => p.pageNum === pageNum);
      const currentSelected = prev.filter(p => p.selected).length;

      // 선택 해제는 항상 허용
      if (page?.selected) {
        return prev.map(p =>
          p.pageNum === pageNum ? { ...p, selected: false } : p
        );
      }

      // 선택 추가 시 제한 체크
      if (currentSelected >= MAX_PAGES) {
        return prev; // 제한 초과 시 변경 없음
      }

      return prev.map(p =>
        p.pageNum === pageNum ? { ...p, selected: true } : p
      );
    });
  };

  // 전체 선택/해제
  const toggleAll = () => {
    const allSelected = pages.every(p => p.selected);
    if (allSelected) {
      // 전체 해제
      setPages(prev => prev.map(p => ({ ...p, selected: false })));
    } else {
      // 전체 선택 (최대 MAX_PAGES까지만)
      setPages(prev => prev.map((p, index) => ({
        ...p,
        selected: index < MAX_PAGES
      })));
    }
  };

  // 선택 확인
  const handleConfirm = () => {
    const selectedPages = pages.filter(p => p.selected);
    if (selectedPages.length === 0) {
      alert('최소 1개 이상의 페이지를 선택해주세요.');
      return;
    }
    if (selectedPages.length > MAX_PAGES) {
      alert(`최대 ${MAX_PAGES}페이지까지만 선택할 수 있습니다.`);
      return;
    }
    onConfirm(pages);
  };

  const selectedCount = pages.filter(p => p.selected).length;
  const isOverLimit = selectedCount > MAX_PAGES;
  const isAtLimit = selectedCount >= MAX_PAGES;

  // ESC 키로 닫기
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      lockScroll();
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      unlockScroll();
    };
  }, [isOpen, onClose]);

  if (typeof window === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-[#F5F0E8]"
          style={{ left: 'var(--modal-left, 0px)' }}
        >
          {/* 헤더 */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="flex items-center justify-between px-4 py-3 border-b-2 border-[#1A1A1A] bg-[#F5F0E8]"
          >
            <button
              onClick={onClose}
              className="p-2 text-[#1A1A1A]"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <h2 className="text-lg font-bold text-[#1A1A1A]">{title}</h2>
            <button
              onClick={toggleAll}
              className="px-3 py-1 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
            >
              {pages.every(p => p.selected)
                ? '전체 해제'
                : pages.length > MAX_PAGES
                ? `${MAX_PAGES}개 선택`
                : '전체 선택'
              }
            </button>
          </motion.div>

          {/* 본문 - 페이지 그리드 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 overflow-y-auto overscroll-contain p-4"
          >
            {isLoading ? (
              <div className="flex flex-col items-center justify-center h-full">
                <div className="w-10 h-10 border-3 border-[#1A1A1A] border-t-transparent rounded-full animate-spin mb-4" />
                <p className="text-[#5C5C5C] font-medium">{loadingMessage}</p>
              </div>
            ) : pages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full">
                <p className="text-[#5C5C5C]">페이지를 찾을 수 없습니다.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                {pages.map((page) => (
                  <motion.button
                    key={page.pageNum}
                    onClick={() => togglePage(page.pageNum)}
                    whileTap={{ scale: 0.98 }}
                    className={`relative aspect-[3/4] border-2 transition-all overflow-hidden ${
                      page.selected
                        ? 'border-[#1A6B1A] ring-2 ring-[#1A6B1A]/30'
                        : 'border-[#D4CFC4] hover:border-[#1A1A1A]'
                    }`}
                  >
                    {/* 썸네일 이미지 */}
                    <img
                      src={page.thumbnail}
                      alt={`페이지 ${page.pageNum}`}
                      className="w-full h-full object-contain bg-white"
                    />

                    {/* 페이지 번호 */}
                    <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-sm font-bold text-center py-1.5">
                      {page.pageNum}
                    </div>

                    {/* 선택 체크 표시 */}
                    {page.selected && (
                      <div className="absolute top-2 right-2 w-8 h-8 bg-[#1A6B1A] rounded-full flex items-center justify-center shadow-lg">
                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                  </motion.button>
                ))}
              </div>
            )}
          </motion.div>

          {/* 푸터 - 선택 확인 */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="px-4 py-4 border-t-2 border-[#1A1A1A] bg-[#EDEAE4]"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-[#5C5C5C]">
                {pages.length}개 중 <span className={`font-bold ${isAtLimit ? 'text-[#8B1A1A]' : 'text-[#1A1A1A]'}`}>{selectedCount}개</span> 선택됨
              </span>
              <span className={`text-xs ${isAtLimit ? 'text-[#8B1A1A] font-bold' : 'text-[#5C5C5C]'}`}>
                최대 {MAX_PAGES}페이지
              </span>
            </div>

            {/* 제한 경고 메시지 */}
            {isAtLimit && (
              <div className="mb-3 px-3 py-2 bg-[#FFF3CD] border border-[#FFCA28] text-[#856404] text-xs rounded">
                {isOverLimit
                  ? `최대 ${MAX_PAGES}페이지를 초과했습니다. 일부 페이지를 해제해주세요.`
                  : `최대 선택 가능 페이지(${MAX_PAGES}개)에 도달했습니다.`
                }
              </div>
            )}

            <button
              onClick={handleConfirm}
              disabled={selectedCount === 0 || isOverLimit}
              className={`w-full py-3 font-bold text-lg border-2 border-[#1A1A1A] transition-all ${
                selectedCount > 0 && !isOverLimit
                  ? 'bg-[#1A1A1A] text-white hover:bg-[#3A3A3A] shadow-[2px_2px_0px_#1A1A1A] active:shadow-none active:translate-x-[2px] active:translate-y-[2px]'
                  : 'bg-[#E5E5E5] text-[#9A9A9A] cursor-not-allowed'
              }`}
            >
              {selectedCount === 0
                ? '페이지를 선택해주세요'
                : isOverLimit
                ? `${selectedCount - MAX_PAGES}개 초과 - 페이지를 줄여주세요`
                : `${selectedCount}개 페이지 선택 완료`
              }
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
