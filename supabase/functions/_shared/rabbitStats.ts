// 토끼 베이스 스탯 + 레벨업 분배 — Edge Function 용 포팅
//
// 원본: functions/src/utils/rabbitStats.ts
// 80 마리 고유 베이스 스탯 룩업 테이블 (rabbitId 0~79).

interface RabbitBaseProfile {
  hp: number;
  atk: number;
  def: number;
}

const RABBIT_BASE_STATS: RabbitBaseProfile[] = [
  { hp: 25, atk: 8,  def: 5  }, // id=0
  { hp: 32, atk: 9,  def: 16 }, // id=1
  { hp: 36, atk: 12, def: 10 }, // id=2
  { hp: 27, atk: 17, def: 6  }, // id=3
  { hp: 29, atk: 16, def: 7  }, // id=4
  { hp: 52, atk: 10, def: 9  }, // id=5
  { hp: 34, atk: 8,  def: 15 }, // id=6
  { hp: 38, atk: 13, def: 9  }, // id=7
  { hp: 26, atk: 18, def: 5  }, // id=8
  { hp: 35, atk: 12, def: 11 }, // id=9
  { hp: 50, atk: 11, def: 10 }, // id=10
  { hp: 30, atk: 17, def: 7  }, // id=11
  { hp: 40, atk: 14, def: 10 }, // id=12
  { hp: 30, atk: 10, def: 14 }, // id=13
  { hp: 54, atk: 10, def: 8  }, // id=14
  { hp: 28, atk: 16, def: 8  }, // id=15
  { hp: 37, atk: 13, def: 11 }, // id=16
  { hp: 25, atk: 19, def: 6  }, // id=17
  { hp: 36, atk: 9,  def: 15 }, // id=18
  { hp: 39, atk: 12, def: 10 }, // id=19
  { hp: 53, atk: 12, def: 9  }, // id=20
  { hp: 55, atk: 11, def: 8  }, // id=21
  { hp: 51, atk: 10, def: 11 }, // id=22
  { hp: 36, atk: 14, def: 9  }, // id=23
  { hp: 31, atk: 18, def: 5  }, // id=24
  { hp: 41, atk: 13, def: 10 }, // id=25
  { hp: 27, atk: 17, def: 8  }, // id=26
  { hp: 33, atk: 11, def: 14 }, // id=27
  { hp: 32, atk: 16, def: 7  }, // id=28
  { hp: 38, atk: 8,  def: 17 }, // id=29
  { hp: 56, atk: 11, def: 9  }, // id=30
  { hp: 29, atk: 18, def: 6  }, // id=31
  { hp: 26, atk: 19, def: 7  }, // id=32
  { hp: 35, atk: 10, def: 16 }, // id=33
  { hp: 33, atk: 17, def: 6  }, // id=34
  { hp: 38, atk: 12, def: 12 }, // id=35
  { hp: 35, atk: 14, def: 11 }, // id=36
  { hp: 31, atk: 9,  def: 17 }, // id=37
  { hp: 28, atk: 18, def: 7  }, // id=38
  { hp: 42, atk: 13, def: 9  }, // id=39
  { hp: 50, atk: 12, def: 10 }, // id=40
  { hp: 30, atk: 16, def: 9  }, // id=41
  { hp: 37, atk: 12, def: 13 }, // id=42
  { hp: 37, atk: 10, def: 15 }, // id=43
  { hp: 25, atk: 20, def: 5  }, // id=44
  { hp: 54, atk: 11, def: 10 }, // id=45
  { hp: 31, atk: 17, def: 8  }, // id=46
  { hp: 34, atk: 21, def: 8  }, // id=47
  { hp: 34, atk: 11, def: 16 }, // id=48
  { hp: 42, atk: 12, def: 19 }, // id=49
  { hp: 40, atk: 13, def: 11 }, // id=50
  { hp: 45, atk: 16, def: 13 }, // id=51
  { hp: 35, atk: 20, def: 9  }, // id=52
  { hp: 47, atk: 15, def: 12 }, // id=53
  { hp: 52, atk: 12, def: 8  }, // id=54
  { hp: 44, atk: 16, def: 14 }, // id=55
  { hp: 33, atk: 22, def: 7  }, // id=56
  { hp: 40, atk: 11, def: 20 }, // id=57
  { hp: 53, atk: 10, def: 10 }, // id=58
  { hp: 60, atk: 13, def: 12 }, // id=59
  { hp: 36, atk: 19, def: 10 }, // id=60
  { hp: 58, atk: 14, def: 11 }, // id=61
  { hp: 32, atk: 21, def: 9  }, // id=62
  { hp: 44, atk: 13, def: 18 }, // id=63
  { hp: 37, atk: 20, def: 8  }, // id=64
  { hp: 41, atk: 12, def: 21 }, // id=65
  { hp: 62, atk: 12, def: 13 }, // id=66
  { hp: 48, atk: 15, def: 13 }, // id=67
  { hp: 46, atk: 16, def: 12 }, // id=68
  { hp: 52, atk: 17, def: 15 }, // id=69
  { hp: 57, atk: 14, def: 12 }, // id=70
  { hp: 38, atk: 24, def: 10 }, // id=71
  { hp: 59, atk: 13, def: 11 }, // id=72
  { hp: 65, atk: 15, def: 13 }, // id=73
  { hp: 46, atk: 14, def: 20 }, // id=74
  { hp: 35, atk: 25, def: 11 }, // id=75
  { hp: 40, atk: 23, def: 12 }, // id=76
  { hp: 48, atk: 13, def: 19 }, // id=77
  { hp: 53, atk: 18, def: 14 }, // id=78
  { hp: 66, atk: 16, def: 13 }, // id=79
];

export function getBaseStats(rabbitId: number): RabbitBaseProfile {
  if (rabbitId < 0 || rabbitId >= RABBIT_BASE_STATS.length) {
    return { hp: 25, atk: 8, def: 5 };
  }
  return { ...RABBIT_BASE_STATS[rabbitId] };
}

/** 레벨업 시 랜덤 스탯 증가치 생성 (총 3~5, 각 최소 1) */
export function generateStatIncreases(): {
  increases: { hp: number; atk: number; def: number };
  totalPoints: number;
} {
  const totalPoints = 3 + Math.floor(Math.random() * 3);
  const result = { hp: 1, atk: 1, def: 1 };
  const remaining = totalPoints - 3;
  const stats = ["hp", "atk", "def"] as const;
  for (let i = 0; i < remaining; i++) {
    result[stats[Math.floor(Math.random() * 3)]] += 1;
  }
  return { increases: result, totalPoints };
}
