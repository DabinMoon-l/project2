/**
 * Review Repository — Firestore 구현체
 *
 * reviews, customFolders, deletedReviewItems 컬렉션 접근을 추상화.
 * 페이지네이션 커서는 opaque 타입(ReviewPageCursor)으로 노출 — 내부에 Firestore QueryDocumentSnapshot 보관.
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
  startAfter,
  serverTimestamp,
  increment,
  writeBatch,
  db,
  type QueryDocumentSnapshot,
  type QueryConstraint,
  type DocumentData,
} from './firestoreBase';
import type { Unsubscribe, ErrorCallback } from '../types';

// ============================================================
// 공통 타입
// ============================================================

/** 리뷰 raw 문서 (id + 원본 data) */
export interface ReviewDoc {
  id: string;
  [key: string]: unknown;
}

/** 페이지 커서 — opaque. 내부 구현은 Firestore QueryDocumentSnapshot. */
export interface ReviewPageCursor {
  readonly __firestoreCursor: QueryDocumentSnapshot<DocumentData>;
}

/** 페이지 조회 결과 */
export interface ReviewPageResult {
  items: ReviewDoc[];
  hasMore: boolean;
  nextCursor: ReviewPageCursor | null;
}

/** 페이지 조회 파라미터 */
export interface FetchReviewsPageParams {
  userId: string;
  reviewType: 'wrong' | 'bookmark' | 'solved';
  courseId?: string | null;
  pageSize: number;
  cursor?: ReviewPageCursor | null;
}

// ============================================================
// 리뷰 페이지네이션 READ
// ============================================================

/** 오답/찜/푼 문제 페이지 조회 */
export async function fetchReviewsPage(params: FetchReviewsPageParams): Promise<ReviewPageResult> {
  const { userId, reviewType, courseId, pageSize, cursor } = params;

  const constraints: QueryConstraint[] = [
    where('userId', '==', userId),
    where('reviewType', '==', reviewType),
  ];
  if (courseId) {
    constraints.push(where('courseId', '==', courseId));
  }
  constraints.push(orderBy('createdAt', 'desc'));
  if (cursor) {
    constraints.push(startAfter(cursor.__firestoreCursor));
  }
  constraints.push(limit(pageSize + 1));

  const q = query(collection(db, 'reviews'), ...constraints);
  const snapshot = await getDocs(q);
  const docs = snapshot.docs;
  const hasMore = docs.length > pageSize;
  const pageDocs = hasMore ? docs.slice(0, pageSize) : docs;

  const items: ReviewDoc[] = pageDocs.map((d) => ({ id: d.id, ...d.data() }));
  const lastDoc = pageDocs.length > 0 ? pageDocs[pageDocs.length - 1] : null;

  return {
    items,
    hasMore,
    nextCursor: lastDoc ? { __firestoreCursor: lastDoc } : null,
  };
}

// ============================================================
// 리뷰 단건 / 퀴즈별 READ
// ============================================================

/** 리뷰 단일 조회 */
export async function getReview(reviewId: string): Promise<ReviewDoc | null> {
  const snap = await getDoc(doc(db, 'reviews', reviewId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

/** 퀴즈별 리뷰 조회 (삭제/업데이트 용) */
export async function fetchReviewsByQuiz(
  userId: string,
  quizId: string,
  options?: {
    reviewType?: 'wrong' | 'bookmark' | 'solved';
    chapterId?: string;
    flaggedOnly?: boolean;
    questionId?: string;
  },
): Promise<ReviewDoc[]> {
  const constraints: QueryConstraint[] = [
    where('userId', '==', userId),
    where('quizId', '==', quizId),
  ];
  if (options?.reviewType) {
    constraints.push(where('reviewType', '==', options.reviewType));
  }
  if (options?.chapterId) {
    constraints.push(where('chapterId', '==', options.chapterId));
  }
  if (options?.flaggedOnly) {
    constraints.push(where('isBookmarked', '==', true));
  }
  if (options?.questionId) {
    constraints.push(where('questionId', '==', options.questionId));
  }

  const q = query(collection(db, 'reviews'), ...constraints);
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** 퀴즈 내 questionId 복수 조회 (Firestore in 쿼리 — 30개씩 배치) */
export async function fetchReviewsByQuestionIds(
  userId: string,
  quizId: string,
  questionIds: string[],
  options?: {
    reviewType?: 'wrong' | 'bookmark' | 'solved';
  },
): Promise<ReviewDoc[]> {
  if (questionIds.length === 0) return [];

  const batches: Promise<ReviewDoc[]>[] = [];
  for (let i = 0; i < questionIds.length; i += 30) {
    const batch = questionIds.slice(i, i + 30);
    const constraints: QueryConstraint[] = [
      where('userId', '==', userId),
      where('quizId', '==', quizId),
      where('questionId', 'in', batch),
    ];
    if (options?.reviewType) {
      constraints.push(where('reviewType', '==', options.reviewType));
    }
    const q = query(collection(db, 'reviews'), ...constraints);
    batches.push(getDocs(q).then((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
  }
  const results = await Promise.all(batches);
  return results.flat();
}

/** 유저 전체 리뷰 조회 (reviewType / courseId 필터) */
export async function fetchReviewsByUser(
  userId: string,
  options?: {
    reviewType?: 'wrong' | 'bookmark' | 'solved';
    courseId?: string | null;
  },
): Promise<ReviewDoc[]> {
  const constraints: QueryConstraint[] = [where('userId', '==', userId)];
  if (options?.reviewType) {
    constraints.push(where('reviewType', '==', options.reviewType));
  }
  if (options?.courseId) {
    constraints.push(where('courseId', '==', options.courseId));
  }
  const q = query(collection(db, 'reviews'), ...constraints);
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** 복습 횟수 +1 + lastReviewedAt 갱신 */
export async function incrementReviewCount(reviewId: string): Promise<void> {
  await updateDoc(doc(db, 'reviews', reviewId), {
    reviewCount: increment(1),
    lastReviewedAt: serverTimestamp(),
  });
}

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

/** 리뷰 배치 추가 */
export async function batchAddReviews(reviews: Record<string, unknown>[]): Promise<void> {
  for (let i = 0; i < reviews.length; i += 500) {
    const batch = writeBatch(db);
    for (const review of reviews.slice(i, i + 500)) {
      const ref = doc(collection(db, 'reviews'));
      batch.set(ref, { ...review, createdAt: serverTimestamp() });
    }
    await batch.commit();
  }
}

/** 리뷰 배치 삭제 (id 리스트) */
export async function batchDeleteReviews(reviewIds: string[]): Promise<void> {
  for (let i = 0; i < reviewIds.length; i += 500) {
    const batch = writeBatch(db);
    for (const id of reviewIds.slice(i, i + 500)) {
      batch.delete(doc(db, 'reviews', id));
    }
    await batch.commit();
  }
}

/** 리뷰 배치 업데이트 — 동일 필드 값으로 일괄 업데이트 */
export async function batchUpdateReviews(
  reviewIds: string[],
  data: Record<string, unknown>,
): Promise<void> {
  for (let i = 0; i < reviewIds.length; i += 500) {
    const batch = writeBatch(db);
    for (const id of reviewIds.slice(i, i + 500)) {
      batch.update(doc(db, 'reviews', id), data as Partial<DocumentData>);
    }
    await batch.commit();
  }
}

// ============================================================
// 커스텀 폴더
// ============================================================

/** 폴더 실시간 구독 */
export function subscribeCustomFolders(
  userId: string,
  courseId: string | null | undefined,
  callback: (folders: ReviewDoc[]) => void,
  onError?: ErrorCallback,
): Unsubscribe {
  const constraints: QueryConstraint[] = [where('userId', '==', userId)];
  if (courseId) {
    constraints.push(where('courseId', '==', courseId));
  }
  const q = query(collection(db, 'customFolders'), ...constraints);
  return onSnapshot(
    q,
    (snapshot) => {
      const folders: ReviewDoc[] = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      callback(folders);
    },
    onError ? (err) => onError(err as Error) : undefined,
  );
}

/** 폴더 단건 조회 */
export async function getFolder(folderId: string): Promise<ReviewDoc | null> {
  const snap = await getDoc(doc(db, 'customFolders', folderId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

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

// ============================================================
// 휴지통 (deletedReviewItems)
//
// Phase 2에서 Supabase 이관 제외 — Firebase 전용으로 남김.
// 휴지통은 삭제 스냅샷의 일시 저장소라 전환 가치가 낮다.
// ============================================================

/** 휴지통 목록 조회 (courseId 필터 지원) */
export async function fetchDeletedItems(
  userId: string,
  courseId?: string | null,
): Promise<ReviewDoc[]> {
  const constraints: QueryConstraint[] = [where('userId', '==', userId)];
  if (courseId) {
    constraints.push(where('courseId', '==', courseId));
  }
  constraints.push(orderBy('deletedAt', 'desc'));
  const q = query(collection(db, 'deletedReviewItems'), ...constraints);
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** 휴지통 항목 단건 조회 */
export async function getDeletedItem(deletedItemId: string): Promise<ReviewDoc | null> {
  const snap = await getDoc(doc(db, 'deletedReviewItems', deletedItemId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

/** 휴지통 항목 추가 */
export async function addDeletedItem(data: Record<string, unknown>): Promise<string> {
  const ref = await addDoc(collection(db, 'deletedReviewItems'), {
    ...data,
    deletedAt: serverTimestamp(),
  });
  return ref.id;
}

/** 휴지통 항목 영구 삭제 */
export async function deleteDeletedItem(deletedItemId: string): Promise<void> {
  await deleteDoc(doc(db, 'deletedReviewItems', deletedItemId));
}
