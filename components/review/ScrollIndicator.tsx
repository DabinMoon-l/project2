'use client';

import { useState, useEffect } from 'react';

/**
 * 스크롤 인디케이터 컴포넌트
 */
export default function ScrollIndicator({
  containerRef,
  itemCount,
  itemsPerRow = 3,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  itemCount: number;
  itemsPerRow?: number;
}) {
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const calculatePages = () => {
      const scrollHeight = container.scrollHeight;
      const clientHeight = container.clientHeight;
      if (scrollHeight <= clientHeight) {
        setTotalPages(1);
        setCurrentPage(0);
        return;
      }
      // 대략적인 페이지 수 계산
      const rowHeight = 120; // 대략적인 한 행 높이
      const rowsPerPage = Math.floor(clientHeight / rowHeight) || 1;
      const totalRows = Math.ceil(itemCount / itemsPerRow);
      const pages = Math.ceil(totalRows / rowsPerPage) || 1;
      setTotalPages(Math.min(pages, 5)); // 최대 5개
    };

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const maxScroll = scrollHeight - clientHeight;
      if (maxScroll <= 0) {
        setCurrentPage(0);
        return;
      }
      const scrollRatio = scrollTop / maxScroll;
      const page = Math.round(scrollRatio * (totalPages - 1));
      setCurrentPage(page);
    };

    calculatePages();
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [containerRef, itemCount, itemsPerRow, totalPages]);

  if (totalPages <= 1) return null;

  return (
    <div className="flex justify-center gap-1.5 py-2">
      {Array.from({ length: totalPages }).map((_, i) => (
        <div
          key={i}
          className={`w-1.5 h-1.5 rounded-full transition-colors ${
            i === currentPage ? 'bg-[#1A1A1A]' : 'bg-[#D4CFC4]'
          }`}
        />
      ))}
    </div>
  );
}
