'use client';

/**
 * 배틀 오버레이 배치 결정
 *
 * 규칙:
 *  - 세로: fullscreen
 *  - 가로 + 3쪽 free: panel-right (3쪽, preferred)
 *  - 가로 + 3쪽 locked + 2쪽 free: panel-left (2쪽)
 *  - 가로 + 둘 다 locked: 'blocked' → 호출부에서 fullscreen fallback
 *
 * 훅(useBattlePlacement) 은 실시간 값, 순수 함수(computeBattlePlacement) 는
 * "바로 이 순간" 의 placement 를 외부에서 캡처할 때 사용 (수락 클릭 시점 등).
 */

import { usePathname } from 'next/navigation';
import { useMemo } from 'react';
import { useWideMode } from '@/lib/hooks/useViewportScale';
import { useDetailPanel } from '@/lib/contexts/DetailPanelContext';

export type BattlePlacement = 'fullscreen' | 'panel-right' | 'panel-left';

/** 2쪽(메인 페이지)이 학습·배틀로 바쁘다고 판정되는 경로 */
export function isMainPanelBusy(pathname: string): boolean {
  if (/^\/quiz\/[^/]+/.test(pathname) && pathname !== '/quiz/create') return true;
  if (/^\/review\/[^/]+\/[^/]+/.test(pathname)) return true;
  return false;
}

/** placement → CSS style 로 변환 (TekkenBattleOverlay overrideStyle 용) */
export function placementToStyle(p: BattlePlacement): React.CSSProperties {
  switch (p) {
    case 'fullscreen':
      return { left: 0, right: 0 };
    case 'panel-right':
      return { left: 'calc(50% + 120px)', right: 0 };
    case 'panel-left':
      return { left: '240px', right: 'calc(50% - 120px)' };
  }
}

/**
 * 순수 함수 — 지정된 입력으로 placement 계산 (훅 없이 아무 데서나 호출 가능).
 * 둘 다 잠김(blocked) 케이스는 fullscreen 으로 fallback (신청은 sender 쪽에서 차단).
 */
export function computeBattlePlacement(
  isWide: boolean,
  isLocked: boolean,
  pathname: string,
): BattlePlacement {
  if (!isWide) return 'fullscreen';
  if (!isLocked) return 'panel-right';
  if (!isMainPanelBusy(pathname)) return 'panel-left';
  return 'fullscreen';
}

/** 훅 — 실시간 placement. 기본 스타일도 같이 반환 */
export function useBattlePlacement(): { placement: BattlePlacement; style: React.CSSProperties } {
  const isWide = useWideMode();
  const pathname = usePathname() || '';
  const { isLocked } = useDetailPanel();

  return useMemo(() => {
    const placement = computeBattlePlacement(isWide, isLocked, pathname);
    return { placement, style: placementToStyle(placement) };
  }, [isWide, isLocked, pathname]);
}
