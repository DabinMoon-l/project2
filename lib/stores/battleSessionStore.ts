'use client';

/**
 * 배틀 세션 pending store (zustand)
 *
 * 배틀 신청을 수락한 순간 CharacterBox 대신 layout 레벨 BattleOverlayMount 가
 * pending 을 소비해 배틀을 시작. 수신자가 어느 페이지에 있든 현재 화면에서
 * 오버레이가 뜸.
 *
 * placement 는 수락 클릭 시점에 수신자 화면 상태(isLocked 등)를 기준으로
 * 계산해 박제. 이후 CharacterBox 가 lockDetail() 을 호출해도 뒤집히지 않음.
 */

import { create } from 'zustand';
import type { BattlePlacement } from '@/lib/hooks/useBattlePlacement';

interface BattleSessionStore {
  pending: { battleId: string; aiOnly: boolean; placement: BattlePlacement } | null;
  request: (battleId: string, aiOnly: boolean, placement: BattlePlacement) => void;
  consume: () => void;
}

export const useBattleSessionStore = create<BattleSessionStore>((set) => ({
  pending: null,
  request: (battleId, aiOnly, placement) => set({ pending: { battleId, aiOnly, placement } }),
  consume: () => set({ pending: null }),
}));
