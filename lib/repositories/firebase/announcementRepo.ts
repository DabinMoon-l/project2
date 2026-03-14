/**
 * Announcement Repository — Firestore 구현체
 *
 * announcements 컬렉션 접근을 추상화
 */

import {
  doc,
  collection,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  db,
  type DocumentData,
} from './firestoreBase';
import type { Unsubscribe, ErrorCallback } from '../types';

/** 공지 생성 */
export async function createAnnouncement(data: Record<string, unknown>): Promise<string> {
  const ref = await addDoc(collection(db, 'announcements'), {
    ...data,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

/** 공지 업데이트 */
export async function updateAnnouncement(id: string, data: Record<string, unknown>): Promise<void> {
  await updateDoc(doc(db, 'announcements', id), data as Partial<DocumentData>);
}

/** 공지 삭제 */
export async function deleteAnnouncement(id: string): Promise<void> {
  await deleteDoc(doc(db, 'announcements', id));
}

/** 공지 실시간 구독 (과목 + 최신 N개) */
export function subscribeAnnouncements(
  courseId: string,
  limitCount: number,
  callback: (announcements: Record<string, unknown>[]) => void,
  onError?: ErrorCallback,
): Unsubscribe {
  const q = query(
    collection(db, 'announcements'),
    where('courseId', '==', courseId),
    orderBy('createdAt', 'desc'),
    limit(limitCount),
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      callback(items);
    },
    onError ? (err) => onError(err as Error) : undefined,
  );
}
