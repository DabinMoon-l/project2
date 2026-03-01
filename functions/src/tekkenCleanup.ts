/**
 * 철권퀴즈 정리 Scheduled Function
 *
 * 5분마다 실행:
 * - 방치된 매칭 큐 제거 (2분 이상)
 * - 종료된 배틀 + battleAnswers 제거 (10분 이상)
 * - 타임아웃된 진행중 배틀 강제 종료 (dot notation으로 result 덮어쓰기 방지)
 * - 오래된 matchResults 정리 (5분 이상)
 */

import { onSchedule } from "firebase-functions/v2/scheduler";
import { getDatabase } from "firebase-admin/database";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

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

    // 2. 종료된 배틀 + battleAnswers 정리 (10분 이상)
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
        // battleAnswers도 함께 정리
        await rtdb.ref(`tekken/battleAnswers/${battleId}`).remove();
        removedBattles++;
      }
    }

    // 3. 타임아웃된 진행중 배틀 강제 종료
    // dot notation으로 개별 필드만 설정 (endBattle의 xpGranted 덮어쓰기 방지)
    const activeBattlesSnap = await battlesRef.once("value");
    const activeBattles = activeBattlesSnap.val() || {};

    let forcedEnd = 0;
    for (const [battleId, battle] of Object.entries(activeBattles)) {
      const b = battle as { status?: string; endsAt?: number; createdAt?: number; result?: any };
      if (b.status && b.status !== "finished") {
        // endsAt 기반 타임아웃 (endsAt이 설정된 배틀)
        const endsAtTimeout = b.endsAt && now > b.endsAt + 30000;
        // createdAt 기반 타임아웃 (loading 상태에서 endsAt=0인 배틀 — 5분 초과)
        const loadingTimeout = !b.endsAt && b.createdAt && now - b.createdAt > 300000;

        if (endsAtTimeout || loadingTimeout) {
          // endBattle이 이미 result를 설정했으면 건드리지 않음
          if (b.result?.xpGranted !== undefined) continue;

          await battlesRef.child(battleId).update({
            status: "finished",
            "result/winnerId": null,
            "result/loserId": null,
            "result/isDraw": true,
            "result/endReason": "timeout",
            "result/xpGranted": false,
          });
          forcedEnd++;
        }
      }
    }

    // 4. 오래된 matchResults 정리 (5분 이상)
    const matchResultsRef = rtdb.ref("tekken/matchResults");
    const mrSnap = await matchResultsRef.once("value");
    const mrData = mrSnap.val() || {};

    let removedMatchResults = 0;
    for (const [userId, result] of Object.entries(mrData)) {
      const r = result as { matchedAt?: number };
      if (r.matchedAt && now - r.matchedAt > 300000) {
        await matchResultsRef.child(userId).remove();
        removedMatchResults++;
      }
    }

    // 5. 오래된 사전 캐시 정리 (5분 이상)
    const pregenRef = rtdb.ref("tekken/pregenQuestions");
    const pregenSnap = await pregenRef.once("value");
    const pregenData = pregenSnap.val() || {};

    let removedPregen = 0;
    for (const [key, cache] of Object.entries(pregenData)) {
      const c = cache as { createdAt?: number };
      if (c.createdAt && now - c.createdAt > 300000) {
        await pregenRef.child(key).remove();
        removedPregen++;
      }
    }

    // 6. Firestore seenQuestions 정리 (24시간 지난 문서)
    const fsDb = getFirestore();
    const oneDayAgo = Timestamp.fromMillis(now - 24 * 60 * 60 * 1000);
    const courseIds = ["biology", "pathophysiology", "microbiology"];
    let removedSeen = 0;

    for (const courseId of courseIds) {
      try {
        const seenRef = fsDb
          .collection("tekkenQuestionPool")
          .doc(courseId)
          .collection("seenQuestions");

        const expiredSnap = await seenRef
          .where("seenAt", "<", oneDayAgo)
          .limit(100)
          .get();

        if (!expiredSnap.empty) {
          const batch = fsDb.batch();
          expiredSnap.docs.forEach(doc => batch.delete(doc.ref));
          await batch.commit();
          removedSeen += expiredSnap.size;
        }
      } catch {
        // seenQuestions 컬렉션이 아직 없을 수 있음
      }
    }

    if (removedQueue > 0 || removedBattles > 0 || forcedEnd > 0 || removedMatchResults > 0 || removedPregen > 0 || removedSeen > 0) {
      console.log(
        `철권퀴즈 정리: 큐 ${removedQueue}건, 배틀 ${removedBattles}건 제거, 강제종료 ${forcedEnd}건, matchResults ${removedMatchResults}건, 사전캐시 ${removedPregen}건, seenQuestions ${removedSeen}건`
      );
    }
  }
);
