/**
 * 철권퀴즈 데미지/XP 계산 유틸 (서버)
 */

/** 배틀 설정 상수 */
export const BATTLE_CONFIG = {
  BATTLE_DURATION: 600000, // 안전장치 (실질 종료는 HP=0 또는 라운드 완료)
  QUESTION_TIMEOUT: 30000,
  CRITICAL_TIME: 10000,
  MATCH_TIMEOUT: 20000,
  MASH_TIMEOUT: 30000, // 연타 안전 타임아웃 30초 (UI에 표시 안 함)
};

/** 양쪽 오답 시 상호 고정 데미지 */
export const MUTUAL_DAMAGE = 10;

/** XP 보상 상수 */
export const BATTLE_XP = {
  WIN: 30,
  LOSE: 10,
  STREAK_BONUS: 5,
  MAX_TOTAL: 50,
};

/**
 * 기본 데미지 = max(ceil(ATK² / (ATK + DEF × 1.5)), 5)
 * 2vs2 로테이션 10문제 기준 (기존 1v1 DEF×3.5 → 2v2 DEF×1.5)
 * 총 HP 풀 2배(토끼 2마리)에 맞춰 데미지 상향
 * 7/10 정답 시 양쪽 KO 가능, 밸런스 매치(5:5)는 점수 비교 결말
 */
export function calcBaseDamage(atk: number, opponentDef: number): number {
  return Math.max(Math.ceil((atk * atk) / (atk + opponentDef * 1.5)), 5);
}

/**
 * 크리티컬 데미지 (5초 이내)
 */
export function calcCriticalDamage(baseDamage: number): number {
  return Math.ceil(baseDamage * 1.5);
}

/**
 * 연타 승리 보너스 데미지 — 패자 maxHp의 35% (레벨 무시 크리티컬)
 * 스탯 대신 상대 maxHp 비례로 계산해 레벨 차이 있어도 유효타 보장.
 */
export const MASH_BONUS_HP_RATIO = 0.35;
export function calcMashBonusDamage(loserMaxHp: number): number {
  return Math.max(Math.ceil(loserMaxHp * MASH_BONUS_HP_RATIO), 10);
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
