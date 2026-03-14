/**
 * User Repository — Firestore 구현체
 *
 * users/{uid} 컬렉션 접근을 추상화
 */

import {
  docRef,
  getDocument,
  getDocumentRaw,
  updateDocument,
  subscribeDocument,
  serverTimestamp,
  Timestamp,
  doc,
  onSnapshot,
  getDoc,
  db,
} from './firestoreBase';
import type { Unsubscribe, SubscribeCallback, ErrorCallback } from '../types';

// ============================================================
// 프로필 구독 (UserContext용)
// ============================================================

/** 사용자 프로필 실시간 구독 (raw data 전달 — 변환은 소비자가 담당) */
export function subscribeProfile(
  uid: string,
  callback: (data: Record<string, unknown> | null, id: string) => void,
  onError?: ErrorCallback,
): Unsubscribe {
  const ref = doc(db, 'users', uid);
  return onSnapshot(
    ref,
    (docSnap) => {
      if (docSnap.exists()) {
        callback(docSnap.data() as Record<string, unknown>, docSnap.id);
      } else {
        callback(null, uid);
      }
    },
    onError ? (err) => onError(err as Error) : undefined,
  );
}

// ============================================================
// 프로필 CRUD
// ============================================================

/** 프로필 업데이트 */
export async function updateProfile(
  uid: string,
  data: Record<string, unknown>,
): Promise<void> {
  await updateDocument('users', uid, {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

/** 닉네임 변경 */
export async function updateNickname(uid: string, nickname: string): Promise<void> {
  await updateDocument('users', uid, {
    nickname,
    lastNicknameChangeAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/** 닉네임 조회 */
export async function getNickname(uid: string): Promise<string> {
  try {
    const docSnap = await getDoc(doc(db, 'users', uid));
    if (docSnap.exists()) {
      return (docSnap.data().nickname as string) || '용사';
    }
    return '용사';
  } catch {
    return '용사';
  }
}

/** 역할 조회 */
export async function getRole(uid: string): Promise<'student' | 'professor' | null> {
  try {
    const docSnap = await getDoc(doc(db, 'users', uid));
    if (docSnap.exists()) {
      return (docSnap.data().role as string as 'student' | 'professor') || 'student';
    }
    return null;
  } catch {
    return null;
  }
}

/** 문서 존재 확인 */
export async function profileExists(uid: string): Promise<boolean> {
  const docSnap = await getDoc(doc(db, 'users', uid));
  return docSnap.exists();
}

/** 활동 시간 업데이트 */
export async function updateActivity(
  uid: string,
  currentActivity: string,
): Promise<void> {
  await updateDocument('users', uid, {
    lastActiveAt: serverTimestamp(),
    currentActivity,
  });
}
