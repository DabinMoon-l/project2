/**
 * Firestore 프리미티브 래핑 — Repository 구현체의 공통 베이스
 *
 * 모든 Firestore 직접 호출을 이 파일에 집중시켜서
 * Supabase 마이그레이션 시 교체 범위를 최소화합니다.
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
  writeBatch,
  serverTimestamp,
  increment,
  arrayUnion,
  arrayRemove,
  deleteField,
  documentId,
  Timestamp,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
  type DocumentReference,
  type CollectionReference,
  type Query,
  type QueryConstraint,
  type SetOptions,
  type UpdateData,
  type DocumentData,
  type WriteBatch,
  type FieldValue,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type {
  Unsubscribe,
  SubscribeCallback,
  ErrorCallback,
  DocConvertOptions,
  QueryFilter,
  QueryOrder,
  PageCursor,
} from '../types';

// ============================================================
// 문서 변환 (기존 lib/utils/firestore.ts 흡수)
// ============================================================

/** Firestore Timestamp → Date */
export function timestampToDate(ts: Timestamp | null | undefined): Date | undefined {
  if (!ts) return undefined;
  return ts.toDate();
}

/** DocumentSnapshot → 타입 안전 객체 */
export function docToObject<T extends Record<string, unknown>>(
  docSnap: DocumentSnapshot | QueryDocumentSnapshot,
  options: DocConvertOptions = {},
): (T & { id: string }) | null {
  if (!docSnap.exists()) return null;

  const data = docSnap.data();
  const { dateFields = ['createdAt', 'updatedAt'], defaults = {} } = options;

  const withDefaults = { ...defaults, ...data };
  const withDates = { ...withDefaults };
  for (const field of dateFields) {
    if (withDates[field] instanceof Timestamp) {
      (withDates as Record<string, unknown>)[field] = (withDates[field] as Timestamp).toDate();
    }
  }

  return { id: docSnap.id, ...withDates } as T & { id: string };
}

/** DocumentSnapshot 배열 → 객체 배열 */
export function docsToArray<T extends Record<string, unknown>>(
  docs: (DocumentSnapshot | QueryDocumentSnapshot)[],
  options: DocConvertOptions = {},
): (T & { id: string })[] {
  return docs
    .map((d) => docToObject<T>(d, options))
    .filter((item): item is T & { id: string } => item !== null);
}

// ============================================================
// 문서 레퍼런스 헬퍼
// ============================================================

/** 문서 레퍼런스 가져오기 */
export function docRef(path: string, ...segments: string[]): DocumentReference {
  return doc(db, path, ...segments);
}

/** 컬렉션 레퍼런스 가져오기 */
export function collectionRef(path: string, ...segments: string[]): CollectionReference {
  return collection(db, path, ...segments);
}

// ============================================================
// CRUD 프리미티브
// ============================================================

/** 단일 문서 읽기 */
export async function getDocument<T extends Record<string, unknown>>(
  path: string,
  id: string,
  options?: DocConvertOptions,
): Promise<(T & { id: string }) | null> {
  const docSnap = await getDoc(doc(db, path, id));
  return docToObject<T>(docSnap, options);
}

/** 단일 문서 읽기 (raw snapshot) */
export async function getDocumentRaw(path: string, id: string) {
  return getDoc(doc(db, path, id));
}

/** 문서 존재 여부 */
export async function documentExists(path: string, id: string): Promise<boolean> {
  const docSnap = await getDoc(doc(db, path, id));
  return docSnap.exists();
}

/** 문서 생성/덮어쓰기 */
export async function setDocument(
  path: string,
  id: string,
  data: Record<string, unknown>,
  options?: SetOptions,
): Promise<void> {
  await setDoc(doc(db, path, id), data, options ?? {});
}

/** 문서 부분 업데이트 */
export async function updateDocument(
  path: string,
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  await updateDoc(doc(db, path, id), data as UpdateData<DocumentData>);
}

/** 문서 삭제 */
export async function deleteDocument(path: string, id: string): Promise<void> {
  await deleteDoc(doc(db, path, id));
}

/** 컬렉션에 문서 추가 (자동 ID) */
export async function addDocument(
  path: string,
  data: Record<string, unknown>,
): Promise<string> {
  const docRef = await addDoc(collection(db, path), data);
  return docRef.id;
}

// ============================================================
// 쿼리 프리미티브
// ============================================================

/** 쿼리 필터/정렬을 QueryConstraint로 변환 */
function buildConstraints(
  filters?: QueryFilter[],
  orders?: QueryOrder[],
  limitCount?: number,
  cursor?: PageCursor,
): QueryConstraint[] {
  const constraints: QueryConstraint[] = [];

  if (filters) {
    for (const f of filters) {
      constraints.push(where(f.field, f.op, f.value));
    }
  }
  if (orders) {
    for (const o of orders) {
      constraints.push(orderBy(o.field, o.direction));
    }
  }
  if (limitCount) {
    constraints.push(limit(limitCount));
  }
  if (cursor) {
    constraints.push(startAfter(cursor));
  }
  return constraints;
}

/** 컬렉션 쿼리 실행 */
export async function queryDocuments<T extends Record<string, unknown>>(
  path: string,
  options?: {
    filters?: QueryFilter[];
    orders?: QueryOrder[];
    limitCount?: number;
    cursor?: PageCursor;
    convertOptions?: DocConvertOptions;
  },
): Promise<{ items: (T & { id: string })[]; lastDoc: QueryDocumentSnapshot | null }> {
  const constraints = buildConstraints(
    options?.filters,
    options?.orders,
    options?.limitCount,
    options?.cursor,
  );
  const q = query(collection(db, path), ...constraints);
  const snapshot = await getDocs(q);

  const items = docsToArray<T>(snapshot.docs, options?.convertOptions);
  const lastDoc = snapshot.docs.length > 0
    ? snapshot.docs[snapshot.docs.length - 1]
    : null;

  return { items, lastDoc };
}

// ============================================================
// 구독 프리미티브
// ============================================================

/** 단일 문서 실시간 구독 */
export function subscribeDocument<T extends Record<string, unknown>>(
  path: string,
  id: string,
  callback: SubscribeCallback<(T & { id: string }) | null>,
  onError?: ErrorCallback,
  options?: DocConvertOptions,
): Unsubscribe {
  return onSnapshot(
    doc(db, path, id),
    (docSnap) => callback(docToObject<T>(docSnap, options)),
    onError ? (err) => onError(err as Error) : undefined,
  );
}

/** 컬렉션 쿼리 실시간 구독 */
export function subscribeQuery<T extends Record<string, unknown>>(
  path: string,
  callback: SubscribeCallback<(T & { id: string })[]>,
  options?: {
    filters?: QueryFilter[];
    orders?: QueryOrder[];
    limitCount?: number;
    convertOptions?: DocConvertOptions;
    onError?: ErrorCallback;
  },
): Unsubscribe {
  const constraints = buildConstraints(
    options?.filters,
    options?.orders,
    options?.limitCount,
  );
  const q = query(collection(db, path), ...constraints);
  return onSnapshot(
    q,
    (snapshot) => callback(docsToArray<T>(snapshot.docs, options?.convertOptions)),
    options?.onError ? (err) => options.onError!(err as Error) : undefined,
  );
}

// ============================================================
// 배치 쓰기
// ============================================================

/** 배치 인스턴스 생성 */
export function createBatch(): WriteBatch {
  return writeBatch(db);
}

// ============================================================
// 필드 값 헬퍼 (serverTimestamp, increment 등)
// ============================================================

export {
  serverTimestamp,
  increment,
  arrayUnion,
  arrayRemove,
  deleteField,
  documentId,
  Timestamp,
  // 타입 re-export (소비자가 필요한 경우)
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
  type DocumentReference,
  type CollectionReference,
  type Query,
  type QueryConstraint,
  type WriteBatch,
  type FieldValue,
  type DocumentData,
  type SetOptions,
  type UpdateData,
};

// Raw Firestore 접근 (점진적 마이그레이션 — 복잡한 쿼리용)
export {
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
  writeBatch,
} from 'firebase/firestore';

export { db } from '@/lib/firebase';
