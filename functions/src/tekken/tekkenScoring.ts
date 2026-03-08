/**
 * 철권퀴즈 채점 — submitAnswer, submitTimeout, scoreRound
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getDatabase } from "firebase-admin/database";
import {
  calcDamage,
  BATTLE_CONFIG,
  MUTUAL_DAMAGE,
} from "../utils/tekkenDamage";
import { generateBotAnswer } from "../utils/tekkenBot";
import { processRoundEnd } from "./tekkenRound";

/**
 * 라운드 채점 로직 (submitAnswer/submitTimeout 공용)
 */
async function scoreRound(
  battleId: string,
  roundIndex: number,
  rtdb: ReturnType<typeof getDatabase>,
  battleRef: ReturnType<ReturnType<typeof getDatabase>["ref"]>,
  callerId?: string,
) {
  // 배틀 데이터 + 정답 병렬 읽기
  const [battleSnap, correctAnswerSnap] = await Promise.all([
    battleRef.once("value"),
    rtdb.ref(`tekken/battleAnswers/${battleId}/${roundIndex}`).once("value"),
  ]);
  const battle = battleSnap.val();
  const round = battle.rounds?.[roundIndex];
  const correctAnswer = correctAnswerSnap.val();

  const players = battle.players;
  const playerIds = Object.keys(players);
  const [p1Id, p2Id] = playerIds;
  const p1Answer = round.answers?.[p1Id];
  const p2Answer = round.answers?.[p2Id];

  const p1Correct = p1Answer ? p1Answer.answer === correctAnswer : false;
  const p2Correct = p2Answer ? p2Answer.answer === correctAnswer : false;

  const p1Player = players[p1Id];
  const p2Player = players[p2Id];
  const p1Rabbit = p1Player.rabbits[p1Player.activeRabbitIndex];
  const p2Rabbit = p2Player.rabbits[p2Player.activeRabbitIndex];

  // 정답 선지 텍스트
  const correctChoiceText = round.questionData?.choices?.[correctAnswer] || "";

  // 결과 초기화
  const p1Result = { isCorrect: p1Correct, damage: 0, isCritical: false, damageReceived: 0, correctChoiceText };
  const p2Result = { isCorrect: p2Correct, damage: 0, isCritical: false, damageReceived: 0, correctChoiceText };

  let mashTriggered = false;
  let mashId = "";

  // 원자적 업데이트를 위한 updates 객체
  const updates: Record<string, any> = {};

  if (p1Correct && p2Correct) {
    // 양쪽 정답 → 연타 미니게임
    mashTriggered = true;
  } else if (!p1Correct && !p2Correct) {
    // 양쪽 오답 → 상호 고정 데미지
    p1Result.damageReceived = MUTUAL_DAMAGE;
    p2Result.damageReceived = MUTUAL_DAMAGE;

    updates[`players/${p1Id}/rabbits/${p1Player.activeRabbitIndex}/currentHp`] =
      Math.max(0, p1Rabbit.currentHp - MUTUAL_DAMAGE);
    updates[`players/${p2Id}/rabbits/${p2Player.activeRabbitIndex}/currentHp`] =
      Math.max(0, p2Rabbit.currentHp - MUTUAL_DAMAGE);
  } else {
    // 한쪽만 정답
    const loserId = p1Correct ? p2Id : p1Id;
    const winnerAnswer = p1Correct ? p1Answer : p2Answer;
    const winnerRabbit = p1Correct ? p1Rabbit : p2Rabbit;
    const loserRabbit = p1Correct ? p2Rabbit : p1Rabbit;
    const loserPlayer = p1Correct ? p2Player : p1Player;
    const winnerResult = p1Correct ? p1Result : p2Result;
    const loserResult = p1Correct ? p2Result : p1Result;

    const dmgResult = calcDamage(
      winnerRabbit.atk,
      loserRabbit.def,
      winnerAnswer?.answeredAt || round.startedAt,
      round.startedAt
    );
    winnerResult.damage = dmgResult.damage;
    winnerResult.isCritical = dmgResult.isCritical;
    loserResult.damageReceived = dmgResult.damage;

    updates[`players/${loserId}/rabbits/${loserPlayer.activeRabbitIndex}/currentHp`] =
      Math.max(0, loserRabbit.currentHp - dmgResult.damage);
  }

  // 결과 + HP + mash/status를 단일 update로 원자적 기록
  updates[`rounds/${roundIndex}/result/${p1Id}`] = p1Result;
  updates[`rounds/${roundIndex}/result/${p2Id}`] = p2Result;

  if (mashTriggered) {
    mashId = `mash_${roundIndex}_${Date.now()}`;
    const mashNow = Date.now();
    updates["mash"] = {
      mashId,
      startedAt: mashNow,
      endsAt: mashNow + BATTLE_CONFIG.MASH_TIMEOUT,
      taps: {},
    };
    updates["status"] = "mash";
  }

  await battleRef.update(updates);

  if (!mashTriggered) {
    // 라운드 종료 처리
    const updatedBattle = (await battleRef.once("value")).val();
    await processRoundEnd(battleId, roundIndex, updatedBattle);
  }

  // 호출자에게 결과 반환
  const callerResult = callerId === p1Id ? p1Result : callerId === p2Id ? p2Result : null;
  return {
    status: "scored" as const,
    isCorrect: callerResult?.isCorrect,
    damage: callerResult?.damage,
    isCritical: callerResult?.isCritical,
    damageReceived: callerResult?.damageReceived,
    mashTriggered,
    mashId: mashTriggered ? mashId : undefined,
  };
}

// ============================================
// submitAnswer — 양쪽 독립 답변 → 둘 다 제출 후 채점
// scored transaction lock으로 이중 채점 방지
// ============================================
export const submitAnswer = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const userId = request.auth.uid;
    const { battleId, roundIndex, answer } = request.data as {
      battleId: string;
      roundIndex: number;
      answer: number;
    };

    if (typeof roundIndex !== "number" || roundIndex < 0) {
      throw new HttpsError("invalid-argument", "유효하지 않은 라운드입니다.");
    }

    const rtdb = getDatabase();
    const battleRef = rtdb.ref(`tekken/battles/${battleId}`);

    // 배틀 데이터 읽기
    const battleSnap = await battleRef.once("value");
    const battle = battleSnap.val();

    if (!battle) {
      throw new HttpsError("not-found", "배틀을 찾을 수 없습니다.");
    }

    // 참가자 검증
    if (!battle.players?.[userId]) {
      throw new HttpsError("permission-denied", "이 배틀의 참가자가 아닙니다.");
    }

    // 상태 검증: question 상태에서만 답변 가능
    if (battle.status !== "question") {
      throw new HttpsError("failed-precondition", "답변할 수 없는 상태입니다.");
    }

    // 현재 라운드 검증
    if (battle.currentRound !== roundIndex) {
      throw new HttpsError("failed-precondition", "현재 라운드가 아닙니다.");
    }

    const round = battle.rounds?.[roundIndex];
    if (!round) {
      throw new HttpsError("not-found", "라운드를 찾을 수 없습니다.");
    }

    // 이미 채점 완료된 라운드
    if (round.scored) {
      throw new HttpsError("failed-precondition", "라운드가 이미 종료되었습니다.");
    }

    const now = Date.now();

    // 답변 기록
    await battleRef.child(`rounds/${roundIndex}/answers/${userId}`).set({
      answer,
      answeredAt: now,
    });

    // 플레이어 정보
    const players = battle.players;
    const playerIds = Object.keys(players);
    const opponentId = playerIds.find((id) => id !== userId)!;
    const opponent = players[opponentId];

    // 봇이면 서버에서 봇 답변 즉시 생성
    const existingOpAnswer = round.answers?.[opponentId];
    if (opponent.isBot && !existingOpAnswer) {
      const correctAnswerSnap = await rtdb
        .ref(`tekken/battleAnswers/${battleId}/${roundIndex}`)
        .once("value");
      const correctAnswer = correctAnswerSnap.val();
      const questionData = round.questionData;
      const botResult = generateBotAnswer(correctAnswer, questionData.choices?.length || 4);
      const botAnsweredAt = now + botResult.delay;
      await battleRef.child(`rounds/${roundIndex}/answers/${opponentId}`).set({
        answer: botResult.answer,
        answeredAt: botAnsweredAt,
      });
    }

    // 다시 읽어서 양쪽 답변 확인
    const updatedRoundSnap = await battleRef.child(`rounds/${roundIndex}/answers`).once("value");
    const allAnswers = updatedRoundSnap.val() || {};

    // 상대가 아직 답변 안 함 → 대기
    if (!allAnswers[opponentId]) {
      return { status: "waiting" as const };
    }

    // 양쪽 다 답변 → scored transaction lock 획득
    const scoredRef = battleRef.child(`rounds/${roundIndex}/scored`);
    const txResult = await scoredRef.transaction((current) => {
      if (current) return; // 이미 채점됨 → abort
      return true;
    });

    if (!txResult.committed) {
      // 이미 상대가 채점 중 → RTDB 리스너로 결과 대기 (최대 3초)
      const resultRef = battleRef.child(`rounds/${roundIndex}/result/${userId}`);
      const myResult = await new Promise<any>((resolve) => {
        const timeout = setTimeout(() => {
          resultRef.off("value", listener);
          resolve(null);
        }, 3000);
        const listener = resultRef.on("value", (snap) => {
          const val = snap.val();
          if (val) {
            clearTimeout(timeout);
            resultRef.off("value", listener);
            resolve(val);
          }
        });
      });
      if (!myResult) {
        return { status: "waiting" as const };
      }
      return {
        status: "scored" as const,
        isCorrect: myResult.isCorrect,
        damage: myResult.damage,
        isCritical: myResult.isCritical,
        damageReceived: myResult.damageReceived,
      };
    }

    // 채점 수행
    return await scoreRound(battleId, roundIndex, rtdb, battleRef, userId);
  }
);

// ============================================
// submitTimeout — 타임아웃 처리 (미답변 = 오답)
// scored transaction lock으로 이중 채점 방지
// ============================================
export const submitTimeout = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const userId = request.auth.uid;
    const { battleId, roundIndex } = request.data as {
      battleId: string;
      roundIndex: number;
    };

    if (typeof roundIndex !== "number" || roundIndex < 0) {
      throw new HttpsError("invalid-argument", "유효하지 않은 라운드입니다.");
    }

    const rtdb = getDatabase();
    const battleRef = rtdb.ref(`tekken/battles/${battleId}`);

    // 배틀 상태 + 참가자 검증
    const battleSnap = await battleRef.once("value");
    const battle = battleSnap.val();
    if (!battle) {
      throw new HttpsError("not-found", "배틀을 찾을 수 없습니다.");
    }
    if (!battle.players?.[userId]) {
      throw new HttpsError("permission-denied", "이 배틀의 참가자가 아닙니다.");
    }
    if (battle.status !== "question") {
      return { success: false };
    }
    if (battle.currentRound !== roundIndex) {
      return { success: false };
    }

    // 서버 시간 기준 타임아웃 검증 (5초 여유 — 클라이언트 시계 차이 허용)
    const round = battle.rounds?.[roundIndex];
    if (round?.timeoutAt && Date.now() < round.timeoutAt - 5000) {
      return { success: false }; // 너무 이른 호출 → 클라이언트가 재시도
    }

    // 봇 상대일 때 봇 답변 생성 (타임아웃이어도 봇은 독립적으로 답변)
    const playerIds = Object.keys(battle.players || {});
    const opponentId = playerIds.find((id: string) => id !== userId)!;
    const opponent = battle.players?.[opponentId];
    const existingOpAnswer = round?.answers?.[opponentId];

    if (opponent?.isBot && !existingOpAnswer) {
      const correctAnswerSnap = await rtdb
        .ref(`tekken/battleAnswers/${battleId}/${roundIndex}`)
        .once("value");
      const correctAnswer = correctAnswerSnap.val();
      const questionData = round?.questionData;
      const botResult = generateBotAnswer(correctAnswer, questionData?.choices?.length || 4);
      await battleRef.child(`rounds/${roundIndex}/answers/${opponentId}`).set({
        answer: botResult.answer,
        answeredAt: (round?.startedAt || Date.now()) + botResult.delay,
      });
    }

    // scored transaction lock 획득
    const scoredRef = battleRef.child(`rounds/${roundIndex}/scored`);
    const txResult = await scoredRef.transaction((current: any) => {
      if (current) return; // 이미 채점됨 → abort
      return true;
    });

    if (!txResult.committed) {
      return { success: false };
    }

    // 채점 수행
    await scoreRound(battleId, roundIndex, rtdb, battleRef);

    return { success: true };
  }
);
