'use client';

import { InputHTMLAttributes, forwardRef, useId } from 'react';

// Input Props 타입
interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** 입력 필드 라벨 */
  label?: string;
  /** 에러 메시지 */
  error?: string;
  /** 도움말 텍스트 */
  helperText?: string;
  /** 왼쪽 아이콘 */
  leftIcon?: React.ReactNode;
  /** 오른쪽 아이콘 */
  rightIcon?: React.ReactNode;
  /** 입력 필드 크기 */
  inputSize?: 'sm' | 'md' | 'lg';
  /** 전체 너비 */
  fullWidth?: boolean;
}

// size별 스타일
const sizeStyles = {
  sm: 'px-3 py-2 text-sm',
  md: 'px-4 py-2.5 text-base',
  lg: 'px-5 py-3.5 text-lg',
};

// 아이콘 padding 스타일
const iconPaddingStyles = {
  sm: { left: 'pl-9', right: 'pr-9' },
  md: { left: 'pl-10', right: 'pr-10' },
  lg: { left: 'pl-12', right: 'pr-12' },
};

/**
 * 공통 Input 컴포넌트
 *
 * @example
 * // 기본 사용
 * <Input label="이메일" placeholder="이메일을 입력하세요" />
 *
 * // 에러 상태
 * <Input label="비밀번호" error="비밀번호는 8자 이상이어야 합니다" />
 *
 * // 아이콘과 함께
 * <Input leftIcon={<SearchIcon />} placeholder="검색..." />
 */
const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      helperText,
      leftIcon,
      rightIcon,
      inputSize = 'md',
      fullWidth = true,
      disabled,
      className = '',
      id,
      ...props
    },
    ref
  ) => {
    // 고유 ID 생성 (접근성을 위해)
    const generatedId = useId();
    const inputId = id || generatedId;
    const errorId = `${inputId}-error`;
    const helperId = `${inputId}-helper`;

    const hasError = !!error;

    return (
      <div className={`${fullWidth ? 'w-full' : ''}`}>
        {/* 라벨 */}
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-gray-700 mb-1.5"
          >
            {label}
          </label>
        )}

        {/* 입력 필드 컨테이너 */}
        <div className="relative">
          {/* 왼쪽 아이콘 */}
          {leftIcon && (
            <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-gray-400">
              {leftIcon}
            </div>
          )}

          {/* 입력 필드 */}
          <input
            ref={ref}
            id={inputId}
            disabled={disabled}
            aria-invalid={hasError}
            aria-describedby={
              hasError ? errorId : helperText ? helperId : undefined
            }
            className={`
              block w-full
              bg-white
              border rounded-xl
              transition-all duration-200
              placeholder:text-gray-400
              focus:outline-none focus:ring-2 focus:ring-offset-0
              disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed
              ${sizeStyles[inputSize]}
              ${leftIcon ? iconPaddingStyles[inputSize].left : ''}
              ${rightIcon ? iconPaddingStyles[inputSize].right : ''}
              ${
                hasError
                  ? 'border-red-300 focus:border-red-500 focus:ring-red-500/20'
                  : 'border-gray-200 focus:border-indigo-500 focus:ring-indigo-500/20'
              }
              ${className}
            `}
            {...props}
          />

          {/* 오른쪽 아이콘 */}
          {rightIcon && (
            <div className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400">
              {rightIcon}
            </div>
          )}
        </div>

        {/* 에러 메시지 */}
        {hasError && (
          <p
            id={errorId}
            className="mt-1.5 text-sm text-red-600 flex items-center gap-1"
            role="alert"
          >
            <svg
              className="w-4 h-4 flex-shrink-0"
              fill="currentColor"
              viewBox="0 0 20 20"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            {error}
          </p>
        )}

        {/* 도움말 텍스트 */}
        {!hasError && helperText && (
          <p id={helperId} className="mt-1.5 text-sm text-gray-500">
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

export default Input;
