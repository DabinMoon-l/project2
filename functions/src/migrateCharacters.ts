/**
 * 마이그레이션: characterDiscoveries → rabbits 시스템
 *
 * 기존 characterDiscoveries 컬렉션의 데이터를 새 rabbits 시스템으로 변환.
 * - discoverer → 첫 집사 (butlerHistory[0])
 * - currentCharacterIndex → equippedRabbitId
 * - rabbitHoldings 서브컬렉션 생성
 *
 * 교수 전용 callable. 한 번만 실행.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

export const migrateCharactersToRabbits = onCall(
  { region: "asia-northeast3", timeoutSeconds: 540 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const db = getFirestore();

    // 교수 권한 확인
    const userDoc = await db.collection("users").doc(request.auth.uid).get();
    if (!userDoc.exists || userDoc.data()?.role !== "professor") {
      throw new HttpsError("permission-denied", "교수님만 마이그레이션 가능합니다.");
    }

    const { courseId } = request.data as { courseId: string };
    if (!courseId) {
      throw new HttpsError("invalid-argument", "courseId가 필요합니다.");
    }

    // 기존 characterDiscoveries 조회
    const discoveriesSnapshot = await db
      .collection("characterDiscoveries")
      .where("courseId", "==", courseId)
      .get();

    if (discoveriesSnapshot.empty) {
      return { success: true, message: "마이그레이션할 데이터가 없습니다.", count: 0 };
    }

    let migratedCount = 0;
    const batch = db.batch();

    for (const doc of discoveriesSnapshot.docs) {
      const data = doc.data();
      const rabbitId = data.characterIndex;
      const rabbitDocId = `${courseId}_${rabbitId}`;

      // rabbits 문서 생성
      const rabbitRef = db.collection("rabbits").doc(rabbitDocId);
      batch.set(rabbitRef, {
        courseId,
        rabbitId,
        currentButlerUserId: data.discoveredBy,
        currentName: data.characterName,
        nextGenerationCounter: 2,
        holderCount: 1,
        butlerHistory: [{
          userId: data.discoveredBy,
          userName: data.discovererNickname,
          name: data.characterName,
          startAt: data.discoveredAt || FieldValue.serverTimestamp(),
          endAt: null,
        }],
        createdAt: data.discoveredAt || FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      // discoverer의 rabbitHoldings 서브컬렉션 생성
      const holdingRef = db
        .collection("users")
        .doc(data.discoveredBy)
        .collection("rabbitHoldings")
        .doc(rabbitDocId);

      batch.set(holdingRef, {
        rabbitId,
        courseId,
        generationIndex: 1,
        isButler: true,
        acquiredAt: data.discoveredAt || FieldValue.serverTimestamp(),
      }, { merge: true });

      // discoverer의 ownedRabbitKeys에 추가
      const discovererRef = db.collection("users").doc(data.discoveredBy);
      batch.update(discovererRef, {
        ownedRabbitKeys: FieldValue.arrayUnion(rabbitDocId),
        updatedAt: FieldValue.serverTimestamp(),
      });

      migratedCount++;
    }

    // currentCharacterIndex → equippedRabbitId 매핑
    // 모든 사용자의 currentCharacterIndex를 확인
    const usersSnapshot = await db.collection("users")
      .where("courseId", "==", courseId)
      .get();

    for (const userDoc of usersSnapshot.docs) {
      const userData = userDoc.data();
      if (userData.currentCharacterIndex !== undefined && userData.currentCharacterIndex !== null) {
        batch.update(userDoc.ref, {
          equippedRabbitId: userData.currentCharacterIndex,
          equippedRabbitCourseId: courseId,
        });
      }
    }

    await batch.commit();

    return {
      success: true,
      message: `${migratedCount}개 캐릭터를 토끼 시스템으로 마이그레이션했습니다.`,
      count: migratedCount,
    };
  }
);
