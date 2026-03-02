/**
 * 철권퀴즈 배틀 생성, 라운드 종료 처리, 배틀 종료 + XP 지급
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getDatabase } from "firebase-admin/database";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import {
  calcBattleXp,
  getTotalRemainingHp,
  BATTLE_CONFIG,
} from "../utils/tekkenDamage";
import { getBaseStats } from "../utils/rabbitStats";
import { drawQuestionsFromPool } from "../tekkenQuestionPool";
import { generateBattleQuestions, getEmergencyQuestions } from "./tekkenQuestions";
import type { GeneratedQuestion, PregenCache, PlayerSetup } from "./tekkenTypes";

/**
 * 플레이어 스탯 조회
 */
async function getPlayerBattleRabbits(
  userId: string,
  equippedRabbits: Array<{ rabbitId: number; courseId: string }>
) {
  const db = getFirestore();

  // 병렬 조회 (홀딩 + 토끼 이름)
  const rabbits = await Promise.all(
    equippedRabbits.map(async (eq) => {
      const holdingId = `${eq.courseId}_${eq.rabbitId}`;
      const [holdingDoc, rabbitDoc] = await Promise.all([
        db.collection("users").doc(userId)
          .collection("rabbitHoldings").doc(holdingId).get(),
        db.collection("rabbits").doc(holdingId).get(),
      ]);

      const holdingData = holdingDoc.exists ? holdingDoc.data()! : null;
      const stats = holdingData?.stats || getBaseStats(eq.rabbitId);
      const rabbitName = rabbitDoc.exists ? (rabbitDoc.data()?.name || null) : null;
      const discoveryOrder = holdingData?.discoveryOrder || 1;

      return {
        rabbitId: eq.rabbitId,
        name: rabbitName || "토끼",
        discoveryOrder,
        maxHp: stats.hp,
        currentHp: stats.hp,
        atk: stats.atk,
        def: stats.def,
      };
    })
  );

  return rabbits;
}

/**
 * 배틀 룸 생성 — 즉시 loading 상태로 생성, 문제 생성은 비동기
 */
export async function createBattle(
  courseId: string,
  player1: PlayerSetup,
  player2: PlayerSetup,
  apiKey: string
): Promise<string> {
  const rtdb = getDatabase();
  const battleId = rtdb.ref("tekken/battles").push().key!;
  const now = Date.now();

  // 플레이어 스탯 병렬 조회
  const [p1Rabbits, p2Rabbits] = await Promise.all([
    player1.isBot
      ? Promise.resolve((player1 as any).rabbits || [])
      : getPlayerBattleRabbits(player1.userId, player1.equippedRabbits),
    player2.isBot
      ? Promise.resolve((player2 as any).rabbits || [])
      : getPlayerBattleRabbits(player2.userId, player2.equippedRabbits),
  ]);

  // 즉시 loading 상태로 배틀 생성 (문제 없이)
  const battleData = {
    status: "loading",
    courseId,
    createdAt: now,
    endsAt: 0,
    currentRound: 0,
    totalRounds: 0,
    colorAssignment: {
      [player1.userId]: "red",
      [player2.userId]: "blue",
    },
    players: {
      [player1.userId]: {
        nickname: player1.nickname,
        profileRabbitId: player1.profileRabbitId,
        isBot: player1.isBot,
        rabbits: p1Rabbits,
        activeRabbitIndex: 0,
        connected: true,
      },
      [player2.userId]: {
        nickname: player2.nickname,
        profileRabbitId: player2.profileRabbitId,
        isBot: player2.isBot,
        rabbits: p2Rabbits,
        activeRabbitIndex: 0,
        connected: true,
      },
    },
  };

  await rtdb.ref(`tekken/battles/${battleId}`).set(battleData);

  // 비동기 문제 생성 (실패 시 에러 상태로 전환)
  populateBattleQuestions(battleId, courseId, apiKey).catch(async (err) => {
    console.error("문제 생성 실패:", err);
    try {
      await rtdb.ref(`tekken/battles/${battleId}`).update({
        status: "error",
        errorMessage: "문제 생성에 실패했습니다.",
      });
    } catch (updateErr) {
      console.error("에러 상태 업데이트 실패:", updateErr);
    }
  });

  return battleId;
}

/**
 * 비동기 문제 생성 → 완료 시 countdown 전환
 *
 * 우선순위:
 * 1. Firestore 문제 풀 (사전 생성된 문제, 중복 방지)
 * 2. RTDB per-user 사전 캐시
 * 3. Gemini 실시간 호출
 * 4. 비상 문제
 */
async function populateBattleQuestions(
  battleId: string,
  courseId: string,
  apiKey: string
): Promise<void> {
  const rtdb = getDatabase();
  const battleRef = rtdb.ref(`tekken/battles/${battleId}`);
  const QUESTION_COUNT = 10;

  // 배틀 참가자 확인
  const battleSnap = await battleRef.once("value");
  const battle = battleSnap.val();
  const playerIds = battle?.players ? Object.keys(battle.players) : [];
  const humanPlayerIds = playerIds.filter(pid => !battle?.players?.[pid]?.isBot);

  let questions: GeneratedQuestion[] | null = null;

  // 1. Firestore 문제 풀에서 추출 (중복 방지 포함)
  if (humanPlayerIds.length > 0) {
    try {
      const poolQuestions = await drawQuestionsFromPool(courseId, humanPlayerIds, QUESTION_COUNT);
      if (poolQuestions && poolQuestions.length >= 5) {
        questions = poolQuestions.slice(0, QUESTION_COUNT);
        console.log(`문제 풀 사용 (${courseId}): ${questions.length}문제`);
      }
    } catch (err) {
      console.error("문제 풀 조회 실패, 폴백 진행:", err);
    }
  }

  // 2. RTDB 사전 캐시 확인 (양쪽 플레이어)
  if (!questions) {
    for (const pid of playerIds) {
      if (battle?.players?.[pid]?.isBot) continue;
      const cacheRef = rtdb.ref(`tekken/pregenQuestions/${courseId}_${pid}`);
      const cacheSnap = await cacheRef.once("value");
      const cache = cacheSnap.val() as PregenCache | null;

      if (cache?.questions && cache.questions.length >= 5 &&
          cache.createdAt > Date.now() - 5 * 60 * 1000) {
        questions = cache.questions.slice(0, QUESTION_COUNT);
        await cacheRef.remove();
        console.log(`사전 캐시 사용 (${pid})`);
        break;
      }
    }
  }

  // 3. Gemini 실시간 호출
  if (!questions) {
    const generated = await generateBattleQuestions(courseId, apiKey, QUESTION_COUNT);
    if (generated.length >= 5) {
      questions = generated.slice(0, QUESTION_COUNT);
    }
  }

  // 4. 비상 문제
  if (!questions || questions.length < 5) {
    questions = getEmergencyQuestions(courseId);
  }

  // 라운드 데이터 구성
  const rounds: Record<string, any> = {};
  const battleAnswersData: Record<string, number> = {};
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    rounds[i] = {
      questionData: {
        text: q.text,
        type: q.type,
        choices: q.choices,
      },
      startedAt: 0,
      timeoutAt: 0,
    };
    battleAnswersData[i] = q.correctAnswer;
  }

  const now = Date.now();

  // RTDB 병렬 쓰기
  await Promise.all([
    battleRef.update({
      status: "countdown",
      rounds,
      totalRounds: questions.length,
      countdownStartedAt: now,
      endsAt: now + BATTLE_CONFIG.BATTLE_DURATION + 5000,
    }),
    rtdb.ref(`tekken/battleAnswers/${battleId}`).set(battleAnswersData),
  ]);

  // 남은 캐시 정리 (사용하지 않은 상대방 캐시)
  for (const pid of playerIds) {
    if (battle?.players?.[pid]?.isBot) continue;
    rtdb.ref(`tekken/pregenQuestions/${courseId}_${pid}`).remove().catch(() => {});
  }
}

/**
 * 라운드 종료 처리 (HP 기반, 라운드 제한 없음)
 * 양쪽 동시 KO 시 무승부 처리
 */
export async function processRoundEnd(
  battleId: string,
  _roundIndex: number,
  battle: any
) {
  const rtdb = getDatabase();
  const battleRef = rtdb.ref(`tekken/battles/${battleId}`);

  const playerIds = Object.keys(battle.players);

  // KO 체크 — 양쪽 모든 토끼 HP 확인 (동시 KO 대응)
  const koPlayers: string[] = [];
  for (const pid of playerIds) {
    const player = battle.players[pid];
    const allDead = player.rabbits.every(
      (r: { currentHp: number }) => r.currentHp <= 0
    );
    if (allDead) koPlayers.push(pid);
  }

  if (koPlayers.length >= 2) {
    // 양쪽 동시 KO → 무승부
    await endBattle(battleId, null, null, true, "ko");
    return;
  } else if (koPlayers.length === 1) {
    // 한쪽 KO → 상대 승리
    const loserId = koPlayers[0];
    const winnerId = playerIds.find((id) => id !== loserId)!;
    await endBattle(battleId, winnerId, loserId, false, "ko");
    return;
  }

  // 다음 라운드 or 종료 조건
  const nextRound = (battle.currentRound || 0) + 1;
  const totalRounds = battle.totalRounds || 10;

  // 문제 소진 → HP 비교 (시간제한 없음)
  if (nextRound >= totalRounds) {
    const p1 = playerIds[0];
    const p2 = playerIds[1];
    const p1Hp = getTotalRemainingHp(battle.players[p1].rabbits);
    const p2Hp = getTotalRemainingHp(battle.players[p2].rabbits);

    if (p1Hp > p2Hp) {
      await endBattle(battleId, p1, p2, false, "timeout");
    } else if (p2Hp > p1Hp) {
      await endBattle(battleId, p2, p1, false, "timeout");
    } else {
      await endBattle(battleId, null, null, true, "timeout");
    }
    return;
  }

  // 토끼 교체 + roundResult 전환을 단일 update로 원자적 기록
  // mash 데이터 정리 (taps/processed 등 제거, result만 보존)
  const roundEndUpdates: Record<string, any> = {
    status: "roundResult",
    nextRound,
    "mash/taps": null,
    "mash/processed": null,
    "mash/startedAt": null,
    "mash/endsAt": null,
    "mash/mashId": null,
  };

  for (const pid of playerIds) {
    const player = battle.players[pid];
    const activeRabbit = player.rabbits[player.activeRabbitIndex];
    if (activeRabbit.currentHp <= 0) {
      const otherIndex = player.activeRabbitIndex === 0 ? 1 : 0;
      const otherRabbit = player.rabbits[otherIndex];
      if (otherRabbit && otherRabbit.currentHp > 0) {
        roundEndUpdates[`players/${pid}/activeRabbitIndex`] = otherIndex;
      }
    }
  }

  await battleRef.update(roundEndUpdates);
}

/**
 * 배틀 종료 + XP 지급
 */
export async function endBattle(
  battleId: string,
  winnerId: string | null,
  loserId: string | null,
  isDraw: boolean,
  endReason: string
) {
  const rtdb = getDatabase();
  const fsDb = getFirestore();
  const battleRef = rtdb.ref(`tekken/battles/${battleId}`);

  // 원자적 xpGranted 체크 (이중 XP 지급 방지)
  const xpGrantedRef = battleRef.child("result/xpGranted");
  const xpTx = await xpGrantedRef.transaction((current) => {
    if (current === true) return; // 이미 지급됨 → abort
    return true;
  });

  if (!xpTx.committed) return; // 다른 호출이 이미 처리함

  const battleSnap = await battleRef.once("value");
  const battle = battleSnap.val();

  await battleRef.update({
    status: "finished",
    "result/winnerId": winnerId,
    "result/loserId": loserId,
    "result/isDraw": isDraw,
    "result/endReason": endReason,
    mash: null,
  });

  const players = battle?.players || {};
  const batch = fsDb.batch();

  for (const [uid, player] of Object.entries(players)) {
    const p = player as any;
    if (p.isBot) continue;

    const isWinner = uid === winnerId;

    // 연승 업데이트 (트랜잭션으로 race condition 방지)
    const streakRef = rtdb.ref(`tekken/streaks/${uid}`);
    const txResult = await streakRef.transaction((current: any) => {
      const streak = current || { currentStreak: 0, lastBattleAt: 0 };
      const newStreak = isWinner
        ? streak.currentStreak + 1
        : isDraw
          ? streak.currentStreak
          : 0;
      return { currentStreak: newStreak, lastBattleAt: Date.now() };
    });
    const newStreak = txResult.snapshot.val()?.currentStreak ?? 0;
    const xp = calcBattleXp(isWinner, newStreak);

    // 결과에 XP 기록 (클라이언트 표시용)
    await battleRef.child(`result/xpByPlayer/${uid}`).set(xp);

    const userRef = fsDb.collection("users").doc(uid);
    batch.update(userRef, {
      totalExp: FieldValue.increment(xp),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const histRef = userRef.collection("expHistory").doc();
    batch.set(histRef, {
      type: "tekken_battle",
      amount: xp,
      reason: isWinner
        ? `배틀 승리 (${newStreak}연승)`
        : isDraw
          ? "배틀 무승부"
          : "배틀 패배",
      battleId,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  try {
    await batch.commit();
  } catch (err) {
    // Firestore batch 실패 → xpGranted 리셋 (재시도 가능)
    console.error("XP 지급 Firestore batch 실패, xpGranted 리셋:", err);
    await xpGrantedRef.set(false).catch(() => {});
  }
}

// ============================================
// startBattleRound — 카운트다운 후 / roundResult 후 라운드 시작
// ============================================
export const startBattleRound = onCall(
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

    const rtdb = getDatabase();
    const battleRef = rtdb.ref(`tekken/battles/${battleId}`);
    const battleSnap = await battleRef.once("value");
    const battle = battleSnap.val();

    if (!battle) {
      throw new HttpsError("not-found", "배틀을 찾을 수 없습니다.");
    }

    // 참가자 검증
    if (!battle.players?.[userId]) {
      throw new HttpsError("permission-denied", "이 배틀의 참가자가 아닙니다.");
    }

    if (battle.status === "finished") {
      throw new HttpsError("failed-precondition", "이미 종료된 배틀입니다.");
    }

    // question 상태에서 다시 시작 방지
    if (battle.status === "question") {
      return { success: true };
    }

    // 라운드별 started 플래그 트랜잭션 (이중 시작 방지)
    const startedRef = battleRef.child(`rounds/${roundIndex}/started`);
    const txResult = await startedRef.transaction((current) => {
      if (current) return; // 이미 시작됨 → abort
      return true;
    });

    if (!txResult.committed) {
      // 다른 클라이언트가 이미 시작함
      return { success: true };
    }

    // status + 라운드 데이터를 단일 update로 원자적 기록
    const now = Date.now();
    await battleRef.update({
      status: "question",
      currentRound: roundIndex,
      mash: null,
      [`rounds/${roundIndex}/startedAt`]: now,
      [`rounds/${roundIndex}/timeoutAt`]: now + BATTLE_CONFIG.QUESTION_TIMEOUT,
    });

    return { success: true };
  }
);
