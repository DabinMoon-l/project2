'use client';

/**
 * 배틀 오버레이 마운트 포인트 — layout.tsx 에 한 번만 렌더.
 *
 * - BattleSession context 의 showBattle 이 true 일 때 오버레이 표시
 * - zustand store(pending) 에서 수락된 battleId + placement 소비 → startBattle 호출
 * - entry='self' (신청자): override 없이 기본 스타일(--home-sheet-left 기반 3쪽)
 * - entry='invite' (수신자): context 에 박제된 invitePlacement 로 style 덮어쓰기
 */

import { useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useUser } from '@/lib/contexts/UserContext';
import { useBattleSession } from '@/lib/contexts/BattleSessionContext';
import { useBattleSessionStore } from '@/lib/stores/battleSessionStore';
import { placementToStyle } from '@/lib/hooks/useBattlePlacement';
import { useExpToast } from '@/components/common/ExpToast';
import { calcBattleXp } from '@/lib/utils/tekkenDamage';

const TekkenBattleOverlay = dynamic(
  () => import('@/components/tekken/TekkenBattleOverlay'),
  { ssr: false },
);

export default function BattleOverlayMount() {
  const { profile } = useUser();
  const { tekken, showBattle, battleAiOnly, entry, invitePlacement, startBattle, closeBattle } = useBattleSession();
  const { showExpToast } = useExpToast();

  // entry='invite' 면 수신자가 클릭 시점에 박제한 placement 사용.
  // entry='self' 면 override 없이 기본 스타일(3쪽) 유지.
  const overrideStyle =
    entry === 'invite' && invitePlacement
      ? placementToStyle(invitePlacement)
      : undefined;

  // 수신자 store.pending → fromInvite=true + placement 전달로 시작
  const pending = useBattleSessionStore((s) => s.pending);
  const consume = useBattleSessionStore((s) => s.consume);
  useEffect(() => {
    if (!pending) return;
    startBattle(pending.battleId, pending.aiOnly, true, pending.placement);
    consume();
  }, [pending, startBattle, consume]);

  // 배틀 결과 XP 토스트 후 close
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
      overrideStyle={overrideStyle}
    />
  );
}
