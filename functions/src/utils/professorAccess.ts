/**
 * 교수 과목 소유권 검증 유틸리티
 *
 * 교수가 특정 courseId에 대한 권한이 있는지 확인합니다.
 * assignedCourses 배열이 비어있으면 모든 과목 허용 (하위호환).
 */

import { getFirestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";

interface ProfessorAccessResult {
  isProfessor: boolean;
  assignedCourses: string[];
}

/**
 * 교수 권한 + 과목 소유권 검증
 * @throws HttpsError 교수가 아니거나 해당 과목 권한이 없는 경우
 */
export async function verifyProfessorAccess(
  uid: string,
  courseId?: string
): Promise<ProfessorAccessResult> {
  const db = getFirestore();
  const userDoc = await db.collection("users").doc(uid).get();

  if (!userDoc.exists || userDoc.data()?.role !== "professor") {
    throw new HttpsError(
      "permission-denied",
      "교수님만 이 기능을 사용할 수 있습니다."
    );
  }

  const assignedCourses: string[] = userDoc.data()?.assignedCourses || [];

  // courseId가 지정되고 assignedCourses가 있으면 소유권 확인
  if (courseId && assignedCourses.length > 0) {
    if (!assignedCourses.includes(courseId)) {
      throw new HttpsError(
        "permission-denied",
        `해당 과목(${courseId})에 대한 권한이 없습니다.`
      );
    }
  }

  return { isProfessor: true, assignedCourses };
}
