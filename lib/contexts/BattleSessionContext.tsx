'use client';

/**
 * 배틀 세션 Context — useTekkenBattle 훅을 layout 에서 한 번만 호출해 공유.
 *
 * entry:
 *  - 'self'  : 신청자 본인. 배틀 확인 모달이 있던 자리(3쪽, --home-sheet-left) 그대로.
 *  - 'invite': 수신자. 수락 클릭 시점에 캡처된 invitePlacement 사용 (freeze).
 */

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { useTekkenBattle } from '@/lib/hooks/useTekkenBattle';
import { useUser } from '@/lib/contexts/UserContext';
import type { BattlePlacement } from '@/lib/hooks/useBattlePlacement';

type Tekken = ReturnType<typeof useTekkenBattle>;

export type BattleEntry = 'self' | 'invite';

interface BattleSessionContextType {
  tekken: Tekken;
  showBattle: boolean;
  battleAiOnly: boolean;
  entry: BattleEntry;
  /** 수신자(초대 수락) 만 사용. self 면 null. */
  invitePlacement: BattlePlacement | null;
  /** 오버레이만 열기 — AI 매칭처럼 battleId 아직 없을 때 (신청자 flow) */
  openBattle: (aiOnly: boolean) => void;
  /** battleId 주입 + 오버레이 열기.
   *  fromInvite=true 면 invitePlacement 필수 — 클릭 시점의 placement 를 박제.
   */
  startBattle: (
    battleId: string,
    aiOnly: boolean,
    fromInvite?: boolean,
    invitePlacement?: BattlePlacement,
  ) => void;
  closeBattle: () => void;
}

const BattleSessionContext = createContext<BattleSessionContextType | null>(null);

export function BattleSessionProvider({ children }: { children: ReactNode }) {
  const { profile } = useUser();
  const tekken = useTekkenBattle(profile?.uid);
  const [showBattle, setShowBattle] = useState(false);
  const [battleAiOnly, setBattleAiOnly] = useState(false);
  const [entry, setEntry] = useState<BattleEntry>('self');
  const [invitePlacement, setInvitePlacement] = useState<BattlePlacement | null>(null);

  const openBattle = useCallback((aiOnly: boolean) => {
    setEntry('self');
    setInvitePlacement(null);
    setBattleAiOnly(aiOnly);
    setShowBattle(true);
  }, []);

  const startBattle = useCallback((
    battleId: string,
    aiOnly: boolean,
    fromInvite = false,
    placement: BattlePlacement | undefined = undefined,
  ) => {
    setEntry(fromInvite ? 'invite' : 'self');
    setInvitePlacement(fromInvite ? (placement ?? 'panel-right') : null);
    tekken.attachBattleId(battleId);
    setBattleAiOnly(aiOnly);
    setShowBattle(true);
  }, [tekken]);

  const closeBattle = useCallback(() => {
    setShowBattle(false);
    setBattleAiOnly(false);
    setEntry('self');
    setInvitePlacement(null);
    tekken.leaveBattle();
  }, [tekken]);

  return (
    <BattleSessionContext.Provider
      value={{
        tekken, showBattle, battleAiOnly, entry, invitePlacement,
        openBattle, startBattle, closeBattle,
      }}
    >
      {children}
    </BattleSessionContext.Provider>
  );
}

export function useBattleSession() {
  const ctx = useContext(BattleSessionContext);
  if (!ctx) throw new Error('useBattleSession must be inside BattleSessionProvider');
  return ctx;
}
