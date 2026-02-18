'use client';

import { motion } from 'framer-motion';

// ============================================================
// 타입 정의
// ============================================================

interface SettingsItemProps {
  /** 아이콘 (이모지 또는 텍스트) */
  icon?: string;
  /** 레이블 */
  label: string;
  /** 설명 */
  description?: string;
  /** 토글 타입인 경우 */
  type?: 'toggle' | 'link' | 'button';
  /** 토글 값 */
  value?: boolean;
  /** 토글 변경 핸들러 */
  onChange?: (value: boolean) => void;
  /** 클릭 핸들러 */
  onClick?: () => void;
  /** 비활성화 */
  disabled?: boolean;
  /** 위험한 액션 (빨간색 표시) */
  danger?: boolean;
  /** 우측에 표시할 텍스트 */
  rightText?: string;
}

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 설정 항목 컴포넌트 (글래스모피즘)
 */
export default function SettingsItem({
  icon,
  label,
  description,
  type = 'link',
  value = false,
  onChange,
  onClick,
  disabled = false,
  danger = false,
  rightText,
}: SettingsItemProps) {
  const handleClick = () => {
    if (disabled) return;

    if (type === 'toggle' && onChange) {
      onChange(!value);
    } else if (onClick) {
      onClick();
    }
  };

  return (
    <motion.button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className={`
        w-full flex items-center gap-3 px-4 py-3 text-left transition-colors
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-white/5 active:bg-white/10'}
      `}
      whileTap={!disabled ? { scale: 0.99 } : undefined}
    >
      {/* 아이콘 */}
      {icon && (
        <span className="text-xl w-8 h-8 flex items-center justify-center rounded-lg bg-white/10">
          {icon}
        </span>
      )}

      {/* 레이블 & 설명 */}
      <div className="flex-1 min-w-0">
        <p className={`font-medium truncate ${danger ? 'text-red-400' : 'text-white'}`}>
          {label}
        </p>
        {description && (
          <p className="text-sm truncate text-white/50">
            {description}
          </p>
        )}
      </div>

      {/* 우측 영역 */}
      {type === 'toggle' ? (
        // 토글 스위치
        <div
          className={`
            relative w-12 h-7 rounded-full transition-colors
            ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}
            ${value ? 'bg-white/40' : 'bg-white/15'}
          `}
        >
          <motion.div
            className="absolute top-1 w-5 h-5 bg-white rounded-full shadow-sm"
            animate={{ left: value ? 24 : 4 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          />
        </div>
      ) : type === 'link' ? (
        // 링크 화살표
        <div className="flex items-center gap-2">
          {rightText && (
            <span className="text-sm text-white/50">
              {rightText}
            </span>
          )}
          <svg
            className="w-5 h-5 text-white/40"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </div>
      ) : null}
    </motion.button>
  );
}
