/**
 * 토끼 80~99 정리 (1회성 디버그)
 * 호출자 본인 계정에서 rabbitId 80~99의 holding + rabbit 문서 삭제
 * equippedRabbits에 80 이상이 있으면 제거
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

export const cleanupExtraRabbits = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const userId = request.auth.uid;
    const { courseId } = request.data as { courseId: string };

    if (!courseId) {
      throw new HttpsError("invalid-argument", "courseId가 필요합니다.");
    }

    const db = getFirestore();

    // 사용자 문서 읽기 (equippedRabbits 정리용)
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      throw new HttpsError("not-found", "사용자를 찾을 수 없습니다.");
    }

    const userData = userDoc.data()!;
    const equippedRabbits: Array<{ rabbitId: number; courseId: string }> =
      userData.equippedRabbits || [];

    let deletedHoldings = 0;
    let deletedRabbits = 0;

    // 배치로 80~99 삭제 (20개이므로 1배치로 충분)
    const batch = db.batch();

    for (let rabbitId = 80; rabbitId <= 99; rabbitId++) {
      const rabbitDocId = `${courseId}_${rabbitId}`;

      // holding 삭제
      const holdingRef = userRef.collection("rabbitHoldings").doc(rabbitDocId);
      const holdingDoc = await holdingRef.get();
      if (holdingDoc.exists) {
        batch.delete(holdingRef);
        deletedHoldings++;
      }

      // rabbit 문서 삭제
      const rabbitRef = db.collection("rabbits").doc(rabbitDocId);
      const rabbitDoc = await rabbitRef.get();
      if (rabbitDoc.exists) {
        batch.delete(rabbitRef);
        deletedRabbits++;
      }
    }

    // equippedRabbits에서 80 이상 제거
    const cleanedEquipped = equippedRabbits.filter((e) => e.rabbitId < 80);
    if (cleanedEquipped.length !== equippedRabbits.length) {
      batch.update(userRef, {
        equippedRabbits: cleanedEquipped,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    await batch.commit();

    return {
      success: true,
      message: `토끼 #80~#99 정리 완료`,
      deletedHoldings,
      deletedRabbits,
      equippedCleaned: equippedRabbits.length - cleanedEquipped.length,
    };
  }
);
