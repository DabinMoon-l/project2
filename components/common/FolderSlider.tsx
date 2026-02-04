'use client';

import { useState, ReactNode } from 'react';
import { motion } from 'framer-motion';

interface FolderSliderProps {
  children: ReactNode[];
}

/**
 * 폴더 슬라이더 컴포넌트
 * 4개 이상일 때 좌우 화살표로 슬라이드
 * 3개씩 보이고, 1개씩 이동
 */
export default function FolderSlider({ children }: FolderSliderProps) {
  const [currentIndex, setCurrentIndex] = useState(0);

  const totalItems = children.length;
  const maxIndex = Math.max(0, totalItems - 3);

  // 이전으로
  const handlePrev = () => {
    setCurrentIndex((prev) => Math.max(0, prev - 1));
  };

  // 다음으로
  const handleNext = () => {
    setCurrentIndex((prev) => Math.min(maxIndex, prev + 1));
  };

  // 4개 미만이면 그냥 그리드로 표시
  if (totalItems < 4) {
    return (
      <div className="grid grid-cols-3 gap-3">
        {children}
      </div>
    );
  }

  // 보이는 3개만 표시
  const visibleItems = children.slice(currentIndex, currentIndex + 3);

  return (
    <div className="relative">
      {/* 왼쪽 화살표 */}
      {currentIndex > 0 && (
        <button
          onClick={handlePrev}
          className="absolute -left-3 top-1/2 -translate-y-1/2 z-10 w-6 h-6 flex items-center justify-center bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#333] transition-colors"
          aria-label="이전"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}

      {/* 슬라이더 컨테이너 - 3열 그리드 고정 */}
      <motion.div
        key={currentIndex}
        initial={{ opacity: 0.5, x: 10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.2 }}
        className="grid grid-cols-3 gap-3"
      >
        {visibleItems}
      </motion.div>

      {/* 오른쪽 화살표 */}
      {currentIndex < maxIndex && (
        <button
          onClick={handleNext}
          className="absolute -right-3 top-1/2 -translate-y-1/2 z-10 w-6 h-6 flex items-center justify-center bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#333] transition-colors"
          aria-label="다음"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}

      {/* 인디케이터 */}
      <div className="flex justify-center gap-1 mt-2">
        {Array.from({ length: maxIndex + 1 }).map((_, idx) => (
          <button
            key={idx}
            onClick={() => setCurrentIndex(idx)}
            className={`w-1.5 h-1.5 rounded-full transition-colors ${
              idx === currentIndex ? 'bg-[#1A1A1A]' : 'bg-[#D4CFC4]'
            }`}
            aria-label={`슬라이드 ${idx + 1}`}
          />
        ))}
      </div>
    </div>
  );
}
