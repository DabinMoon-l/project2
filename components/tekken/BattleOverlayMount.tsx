'use client';

/**
 * 배틀 오버레이 마운트 포인트 — layout.tsx 에 한 번만 렌더.
 *
 * - BattleSession context 의 showBattle 이 true 일 때만 오버레이 띄움
 * - zustand store(pending)에서 수락된 battleId 감지 → startBattle 호출
 * - useBattlePlacement 로 세로·가로·패널 잠금 상태 판단해 style 덮어쓰기
 *
 * TekkenBattleOverlay 는 기본 `--home-sheet-left` 기준 렌더.
 * 이 컴포넌트가 overrideStyle 을 전달해 경우에 따라 2쪽으로 옮김.
 */

import { useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useUser } from '@/lib/contexts/UserContext';
import { useBattleSession } from '@/lib/contexts/BattleSessionContext';
import { useBattleSessionStore } from '@/lib/stores/battleSessionStore';
import { useBattlePlacement } from '@/lib/hooks/useBattlePlacement';
import { useExpToast } from '@/components/common/ExpToast';
import { calcBattleXp } from '@/lib/utils/tekkenDamage';

const TekkenBattleOverlay = dynamic(
  () => import('@/components/tekken/TekkenBattleOverlay'),
  { ssr: false },
);

export default function BattleOverlayMount() {
  const { profile } = useUser();
  const { tekken, showBattle, battleAiOnly, startBattle, closeBattle } = useBattleSession();
  const { style: placementStyle } = useBattlePlacement();
  const { showExpToast } = useExpToast();

  // 배틀 신청 수락 시 store.request(battleId) 로 전달된 pending 소비
  const pending = useBattleSessionStore((s) => s.pending);
  const consume = useBattleSessionStore((s) => s.consume);
  useEffect(() => {
    if (!pending) return;
    startBattle(pending.battleId, pending.aiOnly);
    consume();
  }, [pending, startBattle, consume]);

  // 배틀 결과 → EXP 토스트 후 close
  const handleClose = useCallback(() => {
    if (tekken.result && profile) {
      const isWinner = tekken.result.winnerId === profile.uid;
      const xp = calcBattleXp(isWinner, 0);
      showExpToast(xp, isWinner ? '배틀 승리' : '배틀 참여');
    }
    closeBattle();
  }, [tekken.result, profile, showExpToast, closeBattle]);

  if (!showBattle || !profile) return null;

  return (
    <TekkenBattleOverlay
      tekken={tekken}
      userId={profile.uid}
      aiOnly={battleAiOnly}
      onClose={handleClose}
      overrideStyle={placementStyle}
    />
  );
}
