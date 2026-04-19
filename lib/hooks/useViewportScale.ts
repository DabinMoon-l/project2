'use client';

import { useSyncExternalStore } from 'react';

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
 * 가로모드(wide) 감지 훅 — useSyncExternalStore 기반.
 *
 * 왜 useSyncExternalStore인가:
 * - useState + useEffect는 초기 render에 매칭 전 값(false)을 쓰고 effect 후 재render.
 *   이 경우 브라우저가 이미 paint한 뒤 전환이 일어나 1프레임 '세로→가로' 깜빡임 발생.
 *   특히 cold reload + SW 캐시된 HTML에서 두드러짐.
 * - useSyncExternalStore는 초기 render 시점에 getSnapshot을 호출해 paint 전 동기화.
 *
 * SSR 시 getServerSnapshot은 false (window 없음) → 하이드레이션 시 첫 render에서 정확한 값 반영.
 */
const MQL_QUERY = '(orientation: landscape) and (min-width: 1024px)';

function subscribe(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const mql = window.matchMedia(MQL_QUERY);
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia(MQL_QUERY).matches;
}

function getServerSnapshot(): boolean {
  return false;
}

export function useWideMode(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
