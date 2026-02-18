/**
 * 토끼 베이스 스탯 + 레벨업 스탯 증가 유틸
 */

/** rabbitId 기반 베이스 스탯 (Lv.1) */
export function getBaseStats(rabbitId: number) {
  return {
    hp: 10 + ((rabbitId * 3) % 20),
    atk: 3 + ((rabbitId * 7) % 12),
    def: 2 + ((rabbitId * 5) % 8),
  };
}

/** 레벨업 시 랜덤 스탯 증가치 생성 (총 10~15, 각 최소 1) */
export function generateStatIncreases() {
  const totalPoints = 10 + Math.floor(Math.random() * 6); // 10~15
  const result = { hp: 1, atk: 1, def: 1 }; // 각 최소 1
  let remaining = totalPoints - 3;
  const stats = ["hp", "atk", "def"] as const;
  for (let i = 0; i < remaining; i++) {
    result[stats[Math.floor(Math.random() * 3)]] += 1;
  }
  return { increases: result, totalPoints };
}
