/**
 * Reduced Motion 훅
 *
 * 사용자의 접근성 설정(prefers-reduced-motion)을 감지하여
 * 애니메이션을 비활성화하거나 간소화합니다.
 */

'use client';

import { useState, useEffect } from 'react';

/**
 * 사용자가 애니메이션 축소를 선호하는지 확인하는 훅
 *
 * @returns 애니메이션 축소 선호 여부
 *
 * @example
 * ```tsx
 * function AnimatedComponent() {
 *   const prefersReducedMotion = useReducedMotion();
 *
 *   return (
 *     <motion.div
 *       variants={prefersReducedMotion ? reducedMotionVariants : normalVariants}
 *     >
 *       콘텐츠
 *     </motion.div>
 *   );
 * }
 * ```
 */
export function useReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    // SSR 환경에서는 false 반환
    if (typeof window === 'undefined') return;

    // 미디어 쿼리 확인
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mediaQuery.matches);

    // 설정 변경 감지
    const handleChange = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches);
    };

    // 이벤트 리스너 등록
    mediaQuery.addEventListener('change', handleChange);

    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, []);

  return prefersReducedMotion;
}

/**
 * 애니메이션 지속 시간을 반환 (reduced motion 시 0)
 */
export function useAnimationDuration(normalDuration: number): number {
  const prefersReducedMotion = useReducedMotion();
  return prefersReducedMotion ? 0 : normalDuration;
}
