/**
 * 패널 승격 상태 보존 Store (zustand)
 *
 * 2쪽(queue) → 3쪽(detail) 승격 시 컴포넌트 상태를 보존.
 * - 2쪽 unmount → 상태 저장
 * - 3쪽 mount → 상태 복원 + 소비
 * - 2쪽 닫기 (승격 아님) → 저장 상태 클리어
 *
 * persist 미들웨어로 localStorage에 저장 — iOS PWA eviction 후 cold reload에도 복원 가능.
 * 단, 저장 직후 앱이 죽어도 다음 실행 시 pending에 남아있으면 가로모드 재진입 시 승격됨.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyState = Record<string, any>;

interface PanelStateStore {
  /** 승격 대기 중인 상태 (컴포넌트 타입별) */
  pending: Record<string, AnyState>;
  /** 마지막 저장 시각 (너무 오래된 상태는 복원 시 무시) */
  savedAt: Record<string, number>;
  /** 2쪽 unmount 시 상태 저장 */
  save: (componentType: string, state: AnyState) => void;
  /** 3쪽 mount 시 상태 복원 + 소비 (1회성, 24시간 초과 시 null) */
  consume: (componentType: string) => AnyState | null;
  /** 2쪽 닫기 시 클리어 (승격 아닌 경우) */
  clear: (componentType?: string) => void;
}

/** 복원 유효기간 (24시간) — persist에서 너무 오래된 상태 복원 방지 */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const usePanelStateStore = create<PanelStateStore>()(
  persist(
    (set, get) => ({
      pending: {},
      savedAt: {},

      save: (componentType, state) => set(s => ({
        pending: { ...s.pending, [componentType]: state },
        savedAt: { ...s.savedAt, [componentType]: Date.now() },
      })),

      consume: (componentType) => {
        const state = get().pending[componentType] ?? null;
        const ts = get().savedAt[componentType] ?? 0;
        if (state && Date.now() - ts > MAX_AGE_MS) {
          // 만료: 소비 없이 클리어만
          set(s => {
            const { [componentType]: _p, ...restP } = s.pending;
            const { [componentType]: _t, ...restT } = s.savedAt;
            return { pending: restP, savedAt: restT };
          });
          return null;
        }
        if (state) {
          set(s => {
            const { [componentType]: _p, ...restP } = s.pending;
            const { [componentType]: _t, ...restT } = s.savedAt;
            return { pending: restP, savedAt: restT };
          });
        }
        return state;
      },

      clear: (componentType) => {
        if (componentType) {
          set(s => {
            const { [componentType]: _p, ...restP } = s.pending;
            const { [componentType]: _t, ...restT } = s.savedAt;
            return { pending: restP, savedAt: restT };
          });
        } else {
          set({ pending: {}, savedAt: {} });
        }
      },
    }),
    {
      name: 'rabbitory-panel-state',
      storage: createJSONStorage(() => localStorage),
      // pending + savedAt만 저장 (함수 등은 자동 제외)
      partialize: (s) => ({ pending: s.pending, savedAt: s.savedAt }),
      version: 1,
    },
  ),
);
