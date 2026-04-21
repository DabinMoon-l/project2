/**
 * Rabbit Repository — Firestore 구현체
 *
 * users/{uid}/rabbitHoldings, rabbits/{courseId}_{rabbitId} 접근을 추상화
 */

import {
  doc,
  collection,
  onSnapshot,
  query,
  where,
  orderBy,
  db,
  docsToArray,
} from './firestoreBase';
import type { Unsubscribe, ErrorCallback } from '../types';

// ============================================================
// 토끼 보유 목록
// ============================================================

/** 토끼 보유 실시간 구독 */
export function subscribeHoldings(
  uid: string,
  callback: (holdings: Record<string, unknown>[]) => void,
  onError?: ErrorCallback,
): Unsubscribe {
  const ref = collection(db, 'users', uid, 'rabbitHoldings');
  return onSnapshot(
    ref,
    (snapshot) => {
      const holdings = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));
      callback(holdings);
    },
    onError ? (err) => onError(err as Error) : undefined,
  );
}

// ============================================================
// 토끼 도감
// ============================================================

/** 특정 토끼 문서 실시간 구독 */
export function subscribeRabbitDoc(
  courseId: string,
  rabbitId: number,
  callback: (rabbit: Record<string, unknown> | null) => void,
  onError?: ErrorCallback,
): Unsubscribe {
  const docId = `${courseId}_${rabbitId}`;
  const ref = doc(db, 'rabbits', docId);
  return onSnapshot(
    ref,
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

/** 과목별 토끼 도감 구독 */
export function subscribeRabbitsForCourse(
  courseId: string,
  callback: (rabbits: Record<string, unknown>[]) => void,
  onError?: ErrorCallback,
): Unsubscribe {
  const q = query(
    collection(db, 'rabbits'),
    where('courseId', '==', courseId),
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const rabbits = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));
      callback(rabbits);
    },
    onError ? (err) => onError(err as Error) : undefined,
  );
}
