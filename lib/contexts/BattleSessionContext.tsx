'use client';

/**
 * 배틀 세션 Context — useTekkenBattle 훅 결과를 layout 레벨에서 한 번만 호출해
 * 앱 어디서든 접근 가능하게 공유.
 *
 * 기존: CharacterBox(홈)만 useTekkenBattle 사용 → 홈 밖에선 배틀 불가.
 * 이제: layout이 Provider 마운트 → BattleOverlayMount·CharacterBox·도전장 모달 등
 *       모두 같은 인스턴스의 tekken 사용.
 *
 * 훅 인스턴스는 1개뿐이므로 RTDB 구독 중복도 없음.
 */

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { useTekkenBattle } from '@/lib/hooks/useTekkenBattle';
import { useUser } from '@/lib/contexts/UserContext';

type Tekken = ReturnType<typeof useTekkenBattle>;

/**
 * 배틀 진입 경로.
 *  - 'self'  : 신청자(본인) 의 flow. 배틀 확인 모달이 있던 자리(3쪽) 를 그대로 사용.
 *  - 'invite': 수신자 쪽. 현재 화면·패널 상태 보고 동적으로 2쪽/3쪽/fullscreen 결정.
 */
export type BattleEntry = 'self' | 'invite';

interface BattleSessionContextType {
  tekken: Tekken;
  showBattle: boolean;
  battleAiOnly: boolean;
  entry: BattleEntry;
  /** 오버레이만 열기 — AI 매칭처럼 battleId 아직 없을 때 사용 (신청자 flow) */
  openBattle: (aiOnly: boolean) => void;
  /** battleId 주입 + 오버레이 열기. fromInvite=true 면 수신자 동적 placement */
  startBattle: (battleId: string, aiOnly: boolean, fromInvite?: boolean) => void;
  closeBattle: () => void;
}

const BattleSessionContext = createContext<BattleSessionContextType | null>(null);

export function BattleSessionProvider({ children }: { children: ReactNode }) {
  const { profile } = useUser();
  const tekken = useTekkenBattle(profile?.uid);
  const [showBattle, setShowBattle] = useState(false);
  const [battleAiOnly, setBattleAiOnly] = useState(false);
  const [entry, setEntry] = useState<BattleEntry>('self');

  const openBattle = useCallback((aiOnly: boolean) => {
    setEntry('self');
    setBattleAiOnly(aiOnly);
    setShowBattle(true);
  }, []);

  const startBattle = useCallback((battleId: string, aiOnly: boolean, fromInvite = false) => {
    setEntry(fromInvite ? 'invite' : 'self');
    tekken.attachBattleId(battleId);
    setBattleAiOnly(aiOnly);
    setShowBattle(true);
  }, [tekken]);

  const closeBattle = useCallback(() => {
    setShowBattle(false);
    setBattleAiOnly(false);
    setEntry('self');
    tekken.leaveBattle();
  }, [tekken]);

  return (
    <BattleSessionContext.Provider
      value={{ tekken, showBattle, battleAiOnly, entry, openBattle, startBattle, closeBattle }}
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
