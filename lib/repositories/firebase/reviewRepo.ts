/**
 * Review Repository — Firestore 구현체
 *
 * reviews, customFolders 컬렉션 접근을 추상화
 */

import {
  doc,
  collection,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  serverTimestamp,
  increment,
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
// 리뷰 CRUD
// ============================================================

/** 리뷰 추가 */
export async function addReview(data: Record<string, unknown>): Promise<string> {
  const ref = await addDoc(collection(db, 'reviews'), {
    ...data,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

/** 리뷰 업데이트 */
export async function updateReview(reviewId: string, data: Record<string, unknown>): Promise<void> {
  await updateDoc(doc(db, 'reviews', reviewId), data as Partial<DocumentData>);
}

/** 리뷰 삭제 */
export async function deleteReview(reviewId: string): Promise<void> {
  await deleteDoc(doc(db, 'reviews', reviewId));
}

/** 리뷰 배치 추가 (오답 자동 생성용) */
export async function batchAddReviews(reviews: Record<string, unknown>[]): Promise<void> {
  const batch = writeBatch(db);
  for (const review of reviews) {
    const ref = doc(collection(db, 'reviews'));
    batch.set(ref, { ...review, createdAt: serverTimestamp() });
  }
  await batch.commit();
}

// ============================================================
// 커스텀 폴더
// ============================================================

/** 폴더 추가 */
export async function addFolder(data: Record<string, unknown>): Promise<string> {
  const ref = await addDoc(collection(db, 'customFolders'), {
    ...data,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

/** 폴더 업데이트 */
export async function updateFolder(folderId: string, data: Record<string, unknown>): Promise<void> {
  await updateDoc(doc(db, 'customFolders', folderId), data as Partial<DocumentData>);
}

/** 폴더 삭제 */
export async function deleteFolder(folderId: string): Promise<void> {
  await deleteDoc(doc(db, 'customFolders', folderId));
}
