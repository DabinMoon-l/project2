'use client';

import { ButtonHTMLAttributes, forwardRef } from 'react';
import { motion, HTMLMotionProps } from 'framer-motion';

// 버튼 variant 타입
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'white';

// 버튼 size 타입
type ButtonSize = 'sm' | 'md' | 'lg';

// 버튼 Props 타입 (motion.button props와 결합)
interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  /** 버튼 스타일 variant */
  variant?: ButtonVariant;
  /** 버튼 크기 */
  size?: ButtonSize;
  /** 로딩 상태 */
  loading?: boolean;
  /** 전체 너비 */
  fullWidth?: boolean;
  /** 버튼 내용 */
  children: React.ReactNode;
}

// variant별 스타일
const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-md hover:shadow-lg hover:from-indigo-600 hover:to-purple-700 active:from-indigo-700 active:to-purple-800',
  secondary:
    'bg-white text-gray-800 border border-gray-200 shadow-sm hover:bg-gray-50 hover:border-gray-300 active:bg-gray-100',
  ghost:
    'bg-transparent text-gray-600 hover:bg-gray-100 hover:text-gray-800 active:bg-gray-200',
  white:
    'bg-white text-black shadow-md hover:bg-gray-100 active:bg-gray-200',
};

// size별 스타일
const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm rounded-lg',
  md: 'px-4 py-2.5 text-base rounded-xl',
  lg: 'px-6 py-3.5 text-lg rounded-2xl',
};

/**
 * 공통 Button 컴포넌트
 *
 * @example
 * // Primary 버튼
 * <Button variant="primary" size="md">확인</Button>
 *
 * // 로딩 상태
 * <Button loading>저장 중...</Button>
 *
 * // Ghost 버튼
 * <Button variant="ghost" size="sm">취소</Button>
 */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      fullWidth = false,
      disabled,
      children,
      className = '',
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || loading;

    return (
      <motion.button
        ref={ref}
        whileTap={!isDisabled ? { scale: 0.97 } : undefined}
        transition={{ duration: 0.1 }}
        disabled={isDisabled}
        className={`
          inline-flex items-center justify-center gap-2
          font-medium
          transition-colors duration-200
          focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2
          disabled:opacity-50 disabled:cursor-not-allowed
          ${variantStyles[variant]}
          ${sizeStyles[size]}
          ${fullWidth ? 'w-full' : ''}
          ${className}
        `}
        aria-busy={loading}
        {...props}
      >
        {/* 로딩 스피너 */}
        {loading && (
          <svg
            className="animate-spin h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        )}
        {children}
      </motion.button>
    );
  }
);

Button.displayName = 'Button';

export default Button;
