/**
 * Enrollment Repository — Firestore 구현체
 *
 * enrolledStudents/{courseId}/students 접근을 추상화
 */

import {
  collection,
  getDocs,
  query,
  db,
} from './firestoreBase';

/** 등록된 학생 목록 조회 */
export async function getEnrolledStudents(
  courseId: string,
): Promise<Record<string, unknown>[]> {
  const q = query(collection(db, 'enrolledStudents', courseId, 'students'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}
