'use client';

import { motion } from 'framer-motion';
import { useThemeColors } from '@/styles/themes/useTheme';

/**
 * OX 답안 타입
 */
export type OXAnswer = 'O' | 'X' | null;

/**
 * OXChoice Props 타입
 */
interface OXChoiceProps {
  /** 현재 선택된 답 */
  selected: OXAnswer;
  /** 답 선택 핸들러 */
  onSelect: (answer: OXAnswer) => void;
  /** 비활성화 상태 */
  disabled?: boolean;
}

/**
 * OX 선지 컴포넌트
 *
 * O, X 버튼 두 개를 표시하고 선택 애니메이션을 제공합니다.
 *
 * @example
 * ```tsx
 * <OXChoice
 *   selected={answer}
 *   onSelect={(value) => setAnswer(value)}
 * />
 * ```
 */
export default function OXChoice({
  selected,
  onSelect,
  disabled = false,
}: OXChoiceProps) {
  const colors = useThemeColors();

  // 버튼 클릭 핸들러
  const handleSelect = (value: 'O' | 'X') => {
    if (disabled) return;
    // 같은 값 다시 클릭하면 선택 해제
    onSelect(selected === value ? null : value);
  };

  // 선택 상태에 따른 스타일
  const getButtonStyle = (value: 'O' | 'X') => {
    const isSelected = selected === value;
    const isO = value === 'O';

    if (isSelected) {
      return {
        backgroundColor: isO ? '#22C55E' : '#EF4444', // 초록/빨강
        color: '#FFFFFF',
        borderColor: isO ? '#22C55E' : '#EF4444',
      };
    }

    return {
      backgroundColor: '#F9FAFB',
      color: '#6B7280',
      borderColor: '#E5E7EB',
    };
  };

  return (
    <div className="flex gap-4 justify-center py-4">
      {/* O 버튼 */}
      <motion.button
        whileHover={!disabled ? { scale: 1.05 } : undefined}
        whileTap={!disabled ? { scale: 0.95 } : undefined}
        onClick={() => handleSelect('O')}
        disabled={disabled}
        style={getButtonStyle('O')}
        className={`
          w-28 h-28 rounded-full text-5xl font-bold
          border-4 transition-colors duration-200
          flex items-center justify-center
          ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
        `}
        aria-label="O 선택"
        aria-pressed={selected === 'O'}
      >
        <motion.span
          initial={{ scale: 0.8 }}
          animate={{
            scale: selected === 'O' ? [1, 1.2, 1] : 1,
          }}
          transition={{ duration: 0.3 }}
        >
          O
        </motion.span>
      </motion.button>

      {/* X 버튼 */}
      <motion.button
        whileHover={!disabled ? { scale: 1.05 } : undefined}
        whileTap={!disabled ? { scale: 0.95 } : undefined}
        onClick={() => handleSelect('X')}
        disabled={disabled}
        style={getButtonStyle('X')}
        className={`
          w-28 h-28 rounded-full text-5xl font-bold
          border-4 transition-colors duration-200
          flex items-center justify-center
          ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
        `}
        aria-label="X 선택"
        aria-pressed={selected === 'X'}
      >
        <motion.span
          initial={{ scale: 0.8 }}
          animate={{
            scale: selected === 'X' ? [1, 1.2, 1] : 1,
          }}
          transition={{ duration: 0.3 }}
        >
          X
        </motion.span>
      </motion.button>
    </div>
  );
}
