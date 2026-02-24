/**
 * 철권퀴즈 정리 Scheduled Function
 *
 * 5분마다 실행:
 * - 방치된 매칭 큐 제거 (2분 이상)
 * - 종료된 배틀 제거 (10분 이상)
 */

import { onSchedule } from "firebase-functions/v2/scheduler";
import { getDatabase } from "firebase-admin/database";

export const tekkenCleanup = onSchedule(
  {
    schedule: "every 5 minutes",
    region: "asia-northeast3",
    timeZone: "Asia/Seoul",
  },
  async () => {
    const rtdb = getDatabase();
    const now = Date.now();

    // 1. 매칭 큐 정리 (2분 이상 대기)
    const matchmakingRef = rtdb.ref("tekken/matchmaking");
    const matchSnap = await matchmakingRef.once("value");
    const matchData = matchSnap.val() || {};

    let removedQueue = 0;
    for (const courseId of Object.keys(matchData)) {
      const courseQueue = matchData[courseId] || {};
      for (const [userId, entry] of Object.entries(courseQueue)) {
        const e = entry as { joinedAt?: number };
        if (e.joinedAt && now - e.joinedAt > 120000) {
          await matchmakingRef.child(`${courseId}/${userId}`).remove();
          removedQueue++;
        }
      }
    }

    // 2. 종료된 배틀 정리 (10분 이상)
    const battlesRef = rtdb.ref("tekken/battles");
    const battlesSnap = await battlesRef
      .orderByChild("status")
      .equalTo("finished")
      .once("value");
    const battles = battlesSnap.val() || {};

    let removedBattles = 0;
    for (const [battleId, battle] of Object.entries(battles)) {
      const b = battle as { createdAt?: number };
      if (b.createdAt && now - b.createdAt > 600000) {
        await battlesRef.child(battleId).remove();
        removedBattles++;
      }
    }

    // 3. 타임아웃된 진행중 배틀 강제 종료
    const activeBattlesSnap = await battlesRef.once("value");
    const activeBattles = activeBattlesSnap.val() || {};

    let forcedEnd = 0;
    for (const [battleId, battle] of Object.entries(activeBattles)) {
      const b = battle as { status?: string; endsAt?: number };
      if (
        b.status &&
        b.status !== "finished" &&
        b.endsAt &&
        now > b.endsAt + 30000 // 30초 여유
      ) {
        await battlesRef.child(battleId).update({
          status: "finished",
          result: {
            winnerId: null,
            loserId: null,
            isDraw: true,
            endReason: "timeout",
            xpGranted: false,
          },
        });
        forcedEnd++;
      }
    }

    if (removedQueue > 0 || removedBattles > 0 || forcedEnd > 0) {
      console.log(
        `철권퀴즈 정리: 큐 ${removedQueue}건, 배틀 ${removedBattles}건 제거, 강제종료 ${forcedEnd}건`
      );
    }
  }
);
