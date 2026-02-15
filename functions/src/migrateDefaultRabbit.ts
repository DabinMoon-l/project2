/**
 * 기존 유저에게 기본 토끼(rabbitId: 0) 일괄 지급
 *
 * 1회성 실행. 교수님 전용.
 * onboardingCompleted가 true인 학생 중 기본 토끼가 없는 유저에게 지급.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

export const migrateDefaultRabbit = onCall(
  { region: "asia-northeast3", timeoutSeconds: 540 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const db = getFirestore();

    // 교수님 권한 확인
    const callerDoc = await db.collection("users").doc(request.auth.uid).get();
    if (!callerDoc.exists || callerDoc.data()?.role !== "professor") {
      throw new HttpsError("permission-denied", "교수님만 실행 가능합니다.");
    }

    const usersSnapshot = await db
      .collection("users")
      .where("onboardingCompleted", "==", true)
      .where("role", "==", "student")
      .get();

    let grantedCount = 0;
    let skippedCount = 0;

    for (const userDoc of usersSnapshot.docs) {
      const userData = userDoc.data();
      const uid = userDoc.id;
      const courseId = userData.courseId;

      if (!courseId) {
        skippedCount++;
        continue;
      }

      const rabbitId = 0;
      const holdingKey = `${courseId}_${rabbitId}`;

      // 이미 기본 토끼 보유 중이면 건너뛰기
      const holdingDoc = await db
        .collection("users")
        .doc(uid)
        .collection("rabbitHoldings")
        .doc(holdingKey)
        .get();

      if (holdingDoc.exists) {
        skippedCount++;
        continue;
      }

      const batch = db.batch();

      // rabbitHoldings 생성
      batch.set(holdingDoc.ref, {
        rabbitId,
        courseId,
        discoveryOrder: 1,
        discoveredAt: FieldValue.serverTimestamp(),
      });

      // rabbits 문서 생성/업데이트
      const rabbitRef = db.collection("rabbits").doc(holdingKey);
      const rabbitDoc = await rabbitRef.get();

      if (!rabbitDoc.exists) {
        batch.set(rabbitRef, {
          rabbitId,
          courseId,
          name: null,
          firstDiscovererUserId: uid,
          firstDiscovererName: userData.nickname || "알 수 없음",
          discovererCount: 1,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        batch.update(rabbitRef, {
          discovererCount: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      // equippedRabbits에 기본 토끼 추가 (기존 장착 유지)
      const currentEquipped = userData.equippedRabbits || [];
      const alreadyEquipped = currentEquipped.some(
        (e: { rabbitId: number; courseId: string }) =>
          e.rabbitId === rabbitId && e.courseId === courseId
      );

      if (!alreadyEquipped && currentEquipped.length < 2) {
        batch.update(userDoc.ref, {
          equippedRabbits: [...currentEquipped, { rabbitId, courseId }],
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      await batch.commit();
      grantedCount++;
    }

    console.log(`기본 토끼 일괄 지급 완료: ${grantedCount}명 지급, ${skippedCount}명 건너뜀`);

    return {
      success: true,
      message: `${grantedCount}명에게 기본 토끼 지급 완료 (${skippedCount}명 건너뜀)`,
      grantedCount,
      skippedCount,
    };
  }
);
