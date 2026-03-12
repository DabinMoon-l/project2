'use client';

/**
 * 애니메이션 밑줄 탭 — 재사용 가능한 제네릭 컴포넌트
 *
 * 스프링 애니메이션으로 활성 탭 아래에 밑줄이 이동합니다.
 * 사용처: 학생 퀴즈 반별 필터, 교수 퀴즈 섹션 탭, 복습 필터 탭
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

export interface TabOption<T extends string> {
  value: T;
  label: string;
}

export default function AnimatedUnderlineTabs<T extends string>({
  options,
  activeValue,
  onChange,
  className,
  buttonClassName = 'text-lg',
}: {
  options: readonly TabOption<T>[] | TabOption<T>[];
  activeValue: T;
  onChange: (value: T) => void;
  className?: string;
  /** 버튼 텍스트 크기 등 (기본: text-lg) */
  buttonClassName?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [underline, setUnderline] = useState({ left: 0, width: 0 });
  const activeIdx = options.findIndex(o => o.value === activeValue);

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
    <div ref={containerRef} className={`relative flex ${className || 'gap-4'}`}>
      {options.map((opt, i) => (
        <button
          key={opt.value}
          ref={el => { btnRefs.current[i] = el; }}
          onClick={() => onChange(opt.value)}
          className={`pb-1.5 ${buttonClassName} font-bold transition-colors ${
            activeValue === opt.value ? 'text-[#1A1A1A]' : 'text-[#5C5C5C]'
          }`}
        >
          {opt.label}
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
