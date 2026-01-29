'use client';

import { motion } from 'framer-motion';
import type { TargetClass } from '@/lib/hooks/useProfessorQuiz';

// ============================================================
// 타입 정의
// ============================================================

interface TargetClassSelectorProps {
  /** 선택된 대상 반 */
  value: TargetClass;
  /** 선택 변경 시 콜백 */
  onChange: (value: TargetClass) => void;
  /** 비활성화 여부 */
  disabled?: boolean;
  /** 추가 클래스명 */
  className?: string;
}

// ============================================================
// 상수
// ============================================================

/** 반별 색상 테마 */
const CLASS_COLORS: Record<TargetClass, { bg: string; text: string; border: string; activeBg: string }> = {
  A: {
    bg: 'bg-red-50',
    text: 'text-red-700',
    border: 'border-red-200',
    activeBg: 'bg-red-500',
  },
  B: {
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    border: 'border-amber-200',
    activeBg: 'bg-amber-500',
  },
  C: {
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
    activeBg: 'bg-emerald-500',
  },
  D: {
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    border: 'border-blue-200',
    activeBg: 'bg-blue-500',
  },
  all: {
    bg: 'bg-purple-50',
    text: 'text-purple-700',
    border: 'border-purple-200',
    activeBg: 'bg-purple-500',
  },
};

/** 대상 반 옵션 */
const CLASS_OPTIONS: { value: TargetClass; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'A', label: 'A반' },
  { value: 'B', label: 'B반' },
  { value: 'C', label: 'C반' },
  { value: 'D', label: 'D반' },
];

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 대상 반 선택 컴포넌트
 *
 * 퀴즈 대상 반(A/B/C/D/전체)을 선택할 수 있는 버튼 그룹입니다.
 * 각 반별 테마 색상이 적용됩니다.
 *
 * @example
 * ```tsx
 * <TargetClassSelector
 *   value={targetClass}
 *   onChange={setTargetClass}
 * />
 * ```
 */
export default function TargetClassSelector({
  value,
  onChange,
  disabled = false,
  className = '',
}: TargetClassSelectorProps) {
  return (
    <div className={className}>
      <label className="block text-sm font-medium text-gray-700 mb-2">
        대상 반
      </label>
      <div className="flex flex-wrap gap-2">
        {CLASS_OPTIONS.map((option) => {
          const isSelected = value === option.value;
          const colors = CLASS_COLORS[option.value];

          return (
            <motion.button
              key={option.value}
              type="button"
              whileHover={!disabled ? { scale: 1.05 } : undefined}
              whileTap={!disabled ? { scale: 0.95 } : undefined}
              onClick={() => !disabled && onChange(option.value)}
              disabled={disabled}
              className={`
                px-4 py-2 rounded-xl font-medium text-sm
                border-2 transition-all duration-200
                disabled:opacity-50 disabled:cursor-not-allowed
                ${
                  isSelected
                    ? `${colors.activeBg} text-white border-transparent shadow-md`
                    : `${colors.bg} ${colors.text} ${colors.border} hover:border-current`
                }
              `}
            >
              {option.label}
            </motion.button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-gray-500">
        {value === 'all'
          ? '모든 반의 학생들이 퀴즈를 풀 수 있습니다.'
          : `${value}반 학생들만 퀴즈를 풀 수 있습니다.`}
      </p>
    </div>
  );
}
