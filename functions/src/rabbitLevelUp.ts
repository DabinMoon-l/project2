/**
 * 토끼 레벨업 Cloud Function
 *
 * 마일스톤 1개를 소비하여 보유 토끼의 레벨을 올리고 스탯을 증가시킴
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getBaseStats, generateStatIncreases } from "./utils/rabbitStats";

export const levelUpRabbit = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const userId = request.auth.uid;
    const { courseId, rabbitId } = request.data as {
      courseId: string;
      rabbitId: number;
    };

    if (!courseId || rabbitId === undefined) {
      throw new HttpsError("invalid-argument", "courseId와 rabbitId가 필요합니다.");
    }

    const db = getFirestore();

    const result = await db.runTransaction(async (transaction) => {
      // READ: user doc
      const userRef = db.collection("users").doc(userId);
      const userDoc = await transaction.get(userRef);

      if (!userDoc.exists) {
        throw new HttpsError("not-found", "사용자를 찾을 수 없습니다.");
      }

      const userData = userDoc.data()!;
      const totalExp = userData.totalExp || 0;
      const lastGachaExp = userData.lastGachaExp || 0;

      // 마일스톤 검증
      const pendingMilestones =
        Math.floor(totalExp / 50) - Math.floor(lastGachaExp / 50);
      if (pendingMilestones <= 0) {
        throw new HttpsError(
          "failed-precondition",
          "사용 가능한 마일스톤이 없습니다."
        );
      }

      // READ: holding doc
      const holdingId = `${courseId}_${rabbitId}`;
      const holdingRef = userRef.collection("rabbitHoldings").doc(holdingId);
      const holdingDoc = await transaction.get(holdingRef);

      if (!holdingDoc.exists) {
        throw new HttpsError("not-found", "보유하지 않은 토끼입니다.");
      }

      const holdingData = holdingDoc.data()!;
      const currentLevel = holdingData.level || 1;
      const currentStats = holdingData.stats || getBaseStats(rabbitId);

      // 랜덤 스탯 증가치 생성
      const { increases, totalPoints } = generateStatIncreases();

      const newStats = {
        hp: currentStats.hp + increases.hp,
        atk: currentStats.atk + increases.atk,
        def: currentStats.def + increases.def,
      };
      const newLevel = currentLevel + 1;

      // WRITE: holding level + stats 업데이트
      transaction.update(holdingRef, {
        level: newLevel,
        stats: newStats,
        updatedAt: FieldValue.serverTimestamp(),
      });

      // WRITE: user lastGachaExp += 50 (마일스톤 1개 소비)
      transaction.update(userRef, {
        lastGachaExp: lastGachaExp + 50,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return {
        newLevel,
        oldStats: currentStats,
        newStats,
        statIncreases: increases,
        totalPoints,
      };
    });

    return result;
  }
);
