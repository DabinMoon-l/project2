/**
 * 철권퀴즈 봇 로직
 *
 * 30초 매칭 실패 시 봇과 대전
 */

import { getBaseStats } from "./rabbitStats";

/** 봇 닉네임 풀 */
const BOT_NAMES = [
  "토순이", "당근러버", "뿅뿅이", "깡총이", "하양이",
  "솜사탕", "콩콩이", "달토끼", "바니바니", "뭉치",
];

/** 봇 프로필 생성 */
export function createBotProfile() {
  const nickname = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
  const rabbitId = Math.floor(Math.random() * 80);
  const rabbitId2 = (rabbitId + 1 + Math.floor(Math.random() * 79)) % 80;

  const stats1 = getBaseStats(rabbitId);
  const stats2 = getBaseStats(rabbitId2);

  // 봇 레벨 3~7 랜덤 → 스탯 약간 부스트
  const level1 = 3 + Math.floor(Math.random() * 5);
  const level2 = 3 + Math.floor(Math.random() * 5);

  const boost = (base: number, lv: number) =>
    base + Math.floor((lv - 1) * 3);

  return {
    nickname,
    profileRabbitId: rabbitId,
    isBot: true,
    rabbits: [
      {
        rabbitId: rabbitId,
        maxHp: boost(stats1.hp, level1),
        currentHp: boost(stats1.hp, level1),
        atk: boost(stats1.atk, level1),
        def: boost(stats1.def, level1),
      },
      {
        rabbitId: rabbitId2,
        maxHp: boost(stats2.hp, level2),
        currentHp: boost(stats2.hp, level2),
        atk: boost(stats2.atk, level2),
        def: boost(stats2.def, level2),
      },
    ],
    activeRabbitIndex: 0,
    connected: true,
  };
}

/**
 * 봇 답변 생성
 * correctAnswer: 정답 인덱스
 * choiceCount: 선택지 수
 * 봇은 60% 확률로 정답, 1~8초 랜덤 딜레이
 */
export function generateBotAnswer(
  correctAnswer: number,
  choiceCount: number
): { answer: number; delay: number } {
  const isCorrect = Math.random() < 0.6;
  const delay = 1000 + Math.floor(Math.random() * 7000); // 1~8초

  if (isCorrect) {
    return { answer: correctAnswer, delay };
  }

  // 오답: 정답이 아닌 랜덤 선택
  let wrong = Math.floor(Math.random() * choiceCount);
  while (wrong === correctAnswer) {
    wrong = Math.floor(Math.random() * choiceCount);
  }
  return { answer: wrong, delay };
}

/**
 * 봇 연타 탭 수 생성 (10~25)
 */
export function generateBotMashTaps(): number {
  return 10 + Math.floor(Math.random() * 16);
}

/**
 * 봇이 토끼 교체할지 결정 (30% 확률, 현재 HP 낮을 때)
 */
export function shouldBotSwap(
  activeRabbit: { currentHp: number; maxHp: number },
  otherRabbit: { currentHp: number } | undefined
): boolean {
  if (!otherRabbit || otherRabbit.currentHp <= 0) return false;
  const hpRatio = activeRabbit.currentHp / activeRabbit.maxHp;
  return hpRatio < 0.3 && Math.random() < 0.3;
}
