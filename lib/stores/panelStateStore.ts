/**
 * 패널 승격 상태 보존 Store (zustand)
 *
 * 2쪽(queue) → 3쪽(detail) 승격 시 컴포넌트 상태를 보존.
 * - 2쪽 unmount → 상태 저장
 * - 3쪽 mount → 상태 복원 + 소비
 * - 2쪽 닫기 (승격 아님) → 저장 상태 클리어
 */

import { create } from 'zustand';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyState = Record<string, any>;

interface PanelStateStore {
  /** 승격 대기 중인 상태 (컴포넌트 타입별) */
  pending: Record<string, AnyState>;
  /** 2쪽 unmount 시 상태 저장 */
  save: (componentType: string, state: AnyState) => void;
  /** 3쪽 mount 시 상태 복원 + 소비 (1회성) */
  consume: (componentType: string) => AnyState | null;
  /** 2쪽 닫기 시 클리어 (승격 아닌 경우) */
  clear: (componentType?: string) => void;
}

export const usePanelStateStore = create<PanelStateStore>((set, get) => ({
  pending: {},

  save: (componentType, state) => set(s => ({
    pending: { ...s.pending, [componentType]: state },
  })),

  consume: (componentType) => {
    const state = get().pending[componentType] ?? null;
    if (state) {
      set(s => {
        const { [componentType]: _, ...rest } = s.pending;
        return { pending: rest };
      });
    }
    return state;
  },

  clear: (componentType) => {
    if (componentType) {
      set(s => {
        const { [componentType]: _, ...rest } = s.pending;
        return { pending: rest };
      });
    } else {
      set({ pending: {} });
    }
  },
}));
