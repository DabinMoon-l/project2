'use client';

import { motion } from 'framer-motion';
import { useThemeColors } from '@/styles/themes/useTheme';

/**
 * MultipleChoice Props 타입
 */
interface MultipleChoiceProps {
  /** 선지 목록 (4개) */
  choices: string[];
  /** 현재 선택된 선지 인덱스 (0~3, 선택 안함 시 null) - 단일 선택용 */
  selected?: number | null;
  /** 현재 선택된 선지 인덱스 배열 - 다중 선택용 */
  selectedIndices?: number[];
  /** 선지 선택 핸들러 - 단일 선택용 */
  onSelect?: (index: number | null) => void;
  /** 선지 선택 핸들러 - 다중 선택용 */
  onMultiSelect?: (indices: number[]) => void;
  /** 다중 선택 모드 여부 */
  multiSelect?: boolean;
  /** 비활성화 상태 */
  disabled?: boolean;
  /** 정답 인덱스 (결과 표시용, 제출 후에만 사용) - 단일 정답 */
  correctIndex?: number;
  /** 정답 인덱스 배열 (결과 표시용, 제출 후에만 사용) - 복수 정답 */
  correctIndices?: number[];
}

// 선지 번호 라벨
const choiceLabels = ['①', '②', '③', '④'];

/**
 * 객관식 선지 컴포넌트 (4지선다)
 *
 * 4개의 선지 버튼을 표시하고 선택 상태를 관리합니다.
 * multiSelect prop으로 다중 선택 모드를 활성화할 수 있습니다.
 *
 * @example
 * // 단일 선택
 * <MultipleChoice
 *   choices={['선지 1', '선지 2', '선지 3', '선지 4']}
 *   selected={selectedIndex}
 *   onSelect={(index) => setSelectedIndex(index)}
 * />
 *
 * // 다중 선택 (복수정답)
 * <MultipleChoice
 *   choices={['선지 1', '선지 2', '선지 3', '선지 4']}
 *   multiSelect
 *   selectedIndices={selectedIndices}
 *   onMultiSelect={(indices) => setSelectedIndices(indices)}
 * />
 */
export default function MultipleChoice({
  choices,
  selected,
  selectedIndices = [],
  onSelect,
  onMultiSelect,
  multiSelect = false,
  disabled = false,
  correctIndex,
  correctIndices,
}: MultipleChoiceProps) {
  const colors = useThemeColors();

  // 선지 클릭 핸들러
  const handleSelect = (index: number) => {
    if (disabled) return;

    if (multiSelect && onMultiSelect) {
      // 다중 선택 모드
      if (selectedIndices.includes(index)) {
        // 이미 선택된 경우 제거
        onMultiSelect(selectedIndices.filter(i => i !== index));
      } else {
        // 새로 선택 추가
        onMultiSelect([...selectedIndices, index].sort((a, b) => a - b));
      }
    } else if (onSelect) {
      // 단일 선택 모드
      // 같은 선지 다시 클릭하면 선택 해제
      onSelect(selected === index ? null : index);
    }
  };

  // 선택 여부 확인
  const isSelected = (index: number) => {
    if (multiSelect) {
      return selectedIndices.includes(index);
    }
    return selected === index;
  };

  // 정답 여부 확인
  const isCorrectAnswer = (index: number) => {
    if (correctIndices && correctIndices.length > 0) {
      return correctIndices.includes(index);
    }
    return correctIndex !== undefined && correctIndex === index;
  };

  // 선택 상태에 따른 스타일
  const getChoiceStyle = (index: number) => {
    const selected = isSelected(index);
    const isCorrect = isCorrectAnswer(index);
    const showResult = correctIndex !== undefined || (correctIndices && correctIndices.length > 0);
    const isWrong = showResult && selected && !isCorrect;

    // 정답/오답 표시 모드
    if (showResult) {
      if (isCorrect) {
        return {
          backgroundColor: '#1A6B1A',
          borderColor: '#1A6B1A',
          color: '#F5F0E8',
        };
      }
      if (isWrong) {
        return {
          backgroundColor: '#8B1A1A',
          borderColor: '#8B1A1A',
          color: '#F5F0E8',
        };
      }
    }

    if (selected) {
      // 다중 선택 모드에서는 초록색 계열로 표시
      if (multiSelect) {
        return {
          backgroundColor: '#1A6B1A',
          borderColor: '#1A6B1A',
          color: '#F5F0E8',
        };
      }
      return {
        backgroundColor: '#1A1A1A',
        borderColor: '#1A1A1A',
        color: '#F5F0E8',
      };
    }

    return {
      backgroundColor: '#F5F0E8',
      borderColor: '#1A1A1A',
      color: '#1A1A1A',
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
      {choices.map((choice, index) => {
        const selected = isSelected(index);

        return (
          <motion.button
            key={index}
            variants={itemVariants}
            whileHover={!disabled ? { scale: 1.02, x: 4 } : undefined}
            whileTap={!disabled ? { scale: 0.98 } : undefined}
            onClick={() => handleSelect(index)}
            disabled={disabled}
            style={getChoiceStyle(index)}
            className={`
              w-full p-4
              border-2 transition-all duration-200
              flex items-start gap-3 text-left
              ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
            `}
            aria-label={`선지 ${index + 1}: ${choice}`}
            aria-pressed={selected}
          >
            {/* 선지 번호 */}
            <span
              className={`
                flex-shrink-0 w-7 h-7
                flex items-center justify-center text-sm font-bold
                transition-colors duration-200
                ${selected
                  ? 'bg-[#F5F0E8]/20 text-[#F5F0E8]'
                  : 'bg-[#EDEAE4] text-[#1A1A1A]'
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
            {selected && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                className="flex-shrink-0"
              >
                <svg
                  className="w-5 h-5 text-[#F5F0E8]"
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
        );
      })}
    </motion.div>
  );
}
