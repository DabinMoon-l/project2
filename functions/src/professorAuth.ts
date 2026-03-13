/**
 * 교수님 계정 초기화 (서버사이드 권한 검증)
 *
 * 클라이언트에서 role: 'professor'를 직접 설정하는 대신,
 * 서버에서 이메일을 검증한 후 교수님 계정을 생성합니다.
 *
 * 교수 허용 목록: Firestore `allowedProfessors/{email}` 컬렉션
 * → 하드코딩 제거, DB 기반 다중 교수 지원
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

export const initProfessorAccount = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const email = request.auth.token.email;
    if (!email) {
      throw new HttpsError("permission-denied", "이메일 정보가 없습니다.");
    }

    const db = getFirestore();

    // DB에서 교수 허용 목록 조회 (하드코딩 제거)
    const allowedDoc = await db
      .collection("allowedProfessors")
      .doc(email)
      .get();

    if (!allowedDoc.exists) {
      throw new HttpsError("permission-denied", "교수님 권한이 없습니다.");
    }

    const allowedData = allowedDoc.data()!;
    const assignedCourses: string[] = allowedData.courses || [];

    const userRef = db.collection("users").doc(request.auth.uid);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      // 신규 교수 계정 생성
      await userRef.set({
        email,
        nickname: allowedData.nickname || "교수님",
        role: "professor",
        assignedCourses,
        onboardingCompleted: true,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else if (userDoc.data()?.role === "professor") {
      // 기존 교수 — 과목 목록 동기화 (allowedProfessors에서 변경 시 반영)
      await userRef.update({
        assignedCourses,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    return { success: true, courses: assignedCourses };
  }
);
