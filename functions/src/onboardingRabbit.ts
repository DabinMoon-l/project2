/**
 * 온보딩 완료 시 기본 토끼(rabbitId: 0) 자동 지급
 *
 * users/{uid} 문서에 onboardingCompleted가 true로 변경되면
 * 기본 토끼를 rabbitHoldings에 생성하고 equippedRabbits에 장착
 *
 * transaction 사용: discoveryOrder 중복 방지
 */

import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getBaseStats } from "./utils/rabbitStats";

export const onOnboardingComplete = onDocumentUpdated(
  {
    document: "users/{uid}",
    region: "asia-northeast3",
  },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after) return;

    // onboardingCompleted가 false→true로 변경된 경우만
    if (before.onboardingCompleted || !after.onboardingCompleted) return;

    // 이미 equippedRabbits가 있으면 중복 방지
    if (after.equippedRabbits && after.equippedRabbits.length > 0) return;

    const uid = event.params.uid;
    const courseId = after.courseId;
    if (!courseId) return;

    const db = getFirestore();
    const rabbitId = 0;
    const holdingKey = `${courseId}_${rabbitId}`;
    const nickname = after.nickname || "알 수 없음";

    const userRef = db.collection("users").doc(uid);
    const holdingRef = userRef.collection("rabbitHoldings").doc(holdingKey);
    const rabbitRef = db.collection("rabbits").doc(holdingKey);

    await db.runTransaction(async (transaction) => {
      // ALL READS FIRST (Firestore 트랜잭션 요구사항)
      const holdingDoc = await transaction.get(holdingRef);
      if (holdingDoc.exists) return; // 이미 홀딩 존재 — 중복 방지

      const rabbitDoc = await transaction.get(rabbitRef);
      const userDoc = await transaction.get(userRef);

      // ALL WRITES
      // 1. rabbitHoldings 서브컬렉션에 기본 토끼 추가
      transaction.set(holdingRef, {
        rabbitId,
        courseId,
        discoveryOrder: 1,
        discoveredAt: FieldValue.serverTimestamp(),
        level: 1,
        stats: getBaseStats(rabbitId),
      });

      // 2. rabbits 컬렉션에 기본 토끼 문서 생성/업데이트
      if (!rabbitDoc.exists) {
        transaction.set(rabbitRef, {
          rabbitId,
          courseId,
          name: null,
          firstDiscovererUserId: uid,
          firstDiscovererName: nickname,
          discovererCount: 1,
          discoverers: [{ userId: uid, nickname, discoveryOrder: 1 }],
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        // 트랜잭션 내에서 읽은 값으로 discoveryOrder 계산 (중복 방지)
        const existingData = rabbitDoc.data()!;
        const nextOrder = (existingData.discovererCount || 1) + 1;
        transaction.update(rabbitRef, {
          discovererCount: nextOrder,
          discoverers: FieldValue.arrayUnion({
            userId: uid,
            nickname,
            discoveryOrder: nextOrder,
          }),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      // 3. equippedRabbits에 기본 토끼 장착 (현재 상태 기반)
      const currentEquipped = userDoc.data()?.equippedRabbits || [];
      if (currentEquipped.length === 0) {
        transaction.update(userRef, {
          equippedRabbits: [{ rabbitId, courseId }],
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    });

    console.log(`기본 토끼 지급 완료: uid=${uid}, courseId=${courseId}`);
  }
);
