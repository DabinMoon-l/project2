'use client';

/**
 * 배틀 세션 pending store (zustand)
 *
 * 용도: 배틀 신청을 수락한 순간 receiver 쪽에서 CharacterBox에 battleId를 전달.
 * searchParams 방식은 Next.js의 효과 재실행 타이밍 이슈로 불안정 → 이 store로 대체.
 *
 * 흐름:
 *  - BattleInviteChallengeModal 에서 수락 CF 성공 시 `request(battleId, aiOnly)` 호출
 *  - receiver 가 가로모드든 세로모드든 home으로 router.push('/') — 현재는 home 기반 유지
 *  - CharacterBox 가 pending 을 구독하다가 `attachBattleId` 호출 + 배틀 오버레이 표시
 *  - 배틀 시작 직후 `consume()` 으로 pending 정리 (중복 처리 방지)
 *
 * 향후 layout-level overlay 도입 시 CharacterBox 대신 그쪽이 구독하면 됨 — store 스키마는 유지.
 */

import { create } from 'zustand';

interface BattleSessionStore {
  pending: { battleId: string; aiOnly: boolean } | null;
  request: (battleId: string, aiOnly: boolean) => void;
  consume: () => void;
}

export const useBattleSessionStore = create<BattleSessionStore>((set) => ({
  pending: null,
  request: (battleId, aiOnly) => set({ pending: { battleId, aiOnly } }),
  consume: () => set({ pending: null }),
}));
