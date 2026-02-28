/**
 * 철권퀴즈 데미지 계산 유틸 (클라이언트)
 *
 * 서버(CF)와 동일한 공식. 클라이언트에서 미리보기용으로 사용.
 */

import { BATTLE_CONFIG } from '@/lib/types/tekken';

/**
 * 기본 데미지 계산
 * baseDamage = max(ceil(ATK² / (ATK + opponent_DEF) × 1.5), 2)
 * 1.5x 배율: 7라운드 내 게임 종료를 위한 높은 데미지
 */
export function calcBaseDamage(atk: number, opponentDef: number): number {
  return Math.max(Math.ceil((atk * atk) / (atk + opponentDef) * 1.5), 2);
}

/**
 * 크리티컬 데미지 계산 (4초 이내 정답)
 */
export function calcCriticalDamage(baseDamage: number): number {
  return Math.ceil(baseDamage * 1.5);
}

/**
 * 크리티컬 여부 판별
 */
export function isCritical(answeredAt: number, startedAt: number): boolean {
  return (answeredAt - startedAt) <= BATTLE_CONFIG.CRITICAL_TIME;
}

/**
 * 전체 데미지 계산 (정답 시)
 */
export function calcDamage(
  atk: number,
  opponentDef: number,
  answeredAt: number,
  startedAt: number
): { damage: number; isCritical: boolean } {
  const base = calcBaseDamage(atk, opponentDef);
  const critical = isCritical(answeredAt, startedAt);
  return {
    damage: critical ? calcCriticalDamage(base) : base,
    isCritical: critical,
  };
}

/**
 * HP 비교로 승자 결정 (타임아웃 시)
 */
export function determineWinnerByHp(
  p1Id: string,
  p1TotalHp: number,
  p2Id: string,
  p2TotalHp: number
): { winnerId: string | null; loserId: string | null; isDraw: boolean } {
  if (p1TotalHp > p2TotalHp) {
    return { winnerId: p1Id, loserId: p2Id, isDraw: false };
  } else if (p2TotalHp > p1TotalHp) {
    return { winnerId: p2Id, loserId: p1Id, isDraw: false };
  }
  return { winnerId: null, loserId: null, isDraw: true };
}

/**
 * 플레이어의 총 남은 HP 계산
 */
export function getTotalRemainingHp(rabbits: Array<{ currentHp: number }>): number {
  return rabbits.reduce((sum, r) => sum + Math.max(0, r.currentHp), 0);
}

/**
 * XP 보상 계산
 */
export function calcBattleXp(
  isWinner: boolean,
  currentStreak: number
): number {
  const base = isWinner ? 30 : 10;
  const bonus = isWinner ? Math.min(currentStreak * 5, 20) : 0;
  return Math.min(base + bonus, 50);
}
