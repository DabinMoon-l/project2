'use client';

import { motion } from 'framer-motion';
import { useThemeColors } from '@/styles/themes/useTheme';

/**
 * MultipleChoice Props 타입
 */
interface MultipleChoiceProps {
  /** 선지 목록 (4개) */
  choices: string[];
  /** 현재 선택된 선지 인덱스 (0~3, 선택 안함 시 null) */
  selected: number | null;
  /** 선지 선택 핸들러 */
  onSelect: (index: number | null) => void;
  /** 비활성화 상태 */
  disabled?: boolean;
}

// 선지 번호 라벨
const choiceLabels = ['①', '②', '③', '④'];

/**
 * 객관식 선지 컴포넌트 (4지선다)
 *
 * 4개의 선지 버튼을 표시하고 선택 상태를 관리합니다.
 *
 * @example
 * ```tsx
 * <MultipleChoice
 *   choices={['선지 1', '선지 2', '선지 3', '선지 4']}
 *   selected={selectedIndex}
 *   onSelect={(index) => setSelectedIndex(index)}
 * />
 * ```
 */
export default function MultipleChoice({
  choices,
  selected,
  onSelect,
  disabled = false,
}: MultipleChoiceProps) {
  const colors = useThemeColors();

  // 선지 클릭 핸들러
  const handleSelect = (index: number) => {
    if (disabled) return;
    // 같은 선지 다시 클릭하면 선택 해제
    onSelect(selected === index ? null : index);
  };

  // 선택 상태에 따른 스타일
  const getChoiceStyle = (index: number) => {
    const isSelected = selected === index;

    if (isSelected) {
      return {
        backgroundColor: colors.accent,
        borderColor: colors.accent,
        color: '#FFFFFF',
      };
    }

    return {
      backgroundColor: '#FFFFFF',
      borderColor: '#E5E7EB',
      color: '#374151',
    };
  };

  // 애니메이션 variants
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, x: -20 },
    visible: { opacity: 1, x: 0 },
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-3 py-4"
    >
      {choices.map((choice, index) => (
        <motion.button
          key={index}
          variants={itemVariants}
          whileHover={!disabled ? { scale: 1.02, x: 4 } : undefined}
          whileTap={!disabled ? { scale: 0.98 } : undefined}
          onClick={() => handleSelect(index)}
          disabled={disabled}
          style={getChoiceStyle(index)}
          className={`
            w-full p-4 rounded-xl
            border-2 transition-all duration-200
            flex items-start gap-3 text-left
            ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
          `}
          aria-label={`선지 ${index + 1}: ${choice}`}
          aria-pressed={selected === index}
        >
          {/* 선지 번호 */}
          <span
            className={`
              flex-shrink-0 w-7 h-7 rounded-full
              flex items-center justify-center text-sm font-bold
              transition-colors duration-200
              ${selected === index
                ? 'bg-white/20 text-white'
                : 'bg-gray-100 text-gray-600'
              }
            `}
          >
            {choiceLabels[index]}
          </span>

          {/* 선지 텍스트 */}
          <span className="flex-1 text-base leading-relaxed break-words">
            {choice}
          </span>

          {/* 선택 체크 아이콘 */}
          {selected === index && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 500, damping: 25 }}
              className="flex-shrink-0"
            >
              <svg
                className="w-5 h-5 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </motion.div>
          )}
        </motion.button>
      ))}
    </motion.div>
  );
}
