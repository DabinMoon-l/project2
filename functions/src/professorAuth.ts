/**
 * 교수님 계정 초기화 (서버사이드 권한 검증)
 *
 * 클라이언트에서 role: 'professor'를 직접 설정하는 대신,
 * 서버에서 이메일을 검증한 후 교수님 계정을 생성합니다.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// 교수님 이메일 허용 목록
const PROFESSOR_EMAILS = ["jkim@ccn.ac.kr"];

export const initProfessorAccount = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const email = request.auth.token.email;

    if (!email || !PROFESSOR_EMAILS.includes(email)) {
      throw new HttpsError("permission-denied", "교수님 권한이 없습니다.");
    }

    const db = getFirestore();
    const userRef = db.collection("users").doc(request.auth.uid);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      await userRef.set({
        email,
        nickname: "교수님",
        role: "professor",
        onboardingCompleted: true,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    return { success: true };
  }
);
