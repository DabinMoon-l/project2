import { describe, it, expect } from "vitest";
import {
  calcBaseDamage,
  calcCriticalDamage,
  isCritical,
  calcDamage,
  calcBattleXp,
  getTotalRemainingHp,
  BATTLE_CONFIG,
  BATTLE_XP,
  MUTUAL_DAMAGE,
} from "./tekkenDamage";

// ============================================================
// 상수 검증
// ============================================================

describe("배틀 상수", () => {
  it("MUTUAL_DAMAGE = 10", () => {
    expect(MUTUAL_DAMAGE).toBe(10);
  });

  it("BATTLE_XP 값 확인", () => {
    expect(BATTLE_XP.WIN).toBe(30);
    expect(BATTLE_XP.LOSE).toBe(10);
    expect(BATTLE_XP.STREAK_BONUS).toBe(5);
    expect(BATTLE_XP.MAX_TOTAL).toBe(50);
  });

  it("CRITICAL_TIME = 10000ms", () => {
    expect(BATTLE_CONFIG.CRITICAL_TIME).toBe(10000);
  });
});

// ============================================================
// calcBaseDamage
// ============================================================

describe("calcBaseDamage (2vs2 로테이션 기준)", () => {
  it("공식: max(ceil(ATK² / (ATK + DEF*1.5)), 5)", () => {
    // ATK=10, DEF=5 → ceil(100/(10+7.5)) = ceil(5.71) = 6
    expect(calcBaseDamage(10, 5)).toBe(6);
  });

  it("ATK=5, DEF=5 → ceil(25/(5+7.5)) = ceil(2.0) = 5 (최소값)", () => {
    expect(calcBaseDamage(5, 5)).toBe(5);
  });

  it("ATK=3, DEF=10 → ceil(9/(3+15)) = ceil(0.5) = 5 (최소값 5)", () => {
    expect(calcBaseDamage(3, 10)).toBe(5);
  });

  it("최소 데미지는 5", () => {
    expect(calcBaseDamage(1, 100)).toBe(5);
    expect(calcBaseDamage(1, 1000)).toBe(5);
  });

  it("ATK이 높고 DEF가 낮으면 높은 데미지", () => {
    // ATK=20, DEF=3 → ceil(400/(20+4.5)) = ceil(16.33) = 17
    expect(calcBaseDamage(20, 3)).toBe(17);
  });

  it("동일 스탯 (ATK=DEF) → ceil(ATK²/(ATK+DEF*1.5))", () => {
    // ATK=8, DEF=8 → ceil(64/(8+12)) = ceil(3.2) = 5 (최소값)
    expect(calcBaseDamage(8, 8)).toBe(5);
  });

  it("균형형 vs 균형형 (Lv1)", () => {
    // ATK=14, DEF=12 → ceil(196/(14+18)) = ceil(6.13) = 7
    expect(calcBaseDamage(14, 12)).toBe(7);
  });

  it("공격형 vs 방어형 (Lv1)", () => {
    // ATK=20, DEF=15 → ceil(400/(20+22.5)) = ceil(9.41) = 10
    expect(calcBaseDamage(20, 15)).toBe(10);
  });
});

// ============================================================
// calcCriticalDamage
// ============================================================

describe("calcCriticalDamage", () => {
  it("기본 데미지의 1.5배 (올림)", () => {
    expect(calcCriticalDamage(10)).toBe(15);
  });

  it("소수점 올림", () => {
    expect(calcCriticalDamage(7)).toBe(11); // 7 * 1.5 = 10.5 → 11
  });

  it("1 → 2", () => {
    expect(calcCriticalDamage(1)).toBe(2); // 1 * 1.5 = 1.5 → 2
  });

  it("2 → 3", () => {
    expect(calcCriticalDamage(2)).toBe(3);
  });
});

// ============================================================
// isCritical
// ============================================================

describe("isCritical", () => {
  const start = 1000;

  it("즉시 응답 (0ms) → 크리티컬", () => {
    expect(isCritical(start, start)).toBe(true);
  });

  it("5초 이내 → 크리티컬", () => {
    expect(isCritical(start + 5000, start)).toBe(true);
  });

  it("정확히 10초 → 크리티컬 (경계값)", () => {
    expect(isCritical(start + 10000, start)).toBe(true);
  });

  it("10초 초과 → 크리티컬 아님", () => {
    expect(isCritical(start + 10001, start)).toBe(false);
  });

  it("15초 → 크리티컬 아님", () => {
    expect(isCritical(start + 15000, start)).toBe(false);
  });
});

// ============================================================
// calcDamage (통합)
// ============================================================

describe("calcDamage", () => {
  it("크리티컬 시 데미지 1.5배", () => {
    const start = 0;
    const result = calcDamage(10, 5, start + 3000, start); // 3초 → 크리티컬
    const baseDmg = calcBaseDamage(10, 5); // 6
    expect(result.isCritical).toBe(true);
    expect(result.damage).toBe(calcCriticalDamage(baseDmg)); // 9
  });

  it("크리티컬 아닐 때 기본 데미지", () => {
    const start = 0;
    const result = calcDamage(10, 5, start + 15000, start); // 15초 → 일반
    expect(result.isCritical).toBe(false);
    expect(result.damage).toBe(calcBaseDamage(10, 5)); // 6
  });
});

// ============================================================
// calcBattleXp
// ============================================================

describe("calcBattleXp", () => {
  it("승리 (연승 0) → 30", () => {
    expect(calcBattleXp(true, 0)).toBe(30);
  });

  it("승리 (연승 1) → 30 + 5 = 35", () => {
    expect(calcBattleXp(true, 1)).toBe(35);
  });

  it("승리 (연승 2) → 30 + 10 = 40", () => {
    expect(calcBattleXp(true, 2)).toBe(40);
  });

  it("승리 (연승 4) → 30 + 20 = 50 (최대)", () => {
    expect(calcBattleXp(true, 4)).toBe(50);
  });

  it("승리 (연승 10) → 최대 50 (보너스 캡 20)", () => {
    expect(calcBattleXp(true, 10)).toBe(50);
  });

  it("패배 (연승 무관) → 10", () => {
    expect(calcBattleXp(false, 0)).toBe(10);
    expect(calcBattleXp(false, 5)).toBe(10);
    expect(calcBattleXp(false, 100)).toBe(10);
  });
});

// ============================================================
// getTotalRemainingHp
// ============================================================

describe("getTotalRemainingHp", () => {
  it("HP 합산", () => {
    expect(getTotalRemainingHp([{ currentHp: 30 }, { currentHp: 20 }])).toBe(50);
  });

  it("음수 HP는 0으로 처리", () => {
    expect(getTotalRemainingHp([{ currentHp: -5 }, { currentHp: 20 }])).toBe(20);
  });

  it("모두 0 → 0", () => {
    expect(getTotalRemainingHp([{ currentHp: 0 }, { currentHp: 0 }])).toBe(0);
  });

  it("빈 배열 → 0", () => {
    expect(getTotalRemainingHp([])).toBe(0);
  });

  it("토끼 1마리", () => {
    expect(getTotalRemainingHp([{ currentHp: 50 }])).toBe(50);
  });
});
