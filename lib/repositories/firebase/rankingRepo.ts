/**
 * Ranking Repository — Firestore 구현체
 *
 * rankings/{courseId}, radarNorm/{courseId} 접근을 추상화
 */

import {
  doc,
  getDoc,
  onSnapshot,
  db,
} from './firestoreBase';
import type { Unsubscribe, ErrorCallback } from '../types';

// ============================================================
// 랭킹
// ============================================================

/** 랭킹 조회 */
export async function getRanking(courseId: string): Promise<Record<string, unknown> | null> {
  const docSnap = await getDoc(doc(db, 'rankings', courseId));
  if (!docSnap.exists()) return null;
  return { id: docSnap.id, ...docSnap.data() };
}

/** 랭킹 실시간 구독 */
export function subscribeRanking(
  courseId: string,
  callback: (data: Record<string, unknown> | null) => void,
  onError?: ErrorCallback,
): Unsubscribe {
  return onSnapshot(
    doc(db, 'rankings', courseId),
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

// ============================================================
// 레이더 정규화
// ============================================================

/** 레이더 정규화 조회 */
export async function getRadarNorm(courseId: string): Promise<Record<string, unknown> | null> {
  const docSnap = await getDoc(doc(db, 'radarNorm', courseId));
  if (!docSnap.exists()) return null;
  return { id: docSnap.id, ...docSnap.data() };
}
