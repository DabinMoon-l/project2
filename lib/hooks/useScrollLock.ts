import { useEffect } from 'react';
import { lockScroll, unlockScroll } from '@/lib/utils/scrollLock';

/**
 * 스크롤 잠금 훅 — 마운트 시 잠금, 언마운트 시 해제
 * 카운터 기반이라 여러 컴포넌트가 동시에 사용해도 안전.
 *
 * @param active - true일 때 잠금 (기본: true)
 */
export function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return;
    lockScroll();
    return () => unlockScroll();
  }, [active]);
}
