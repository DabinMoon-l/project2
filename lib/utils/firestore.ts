/**
 * Firestore 유틸리티 함수
 *
 * Firestore 문서 변환, 쿼리 헬퍼 등 공통 함수를 제공합니다.
 */

import {
  DocumentSnapshot,
  QueryDocumentSnapshot,
  Timestamp,
  doc,
  getDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

// ============================================================
// 타입 정의
// ============================================================

/**
 * Firestore 문서의 공통 타임스탬프 필드
 */
export interface TimestampFields {
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * 문서 변환 옵션
 */
export interface DocConvertOptions {
  /** 날짜 필드 이름들 */
  dateFields?: string[];
  /** 기본값 설정 */
  defaults?: Record<string, unknown>;
}

// ============================================================
// 문서 변환 함수
// ============================================================

/**
 * Firestore Timestamp를 Date로 변환
 */
export function timestampToDate(timestamp: Timestamp | null | undefined): Date | undefined {
  if (!timestamp) return undefined;
  return timestamp.toDate();
}

/**
 * Firestore 문서를 안전하게 객체로 변환
 *
 * @param docSnap - Firestore 문서 스냅샷
 * @param options - 변환 옵션
 * @returns 변환된 객체 (null이면 문서가 없음)
 *
 * @example
 * ```ts
 * const data = docToObject<Post>(docSnap, {
 *   dateFields: ['createdAt', 'updatedAt'],
 *   defaults: { likes: 0, commentCount: 0 }
 * });
 * ```
 */
export function docToObject<T extends Record<string, unknown>>(
  docSnap: DocumentSnapshot | QueryDocumentSnapshot,
  options: DocConvertOptions = {}
): (T & { id: string }) | null {
  if (!docSnap.exists()) return null;

  const data = docSnap.data();
  const { dateFields = ['createdAt', 'updatedAt'], defaults = {} } = options;

  // 기본값 적용
  const withDefaults = { ...defaults, ...data };

  // 날짜 필드 변환
  const withDates = { ...withDefaults };
  for (const field of dateFields) {
    if (withDates[field] instanceof Timestamp) {
      (withDates as Record<string, unknown>)[field] = (withDates[field] as Timestamp).toDate();
    }
  }

  return {
    id: docSnap.id,
    ...withDates,
  } as T & { id: string };
}

/**
 * Firestore 문서 배열을 객체 배열로 변환
 */
export function docsToArray<T extends Record<string, unknown>>(
  docs: (DocumentSnapshot | QueryDocumentSnapshot)[],
  options: DocConvertOptions = {}
): (T & { id: string })[] {
  return docs
    .map((doc) => docToObject<T>(doc, options))
    .filter((item): item is T & { id: string } => item !== null);
}

// ============================================================
// 사용자 정보 조회 헬퍼
// ============================================================

/**
 * 사용자 닉네임 가져오기
 *
 * @param uid - 사용자 UID
 * @returns 닉네임 (없으면 '용사')
 */
export async function getUserNickname(uid: string): Promise<string> {
  try {
    const userDocRef = doc(db, 'users', uid);
    const userDocSnap = await getDoc(userDocRef);

    if (userDocSnap.exists()) {
      return userDocSnap.data().nickname || '용사';
    }
    return '용사';
  } catch (error) {
    console.error('닉네임 조회 실패:', error);
    return '용사';
  }
}

/**
 * 사용자 역할 확인
 */
export async function getUserRole(uid: string): Promise<'student' | 'professor' | null> {
  try {
    const userDocRef = doc(db, 'users', uid);
    const userDocSnap = await getDoc(userDocRef);

    if (userDocSnap.exists()) {
      return userDocSnap.data().role || 'student';
    }
    return null;
  } catch (error) {
    console.error('역할 조회 실패:', error);
    return null;
  }
}

// ============================================================
// 쿼리 헬퍼
// ============================================================

/**
 * 페이지네이션 결과 타입
 */
export interface PaginatedResult<T> {
  items: T[];
  hasMore: boolean;
  lastDoc: QueryDocumentSnapshot | null;
}

/**
 * 문서 ID로 존재 여부 확인
 */
export async function docExists(collectionName: string, docId: string): Promise<boolean> {
  const docRef = doc(db, collectionName, docId);
  const docSnap = await getDoc(docRef);
  return docSnap.exists();
}

/**
 * 문서 작성자 확인
 */
export async function isDocAuthor(
  collectionName: string,
  docId: string,
  uid: string
): Promise<boolean> {
  const docRef = doc(db, collectionName, docId);
  const docSnap = await getDoc(docRef);

  if (!docSnap.exists()) return false;

  const data = docSnap.data();
  return data.authorId === uid || data.creatorUid === uid;
}
