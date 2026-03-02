'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { type ReviewFilter, FILTER_OPTIONS } from './types';

/**
 * 밑줄 스타일 필터 탭 (교수 퀴즈 페이지 ProfSectionTabs와 동일)
 */
export default function SlideFilter({
  activeFilter,
  onFilterChange,
}: {
  activeFilter: ReviewFilter;
  onFilterChange: (filter: ReviewFilter) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [underline, setUnderline] = useState({ left: 0, width: 0 });
  const activeIdx = FILTER_OPTIONS.findIndex(o => o.value === activeFilter);

  const measureUnderline = useCallback(() => {
    if (activeIdx < 0 || !containerRef.current || !btnRefs.current[activeIdx]) return;
    const container = containerRef.current.getBoundingClientRect();
    const btn = btnRefs.current[activeIdx]!.getBoundingClientRect();
    setUnderline({ left: btn.left - container.left, width: btn.width });
  }, [activeIdx]);

  useEffect(() => {
    measureUnderline();
  }, [measureUnderline]);

  return (
    <div ref={containerRef} className="relative flex gap-4">
      {FILTER_OPTIONS.map((opt, i) => (
        <button
          key={opt.value}
          ref={el => { btnRefs.current[i] = el; }}
          onClick={() => onFilterChange(opt.value)}
          className={`pb-1.5 text-lg font-bold transition-colors ${
            activeFilter === opt.value ? 'text-[#1A1A1A]' : 'text-[#5C5C5C]'
          }`}
        >
          {opt.line1}
        </button>
      ))}
      {activeIdx >= 0 && underline.width > 0 && (
        <motion.div
          className="absolute bottom-0 h-[2px] bg-[#1A1A1A]"
          animate={{ left: underline.left, width: underline.width }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        />
      )}
    </div>
  );
}
