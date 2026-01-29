'use client';

import { HTMLAttributes } from 'react';

// Skeleton variant 타입
type SkeletonVariant = 'text' | 'rectangular' | 'circular' | 'card';

// Skeleton Props 타입
interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /** 스켈레톤 타입 */
  variant?: SkeletonVariant;
  /** 너비 (기본값: '100%') */
  width?: string | number;
  /** 높이 (기본값: variant에 따라 다름) */
  height?: string | number;
  /** 애니메이션 활성화 */
  animate?: boolean;
  /** 텍스트 줄 수 (variant='text'일 때) */
  lines?: number;
}

// variant별 기본 스타일
const variantStyles: Record<SkeletonVariant, string> = {
  text: 'rounded-md h-4',
  rectangular: 'rounded-xl',
  circular: 'rounded-full',
  card: 'rounded-2xl',
};

/**
 * 공통 Skeleton 컴포넌트
 *
 * @example
 * // 텍스트 스켈레톤
 * <Skeleton variant="text" width="80%" />
 *
 * // 여러 줄 텍스트
 * <Skeleton variant="text" lines={3} />
 *
 * // 원형 스켈레톤 (아바타)
 * <Skeleton variant="circular" width={48} height={48} />
 *
 * // 카드 스켈레톤
 * <Skeleton variant="card" height={200} />
 */
export default function Skeleton({
  variant = 'text',
  width,
  height,
  animate = true,
  lines = 1,
  className = '',
  style,
  ...props
}: SkeletonProps) {
  // 텍스트 여러 줄일 경우
  if (variant === 'text' && lines > 1) {
    return (
      <div className="space-y-2" {...props}>
        {Array.from({ length: lines }).map((_, index) => (
          <div
            key={index}
            className={`
              bg-gray-200
              ${variantStyles.text}
              ${animate ? 'animate-pulse' : ''}
              ${className}
            `}
            style={{
              // 마지막 줄은 랜덤하게 짧게
              width: index === lines - 1 ? '60%' : '100%',
              ...style,
            }}
          />
        ))}
      </div>
    );
  }

  // 스타일 계산
  const computedStyle: React.CSSProperties = {
    width: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height,
    ...style,
  };

  // 원형일 경우 너비와 높이 동일하게
  if (variant === 'circular' && width && !height) {
    computedStyle.height = computedStyle.width;
  }

  return (
    <div
      className={`
        bg-gray-200
        ${variantStyles[variant]}
        ${animate ? 'animate-pulse' : ''}
        ${className}
      `}
      style={computedStyle}
      aria-hidden="true"
      {...props}
    />
  );
}

// 미리 정의된 스켈레톤 조합들

interface SkeletonTextProps {
  lines?: number;
  className?: string;
}

/** 텍스트 스켈레톤 */
export function SkeletonText({ lines = 3, className = '' }: SkeletonTextProps) {
  return <Skeleton variant="text" lines={lines} className={className} />;
}

interface SkeletonAvatarProps {
  size?: number;
  className?: string;
}

/** 아바타 스켈레톤 */
export function SkeletonAvatar({ size = 40, className = '' }: SkeletonAvatarProps) {
  return (
    <Skeleton
      variant="circular"
      width={size}
      height={size}
      className={className}
    />
  );
}

interface SkeletonCardProps {
  className?: string;
}

/** 카드 스켈레톤 */
export function SkeletonCard({ className = '' }: SkeletonCardProps) {
  return (
    <div className={`p-4 bg-white rounded-2xl shadow-sm ${className}`}>
      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-4">
        <SkeletonAvatar size={40} />
        <div className="flex-1 space-y-2">
          <Skeleton variant="text" width="40%" />
          <Skeleton variant="text" width="25%" />
        </div>
      </div>
      {/* 이미지 영역 */}
      <Skeleton variant="rectangular" height={160} className="mb-4" />
      {/* 텍스트 */}
      <SkeletonText lines={2} />
    </div>
  );
}

interface SkeletonListProps {
  count?: number;
  className?: string;
}

/** 리스트 아이템 스켈레톤 */
export function SkeletonList({ count = 5, className = '' }: SkeletonListProps) {
  return (
    <div className={`space-y-3 ${className}`}>
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="flex items-center gap-3 p-3 bg-white rounded-xl"
        >
          <SkeletonAvatar size={48} />
          <div className="flex-1 space-y-2">
            <Skeleton variant="text" width="60%" />
            <Skeleton variant="text" width="40%" />
          </div>
        </div>
      ))}
    </div>
  );
}

interface SkeletonQuizCardProps {
  className?: string;
}

/** 퀴즈 카드 스켈레톤 */
export function SkeletonQuizCard({ className = '' }: SkeletonQuizCardProps) {
  return (
    <div className={`p-4 bg-white rounded-2xl shadow-sm ${className}`}>
      {/* 퀴즈 번호/제목 */}
      <div className="flex items-center justify-between mb-4">
        <Skeleton variant="text" width={100} />
        <Skeleton variant="rectangular" width={60} height={24} />
      </div>
      {/* 문제 내용 */}
      <SkeletonText lines={2} className="mb-4" />
      {/* 선택지 */}
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton
            key={index}
            variant="rectangular"
            height={44}
          />
        ))}
      </div>
    </div>
  );
}
