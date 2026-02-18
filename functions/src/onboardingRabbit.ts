/**
 * 온보딩 완료 시 기본 토끼(rabbitId: 0) 자동 지급
 *
 * users/{uid} 문서에 onboardingCompleted가 true로 변경되면
 * 기본 토끼를 rabbitHoldings에 생성하고 equippedRabbits에 장착
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

    const batch = db.batch();

    // 1. rabbitHoldings 서브컬렉션에 기본 토끼 추가
    const holdingRef = db
      .collection("users")
      .doc(uid)
      .collection("rabbitHoldings")
      .doc(holdingKey);

    batch.set(holdingRef, {
      rabbitId,
      courseId,
      discoveryOrder: 1,
      discoveredAt: FieldValue.serverTimestamp(),
      level: 1,
      stats: getBaseStats(rabbitId),
    });

    // 2. rabbits 컬렉션에 기본 토끼 문서 생성 (없을 때만)
    const rabbitRef = db.collection("rabbits").doc(holdingKey);
    const rabbitDoc = await rabbitRef.get();

    const nickname = after.nickname || "알 수 없음";

    if (!rabbitDoc.exists) {
      batch.set(rabbitRef, {
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
      const existingData = rabbitDoc.data()!;
      const nextOrder = (existingData.discovererCount || 1) + 1;
      batch.update(rabbitRef, {
        discovererCount: FieldValue.increment(1),
        discoverers: FieldValue.arrayUnion({ userId: uid, nickname, discoveryOrder: nextOrder }),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    // 3. equippedRabbits에 기본 토끼 장착
    const userRef = db.collection("users").doc(uid);
    batch.update(userRef, {
      equippedRabbits: [{ rabbitId, courseId }],
      updatedAt: FieldValue.serverTimestamp(),
    });

    await batch.commit();

    console.log(`기본 토끼 지급 완료: uid=${uid}, courseId=${courseId}`);
  }
);
