'use client';

import { useEffect, useLayoutEffect, useState, useRef, useCallback } from 'react';

/** SSR 안전 layout effect — 클라이언트에서만 useLayoutEffect, 서버에서는 noop-useEffect */
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

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
 * 100ms 디바운스로 화면 회전 시 깜빡임 방지
 */
export function useWideMode(): boolean {
  const [isWide, setIsWide] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = useCallback((mql: MediaQueryList | MediaQueryListEvent) => {
    const matches = 'matches' in mql ? mql.matches : (mql as MediaQueryList).matches;
    // 100ms 디바운스 — 회전 애니메이션 중 중간 상태 무시
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setIsWide(matches);
    }, 100);
  }, []);

  // 초기 동기화는 paint 전에 끝내야 세로→가로 깜빡임이 없음 (특히 cold reload).
  // useLayoutEffect가 SSR에서 경고를 내므로 isomorphic wrapper 사용.
  useIsomorphicLayoutEffect(() => {
    const mql = window.matchMedia(
      '(orientation: landscape) and (min-width: 1024px)'
    );

    // 초기값은 디바운스 없이 즉시 설정 (paint 전)
    setIsWide(mql.matches);

    const listener = (e: MediaQueryListEvent) => handleChange(e);
    mql.addEventListener('change', listener);
    return () => {
      mql.removeEventListener('change', listener);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [handleChange]);

  return isWide;
}
