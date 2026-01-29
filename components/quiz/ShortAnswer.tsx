'use client';

import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useThemeColors } from '@/styles/themes/useTheme';

/**
 * ShortAnswer Props 타입
 */
interface ShortAnswerProps {
  /** 현재 입력된 답안 */
  value: string;
  /** 답안 변경 핸들러 */
  onChange: (value: string) => void;
  /** 최대 글자 수 */
  maxLength?: number;
  /** 플레이스홀더 */
  placeholder?: string;
  /** 비활성화 상태 */
  disabled?: boolean;
}

/**
 * 주관식 입력 컴포넌트
 *
 * 텍스트 입력 필드와 글자 수를 표시합니다.
 *
 * @example
 * ```tsx
 * <ShortAnswer
 *   value={answer}
 *   onChange={(value) => setAnswer(value)}
 *   maxLength={100}
 * />
 * ```
 */
export default function ShortAnswer({
  value,
  onChange,
  maxLength = 200,
  placeholder = '답을 입력하세요',
  disabled = false,
}: ShortAnswerProps) {
  const colors = useThemeColors();
  const [isFocused, setIsFocused] = useState(false);

  // 입력 변경 핸들러
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      if (newValue.length <= maxLength) {
        onChange(newValue);
      }
    },
    [maxLength, onChange]
  );

  // 글자 수 상태에 따른 색상
  const charCountColor = () => {
    const ratio = value.length / maxLength;
    if (ratio >= 0.9) return '#EF4444'; // 빨강 (90% 이상)
    if (ratio >= 0.7) return '#F59E0B'; // 주황 (70% 이상)
    return '#9CA3AF'; // 회색
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="py-4"
    >
      {/* 입력 필드 */}
      <div className="relative">
        <textarea
          value={value}
          onChange={handleChange}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={placeholder}
          disabled={disabled}
          rows={4}
          style={{
            borderColor: isFocused ? colors.accent : '#E5E7EB',
            boxShadow: isFocused
              ? `0 0 0 3px ${colors.accent}20`
              : 'none',
          }}
          className={`
            w-full p-4 rounded-xl
            border-2 transition-all duration-200
            text-gray-800 text-base leading-relaxed
            placeholder:text-gray-400
            resize-none
            focus:outline-none
            ${disabled ? 'bg-gray-50 cursor-not-allowed' : 'bg-white'}
          `}
          aria-label="주관식 답안 입력"
          aria-describedby="char-count"
        />

        {/* 글자 수 표시 */}
        <div
          id="char-count"
          className="absolute bottom-3 right-3 text-xs font-medium transition-colors duration-200"
          style={{ color: charCountColor() }}
          aria-live="polite"
        >
          {value.length}/{maxLength}
        </div>
      </div>

      {/* 입력 안내 */}
      <p className="mt-2 text-xs text-gray-500">
        정확한 답을 입력해주세요. 띄어쓰기와 맞춤법에 유의하세요.
      </p>
    </motion.div>
  );
}
