/**
 * 철권퀴즈 매칭 — joinMatchmaking, cancelMatchmaking, matchWithBot
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getDatabase } from "firebase-admin/database";
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { createBotProfile } from "../utils/tekkenBot";
import { createBattle } from "./tekkenRound";
import { pregenBattleQuestions } from "./tekkenQuestions";
import type { PlayerSetup } from "./tekkenTypes";

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

// ============================================
// joinMatchmaking
// ============================================
export const joinMatchmaking = onCall(
  {
    region: "asia-northeast3",
    secrets: [GEMINI_API_KEY],
    minInstances: 1,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const userId = request.auth.uid;
    const { courseId } = request.data as { courseId: string };

    if (!courseId) {
      throw new HttpsError("invalid-argument", "courseId가 필요합니다.");
    }

    const rtdb = getDatabase();
    const fsDb = getFirestore();

    const userDoc = await fsDb.collection("users").doc(userId).get();
    if (!userDoc.exists) {
      throw new HttpsError("not-found", "사용자를 찾을 수 없습니다.");
    }
    const userData = userDoc.data()!;
    const equippedRabbits = userData.equippedRabbits || [];
    if (equippedRabbits.length === 0) {
      throw new HttpsError(
        "failed-precondition",
        "장착된 토끼가 없습니다."
      );
    }

    const queueEntry = {
      userId,
      nickname: userData.nickname || "플레이어",
      profileRabbitId: equippedRabbits[0]?.rabbitId || 0,
      equippedRabbits,
      joinedAt: Date.now(),
    };

    // 트랜잭션으로 원자적 매칭
    const queueRef = rtdb.ref(`tekken/matchmaking/${courseId}`);
    let matchedOpponentId: string | null = null;
    let matchedOpponentData: any = null;

    const txResult = await queueRef.transaction((currentData) => {
      matchedOpponentId = null;
      matchedOpponentData = null;

      if (!currentData) {
        return { [userId]: queueEntry };
      }

      delete currentData[userId];

      const opponentIds = Object.keys(currentData);
      if (opponentIds.length > 0) {
        matchedOpponentId = opponentIds[0];
        matchedOpponentData = JSON.parse(JSON.stringify(currentData[matchedOpponentId]));
        delete currentData[matchedOpponentId];
        return Object.keys(currentData).length === 0 ? null : currentData;
      }

      currentData[userId] = queueEntry;
      return currentData;
    });

    if (!txResult.committed) {
      throw new HttpsError("aborted", "매칭 처리 실패, 다시 시도해주세요.");
    }

    if (matchedOpponentId && matchedOpponentData) {
      const player1: PlayerSetup = {
        userId,
        nickname: userData.nickname || "플레이어",
        profileRabbitId: equippedRabbits[0]?.rabbitId || 0,
        isBot: false,
        equippedRabbits,
      };

      const player2: PlayerSetup = {
        userId: matchedOpponentId,
        nickname: matchedOpponentData.nickname || "상대방",
        profileRabbitId: matchedOpponentData.profileRabbitId || 0,
        isBot: false,
        equippedRabbits: matchedOpponentData.equippedRabbits || [],
      };

      // createBattle은 즉시 반환 (문제 생성은 비동기)
      const battleId = await createBattle(
        courseId,
        player1,
        player2,
        GEMINI_API_KEY.value()
      );

      await rtdb.ref(`tekken/matchResults/${matchedOpponentId}`).set({
        battleId,
        matchedAt: Date.now(),
      });

      return { status: "matched", battleId };
    }

    // 매칭 대기 중 → 문제 사전 생성 (fire-and-forget)
    pregenBattleQuestions(courseId, userId, GEMINI_API_KEY.value()).catch((err) => {
      console.error("사전 캐싱 실패 (무시):", err);
    });

    return { status: "waiting" };
  }
);

// ============================================
// cancelMatchmaking
// ============================================
export const cancelMatchmaking = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const userId = request.auth.uid;
    const { courseId } = request.data as { courseId: string };

    const rtdb = getDatabase();
    await rtdb.ref(`tekken/matchmaking/${courseId}/${userId}`).remove();

    // 사전 캐시도 정리
    rtdb.ref(`tekken/pregenQuestions/${courseId}_${userId}`).remove().catch(() => {});

    return { success: true };
  }
);

// ============================================
// matchWithBot
// ============================================
export const matchWithBot = onCall(
  {
    region: "asia-northeast3",
    secrets: [GEMINI_API_KEY],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const userId = request.auth.uid;
    const { courseId } = request.data as { courseId: string };

    const rtdb = getDatabase();
    const fsDb = getFirestore();

    // 원자적으로 큐에서 제거 — 이미 없으면(다른 유저가 매칭) 봇 생성 스킵
    const queueEntryRef = rtdb.ref(`tekken/matchmaking/${courseId}/${userId}`);
    const txResult = await queueEntryRef.transaction((current) => {
      if (!current) return; // 이미 큐에 없음 → abort (다른 유저가 매칭함)
      return null; // 큐에서 제거
    });

    if (!txResult.committed) {
      // 이미 다른 유저와 매칭됨 — matchResults에서 battleId 확인
      const matchResultSnap = await rtdb
        .ref(`tekken/matchResults/${userId}`)
        .once("value");
      const matchResult = matchResultSnap.val();
      if (matchResult?.battleId) {
        return { status: "matched", battleId: matchResult.battleId };
      }
      // matchResult가 아직 없으면 약간 대기 후 재확인 (RTDB 전파 딜레이)
      await new Promise(resolve => setTimeout(resolve, 500));
      const retrySnap = await rtdb
        .ref(`tekken/matchResults/${userId}`)
        .once("value");
      const retryResult = retrySnap.val();
      if (retryResult?.battleId) {
        return { status: "matched", battleId: retryResult.battleId };
      }
      // 정말 없으면 큐에 다시 없는 상태 → 에러 (극히 드문 케이스)
      throw new HttpsError("aborted", "매칭 상태를 확인할 수 없습니다. 다시 시도해주세요.");
    }

    // 큐에서 정상 제거됨 → 봇 매칭 진행
    const userDoc = await fsDb.collection("users").doc(userId).get();
    if (!userDoc.exists) {
      throw new HttpsError("not-found", "사용자를 찾을 수 없습니다.");
    }
    const userData = userDoc.data()!;
    const equippedRabbits = userData.equippedRabbits || [];
    if (equippedRabbits.length === 0) {
      throw new HttpsError("failed-precondition", "장착된 토끼가 없습니다.");
    }

    const botProfile = createBotProfile();
    const botUserId = `bot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const player1: PlayerSetup = {
      userId,
      nickname: userData.nickname || "플레이어",
      profileRabbitId: equippedRabbits[0]?.rabbitId || 0,
      isBot: false,
      equippedRabbits,
    };

    const player2 = {
      userId: botUserId,
      nickname: botProfile.nickname,
      profileRabbitId: botProfile.profileRabbitId,
      isBot: true,
      equippedRabbits: [] as Array<{ rabbitId: number; courseId: string }>,
      rabbits: botProfile.rabbits,
    };

    const battleId = await createBattle(
      courseId,
      player1,
      player2 as any,
      GEMINI_API_KEY.value()
    );

    return { status: "matched", battleId };
  }
);
