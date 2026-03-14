/**
 * Quiz Repository — Firestore 구현체
 *
 * quizzes, quizResults, quiz_completions, quiz_agg 접근을 추상화
 */

import {
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  serverTimestamp,
  Timestamp,
  writeBatch,
  db,
  docToObject,
  docsToArray,
  type QueryDocumentSnapshot,
  type DocumentData,
} from './firestoreBase';
import type { Unsubscribe, ErrorCallback, DocConvertOptions } from '../types';

// ============================================================
// 퀴즈 CRUD
// ============================================================

/** 퀴즈 단건 조회 */
export async function getQuiz<T extends Record<string, unknown>>(
  quizId: string,
  options?: DocConvertOptions,
): Promise<(T & { id: string }) | null> {
  const docSnap = await getDoc(doc(db, 'quizzes', quizId));
  return docToObject<T>(docSnap, options);
}

/** 퀴즈 raw snapshot 조회 */
export async function getQuizRaw(quizId: string) {
  return getDoc(doc(db, 'quizzes', quizId));
}

/** 퀴즈 생성 */
export async function createQuiz(data: Record<string, unknown>): Promise<string> {
  const docRef = await addDoc(collection(db, 'quizzes'), {
    ...data,
    createdAt: serverTimestamp(),
  });
  return docRef.id;
}

/** 퀴즈 업데이트 */
export async function updateQuiz(quizId: string, data: Record<string, unknown>): Promise<void> {
  await updateDoc(doc(db, 'quizzes', quizId), {
    ...data,
    updatedAt: serverTimestamp(),
  } as Partial<DocumentData>);
}

/** 퀴즈 삭제 */
export async function deleteQuiz(quizId: string): Promise<void> {
  await deleteDoc(doc(db, 'quizzes', quizId));
}

/** 퀴즈 실시간 구독 (단건) */
export function subscribeQuiz<T extends Record<string, unknown>>(
  quizId: string,
  callback: (quiz: (T & { id: string }) | null) => void,
  onError?: ErrorCallback,
  options?: DocConvertOptions,
): Unsubscribe {
  return onSnapshot(
    doc(db, 'quizzes', quizId),
    (docSnap) => callback(docToObject<T>(docSnap, options)),
    onError ? (err) => onError(err as Error) : undefined,
  );
}

// ============================================================
// 퀴즈 결과
// ============================================================

/** 퀴즈 결과 조회 (필터) */
export async function getQuizResults<T extends Record<string, unknown>>(
  filters: { quizId?: string; userId?: string },
  options?: DocConvertOptions,
) {
  const constraints = [];
  if (filters.quizId) constraints.push(where('quizId', '==', filters.quizId));
  if (filters.userId) constraints.push(where('userId', '==', filters.userId));

  const q = query(collection(db, 'quizResults'), ...constraints);
  const snapshot = await getDocs(q);
  return docsToArray<T>(snapshot.docs, options);
}

// ============================================================
// 퀴즈 완료 여부
// ============================================================

/** 완료 여부 확인 */
export async function isQuizCompleted(quizId: string, userId: string): Promise<boolean> {
  const docSnap = await getDoc(doc(db, 'quiz_completions', `${quizId}_${userId}`));
  return docSnap.exists();
}

// ============================================================
// Jobs (AI 생성)
// ============================================================

/** Job 실시간 구독 */
export function subscribeJob(
  jobId: string,
  callback: (data: Record<string, unknown> | null) => void,
  onError?: ErrorCallback,
): Unsubscribe {
  return onSnapshot(
    doc(db, 'jobs', jobId),
    (docSnap) => {
      if (docSnap.exists()) {
        callback({ id: docSnap.id, ...docSnap.data() });
      } else {
        callback(null);
      }
    },
    onError ? (err) => onError(err as Error) : undefined,
  );
}

/** Job 문서 생성 */
export async function createJob(jobId: string, data: Record<string, unknown>): Promise<void> {
  await setDoc(doc(db, 'jobs', jobId), {
    ...data,
    createdAt: serverTimestamp(),
  });
}
