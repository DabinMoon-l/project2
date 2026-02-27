'use client';

import { useEffect, useState } from 'react';

// useEffect, useState는 useWideMode에서 사용

/**
 * CSS zoom 제거됨 — 항상 1 반환 (하위 호환용)
 */
export function getZoom(): number {
  return 1;
}

/**
 * zoom 보정 제거됨 — 값을 그대로 반환 (하위 호환용)
 */
export function scaleCoord(value: number): number {
  return value;
}

/**
 * CSS zoom 제거됨 — no-op (하위 호환용)
 * zoom은 터치 좌표·애니메이션·키보드·fixed 요소에 부작용이 있어 제거
 */
export function useViewportScale() {
  // zoom 더 이상 적용하지 않음
}

/**
 * 가로모드(wide) 감지 훅
 * orientation: landscape + min-width: 1024px
 */
export function useWideMode(): boolean {
  const [isWide, setIsWide] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(
      '(orientation: landscape) and (min-width: 1024px)'
    );

    const handleChange = () => setIsWide(mql.matches);
    handleChange();

    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, []);

  return isWide;
}
