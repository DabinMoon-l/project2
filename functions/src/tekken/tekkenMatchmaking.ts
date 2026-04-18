/**
 * 철권퀴즈 매칭 — joinMatchmaking, cancelMatchmaking, matchWithBot
 *
 * v2 — 챕터 기반 매칭:
 * ① 각 유저가 자기 경로에 쓰기 (경합 0) + chaptersKey 포함
 * ② 락 획득한 1명이 큐를 chaptersKey로 그룹핑 → 같은 그룹끼리만 FIFO 페어링
 * ③ matchResults/{userId}로 양쪽 모두에 알림
 * ④ 챕터가 다른 유저는 절대 매칭 안 됨 → 10초 후 봇 매칭
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getDatabase } from "firebase-admin/database";
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { createBotProfile } from "../utils/tekkenBot";
import { createBattle } from "./tekkenRound";
import { pregenBattleQuestions } from "./tekkenQuestions";
import type { PlayerSetup, BotPlayerSetup } from "./tekkenTypes";

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

// 매칭 락 유효 시간 (ms)
const MATCH_LOCK_TTL = 10_000;

/** 챕터 배열을 정렬된 키 문자열로 변환 (매칭 그룹핑용) */
function toChaptersKey(chapters: string[]): string {
  return [...chapters].sort((a, b) => Number(a) - Number(b)).join(",");
}

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
    const { courseId, chapters } = request.data as { courseId: string; chapters: string[] };

    if (!courseId) {
      throw new HttpsError("invalid-argument", "courseId가 필요합니다.");
    }
    if (!chapters || chapters.length === 0) {
      throw new HttpsError("invalid-argument", "최소 1개 챕터를 선택해야 합니다.");
    }

    const chaptersKey = toChaptersKey(chapters);

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

    // ① 프로필 + 큐 등록 (per-user 경로, 경합 없음)
    const profileData = {
      nickname: userData.nickname || "플레이어",
      profileRabbitId: equippedRabbits[0]?.rabbitId || 0,
      equippedRabbits,
      chapters,
    };
    await Promise.all([
      rtdb.ref(`tekken/matchmaking_data/${courseId}/${userId}`).set(profileData),
      rtdb.ref(`tekken/matchmaking/${courseId}/${userId}`).set({
        joinedAt: Date.now(),
        chaptersKey,
      }),
    ]);

    // ② 매칭 락 획득 시도
    const lockRef = rtdb.ref(`tekken/matchmaking_lock/${courseId}`);
    let acquired = false;
    await lockRef.transaction((current) => {
      if (current && Date.now() - current.lockedAt < MATCH_LOCK_TTL) {
        acquired = false;
        return current;
      }
      acquired = true;
      return { lockedAt: Date.now(), matcherId: userId };
    });

    if (acquired) {
      // ③ 매처: 큐 페어링 실행
      try {
        const myBattleId = await runMatchmaker(
          courseId, userId, rtdb, GEMINI_API_KEY.value()
        );
        if (myBattleId) {
          return { status: "matched", battleId: myBattleId };
        }
      } finally {
        lockRef.remove().catch(() => {});
      }

      // 매처였지만 매칭 안 됨 → 대기
      pregenBattleQuestions(courseId, userId, GEMINI_API_KEY.value(), chapters).catch(() => {});
      return { status: "waiting" };
    }

    // ④ 비매처: 매처가 처리할 때까지 대기 후 결과 확인
    await new Promise(r => setTimeout(r, 800));
    const myMatch = await rtdb.ref(`tekken/matchResults/${userId}`).once("value");
    if (myMatch.val()?.battleId) {
      return { status: "matched", battleId: myMatch.val().battleId };
    }

    pregenBattleQuestions(courseId, userId, GEMINI_API_KEY.value(), chapters).catch(() => {});
    return { status: "waiting" };
  }
);

/**
 * 매처: 큐를 chaptersKey로 그룹핑 → 같은 그룹끼리만 FIFO 페어링
 * 다른 chaptersKey의 유저끼리는 절대 매칭하지 않음
 */
async function runMatchmaker(
  courseId: string,
  matcherId: string,
  rtdb: ReturnType<typeof getDatabase>,
  apiKey: string
): Promise<string | null> {
  const snap = await rtdb.ref(`tekken/matchmaking/${courseId}`).once("value");
  const queue = snap.val() || {};
  const userIds = Object.keys(queue).sort(
    (a, b) => (queue[a].joinedAt || 0) - (queue[b].joinedAt || 0)
  );

  if (userIds.length < 2) return null;

  // chaptersKey별 그룹핑
  const groups: Record<string, string[]> = {};
  for (const uid of userIds) {
    const key = queue[uid].chaptersKey || "";
    if (!groups[key]) groups[key] = [];
    groups[key].push(uid);
  }

  // 각 그룹 내 FIFO 페어링 (2명 미만인 그룹은 스킵 → 큐에 남음)
  const allPairs: { pair: [string, string]; chaptersKey: string }[] = [];
  for (const [key, members] of Object.entries(groups)) {
    for (let i = 0; i + 1 < members.length; i += 2) {
      allPairs.push({ pair: [members[i], members[i + 1]], chaptersKey: key });
    }
  }

  if (allPairs.length === 0) return null;

  // 프로필 일괄 로드 (페어에 포함된 유저만)
  const pairedUserIds = new Set<string>();
  for (const { pair } of allPairs) {
    pairedUserIds.add(pair[0]);
    pairedUserIds.add(pair[1]);
  }

  const profileSnaps = await Promise.all(
    [...pairedUserIds].map(id =>
      rtdb.ref(`tekken/matchmaking_data/${courseId}/${id}`).once("value")
    )
  );
  interface MatchProfile {
    nickname?: string;
    profileRabbitId?: number;
    equippedRabbits?: Array<{ rabbitId: number; courseId: string }>;
    chapters?: string[];
  }
  const profiles: Record<string, MatchProfile> = {};
  [...pairedUserIds].forEach((id, i) => { profiles[id] = profileSnaps[i].val() || {}; });

  // 페어 병렬 처리
  let matcherBattleId: string | null = null;

  await Promise.all(allPairs.map(async ({ pair: [id1, id2], chaptersKey }) => {
    // 큐에서 양쪽 제거
    await Promise.all([
      rtdb.ref(`tekken/matchmaking/${courseId}/${id1}`).remove(),
      rtdb.ref(`tekken/matchmaking/${courseId}/${id2}`).remove(),
    ]);

    const p1 = profiles[id1];
    const p2 = profiles[id2];
    const chapters = chaptersKey.split(",");

    const player1: PlayerSetup = {
      userId: id1,
      nickname: p1.nickname || "플레이어",
      profileRabbitId: p1.profileRabbitId || 0,
      isBot: false,
      equippedRabbits: p1.equippedRabbits || [],
    };
    const player2: PlayerSetup = {
      userId: id2,
      nickname: p2.nickname || "상대방",
      profileRabbitId: p2.profileRabbitId || 0,
      isBot: false,
      equippedRabbits: p2.equippedRabbits || [],
    };

    const battleId = await createBattle(courseId, player1, player2, apiKey, chapters);

    // 양쪽 모두에 matchResults 알림
    await Promise.all([
      rtdb.ref(`tekken/matchResults/${id1}`).set({ battleId, matchedAt: Date.now() }),
      rtdb.ref(`tekken/matchResults/${id2}`).set({ battleId, matchedAt: Date.now() }),
    ]);

    // 프로필 정리
    Promise.all([
      rtdb.ref(`tekken/matchmaking_data/${courseId}/${id1}`).remove(),
      rtdb.ref(`tekken/matchmaking_data/${courseId}/${id2}`).remove(),
    ]).catch(() => {});

    if (id1 === matcherId || id2 === matcherId) {
      matcherBattleId = battleId;
    }
  }));

  return matcherBattleId;
}

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

    rtdb.ref(`tekken/matchmaking_data/${courseId}/${userId}`).remove().catch(() => {});
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
    const { courseId, chapters, aiOnly } = request.data as {
      courseId: string;
      chapters: string[];
      aiOnly?: boolean;
    };

    const rtdb = getDatabase();
    const fsDb = getFirestore();

    // AI 전용 모드: 큐 체크 건너뛰고 바로 봇 매칭
    // (유저가 joinMatchmaking을 호출하지 않았으므로 큐에 없음)
    if (!aiOnly) {
      // 큐에서 원자적 제거
      const queueEntryRef = rtdb.ref(`tekken/matchmaking/${courseId}/${userId}`);
      let removedFromQueue = false;
      await queueEntryRef.transaction((current) => {
        if (current) {
          removedFromQueue = true;
          return null;
        }
        removedFromQueue = false;
        return current;
      });

      rtdb.ref(`tekken/matchmaking_data/${courseId}/${userId}`).remove().catch(() => {});

      if (!removedFromQueue) {
        const matchResultSnap = await rtdb
          .ref(`tekken/matchResults/${userId}`)
          .once("value");
        const matchResult = matchResultSnap.val();
        if (matchResult?.battleId) {
          return { status: "matched", battleId: matchResult.battleId };
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
        const retrySnap = await rtdb
          .ref(`tekken/matchResults/${userId}`)
          .once("value");
        const retryResult = retrySnap.val();
        if (retryResult?.battleId) {
          return { status: "matched", battleId: retryResult.battleId };
        }
        return { status: "already_matched" };
      }
    }

    // 봇 매칭 진행
    const userDoc = await fsDb.collection("users").doc(userId).get();
    if (!userDoc.exists) {
      throw new HttpsError("not-found", "사용자를 찾을 수 없습니다.");
    }
    const userData = userDoc.data()!;
    const equippedRabbits = userData.equippedRabbits || [];
    if (equippedRabbits.length === 0) {
      throw new HttpsError("failed-precondition", "장착된 토끼가 없습니다.");
    }

    const holdingDocs = await Promise.all(
      equippedRabbits.slice(0, 2).map((eq: { rabbitId: number; courseId: string }) =>
        fsDb.collection("users").doc(userId)
          .collection("rabbitHoldings").doc(`${eq.courseId}_${eq.rabbitId}`).get()
      )
    );
    const userMaxLevel = Math.max(
      ...holdingDocs.map(d => d.exists ? (d.data()?.level || 1) : 1)
    );

    const botProfile = createBotProfile(userMaxLevel);
    const botUserId = `bot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const player1: PlayerSetup = {
      userId,
      nickname: userData.nickname || "플레이어",
      profileRabbitId: equippedRabbits[0]?.rabbitId || 0,
      isBot: false,
      equippedRabbits,
    };

    const player2: BotPlayerSetup = {
      userId: botUserId,
      nickname: botProfile.nickname,
      profileRabbitId: botProfile.profileRabbitId,
      isBot: true,
      equippedRabbits: [],
      rabbits: botProfile.rabbits,
    };

    const battleId = await createBattle(
      courseId,
      player1,
      player2,
      GEMINI_API_KEY.value(),
      chapters
    );

    return { status: "matched", battleId };
  }
);
