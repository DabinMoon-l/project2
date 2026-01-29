/**
 * 소셜 로그인 버튼 컴포넌트
 *
 * Apple, Google, Naver 각 provider별로 적절한 아이콘과 색상을 표시합니다.
 * 로딩 상태와 비활성화 상태를 지원합니다.
 */

'use client';

import { motion } from 'framer-motion';
import { ButtonHTMLAttributes } from 'react';

// ============================================================
// 타입 정의
// ============================================================

/** 지원하는 소셜 로그인 provider 타입 */
export type SocialProvider = 'apple' | 'google' | 'naver';

/** 컴포넌트 Props */
interface SocialLoginButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** 소셜 로그인 provider */
  provider: SocialProvider;
  /** 로딩 상태 */
  loading?: boolean;
  /** 클릭 핸들러 */
  onClick?: () => void;
}

// ============================================================
// Provider별 설정
// ============================================================

/** Provider별 스타일 및 텍스트 설정 */
const providerConfig: Record<
  SocialProvider,
  {
    label: string;
    bgColor: string;
    textColor: string;
    hoverBgColor: string;
    icon: JSX.Element;
  }
> = {
  apple: {
    label: 'Apple로 계속하기',
    bgColor: 'bg-black',
    textColor: 'text-white',
    hoverBgColor: 'hover:bg-gray-800',
    icon: (
      <svg
        className="w-5 h-5"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
      </svg>
    ),
  },
  google: {
    label: 'Google로 계속하기',
    bgColor: 'bg-white',
    textColor: 'text-gray-700',
    hoverBgColor: 'hover:bg-gray-50',
    icon: (
      <svg
        className="w-5 h-5"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          fill="#4285F4"
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        />
        <path
          fill="#34A853"
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        />
        <path
          fill="#FBBC05"
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        />
        <path
          fill="#EA4335"
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        />
      </svg>
    ),
  },
  naver: {
    label: 'Naver로 계속하기',
    bgColor: 'bg-[#03C75A]',
    textColor: 'text-white',
    hoverBgColor: 'hover:bg-[#02B350]',
    icon: (
      <svg
        className="w-5 h-5"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M16.273 12.845L7.376 0H0v24h7.726V11.156L16.624 24H24V0h-7.727v12.845z" />
      </svg>
    ),
  },
};

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 소셜 로그인 버튼 컴포넌트
 *
 * @example
 * ```tsx
 * <SocialLoginButton
 *   provider="google"
 *   onClick={handleGoogleLogin}
 *   loading={isLoading}
 * />
 * ```
 */
export const SocialLoginButton = ({
  provider,
  loading = false,
  onClick,
  disabled,
  className = '',
  ...props
}: SocialLoginButtonProps) => {
  const config = providerConfig[provider];
  const isDisabled = disabled || loading;

  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      className={`
        w-full
        flex items-center justify-center gap-3
        px-4 py-3
        rounded-xl
        font-medium
        text-base
        transition-colors duration-200
        ${config.bgColor}
        ${config.textColor}
        ${config.hoverBgColor}
        ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        ${provider === 'google' ? 'border border-gray-300' : ''}
        ${className}
      `}
      // Framer Motion 애니메이션
      whileHover={!isDisabled ? { scale: 1.02 } : undefined}
      whileTap={!isDisabled ? { scale: 0.98 } : undefined}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      {...props}
    >
      {/* 로딩 스피너 또는 아이콘 */}
      {loading ? (
        <LoadingSpinner />
      ) : (
        config.icon
      )}

      {/* 버튼 텍스트 */}
      <span>{config.label}</span>
    </motion.button>
  );
};

// ============================================================
// 로딩 스피너 컴포넌트
// ============================================================

/**
 * 로딩 스피너
 * 버튼 내부에서 로딩 상태를 표시합니다.
 */
const LoadingSpinner = () => (
  <svg
    className="w-5 h-5 animate-spin"
    viewBox="0 0 24 24"
    fill="none"
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
);

export default SocialLoginButton;
