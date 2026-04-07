/**
 * 게이미피케이션 통계 수집
 *
 * 토끼 뽑기/레벨업, 배틀(철권퀴즈), 마일스톤
 */

import { getFirestore } from "firebase-admin/firestore";
import * as admin from "firebase-admin";
import { CollectContext, GamificationStats } from "./types";

export async function collectGamification(ctx: CollectContext): Promise<GamificationStats> {
  const db = getFirestore();
  const { courseId, studentIds, start, end } = ctx;

  // ── 토끼 뽑기/레벨업 (expHistory에서 주간 집계) ──
  let gachaSpins = 0;
  let levelUps = 0;
  let totalRabbitsOwned = 0;
  let rabbitUserCount = 0;

  // expHistory가 없을 수 있으므로 안전하게 처리
  // 토끼 보유 수: users 서브컬렉션 rabbitHoldings 카운트 (비용 절감: 학생 수 제한)
  const studentDocs = await db.collection("users")
    .where("courseId", "==", courseId)
    .where("role", "==", "student")
    .select("totalExp", "lastGachaExp")
    .get();

  // 간접 추정: lastGachaExp / 50 = 마일스톤 소비 횟수 ≈ 뽑기+레벨업 총합
  // 정확한 주간 뽑기 수는 expHistory 또는 별도 로그 필요
  // 현재는 rabbitHoldings 서브컬렉션에서 주간 추가분 집계
  for (const userDoc of studentDocs.docs) {
    try {
      const holdingsSnap = await db.collection("users")
        .doc(userDoc.id)
        .collection("rabbitHoldings")
        .get();
      const count = holdingsSnap.size;
      if (count > 0) {
        totalRabbitsOwned += count;
        rabbitUserCount++;
      }
      // 주간 뽑기: acquiredAt이 해당 주인 토끼
      holdingsSnap.docs.forEach(h => {
        const acquired = h.data().acquiredAt?.toDate?.();
        if (acquired && acquired >= start && acquired < end) {
          gachaSpins++;
        }
        // 레벨업: level > 1인 토끼의 레벨업 시점은 추적 불가
        // → levelUpCount 필드가 있으면 집계
        const lv = h.data().level || 1;
        if (lv > 1) levelUps += (lv - 1); // 누적 레벨업 (주간 아님)
      });
    } catch {
      // 서브컬렉션 없는 유저 스킵
    }
  }

  const avgRabbitsOwned = rabbitUserCount > 0
    ? Math.round((totalRabbitsOwned / rabbitUserCount) * 10) / 10
    : 0;

  // ── 배틀(철권퀴즈) — Firebase RTDB ──
  let battleCount = 0;
  let battleWins = 0;
  let battleTotal = 0;

  try {
    const rtdb = admin.database();
    // RTDB: tekken/results/{courseId} 하위에 배틀 결과 저장
    const resultsRef = rtdb.ref(`tekken/results/${courseId}`);
    const snap = await resultsRef
      .orderByChild("finishedAt")
      .startAt(start.getTime())
      .endAt(end.getTime())
      .once("value");

    if (snap.exists()) {
      snap.forEach(child => {
        const data = child.val();
        if (data) {
          battleCount++;
          // 승자가 있으면 승리 집계
          if (data.winnerId && studentIds.has(data.winnerId)) battleWins++;
          // 참가자 중 학생이면 totalBattles 증가
          if (data.player1Id && studentIds.has(data.player1Id)) battleTotal++;
          if (data.player2Id && studentIds.has(data.player2Id)) battleTotal++;
        }
        return false; // forEach continue
      });
    }
  } catch (err) {
    console.warn(`[${ctx.courseId}] 배틀 데이터 조회 실패 (RTDB):`, err);
    // RTDB 구조가 다를 수 있음 — 실패 시 0으로 유지
  }

  const battleWinRate = battleTotal > 0 ? Math.round((battleWins / battleTotal) * 100) : 0;

  return {
    gachaSpins,
    levelUps,
    avgRabbitsOwned,
    battleCount,
    battleWinRate,
  };
}
