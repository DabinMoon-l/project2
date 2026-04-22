/**
 * User Repository — Firestore 구현체
 *
 * users/{uid} 컬렉션 접근을 추상화
 */

import {
  updateDocument,
  subscribeDocument,
  serverTimestamp,
  Timestamp,
  arrayUnion,
  arrayRemove,
  doc,
  collection,
  query,
  where,
  onSnapshot,
  getDoc,
  getDocs,
  updateDoc,
  db,
} from './firestoreBase';
import type { Unsubscribe, SubscribeCallback, ErrorCallback } from '../types';

// ============================================================
// 타입
// ============================================================

/** 사용자 raw 데이터 */
export type UserDoc = Record<string, unknown> & { id: string };

/** 제작자 정보 (교수/퀴즈 관리 상세 패널용) */
export interface CreatorInfo {
  role?: string;
  name?: string;
  nickname?: string;
  classId?: string;
  studentId?: string;
}

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

/**
 * 과목 + 역할 필터로 사용자 리스트 실시간 구독
 *
 * Supabase 이관 시 Realtime 채널로 대체 가능하도록 전체 배열 콜백 시그니처 유지
 * (증분 업데이트가 필요하면 소비자가 Map 비교로 처리)
 */
export function subscribeUsersByCourse(
  courseId: string,
  callback: (users: UserDoc[]) => void,
  options?: { role?: 'student' | 'professor' },
  onError?: ErrorCallback,
): Unsubscribe {
  const constraints = [where('courseId', '==', courseId)];
  if (options?.role) constraints.push(where('role', '==', options.role));
  const q = query(collection(db, 'users'), ...constraints);
  return onSnapshot(
    q,
    (snapshot) => {
      const users: UserDoc[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Record<string, unknown>),
      }));
      callback(users);
    },
    onError ? (err) => onError(err as Error) : undefined,
  );
}

// ============================================================
// 프로필 읽기
// ============================================================

/** 프로필 전체 raw 조회 (없으면 null) */
export async function getProfile(
  uid: string,
): Promise<Record<string, unknown> | null> {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    return snap.exists() ? (snap.data() as Record<string, unknown>) : null;
  } catch {
    return null;
  }
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

/** 게시글/댓글 작성 시 필요한 닉네임 + 반 정보 */
export async function getNicknameAndClassId(
  uid: string,
): Promise<{ nickname: string; classId: 'A' | 'B' | 'C' | 'D' | null }> {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return { nickname: '용사', classId: null };
    const data = snap.data();
    return {
      nickname: (data.nickname as string) || '용사',
      classId: (data.classId as 'A' | 'B' | 'C' | 'D') || null,
    };
  } catch {
    return { nickname: '용사', classId: null };
  }
}

/** 실명 조회 (교수 전용 UI) */
export async function getName(uid: string): Promise<string | null> {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    return snap.exists() ? ((snap.data().name as string) || null) : null;
  } catch {
    return null;
  }
}

/** 학번 조회 */
export async function getStudentId(uid: string): Promise<string | null> {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    return snap.exists() ? ((snap.data().studentId as string) || null) : null;
  } catch {
    return null;
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

/** 제작자 상세 정보 (role/name/nickname/classId) */
export async function getCreatorInfo(uid: string): Promise<CreatorInfo | null> {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      role: (data.role as string) || 'student',
      name: (data.name as string) || undefined,
      nickname: (data.nickname as string) || undefined,
      classId: (data.classId as string) || undefined,
      studentId: (data.studentId as string) || undefined,
    };
  } catch {
    return null;
  }
}

/** 앱 설정(notifications/display/privacy) 조회 */
export async function getAppSettings(
  uid: string,
): Promise<Record<string, unknown> | null> {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return null;
    const data = snap.data();
    return (data.appSettings as Record<string, unknown>) || null;
  } catch {
    return null;
  }
}

/** 문서 존재 확인 */
export async function profileExists(uid: string): Promise<boolean> {
  const docSnap = await getDoc(doc(db, 'users', uid));
  return docSnap.exists();
}

// ============================================================
// 복수 사용자 조회
// ============================================================

/** 과목별 사용자 전체 조회 (역할 필터 선택) */
export async function fetchUsersByCourse(
  courseId: string,
  options?: { role?: 'student' | 'professor' },
): Promise<UserDoc[]> {
  const constraints = [where('courseId', '==', courseId)];
  if (options?.role) constraints.push(where('role', '==', options.role));
  const snap = await getDocs(query(collection(db, 'users'), ...constraints));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
}

/**
 * 여러 uid 를 한 번에 조회 (권한 없음 에러는 null 로 처리)
 * 반환: { [uid]: data | null }
 */
export async function getUsersByIds(
  uids: string[],
): Promise<Record<string, Record<string, unknown> | null>> {
  const result: Record<string, Record<string, unknown> | null> = {};
  await Promise.all(
    uids.map(async (uid) => {
      try {
        const snap = await getDoc(doc(db, 'users', uid));
        result[uid] = snap.exists() ? (snap.data() as Record<string, unknown>) : null;
      } catch {
        result[uid] = null;
      }
    }),
  );
  return result;
}

// ============================================================
// 프로필 CRUD
// ============================================================

/** 프로필 업데이트 (updatedAt 자동 세팅) */
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

/** 반 변경 */
export async function updateClassId(
  uid: string,
  classId: 'A' | 'B' | 'C' | 'D',
): Promise<void> {
  await updateDocument('users', uid, {
    classId,
    updatedAt: serverTimestamp(),
  });
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

// ============================================================
// 앱 설정
// ============================================================

/** 앱 설정 섹션(notifications/display/privacy) 부분 병합 */
export async function updateAppSettingsSection(
  uid: string,
  section: 'notifications' | 'display' | 'privacy',
  data: Record<string, unknown>,
): Promise<void> {
  await updateDoc(doc(db, 'users', uid), {
    [`appSettings.${section}`]: data,
    updatedAt: serverTimestamp(),
  });
}

/** 앱 설정 초기화 */
export async function resetAppSettings(
  uid: string,
  defaults: Record<string, unknown>,
): Promise<void> {
  await updateDocument('users', uid, {
    appSettings: defaults,
    updatedAt: serverTimestamp(),
  });
}

// ============================================================
// FCM 토큰 (알림)
// ============================================================

/** FCM 토큰 추가 (문서가 존재할 때만) */
export async function addFcmToken(uid: string, token: string): Promise<boolean> {
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return false;
  await updateDoc(ref, {
    fcmTokens: arrayUnion(token),
    updatedAt: serverTimestamp(),
  });
  return true;
}

/** FCM 토큰 제거 (문서가 존재할 때만) */
export async function removeFcmToken(uid: string, token: string): Promise<boolean> {
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return false;
  await updateDoc(ref, {
    fcmTokens: arrayRemove(token),
    updatedAt: serverTimestamp(),
  });
  return true;
}

// ============================================================
// 하위 호환 (기존 export)
// ============================================================

export { subscribeDocument, Timestamp };
