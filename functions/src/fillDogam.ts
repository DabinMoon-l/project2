/**
 * 도감 전체 채우기 (디버그/테스트 전용)
 * 호출자 본인 계정에 토끼 #1~#79를 전부 발견 처리
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const RABBIT_NAMES = [
  "하양이", "구름이", "눈송이", "달토끼", "봄이", "꽃님이", "별이", "달님이", "햇님이", "풀잎이",
  "이슬이", "바람이", "소리", "노을이", "새벽이", "미리내", "아라", "하늘이", "다솜이", "가온이",
  "나래", "보람이", "세찬이", "은하", "여울이", "시냇물", "도담이", "한결이", "마루", "다온이",
  "라온이", "윤슬이", "나린이", "가람이", "비올라", "찬별이", "솔이", "담이", "채운이", "푸름이",
  "고은이", "은별이", "새론이", "밝음이", "다정이", "아름이", "참이", "맑음이", "고요이", "나봄이",
  "설레", "두리", "연이", "초롱이", "반디", "어여쁜이", "다래", "모아", "하루", "누리",
  "소나기", "안개꽃", "이리", "온유", "잔디", "파랑이", "단비", "나비", "해랑이", "비비",
  "코코", "모모", "루루", "뭉치", "콩이", "보리", "밤이", "호두", "까미", "깜장이",
  "초코", "카라멜", "토피", "라떼", "모카", "바닐라", "쿠키", "머핀", "푸딩", "마카롱",
  "젤리", "캔디", "슈가", "허니", "피치", "체리", "망고", "키위", "레몬", "민트",
];

export const fillDogam = onCall(
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

    // 사용자 정보
    const userDoc = await db.collection("users").doc(userId).get();
    if (!userDoc.exists) {
      throw new HttpsError("not-found", "사용자를 찾을 수 없습니다.");
    }
    const userData = userDoc.data()!;
    const nickname = userData.nickname || "용사";

    let created = 0;

    // 배치 제한(500)이 있으므로 50개씩 나눠서 처리
    for (let batchStart = 1; batchStart <= 79; batchStart += 25) {
      const batch = db.batch();
      const batchEnd = Math.min(batchStart + 24, 79);

      for (let rabbitId = batchStart; rabbitId <= batchEnd; rabbitId++) {
        const rabbitDocId = `${courseId}_${rabbitId}`;
        const rabbitRef = db.collection("rabbits").doc(rabbitDocId);
        const holdingRef = db.collection("users").doc(userId)
          .collection("rabbitHoldings").doc(rabbitDocId);

        const rabbitName = RABBIT_NAMES[rabbitId - 1] || `토끼 #${rabbitId}`;

        // rabbit 문서 생성 (이미 있으면 discoverers에 추가)
        batch.set(rabbitRef, {
          rabbitId,
          courseId,
          name: rabbitName,
          firstDiscovererUserId: userId,
          firstDiscovererNickname: nickname,
          discovererCount: FieldValue.increment(1),
          discoverers: FieldValue.arrayUnion({
            userId,
            nickname,
            discoveryOrder: 1,
          }),
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        // holding 문서 생성
        batch.set(holdingRef, {
          rabbitId,
          courseId,
          discoveryOrder: 1,
          discoveredAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        created++;
      }

      await batch.commit();
    }

    return {
      success: true,
      message: `토끼 #1~#79 발견 완료 (${created}마리)`,
      created,
    };
  }
);
