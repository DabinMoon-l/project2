/**
 * 토끼 시스템 마이그레이션 (집사/승계 → 발견/장착)
 *
 * 1회성 실행 함수. 교수님 전용.
 *
 * rabbits 컬렉션:
 *   currentName → name
 *   currentButlerUserId → firstDiscovererUserId
 *   butlerHistory[0].userName → firstDiscovererName
 *   holderCount → discovererCount
 *   삭제: nextGenerationCounter, butlerHistory
 *
 * rabbitHoldings:
 *   generationIndex → discoveryOrder
 *   acquiredAt → discoveredAt
 *   삭제: isButler
 *
 * users:
 *   equippedRabbitId + equippedRabbitCourseId → equippedRabbits 배열
 *   삭제: ownedRabbitKeys, equippedRabbitId, equippedRabbitCourseId
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

export const migrateRabbitSystem = onCall(
  { region: "asia-northeast3", timeoutSeconds: 540 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const db = getFirestore();

    // 교수님 권한 확인
    const userDoc = await db.collection("users").doc(request.auth.uid).get();
    if (!userDoc.exists || userDoc.data()?.role !== "professor") {
      throw new HttpsError("permission-denied", "교수님만 마이그레이션이 가능합니다.");
    }

    const stats = {
      rabbitsUpdated: 0,
      holdingsUpdated: 0,
      usersUpdated: 0,
    };

    // 1. rabbits 컬렉션 마이그레이션
    const rabbitsSnapshot = await db.collection("rabbits").get();

    for (const rabbitDoc of rabbitsSnapshot.docs) {
      const data = rabbitDoc.data();

      // 이미 마이그레이션된 경우 건너뛰기
      if (data.firstDiscovererUserId !== undefined) continue;

      const firstButler = data.butlerHistory?.[0];

      await rabbitDoc.ref.update({
        // 새 필드
        name: data.currentName || null,
        firstDiscovererUserId: data.currentButlerUserId || firstButler?.userId || "",
        firstDiscovererName: firstButler?.userName || "알 수 없음",
        discovererCount: data.holderCount || 1,

        // 레거시 필드 삭제
        currentName: FieldValue.delete(),
        currentButlerUserId: FieldValue.delete(),
        nextGenerationCounter: FieldValue.delete(),
        butlerHistory: FieldValue.delete(),
        holderCount: FieldValue.delete(),

        updatedAt: FieldValue.serverTimestamp(),
      });

      stats.rabbitsUpdated++;
    }

    // 2. users 컬렉션 마이그레이션 + rabbitHoldings 서브컬렉션
    const usersSnapshot = await db.collection("users").get();

    for (const userDocSnap of usersSnapshot.docs) {
      const userData = userDocSnap.data();

      // equippedRabbits 배열 구성
      const equippedRabbits: Array<{ rabbitId: number; courseId: string }> = [];

      if (
        userData.equippedRabbitId !== undefined &&
        userData.equippedRabbitId !== null &&
        userData.equippedRabbitCourseId
      ) {
        equippedRabbits.push({
          rabbitId: userData.equippedRabbitId,
          courseId: userData.equippedRabbitCourseId,
        });
      }

      // 이미 마이그레이션된 경우 건너뛰기
      if (userData.equippedRabbits !== undefined) continue;

      await userDocSnap.ref.update({
        equippedRabbits,

        // 레거시 필드 삭제
        equippedRabbitId: FieldValue.delete(),
        equippedRabbitCourseId: FieldValue.delete(),
        ownedRabbitKeys: FieldValue.delete(),

        updatedAt: FieldValue.serverTimestamp(),
      });

      stats.usersUpdated++;

      // rabbitHoldings 서브컬렉션 마이그레이션
      const holdingsSnapshot = await userDocSnap.ref.collection("rabbitHoldings").get();

      for (const holdingDoc of holdingsSnapshot.docs) {
        const holdingData = holdingDoc.data();

        // 이미 마이그레이션된 경우 건너뛰기
        if (holdingData.discoveryOrder !== undefined) continue;

        await holdingDoc.ref.update({
          // 새 필드
          discoveryOrder: holdingData.generationIndex || 1,
          discoveredAt: holdingData.acquiredAt || FieldValue.serverTimestamp(),

          // 레거시 필드 삭제
          generationIndex: FieldValue.delete(),
          isButler: FieldValue.delete(),
          acquiredAt: FieldValue.delete(),
        });

        stats.holdingsUpdated++;
      }
    }

    console.log("토끼 시스템 마이그레이션 완료:", stats);

    return {
      success: true,
      message: `마이그레이션 완료: rabbits ${stats.rabbitsUpdated}개, users ${stats.usersUpdated}명, holdings ${stats.holdingsUpdated}개`,
      stats,
    };
  }
);
