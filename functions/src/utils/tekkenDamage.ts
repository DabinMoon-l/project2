/**
 * 철권퀴즈 데미지/XP 계산 유틸 (서버)
 */

/** 배틀 설정 상수 */
export const BATTLE_CONFIG = {
  BATTLE_DURATION: 180000,
  QUESTION_TIMEOUT: 20000,
  CRITICAL_TIME: 4000,
  MASH_DURATION: 3000,
  SELF_DAMAGE: 3,
  MASH_BONUS_DAMAGE: 5,
  MAX_ROUNDS: 10,
};

/** XP 보상 상수 */
export const BATTLE_XP = {
  WIN: 30,
  LOSE: 10,
  STREAK_BONUS: 5,
  MAX_TOTAL: 50,
};

/**
 * 기본 데미지 = max(ceil(ATK² / (ATK + DEF)), 1)
 */
export function calcBaseDamage(atk: number, opponentDef: number): number {
  return Math.max(Math.ceil((atk * atk) / (atk + opponentDef)), 1);
}

/**
 * 크리티컬 데미지 (4초 이내)
 */
export function calcCriticalDamage(baseDamage: number): number {
  return Math.ceil(baseDamage * 1.5);
}

/**
 * 크리티컬 여부
 */
export function isCritical(answeredAt: number, startedAt: number): boolean {
  return (answeredAt - startedAt) <= BATTLE_CONFIG.CRITICAL_TIME;
}

/**
 * 데미지 계산 (정답 시)
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
 * XP 보상 계산
 */
export function calcBattleXp(isWinner: boolean, currentStreak: number): number {
  const base = isWinner ? BATTLE_XP.WIN : BATTLE_XP.LOSE;
  const bonus = isWinner ? Math.min(currentStreak * BATTLE_XP.STREAK_BONUS, 20) : 0;
  return Math.min(base + bonus, BATTLE_XP.MAX_TOTAL);
}

/**
 * 총 남은 HP
 */
export function getTotalRemainingHp(
  rabbits: Array<{ currentHp: number }>
): number {
  return rabbits.reduce((sum, r) => sum + Math.max(0, r.currentHp), 0);
}
