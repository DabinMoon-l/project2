import { describe, it, expect } from "vitest";
import { getBaseStats, getOldBaseStats, generateStatIncreases } from "./rabbitStats";

// ============================================================
// getBaseStats — 80마리 룩업 + 폴백
// ============================================================

describe("getBaseStats — 룩업 안정성", () => {
  it("id=0 (기본 토끼)는 최약 스탯 25/8/5", () => {
    expect(getBaseStats(0)).toEqual({ hp: 25, atk: 8, def: 5 });
  });

  it("id=79 (마지막 토끼)는 룩업 테이블 마지막 값을 반환", () => {
    const stats = getBaseStats(79);
    // 체력형·아주좋음 → HP 60+, ATK 15+, DEF 12+
    expect(stats.hp).toBeGreaterThanOrEqual(60);
    expect(stats.atk).toBeGreaterThanOrEqual(15);
    expect(stats.def).toBeGreaterThanOrEqual(12);
  });

  it("범위 밖 음수 id → 기본 토끼 폴백", () => {
    expect(getBaseStats(-1)).toEqual({ hp: 25, atk: 8, def: 5 });
  });

  it("범위 밖 큰 id → 기본 토끼 폴백 (서버 오염 방지)", () => {
    expect(getBaseStats(80)).toEqual({ hp: 25, atk: 8, def: 5 });
    expect(getBaseStats(9999)).toEqual({ hp: 25, atk: 8, def: 5 });
  });

  it("반환 객체는 호출자가 변형해도 룩업 테이블이 오염되지 않음 (얕은 복사)", () => {
    const a = getBaseStats(5);
    a.hp = 9999;
    const b = getBaseStats(5);
    expect(b.hp).not.toBe(9999);
  });

  it("0~79 모든 id에 대해 양수 스탯 반환 (음수/0 스탯 방지)", () => {
    for (let id = 0; id < 80; id++) {
      const s = getBaseStats(id);
      expect(s.hp).toBeGreaterThan(0);
      expect(s.atk).toBeGreaterThan(0);
      expect(s.def).toBeGreaterThan(0);
    }
  });
});

// ============================================================
// getOldBaseStats — 마이그레이션 보존용 (옛 공식)
// ============================================================

describe("getOldBaseStats — 옛 공식 결정론", () => {
  it("같은 id를 두 번 호출하면 동일 결과 (결정론적)", () => {
    expect(getOldBaseStats(7)).toEqual(getOldBaseStats(7));
  });

  it("id=0 옛 공식: hp=10, atk=3, def=2", () => {
    // 10 + (0*3)%20 = 10, 3 + (0*7)%12 = 3, 2 + (0*5)%8 = 2
    expect(getOldBaseStats(0)).toEqual({ hp: 10, atk: 3, def: 2 });
  });
});

// ============================================================
// generateStatIncreases — 레벨업 분배
// ============================================================
// 핵심 불변식 (게이미피케이션 경제 안전):
//   1. 총 분배 점수는 정확히 3~5 사이
//   2. 각 스탯은 최소 1 (HP/ATK/DEF 모두 0 증가 금지)
//   3. 합 == totalPoints (반환값 일치)

describe("generateStatIncreases — 분배 불변식", () => {
  it("항상 hp/atk/def 키가 모두 존재하고 1 이상", () => {
    for (let i = 0; i < 200; i++) {
      const { increases } = generateStatIncreases();
      expect(increases.hp).toBeGreaterThanOrEqual(1);
      expect(increases.atk).toBeGreaterThanOrEqual(1);
      expect(increases.def).toBeGreaterThanOrEqual(1);
    }
  });

  it("총합은 항상 3~5 사이", () => {
    for (let i = 0; i < 200; i++) {
      const { increases, totalPoints } = generateStatIncreases();
      const sum = increases.hp + increases.atk + increases.def;
      expect(sum).toBe(totalPoints);
      expect(sum).toBeGreaterThanOrEqual(3);
      expect(sum).toBeLessThanOrEqual(5);
    }
  });

  it("totalPoints 분포: 3, 4, 5 모두 발생 (시드 없는 RNG에서 통계적 검증)", () => {
    const counts = { 3: 0, 4: 0, 5: 0 };
    for (let i = 0; i < 1000; i++) {
      const { totalPoints } = generateStatIncreases();
      counts[totalPoints as 3 | 4 | 5]++;
    }
    // 1000회 시행에서 각 값이 최소 1번 이상 등장해야 함 (확률 ~33%)
    expect(counts[3]).toBeGreaterThan(0);
    expect(counts[4]).toBeGreaterThan(0);
    expect(counts[5]).toBeGreaterThan(0);
  });

  it("totalPoints=3일 때 분배는 정확히 {1,1,1}", () => {
    // totalPoints가 3이면 remaining = 0이므로 추가 분배 없음
    let foundCase = false;
    for (let i = 0; i < 500; i++) {
      const { increases, totalPoints } = generateStatIncreases();
      if (totalPoints === 3) {
        expect(increases).toEqual({ hp: 1, atk: 1, def: 1 });
        foundCase = true;
      }
    }
    expect(foundCase).toBe(true);
  });
});
