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

describe("calcBaseDamage", () => {
  it("공식: max(ceil(ATK² / (ATK + DEF*3.5)), 2)", () => {
    // ATK=10, DEF=5 → ceil(100/(10+17.5)) = ceil(3.64) = 4
    expect(calcBaseDamage(10, 5)).toBe(4);
  });

  it("ATK=5, DEF=5 → ceil(25/(5+17.5)) = ceil(1.11) = 2", () => {
    expect(calcBaseDamage(5, 5)).toBe(2);
  });

  it("ATK=3, DEF=10 → ceil(9/(3+35)) = ceil(0.24) = 2 (최소값 2)", () => {
    expect(calcBaseDamage(3, 10)).toBe(2);
  });

  it("최소 데미지는 2", () => {
    expect(calcBaseDamage(1, 100)).toBe(2);
    expect(calcBaseDamage(1, 1000)).toBe(2);
  });

  it("ATK이 높고 DEF가 낮으면 높은 데미지", () => {
    // ATK=20, DEF=3 → ceil(400/(20+10.5)) = ceil(13.11) = 14
    expect(calcBaseDamage(20, 3)).toBe(14);
  });

  it("동일 스탯 (ATK=DEF) → ceil(ATK²/(ATK+DEF*3.5))", () => {
    // ATK=8, DEF=8 → ceil(64/(8+28)) = ceil(1.78) = 2
    expect(calcBaseDamage(8, 8)).toBe(2);
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
    const baseDmg = calcBaseDamage(10, 5); // 10
    expect(result.isCritical).toBe(true);
    expect(result.damage).toBe(calcCriticalDamage(baseDmg)); // 15
  });

  it("크리티컬 아닐 때 기본 데미지", () => {
    const start = 0;
    const result = calcDamage(10, 5, start + 15000, start); // 15초 → 일반
    expect(result.isCritical).toBe(false);
    expect(result.damage).toBe(calcBaseDamage(10, 5)); // 10
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
