/**
 * 철권퀴즈 액션 — swapRabbit, submitMashResult
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getDatabase } from "firebase-admin/database";
import { calcMashBonusDamage } from "../utils/tekkenDamage";
import { processRoundEnd } from "./tekkenRound";
import {
  DEFAULT_ORG_ID_SECRET,
  SUPABASE_URL_SECRET,
  SUPABASE_SERVICE_ROLE_SECRET,
} from "../utils/supabase";

// ============================================
// swapRabbit
// ============================================
export const swapRabbit = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const userId = request.auth.uid;
    const { battleId } = request.data as { battleId: string };

    const rtdb = getDatabase();
    const battleRef = rtdb.ref(`tekken/battles/${battleId}`);
    const battleSnap = await battleRef.once("value");
    const battle = battleSnap.val();

    if (!battle || battle.status !== "question") {
      throw new HttpsError("failed-precondition", "교체할 수 없는 상태입니다.");
    }

    const player = battle.players?.[userId];
    if (!player) {
      throw new HttpsError("not-found", "플레이어를 찾을 수 없습니다.");
    }

    const currentRound = battle.currentRound || 0;
    if (battle.rounds?.[currentRound]?.answers?.[userId]) {
      throw new HttpsError("failed-precondition", "답변 후에는 교체할 수 없습니다.");
    }

    const currentIndex = player.activeRabbitIndex;
    const newIndex = currentIndex === 0 ? 1 : 0;
    const otherRabbit = player.rabbits?.[newIndex];

    if (!otherRabbit || otherRabbit.currentHp <= 0) {
      throw new HttpsError(
        "failed-precondition",
        "교체할 토끼가 없거나 HP가 0입니다."
      );
    }

    await battleRef.child(`players/${userId}/activeRabbitIndex`).set(newIndex);

    return { success: true, newIndex };
  }
);

// ============================================
// submitMashResult — 줄다리기 결과 (스탯 기반 데미지)
// Transaction으로 이중 처리 방지
// ============================================
export const submitMashResult = onCall(
  {
    region: "asia-northeast3",
    secrets: [
      SUPABASE_URL_SECRET,
      SUPABASE_SERVICE_ROLE_SECRET,
      DEFAULT_ORG_ID_SECRET,
    ],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const userId = request.auth.uid;
    const { battleId, taps, botTaps: clientBotTaps } = request.data as {
      battleId: string;
      taps: number;
      botTaps?: number; // 클라이언트가 전달한 봇 탭 수 (RTDB 레이스컨디션 방지)
    };

    const rtdb = getDatabase();
    const battleRef = rtdb.ref(`tekken/battles/${battleId}`);
    const battleSnap = await battleRef.once("value");
    const battle = battleSnap.val();

    if (!battle?.mash) {
      throw new HttpsError("not-found", "연타 미니게임을 찾을 수 없습니다.");
    }

    // 이미 결과 처리 완료된 경우
    if (battle.mash.result) {
      return { winnerId: battle.mash.result.winnerId, bonusDamage: battle.mash.result.bonusDamage };
    }

    const MAX_TAPS = 200;
    const validTaps = Math.max(0, Math.min(Math.floor(taps), MAX_TAPS));

    // 내 탭 수 기록
    await battleRef.child(`mash/taps/${userId}`).set(validTaps);

    const players = battle.players;
    const playerIds = Object.keys(players);
    const opponentId = playerIds.find((id) => id !== userId)!;
    const opponent = players[opponentId];

    // 원자적 연타 결과 처리 (이중 처리 방지)
    const processedRef = battleRef.child("mash/processed");
    const mashTx = await processedRef.transaction((current: boolean | null) => {
      if (current) return; // 이미 처리됨 → abort
      return true;
    });

    if (!mashTx.committed) {
      // 이미 처리됨 — 최신 결과 반환
      const latestSnap = await battleRef.child("mash/result").once("value");
      const latestResult = latestSnap.val();
      return { winnerId: latestResult?.winnerId, bonusDamage: latestResult?.bonusDamage };
    }

    // 최신 탭 수: 클라이언트 파라미터 우선, RTDB 보조
    const latestTapsSnap = await battleRef.child("mash/taps").once("value");
    const latestTaps = latestTapsSnap.val() || {};
    const myTaps = latestTaps[userId] || validTaps;
    let opTaps = latestTaps[opponentId] || 0;

    // 봇 처리 — 클라이언트 전달값 > RTDB > 서버 생성 (레이스컨디션 방지)
    if (opponent.isBot) {
      const validBotTaps = clientBotTaps != null ? Math.max(0, Math.min(Math.floor(clientBotTaps), MAX_TAPS)) : 0;
      if (validBotTaps > 0) {
        // 클라이언트가 전달한 봇 탭 사용 (게임 화면과 동일한 값)
        opTaps = validBotTaps;
        await battleRef.child(`mash/taps/${opponentId}`).set(opTaps);
      } else if (opTaps <= 0) {
        // 폴백: RTDB에도 없으면 경과시간 기반 생성
        const elapsed = Math.max(1000, Date.now() - (battle.mash.startedAt || Date.now()));
        const botTapsPerSec = 3 + Math.random() * 2;
        opTaps = Math.floor((elapsed / 1000) * botTapsPerSec);
        await battleRef.child(`mash/taps/${opponentId}`).set(opTaps);
      }
    }

    const mashWinnerId = myTaps > opTaps ? userId : myTaps < opTaps ? opponentId : userId;
    const mashLoserId = mashWinnerId === userId ? opponentId : userId;

    // 레벨 무시 크리티컬 — 패자 maxHp의 35% (레벨 차이 커도 유효타 보장)
    const loser = players[mashLoserId];
    const loserRabbit = loser.rabbits[loser.activeRabbitIndex];
    const bonusDamage = calcMashBonusDamage(loserRabbit.maxHp);

    // 패자에게 보너스 데미지 — result + HP + 라운드 결과를 원자적으로 기록
    // 이미 로드된 loserRabbit.currentHp 사용 (별도 RTDB 읽기 불필요)
    const newHp = Math.max(0, loserRabbit.currentHp - bonusDamage);
    const roundIdx = battle.currentRound || 0;
    await battleRef.update({
      "mash/result": { winnerId: mashWinnerId, bonusDamage },
      [`players/${mashLoserId}/rabbits/${loser.activeRabbitIndex}/currentHp`]: newHp,
      // 라운드 결과에 연타 데미지 반영 (클라이언트 데미지 팝업용)
      [`rounds/${roundIdx}/result/${mashWinnerId}/damage`]: bonusDamage,
      [`rounds/${roundIdx}/result/${mashLoserId}/damageReceived`]: bonusDamage,
    });

    // 라운드 종료 처리
    const updatedBattle = (await battleRef.once("value")).val();
    await processRoundEnd(battleId, roundIdx, updatedBattle);

    return { winnerId: mashWinnerId, bonusDamage };
  }
);
