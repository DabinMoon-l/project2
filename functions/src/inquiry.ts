/**
 * 비로그인 문의 제출 Cloud Function
 *
 * 비밀번호 찾기 페이지에서 비로그인 상태 학생이
 * 교수님에게 문의를 보낼 수 있도록 하는 CF.
 * rate limit (학번 기반, 1분 1건) 적용.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

export const submitInquiry = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    const { studentId, message } = request.data as {
      studentId: string;
      message: string;
    };

    // 학번 검증 (7~10자리 숫자)
    if (!studentId || !/^\d{7,10}$/.test(studentId)) {
      throw new HttpsError("invalid-argument", "학번은 7-10자리 숫자여야 합니다.");
    }

    // 메시지 검증 (1~500자)
    const trimmed = (message || "").trim();
    if (!trimmed || trimmed.length > 500) {
      throw new HttpsError("invalid-argument", "문의 내용은 1~500자여야 합니다.");
    }

    const db = getFirestore();

    // rate limit: 학번 기반 1분 1건
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
    const recentSnapshot = await db.collection("inquiries")
      .where("studentId", "==", studentId)
      .where("createdAt", ">=", oneMinuteAgo)
      .limit(1)
      .get();

    if (!recentSnapshot.empty) {
      throw new HttpsError("resource-exhausted", "1분에 1건만 문의할 수 있습니다.");
    }

    // inquiries 컬렉션에 저장
    await db.collection("inquiries").add({
      studentId,
      message: trimmed,
      type: "password_reset",
      createdAt: FieldValue.serverTimestamp(),
      isRead: false,
    });

    return { success: true };
  }
);
