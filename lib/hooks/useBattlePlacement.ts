'use client';

/**
 * 배틀 오버레이 배치 결정
 *
 * 세로모드: 전체 화면
 * 가로모드:
 *   - 3쪽 잠금 안 됨 → 3쪽 (preferred)
 *   - 3쪽 잠금 (퀴즈/복습/만들기 진행 중) → 2쪽 (메인)
 *   - 2쪽도 바쁜 상태 (퀴즈 풀이 경로 등) → 'blocked'
 *
 * 반환값 style 은 TekkenBattleOverlay의 left/right 를 덮어쓰기 위함.
 */

import { usePathname } from 'next/navigation';
import { useMemo } from 'react';
import { useWideMode } from '@/lib/hooks/useViewportScale';
import { useDetailPanel } from '@/lib/contexts/DetailPanelContext';

export type BattlePlacement = 'fullscreen' | 'panel-right' | 'panel-left' | 'blocked';

/** 2쪽(메인 페이지)이 학습·배틀로 바쁘다고 판정되는 경로 */
function isMainPanelBusy(pathname: string): boolean {
  // 퀴즈 풀이
  if (/^\/quiz\/[^/]+/.test(pathname) && pathname !== '/quiz/create') return true;
  // 복습 디테일
  if (/^\/review\/[^/]+\/[^/]+/.test(pathname)) return true;
  return false;
}

export function useBattlePlacement(): {
  placement: BattlePlacement;
  style: React.CSSProperties;
} {
  const isWide = useWideMode();
  const pathname = usePathname() || '';
  const { isLocked } = useDetailPanel();

  return useMemo(() => {
    // 세로모드: 전체화면
    if (!isWide) {
      return { placement: 'fullscreen' as const, style: { left: 0, right: 0 } };
    }
    // 가로모드 — 3쪽 우선
    if (!isLocked) {
      return {
        placement: 'panel-right' as const,
        style: { left: 'calc(50% + 120px)', right: 0 },
      };
    }
    // 3쪽 잠김 — 2쪽 가능?
    if (!isMainPanelBusy(pathname)) {
      return {
        placement: 'panel-left' as const,
        style: { left: '240px', right: 'calc(50% - 120px)' },
      };
    }
    // 둘 다 바쁨 — 배틀 시작 불가 (sender 쪽에서 차단되어야 정상)
    return { placement: 'blocked' as const, style: {} };
  }, [isWide, isLocked, pathname]);
}
