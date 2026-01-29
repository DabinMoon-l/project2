/**
 * 공통 애니메이션 설정
 *
 * Framer Motion 애니메이션을 위한 재사용 가능한 variants와 transitions를 정의합니다.
 * - 일관된 애니메이션 경험 제공
 * - reduce-motion 접근성 지원
 * - 성능 최적화 (transform/opacity 기반)
 */

import type { Variants, Transition } from 'framer-motion';

// ============================================================
// 공통 Transition 설정
// ============================================================

/**
 * 기본 트랜지션 (빠른 응답)
 */
export const quickTransition: Transition = {
  type: 'tween',
  duration: 0.15,
  ease: 'easeOut',
};

/**
 * 부드러운 트랜지션
 */
export const smoothTransition: Transition = {
  type: 'tween',
  duration: 0.25,
  ease: 'easeInOut',
};

/**
 * 스프링 트랜지션 (자연스러운 움직임)
 */
export const springTransition: Transition = {
  type: 'spring',
  stiffness: 300,
  damping: 25,
};

/**
 * 느린 스프링 (부드러운 바운스)
 */
export const softSpringTransition: Transition = {
  type: 'spring',
  stiffness: 200,
  damping: 20,
};

// ============================================================
// 페이지 전환 Variants
// ============================================================

/**
 * 페이드 인/아웃
 */
export const fadeVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: smoothTransition },
  exit: { opacity: 0, transition: quickTransition },
};

/**
 * 아래에서 위로 슬라이드
 */
export const slideUpVariants: Variants = {
  initial: { opacity: 0, y: 20 },
  animate: {
    opacity: 1,
    y: 0,
    transition: smoothTransition,
  },
  exit: {
    opacity: 0,
    y: -10,
    transition: quickTransition,
  },
};

/**
 * 왼쪽에서 오른쪽으로 슬라이드
 */
export const slideRightVariants: Variants = {
  initial: { opacity: 0, x: -20 },
  animate: {
    opacity: 1,
    x: 0,
    transition: smoothTransition,
  },
  exit: {
    opacity: 0,
    x: 20,
    transition: quickTransition,
  },
};

/**
 * 오른쪽에서 왼쪽으로 슬라이드
 */
export const slideLeftVariants: Variants = {
  initial: { opacity: 0, x: 20 },
  animate: {
    opacity: 1,
    x: 0,
    transition: smoothTransition,
  },
  exit: {
    opacity: 0,
    x: -20,
    transition: quickTransition,
  },
};

// ============================================================
// 컴포넌트 Variants
// ============================================================

/**
 * 스케일 팝
 */
export const scaleVariants: Variants = {
  initial: { opacity: 0, scale: 0.9 },
  animate: {
    opacity: 1,
    scale: 1,
    transition: springTransition,
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    transition: quickTransition,
  },
};

/**
 * 카드 호버 효과
 */
export const cardHoverVariants: Variants = {
  initial: { y: 0, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' },
  hover: {
    y: -4,
    boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
    transition: quickTransition,
  },
  tap: { scale: 0.98, transition: { duration: 0.1 } },
};

/**
 * 버튼 탭 효과
 */
export const buttonTapVariants: Variants = {
  initial: { scale: 1 },
  tap: { scale: 0.97, transition: { duration: 0.1 } },
  hover: { scale: 1.02, transition: quickTransition },
};

/**
 * 리스트 아이템 스태거 (컨테이너)
 */
export const staggerContainerVariants: Variants = {
  initial: {},
  animate: {
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.1,
    },
  },
};

/**
 * 리스트 아이템 스태거 (아이템)
 */
export const staggerItemVariants: Variants = {
  initial: { opacity: 0, y: 10 },
  animate: {
    opacity: 1,
    y: 0,
    transition: smoothTransition,
  },
};

// ============================================================
// 모달/오버레이 Variants
// ============================================================

/**
 * 모달 백드롭
 */
export const backdropVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

/**
 * 모달 컨텐츠 (센터 팝업)
 */
export const modalVariants: Variants = {
  initial: { opacity: 0, scale: 0.95, y: 10 },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: springTransition,
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    y: 10,
    transition: { duration: 0.15 },
  },
};

/**
 * 바텀 시트
 */
export const bottomSheetVariants: Variants = {
  initial: { y: '100%' },
  animate: {
    y: 0,
    transition: {
      type: 'spring',
      stiffness: 400,
      damping: 35,
    },
  },
  exit: {
    y: '100%',
    transition: { duration: 0.2 },
  },
};

// ============================================================
// 특수 효과 Variants
// ============================================================

/**
 * 펄스 효과 (알림 등)
 */
export const pulseVariants: Variants = {
  initial: { scale: 1 },
  pulse: {
    scale: [1, 1.05, 1],
    transition: {
      duration: 0.6,
      repeat: Infinity,
      repeatDelay: 2,
    },
  },
};

/**
 * 쉐이크 효과 (에러 등)
 */
export const shakeVariants: Variants = {
  initial: { x: 0 },
  shake: {
    x: [-10, 10, -10, 10, 0],
    transition: { duration: 0.4 },
  },
};

// ============================================================
// Reduce Motion 지원
// ============================================================

/**
 * reduce-motion 사용자를 위한 기본 variants
 * 애니메이션 없이 즉시 표시
 */
export const reducedMotionVariants: Variants = {
  initial: { opacity: 1 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

/**
 * reduce-motion 설정에 따라 variants 선택
 */
export function getAccessibleVariants(
  normalVariants: Variants,
  prefersReducedMotion: boolean
): Variants {
  return prefersReducedMotion ? reducedMotionVariants : normalVariants;
}
