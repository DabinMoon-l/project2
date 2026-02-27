/**
 * 토끼 베이스 스탯 + 레벨업 스탯 증가 유틸
 *
 * 80마리 고유 베이스 스탯 룩업 테이블.
 * 유형: 방어형(16), 공격형(25), 체력형(18), 균형형(21)
 * 희귀도: 일반(~51), 좋음(~20), 아주 좋음(~9)
 */

/** 토끼 유형 (참고용, 런타임 분류에 사용하지 않음) */
export type RabbitArchetype = "defense" | "attack" | "hp" | "balanced";

interface RabbitBaseProfile {
  hp: number;
  atk: number;
  def: number;
}

/**
 * 80개 고유 베이스 스탯 (index = rabbitId 0~79)
 *
 * 유형별 스탯 범위:
 *   방어형 — HP 30-50, ATK 8-14, DEF 14-22
 *   공격형 — HP 25-40, ATK 16-25, DEF 5-12
 *   체력형 — HP 50-70, ATK 10-16, DEF 8-14
 *   균형형 — HP 35-55, ATK 12-18, DEF 9-16
 *   기본(#1, id=0) — HP 25, ATK 8, DEF 5 (최약)
 */
const RABBIT_BASE_STATS: RabbitBaseProfile[] = [
  // ── id=0 ── 기본 토끼 (최약) ──
  { hp: 25, atk: 8,  def: 5  },
  // ── id=1 ── 방어형·일반 ──
  { hp: 32, atk: 9,  def: 16 },
  // ── id=2 ── 균형형·일반 ──
  { hp: 36, atk: 12, def: 10 },
  // ── id=3 ── 공격형·일반 ──
  { hp: 27, atk: 17, def: 6  },
  // ── id=4 ── 공격형·일반 ──
  { hp: 29, atk: 16, def: 7  },
  // ── id=5 ── 체력형·일반 ──
  { hp: 52, atk: 10, def: 9  },
  // ── id=6 ── 방어형·일반 ──
  { hp: 34, atk: 8,  def: 15 },
  // ── id=7 ── 균형형·일반 ──
  { hp: 38, atk: 13, def: 9  },
  // ── id=8 ── 공격형·일반 ──
  { hp: 26, atk: 18, def: 5  },
  // ── id=9 ── 균형형·일반 ──
  { hp: 35, atk: 12, def: 11 },
  // ── id=10 ── 체력형·일반 ──
  { hp: 50, atk: 11, def: 10 },
  // ── id=11 ── 공격형·일반 ──
  { hp: 30, atk: 17, def: 7  },
  // ── id=12 ── 균형형·일반 ──
  { hp: 40, atk: 14, def: 10 },
  // ── id=13 ── 방어형·일반 ──
  { hp: 30, atk: 10, def: 14 },
  // ── id=14 ── 체력형·일반 ──
  { hp: 54, atk: 10, def: 8  },
  // ── id=15 ── 공격형·일반 ──
  { hp: 28, atk: 16, def: 8  },
  // ── id=16 ── 균형형·일반 ──
  { hp: 37, atk: 13, def: 11 },
  // ── id=17 ── 공격형·일반 ──
  { hp: 25, atk: 19, def: 6  },
  // ── id=18 ── 방어형·일반 ──
  { hp: 36, atk: 9,  def: 15 },
  // ── id=19 ── 균형형·일반 ──
  { hp: 39, atk: 12, def: 10 },
  // ── id=20 ── 체력형·일반 ──
  { hp: 53, atk: 12, def: 9  },
  // ── id=21 ── 체력형·일반 ──
  { hp: 55, atk: 11, def: 8  },
  // ── id=22 ── 체력형·일반 ──
  { hp: 51, atk: 10, def: 11 },
  // ── id=23 ── 균형형·일반 ──
  { hp: 36, atk: 14, def: 9  },
  // ── id=24 ── 공격형·일반 ──
  { hp: 31, atk: 18, def: 5  },
  // ── id=25 ── 균형형·일반 ──
  { hp: 41, atk: 13, def: 10 },
  // ── id=26 ── 공격형·일반 ──
  { hp: 27, atk: 17, def: 8  },
  // ── id=27 ── 방어형·일반 ──
  { hp: 33, atk: 11, def: 14 },
  // ── id=28 ── 공격형·일반 ──
  { hp: 32, atk: 16, def: 7  },
  // ── id=29 ── 방어형·일반 ──
  { hp: 38, atk: 8,  def: 17 },
  // ── id=30 ── 체력형·일반 ──
  { hp: 56, atk: 11, def: 9  },
  // ── id=31 ── 공격형·일반 ──
  { hp: 29, atk: 18, def: 6  },
  // ── id=32 ── 공격형·일반 ──
  { hp: 26, atk: 19, def: 7  },
  // ── id=33 ── 방어형·일반 ──
  { hp: 35, atk: 10, def: 16 },
  // ── id=34 ── 공격형·일반 ──
  { hp: 33, atk: 17, def: 6  },
  // ── id=35 ── 균형형·일반 ──
  { hp: 38, atk: 12, def: 12 },
  // ── id=36 ── 균형형·일반 ──
  { hp: 35, atk: 14, def: 11 },
  // ── id=37 ── 방어형·일반 ──
  { hp: 31, atk: 9,  def: 17 },
  // ── id=38 ── 공격형·일반 ──
  { hp: 28, atk: 18, def: 7  },
  // ── id=39 ── 균형형·일반 ──
  { hp: 42, atk: 13, def: 9  },
  // ── id=40 ── 체력형·일반 ──
  { hp: 50, atk: 12, def: 10 },
  // ── id=41 ── 공격형·일반 ──
  { hp: 30, atk: 16, def: 9  },
  // ── id=42 ── 균형형·일반 ──
  { hp: 37, atk: 12, def: 13 },
  // ── id=43 ── 방어형·일반 ──
  { hp: 37, atk: 10, def: 15 },
  // ── id=44 ── 공격형·일반 ──
  { hp: 25, atk: 20, def: 5  },
  // ── id=45 ── 체력형·일반 ──
  { hp: 54, atk: 11, def: 10 },
  // ── id=46 ── 공격형·일반 ──
  { hp: 31, atk: 17, def: 8  },
  // ── id=47 ── 공격형·좋음 ──
  { hp: 34, atk: 21, def: 8  },
  // ── id=48 ── 방어형·일반 ──
  { hp: 34, atk: 11, def: 16 },
  // ── id=49 ── 방어형·좋음 ──
  { hp: 42, atk: 12, def: 19 },
  // ── id=50 ── 균형형·일반 ──
  { hp: 40, atk: 13, def: 11 },
  // ── id=51 ── 균형형·좋음 ──
  { hp: 45, atk: 16, def: 13 },
  // ── id=52 ── 공격형·좋음 ──
  { hp: 35, atk: 20, def: 9  },
  // ── id=53 ── 균형형·좋음 ──
  { hp: 47, atk: 15, def: 12 },
  // ── id=54 ── 체력형·일반 ──
  { hp: 52, atk: 12, def: 8  },
  // ── id=55 ── 균형형·좋음 ──
  { hp: 44, atk: 16, def: 14 },
  // ── id=56 ── 공격형·좋음 ──
  { hp: 33, atk: 22, def: 7  },
  // ── id=57 ── 방어형·좋음 ──
  { hp: 40, atk: 11, def: 20 },
  // ── id=58 ── 체력형·일반 ──
  { hp: 53, atk: 10, def: 10 },
  // ── id=59 ── 체력형·좋음 ──
  { hp: 60, atk: 13, def: 12 },
  // ── id=60 ── 공격형·좋음 ──
  { hp: 36, atk: 19, def: 10 },
  // ── id=61 ── 체력형·좋음 ──
  { hp: 58, atk: 14, def: 11 },
  // ── id=62 ── 공격형·좋음 ──
  { hp: 32, atk: 21, def: 9  },
  // ── id=63 ── 방어형·좋음 ──
  { hp: 44, atk: 13, def: 18 },
  // ── id=64 ── 공격형·좋음 ──
  { hp: 37, atk: 20, def: 8  },
  // ── id=65 ── 방어형·좋음 ──
  { hp: 41, atk: 12, def: 21 },
  // ── id=66 ── 체력형·좋음 ──
  { hp: 62, atk: 12, def: 13 },
  // ── id=67 ── 균형형·좋음 ──
  { hp: 48, atk: 15, def: 13 },
  // ── id=68 ── 균형형·좋음 ──
  { hp: 46, atk: 16, def: 12 },
  // ── id=69 ── 균형형·아주좋음 ──
  { hp: 52, atk: 17, def: 15 },
  // ── id=70 ── 체력형·좋음 ──
  { hp: 57, atk: 14, def: 12 },
  // ── id=71 ── 공격형·아주좋음 ──
  { hp: 38, atk: 24, def: 10 },
  // ── id=72 ── 체력형·좋음 ──
  { hp: 59, atk: 13, def: 11 },
  // ── id=73 ── 체력형·아주좋음 ──
  { hp: 65, atk: 15, def: 13 },
  // ── id=74 ── 방어형·아주좋음 ──
  { hp: 46, atk: 14, def: 20 },
  // ── id=75 ── 공격형·아주좋음 ──
  { hp: 35, atk: 25, def: 11 },
  // ── id=76 ── 공격형·아주좋음 ──
  { hp: 40, atk: 23, def: 12 },
  // ── id=77 ── 방어형·아주좋음 ──
  { hp: 48, atk: 13, def: 19 },
  // ── id=78 ── 균형형·아주좋음 ──
  { hp: 53, atk: 18, def: 14 },
  // ── id=79 ── 체력형·아주좋음 ──
  { hp: 66, atk: 16, def: 13 },
];

/** rabbitId 기반 베이스 스탯 (Lv.1) — 룩업 테이블 */
export function getBaseStats(rabbitId: number): RabbitBaseProfile {
  if (rabbitId < 0 || rabbitId >= RABBIT_BASE_STATS.length) {
    return { hp: 25, atk: 8, def: 5 }; // 폴백 = 기본 토끼
  }
  return { ...RABBIT_BASE_STATS[rabbitId] };
}

/**
 * 구 공식 베이스 스탯 (마이그레이션 전용)
 * 기존 홀딩 문서의 레벨업 보너스를 보존하기 위해 옛 공식 보존
 */
export function getOldBaseStats(rabbitId: number) {
  return {
    hp: 10 + ((rabbitId * 3) % 20),
    atk: 3 + ((rabbitId * 7) % 12),
    def: 2 + ((rabbitId * 5) % 8),
  };
}

/** 레벨업 시 랜덤 스탯 증가치 생성 (총 3~5, 각 최소 1) */
export function generateStatIncreases() {
  const totalPoints = 3 + Math.floor(Math.random() * 3); // 3~5
  const result = { hp: 1, atk: 1, def: 1 }; // 각 최소 1 (3 소비)
  let remaining = totalPoints - 3; // 0~2
  const stats = ["hp", "atk", "def"] as const;
  for (let i = 0; i < remaining; i++) {
    result[stats[Math.floor(Math.random() * 3)]] += 1;
  }
  return { increases: result, totalPoints };
}
