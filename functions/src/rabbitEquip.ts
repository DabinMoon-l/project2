/**
 * 토끼 장착/해제 Cloud Functions
 *
 * - equipRabbit: 도감에서 "데려오기" 시 호출
 * - unequipRabbit: 슬롯에서 토끼 해제
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

/**
 * equipRabbit — 토끼 장착 (슬롯 지정)
 *
 * 입력: courseId, rabbitId, slotIndex (0|1)
 * 검증: rabbitHoldings 존재 확인, 최대 2개
 */
export const equipRabbit = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const userId = request.auth.uid;
    const { courseId, rabbitId, slotIndex } = request.data as {
      courseId: string;
      rabbitId: number;
      slotIndex: number; // 0 또는 1
    };

    if (!courseId || rabbitId === undefined || slotIndex === undefined) {
      throw new HttpsError("invalid-argument", "courseId, rabbitId, slotIndex가 필요합니다.");
    }

    if (slotIndex !== 0 && slotIndex !== 1) {
      throw new HttpsError("invalid-argument", "slotIndex는 0 또는 1이어야 합니다.");
    }

    const db = getFirestore();
    const rabbitDocId = `${courseId}_${rabbitId}`;

    await db.runTransaction(async (transaction) => {
      // 보유 여부 확인
      const holdingRef = db
        .collection("users")
        .doc(userId)
        .collection("rabbitHoldings")
        .doc(rabbitDocId);
      const holdingDoc = await transaction.get(holdingRef);

      if (!holdingDoc.exists) {
        throw new HttpsError("not-found", "발견하지 않은 토끼입니다.");
      }

      // 현재 장착 상태 확인
      const userRef = db.collection("users").doc(userId);
      const userDoc = await transaction.get(userRef);

      if (!userDoc.exists) {
        throw new HttpsError("not-found", "사용자를 찾을 수 없습니다.");
      }

      const userData = userDoc.data()!;
      const equippedRabbits: Array<{ rabbitId: number; courseId: string }> =
        userData.equippedRabbits || [];

      // 이미 장착 중인지 확인
      const alreadyEquipped = equippedRabbits.some(
        (e) => e.rabbitId === rabbitId && e.courseId === courseId
      );
      if (alreadyEquipped) {
        throw new HttpsError("already-exists", "이미 장착 중인 토끼입니다.");
      }

      // 새 배열 구성
      const newEquipped = [...equippedRabbits];

      if (newEquipped.length <= slotIndex) {
        // 슬롯이 비어있으면 추가
        while (newEquipped.length <= slotIndex) {
          newEquipped.push({ rabbitId: -1, courseId: "" });
        }
      }
      newEquipped[slotIndex] = { rabbitId, courseId };

      // 빈 슬롯(-1) 제거하고 유효한 것만 유지
      const validEquipped = newEquipped.filter(
        (e) => e.rabbitId >= 0 && e.courseId !== ""
      );

      transaction.update(userRef, {
        equippedRabbits: validEquipped,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    return { success: true };
  }
);

/**
 * unequipRabbit — 토끼 해제 (슬롯에서 제거)
 *
 * 입력: slotIndex (0|1)
 */
export const unequipRabbit = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const userId = request.auth.uid;
    const { slotIndex } = request.data as { slotIndex: number };

    if (slotIndex !== 0 && slotIndex !== 1) {
      throw new HttpsError("invalid-argument", "slotIndex는 0 또는 1이어야 합니다.");
    }

    const db = getFirestore();
    const userRef = db.collection("users").doc(userId);

    await db.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);

      if (!userDoc.exists) {
        throw new HttpsError("not-found", "사용자를 찾을 수 없습니다.");
      }

      const userData = userDoc.data()!;
      const equippedRabbits: Array<{ rabbitId: number; courseId: string }> =
        userData.equippedRabbits || [];

      if (slotIndex >= equippedRabbits.length) {
        throw new HttpsError("not-found", "해당 슬롯에 장착된 토끼가 없습니다.");
      }

      // 해당 인덱스 제거
      const newEquipped = equippedRabbits.filter((_, i) => i !== slotIndex);

      transaction.update(userRef, {
        equippedRabbits: newEquipped,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    return { success: true };
  }
);
