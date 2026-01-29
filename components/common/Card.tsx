'use client';

import { HTMLAttributes, forwardRef } from 'react';
import { motion, HTMLMotionProps } from 'framer-motion';

// Card variant 타입
type CardVariant = 'default' | 'elevated' | 'outlined';

// Card Props 타입
interface CardProps extends HTMLMotionProps<'div'> {
  /** 카드 스타일 variant */
  variant?: CardVariant;
  /** hover 효과 활성화 */
  hoverable?: boolean;
  /** 클릭 가능 여부 */
  clickable?: boolean;
  /** 패딩 크기 */
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /** 카드 내용 */
  children: React.ReactNode;
}

// variant별 스타일
const variantStyles: Record<CardVariant, string> = {
  default: 'bg-white shadow-sm border border-gray-100',
  elevated: 'bg-white shadow-md',
  outlined: 'bg-white border-2 border-gray-200',
};

// padding별 스타일
const paddingStyles = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

/**
 * 공통 Card 컴포넌트
 *
 * @example
 * // 기본 카드
 * <Card>카드 내용</Card>
 *
 * // hover 효과가 있는 카드
 * <Card hoverable>마우스를 올려보세요</Card>
 *
 * // 클릭 가능한 카드
 * <Card clickable onClick={() => console.log('clicked')}>클릭하세요</Card>
 */
const Card = forwardRef<HTMLDivElement, CardProps>(
  (
    {
      variant = 'default',
      hoverable = false,
      clickable = false,
      padding = 'md',
      children,
      className = '',
      onClick,
      ...props
    },
    ref
  ) => {
    const isInteractive = hoverable || clickable || !!onClick;

    return (
      <motion.div
        ref={ref}
        whileHover={
          isInteractive
            ? {
                y: -2,
                boxShadow: '0 8px 30px rgba(0, 0, 0, 0.08)',
              }
            : undefined
        }
        whileTap={clickable || onClick ? { scale: 0.99 } : undefined}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        onClick={onClick}
        role={clickable || onClick ? 'button' : undefined}
        tabIndex={clickable || onClick ? 0 : undefined}
        onKeyDown={(e) => {
          // Enter 또는 Space 키로 클릭 가능
          if ((clickable || onClick) && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onClick?.(e as any);
          }
        }}
        className={`
          rounded-2xl
          transition-all duration-200
          ${variantStyles[variant]}
          ${paddingStyles[padding]}
          ${isInteractive ? 'cursor-pointer' : ''}
          ${clickable || onClick ? 'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2' : ''}
          ${className}
        `}
        {...props}
      >
        {children}
      </motion.div>
    );
  }
);

Card.displayName = 'Card';

// Card 하위 컴포넌트들
interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export const CardHeader = forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ children, className = '', ...props }, ref) => (
    <div
      ref={ref}
      className={`pb-3 border-b border-gray-100 mb-3 ${className}`}
      {...props}
    >
      {children}
    </div>
  )
);

CardHeader.displayName = 'CardHeader';

interface CardTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  children: React.ReactNode;
}

export const CardTitle = forwardRef<HTMLHeadingElement, CardTitleProps>(
  ({ children, className = '', ...props }, ref) => (
    <h3
      ref={ref}
      className={`text-lg font-semibold text-gray-900 ${className}`}
      {...props}
    >
      {children}
    </h3>
  )
);

CardTitle.displayName = 'CardTitle';

interface CardContentProps extends HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export const CardContent = forwardRef<HTMLDivElement, CardContentProps>(
  ({ children, className = '', ...props }, ref) => (
    <div ref={ref} className={`text-gray-600 ${className}`} {...props}>
      {children}
    </div>
  )
);

CardContent.displayName = 'CardContent';

interface CardFooterProps extends HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export const CardFooter = forwardRef<HTMLDivElement, CardFooterProps>(
  ({ children, className = '', ...props }, ref) => (
    <div
      ref={ref}
      className={`pt-3 border-t border-gray-100 mt-3 ${className}`}
      {...props}
    >
      {children}
    </div>
  )
);

CardFooter.displayName = 'CardFooter';

export default Card;
