'use client';

import { motion } from 'framer-motion';

// ============================================================
// 타입 정의
// ============================================================

interface PublishToggleProps {
  /** 공개 여부 */
  isPublished: boolean;
  /** 상태 변경 시 콜백 */
  onChange: (isPublished: boolean) => void;
  /** 참여자 수 (통계 표시용) */
  participantCount?: number;
  /** 비활성화 여부 */
  disabled?: boolean;
  /** 추가 클래스명 */
  className?: string;
}

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 공개/비공개 토글 컴포넌트
 *
 * 퀴즈의 공개 상태를 토글할 수 있는 스위치 UI입니다.
 * 참여자 수 통계도 함께 표시합니다.
 *
 * @example
 * ```tsx
 * <PublishToggle
 *   isPublished={quiz.isPublished}
 *   onChange={handleToggle}
 *   participantCount={quiz.participantCount}
 * />
 * ```
 */
export default function PublishToggle({
  isPublished,
  onChange,
  participantCount = 0,
  disabled = false,
  className = '',
}: PublishToggleProps) {
  return (
    <div className={`flex items-center justify-between ${className}`}>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700">
            공개 상태
          </span>
          <span
            className={`
              px-2 py-0.5 rounded-full text-xs font-medium
              ${isPublished ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}
            `}
          >
            {isPublished ? '공개중' : '비공개'}
          </span>
        </div>
        {participantCount > 0 && (
          <p className="mt-1 text-xs text-gray-500">
            {participantCount}명의 학생이 참여했습니다
          </p>
        )}
      </div>

      {/* 토글 스위치 */}
      <motion.button
        type="button"
        whileTap={!disabled ? { scale: 0.95 } : undefined}
        onClick={() => !disabled && onChange(!isPublished)}
        disabled={disabled}
        className={`
          relative w-14 h-7 rounded-full
          transition-colors duration-300 ease-in-out
          focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500
          disabled:opacity-50 disabled:cursor-not-allowed
          ${isPublished ? 'bg-green-500' : 'bg-gray-300'}
        `}
        role="switch"
        aria-checked={isPublished}
        aria-label="공개 상태 토글"
      >
        {/* 스위치 thumb */}
        <motion.span
          layout
          transition={{
            type: 'spring',
            stiffness: 500,
            damping: 30,
          }}
          className={`
            absolute top-0.5 w-6 h-6
            bg-white rounded-full shadow-md
            flex items-center justify-center
            ${isPublished ? 'left-[calc(100%-1.625rem)]' : 'left-0.5'}
          `}
        >
          {/* 아이콘 */}
          {isPublished ? (
            <svg
              className="w-3.5 h-3.5 text-green-500"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
              <path
                fillRule="evenodd"
                d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z"
                clipRule="evenodd"
              />
            </svg>
          ) : (
            <svg
              className="w-3.5 h-3.5 text-gray-400"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z"
                clipRule="evenodd"
              />
              <path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z" />
            </svg>
          )}
        </motion.span>
      </motion.button>
    </div>
  );
}
