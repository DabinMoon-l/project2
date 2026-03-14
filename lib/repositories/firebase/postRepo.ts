/**
 * Post Repository — Firestore 구현체
 *
 * posts, comments, feedbacks 컬렉션 접근을 추상화
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
  deleteField,
  writeBatch,
  db,
  docToObject,
  docsToArray,
  type QueryDocumentSnapshot,
  type DocumentData,
} from './firestoreBase';
import type { Unsubscribe, ErrorCallback, DocConvertOptions } from '../types';

// ============================================================
// 게시글
// ============================================================

/** 게시글 생성 */
export async function createPost(data: Record<string, unknown>): Promise<string> {
  const ref = await addDoc(collection(db, 'posts'), {
    ...data,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

/** 게시글 업데이트 */
export async function updatePost(postId: string, data: Record<string, unknown>): Promise<void> {
  await updateDoc(doc(db, 'posts', postId), data as Partial<DocumentData>);
}

/** 게시글 조회수 증가 */
export async function incrementPostView(postId: string): Promise<void> {
  await updateDoc(doc(db, 'posts', postId), { viewCount: increment(1) } as Partial<DocumentData>);
}

// ============================================================
// 댓글
// ============================================================

/** 댓글 생성 */
export async function createComment(data: Record<string, unknown>): Promise<string> {
  const ref = await addDoc(collection(db, 'comments'), {
    ...data,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

/** 댓글 업데이트 */
export async function updateComment(commentId: string, data: Record<string, unknown>): Promise<void> {
  await updateDoc(doc(db, 'comments', commentId), data as Partial<DocumentData>);
}

/** 댓글 삭제 */
export async function deleteComment(commentId: string): Promise<void> {
  await deleteDoc(doc(db, 'comments', commentId));
}

// ============================================================
// 피드백
// ============================================================

/** 피드백 추가 */
export async function addFeedback(data: Record<string, unknown>): Promise<string> {
  const ref = await addDoc(collection(db, 'feedbacks'), {
    ...data,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}
