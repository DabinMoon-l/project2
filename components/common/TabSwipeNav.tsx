'use client';

import { useRef, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';

interface TabSwipeNavProps {
  /** 탭 경로 배열 (순서대로) */
  tabs: string[];
  /** 스와이프 활성화 여부 */
  enabled: boolean;
  children: React.ReactNode;
}

/**
 * 탭 간 좌우 스와이프 네비게이션 래퍼
 *
 * 순수 div 래퍼로 ref만 사용. state로 렌더링 제어 안 함 → re-render 없음.
 * - 60px 이상 수평 스와이프 시 인접 탭으로 이동
 * - [data-no-tab-swipe] 속성이 있는 영역 내 터치는 무시
 */
export default function TabSwipeNav({ tabs, enabled, children }: TabSwipeNavProps) {
  const router = useRouter();
  const pathname = usePathname();

  const startXRef = useRef(0);
  const startYRef = useRef(0);
  // 'pending' = 방향 미결정, 'horizontal' = 수평 잠금, 'vertical' = 수직 (무시)
  const directionRef = useRef<'pending' | 'horizontal' | 'vertical'>('pending');
  const ignoredRef = useRef(false);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!enabled) return;

    // [data-no-tab-swipe] 영역 내 터치 무시
    const target = e.target as HTMLElement;
    if (target.closest('[data-no-tab-swipe]')) {
      ignoredRef.current = true;
      return;
    }

    ignoredRef.current = false;
    startXRef.current = e.touches[0].clientX;
    startYRef.current = e.touches[0].clientY;
    directionRef.current = 'pending';
  }, [enabled]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!enabled || ignoredRef.current || directionRef.current !== 'pending') return;

    const dx = Math.abs(e.touches[0].clientX - startXRef.current);
    const dy = Math.abs(e.touches[0].clientY - startYRef.current);

    // 15px 이내면 방향 판단 보류
    if (dx < 15 && dy < 15) return;

    directionRef.current = dx > dy ? 'horizontal' : 'vertical';
  }, [enabled]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!enabled || ignoredRef.current || directionRef.current !== 'horizontal') return;

    const dx = e.changedTouches[0].clientX - startXRef.current;
    const absDx = Math.abs(dx);

    // 60px 미만이면 무시
    if (absDx < 60) return;

    const currentIndex = tabs.indexOf(pathname ?? '');
    if (currentIndex === -1) return;

    // 오른쪽 스와이프 → 이전 탭, 왼쪽 스와이프 → 다음 탭
    const nextIndex = dx > 0 ? currentIndex - 1 : currentIndex + 1;

    if (nextIndex >= 0 && nextIndex < tabs.length) {
      router.push(tabs[nextIndex]);
    }
  }, [enabled, tabs, pathname, router]);

  if (!enabled) {
    return <>{children}</>;
  }

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {children}
    </div>
  );
}
