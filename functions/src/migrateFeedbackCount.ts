/**
 * feedbackCount 일괄 보정 Callable CF
 *
 * questionFeedbacks 컬렉션에서 학생별 피드백 수를 집계하여
 * users/{uid}.feedbackCount를 일괄 업데이트.
 *
 * 교수님이 1회 호출.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";

export const migrateFeedbackCount = onCall(
  { region: "asia-northeast3", timeoutSeconds: 300, memory: "512MiB" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const db = getFirestore();

    // 교수 권한 확인
    const userDoc = await db.collection("users").doc(request.auth.uid).get();
    if (!userDoc.exists || userDoc.data()?.role !== "professor") {
      throw new HttpsError("permission-denied", "교수님만 실행 가능합니다.");
    }

    // 1. 전체 questionFeedbacks에서 userId별 카운트 집계
    const fbSnap = await db.collection("questionFeedbacks").get();
    const countByUid: Record<string, number> = {};

    fbSnap.docs.forEach(d => {
      const userId = d.data().userId as string;
      if (userId) {
        countByUid[userId] = (countByUid[userId] || 0) + 1;
      }
    });

    // 2. 배치로 users 문서 업데이트
    const uids = Object.keys(countByUid);
    let updated = 0;

    for (let i = 0; i < uids.length; i += 500) {
      const batch = db.batch();
      const chunk = uids.slice(i, i + 500);

      for (const uid of chunk) {
        batch.update(db.collection("users").doc(uid), {
          feedbackCount: countByUid[uid],
        });
      }

      await batch.commit();
      updated += chunk.length;
    }

    console.log(`feedbackCount 보정 완료: ${updated}명, 총 피드백 ${fbSnap.size}건`);

    return {
      success: true,
      totalFeedbacks: fbSnap.size,
      updatedUsers: updated,
      details: countByUid,
    };
  }
);
