/**
 * Quiz Repository — Firestore 구현체
 *
 * quizzes, quizResults, quiz_completions, feedbacks, jobs 컬렉션 접근을 추상화.
 * 실시간 구독(subscribe*) 은 onSnapshot 래핑.
 * 페이지 커서는 opaque 타입(QuizPageCursor) — 내부에 Firestore QueryDocumentSnapshot 보관.
 */

import {
  doc,
  collection,
  documentId,
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
  limit as fsLimit,
  startAfter,
  serverTimestamp,
  Timestamp,
  writeBatch,
  db,
  docToObject,
  docsToArray,
  type QueryDocumentSnapshot,
  type QueryConstraint,
  type DocumentData,
} from './firestoreBase';
import type { Unsubscribe, ErrorCallback, DocConvertOptions } from '../types';

// ============================================================
// 공통 타입
// ============================================================

export interface QuizDoc {
  id: string;
  [key: string]: unknown;
}

export interface QuizResultDoc {
  id: string;
  [key: string]: unknown;
}

export interface QuizCompletionDoc {
  id: string;
  [key: string]: unknown;
}

export interface FeedbackDoc {
  id: string;
  [key: string]: unknown;
}

export interface QuizPageCursor {
  readonly __firestoreCursor: QueryDocumentSnapshot<DocumentData>;
}

export interface QuizPageResult {
  items: QuizDoc[];
  hasMore: boolean;
  nextCursor: QuizPageCursor | null;
}

export interface QuizFeedFilters {
  courseId?: string | null;
  type?: string | null;
  typeIn?: string[] | null;
  isPublished?: boolean;
  targetClass?: string | null;
  creatorUid?: string | null;
  creatorClassType?: 'A' | 'B' | 'C' | 'D' | null;
  isPublic?: boolean;
  pastYear?: number | null;
  pastExamType?: string | null;
}

const BATCH_SIZE = 30;

// 내부 유틸: where(in) 쿼리를 30개씩 나눠 병렬 수행
async function batchFetchByIn<T extends Record<string, unknown>>(
  collectionName: string,
  field: string | ReturnType<typeof documentId>,
  ids: string[],
  extraConstraints: QueryConstraint[] = [],
  options?: DocConvertOptions,
): Promise<(T & { id: string })[]> {
  if (ids.length === 0) return [];
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    batches.push(ids.slice(i, i + BATCH_SIZE));
  }
  const constraintFactory =
    typeof field === 'string'
      ? (batch: string[]) => [where(field, 'in', batch), ...extraConstraints]
      : (batch: string[]) => [where(field, 'in', batch), ...extraConstraints];
  const results = await Promise.all(
    batches.map((batch) =>
      getDocs(query(collection(db, collectionName), ...constraintFactory(batch))),
    ),
  );
  const out: (T & { id: string })[] = [];
  for (const snap of results) {
    for (const d of docsToArray<T>(snap.docs, options)) out.push(d);
  }
  return out;
}

// ============================================================
// 퀴즈 — CRUD / 구독 (단건)
// ============================================================

/** 퀴즈 단건 조회 */
export async function getQuiz<T extends Record<string, unknown>>(
  quizId: string,
  options?: DocConvertOptions,
): Promise<(T & { id: string }) | null> {
  const docSnap = await getDoc(doc(db, 'quizzes', quizId));
  return docToObject<T>(docSnap, options);
}

/** 퀴즈 raw snapshot 조회 (호환용) */
export async function getQuizRaw(quizId: string) {
  return getDoc(doc(db, 'quizzes', quizId));
}

/** 퀴즈 생성 (auto ID) */
export async function createQuiz(data: Record<string, unknown>): Promise<string> {
  const docRef = await addDoc(collection(db, 'quizzes'), {
    ...data,
    createdAt: serverTimestamp(),
  });
  return docRef.id;
}

/**
 * ID 사전 할당 후 생성.
 * libraryJobManager 처럼 생성 전 ID 가 필요한 경우.
 * data 에 createdAt 이 없으면 serverTimestamp 를 주입하지 않으므로 호출측이 처리.
 */
export async function createQuizWithId(data: Record<string, unknown>): Promise<string> {
  const ref = doc(collection(db, 'quizzes'));
  await setDoc(ref, data);
  return ref.id;
}

/** 퀴즈 업데이트 */
export async function updateQuiz(quizId: string, data: Record<string, unknown>): Promise<void> {
  await updateDoc(doc(db, 'quizzes', quizId), {
    ...data,
    updatedAt: serverTimestamp(),
  } as Partial<DocumentData>);
}

/** 퀴즈 업데이트 (updatedAt 자동 주입 안 함) */
export async function updateQuizRaw(quizId: string, data: Record<string, unknown>): Promise<void> {
  await updateDoc(doc(db, 'quizzes', quizId), data as Partial<DocumentData>);
}

/** 퀴즈 삭제 */
export async function deleteQuiz(quizId: string): Promise<void> {
  await deleteDoc(doc(db, 'quizzes', quizId));
}

/** 퀴즈 실시간 구독 (단건) */
export function subscribeQuiz<T extends Record<string, unknown>>(
  quizId: string,
  callback: (quiz: (T & { id: string }) | null) => void,
  onError?: ErrorCallback,
  options?: DocConvertOptions,
): Unsubscribe {
  return onSnapshot(
    doc(db, 'quizzes', quizId),
    (docSnap) => callback(docToObject<T>(docSnap, options)),
    onError ? (err) => onError(err as Error) : undefined,
  );
}

// ============================================================
// 퀴즈 — 목록 조회 / 구독
// ============================================================

/**
 * 특정 creator 의 퀴즈 실시간 구독 (서재 탭 용).
 * 반환 전 클라에서 type 필터링(ai-generated + custom-private) 필요.
 */
export function subscribeQuizzesByCreator(
  creatorId: string,
  callback: (quizzes: QuizDoc[]) => void,
  onError?: ErrorCallback,
): Unsubscribe {
  const q = query(collection(db, 'quizzes'), where('creatorId', '==', creatorId));
  return onSnapshot(
    q,
    (snap) => {
      const items: QuizDoc[] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      callback(items);
    },
    onError ? (err) => onError(err as Error) : undefined,
  );
}

/**
 * 특정 교수(creatorUid) + 과목 조합의 퀴즈 실시간 구독.
 * createdAt desc 정렬.
 */
export function subscribeQuizzesForProfessor(
  creatorUid: string,
  courseId: string,
  callback: (quizzes: QuizDoc[]) => void,
  onError?: ErrorCallback,
): Unsubscribe {
  const q = query(
    collection(db, 'quizzes'),
    where('creatorUid', '==', creatorUid),
    where('courseId', '==', courseId),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(
    q,
    (snap) => {
      const items: QuizDoc[] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      callback(items);
    },
    onError ? (err) => onError(err as Error) : undefined,
  );
}

/** 과목별 퀴즈 일회성 조회 */
export async function fetchQuizzesByCourse<T extends Record<string, unknown>>(
  courseId: string,
  options?: DocConvertOptions,
): Promise<(T & { id: string })[]> {
  const q = query(collection(db, 'quizzes'), where('courseId', '==', courseId));
  const snap = await getDocs(q);
  return docsToArray<T>(snap.docs, options);
}

/** 퀴즈 ID 배치 조회 (30개씩) */
export async function fetchQuizzesByIds<T extends Record<string, unknown>>(
  quizIds: string[],
  options?: DocConvertOptions,
): Promise<(T & { id: string })[]> {
  return batchFetchByIn<T>('quizzes', documentId(), quizIds, [], options);
}

/** 특정 creator 의 퀴즈 일회성 조회. courseId/isPublic 추가 필터 지원 */
export async function fetchQuizzesByCreator<T extends Record<string, unknown>>(
  creatorId: string,
  filters?: { courseId?: string | null; isPublic?: boolean },
  options?: DocConvertOptions,
): Promise<(T & { id: string })[]> {
  const constraints: QueryConstraint[] = [where('creatorId', '==', creatorId)];
  if (filters?.courseId) constraints.push(where('courseId', '==', filters.courseId));
  if (filters?.isPublic !== undefined) constraints.push(where('isPublic', '==', filters.isPublic));
  const q = query(collection(db, 'quizzes'), ...constraints);
  const snap = await getDocs(q);
  return docsToArray<T>(snap.docs, options);
}

/**
 * 교수 퀴즈 관리 페이지 전용 조회.
 * creatorUid + type in filter + optional isPublished + createdAt desc + limit.
 * pagination cursor 는 opaque QuizPageCursor.
 */
export async function fetchQuizzesForProfessorPage(
  creatorUid: string,
  typeFilter: string[],
  pageSize: number,
  isPublished?: boolean,
  cursor?: QuizPageCursor | null,
): Promise<QuizPageResult> {
  const constraints: QueryConstraint[] = [
    where('creatorUid', '==', creatorUid),
    where('type', 'in', typeFilter),
  ];
  if (isPublished !== undefined) {
    constraints.push(where('isPublished', '==', isPublished));
  }
  constraints.push(orderBy('createdAt', 'desc'));
  if (cursor) constraints.push(startAfter(cursor.__firestoreCursor));
  constraints.push(fsLimit(pageSize));

  const q = query(collection(db, 'quizzes'), ...constraints);
  const snap = await getDocs(q);
  const docs = snap.docs;
  const items: QuizDoc[] = docs.map((d) => ({ id: d.id, ...d.data() }));
  const lastDoc = docs.length > 0 ? docs[docs.length - 1] : null;
  return {
    items,
    hasMore: docs.length === pageSize,
    nextCursor: lastDoc ? { __firestoreCursor: lastDoc } : null,
  };
}

/**
 * 필터 기반 퀴즈 페이지네이션.
 * filters 에 해당하는 where 절을 순서대로 붙이고 createdAt desc 로 정렬.
 */
export async function fetchQuizzesByFilters(
  filters: QuizFeedFilters,
  pageSize: number,
  cursor?: QuizPageCursor | null,
): Promise<QuizPageResult> {
  const constraints: QueryConstraint[] = [];
  if (filters.courseId) constraints.push(where('courseId', '==', filters.courseId));
  if (filters.type) constraints.push(where('type', '==', filters.type));
  if (filters.typeIn && filters.typeIn.length > 0) {
    constraints.push(where('type', 'in', filters.typeIn));
  }
  if (filters.isPublished !== undefined) {
    constraints.push(where('isPublished', '==', filters.isPublished));
  }
  if (filters.targetClass) constraints.push(where('targetClass', '==', filters.targetClass));
  if (filters.creatorUid) constraints.push(where('creatorUid', '==', filters.creatorUid));
  if (filters.creatorClassType) {
    constraints.push(where('creatorClassType', '==', filters.creatorClassType));
  }
  if (filters.isPublic !== undefined) constraints.push(where('isPublic', '==', filters.isPublic));
  if (filters.pastYear !== undefined && filters.pastYear !== null) {
    constraints.push(where('pastYear', '==', filters.pastYear));
  }
  if (filters.pastExamType) constraints.push(where('pastExamType', '==', filters.pastExamType));

  constraints.push(orderBy('createdAt', 'desc'));
  if (cursor) constraints.push(startAfter(cursor.__firestoreCursor));
  constraints.push(fsLimit(pageSize + 1));

  const q = query(collection(db, 'quizzes'), ...constraints);
  const snap = await getDocs(q);
  const docs = snap.docs;
  const hasMore = docs.length > pageSize;
  const pageDocs = hasMore ? docs.slice(0, pageSize) : docs;
  const items: QuizDoc[] = pageDocs.map((d) => ({ id: d.id, ...d.data() }));
  const lastDoc = pageDocs.length > 0 ? pageDocs[pageDocs.length - 1] : null;
  return {
    items,
    hasMore,
    nextCursor: lastDoc ? { __firestoreCursor: lastDoc } : null,
  };
}

// ============================================================
// 퀴즈 결과 (quizResults)
// ============================================================

/** 특정 퀴즈의 모든 결과 */
export async function fetchQuizResultsByQuiz<T extends Record<string, unknown>>(
  quizId: string,
  options?: DocConvertOptions,
): Promise<(T & { id: string })[]> {
  const q = query(collection(db, 'quizResults'), where('quizId', '==', quizId));
  const snap = await getDocs(q);
  return docsToArray<T>(snap.docs, options);
}

/** 여러 퀴즈의 결과를 배치 조회 */
export async function fetchQuizResultsByQuizzes<T extends Record<string, unknown>>(
  quizIds: string[],
  options?: DocConvertOptions,
): Promise<(T & { id: string })[]> {
  return batchFetchByIn<T>('quizResults', 'quizId', quizIds, [], options);
}

/** 특정 유저의 모든 결과. courseId 추가 필터 지원 */
export async function fetchQuizResultsByUser<T extends Record<string, unknown>>(
  userId: string,
  filters?: { courseId?: string | null },
  options?: DocConvertOptions,
): Promise<(T & { id: string })[]> {
  const constraints: QueryConstraint[] = [where('userId', '==', userId)];
  if (filters?.courseId) constraints.push(where('courseId', '==', filters.courseId));
  const q = query(collection(db, 'quizResults'), ...constraints);
  const snap = await getDocs(q);
  return docsToArray<T>(snap.docs, options);
}

/**
 * 특정 유저+퀴즈 조합의 결과.
 * 삭제된 퀴즈 폴백 등에서 1건만 필요한 경우 limit 인자 활용.
 */
export async function fetchQuizResultsByUserAndQuiz<T extends Record<string, unknown>>(
  userId: string,
  quizId: string,
  listLimit?: number,
  options?: DocConvertOptions,
): Promise<(T & { id: string })[]> {
  const constraints: QueryConstraint[] = [
    where('userId', '==', userId),
    where('quizId', '==', quizId),
  ];
  if (listLimit) constraints.push(fsLimit(listLimit));
  const q = query(collection(db, 'quizResults'), ...constraints);
  const snap = await getDocs(q);
  return docsToArray<T>(snap.docs, options);
}

/** 유저/퀴즈 필터 일회성 조회 (레거시 호환) */
export async function getQuizResults<T extends Record<string, unknown>>(
  filters: { quizId?: string; userId?: string },
  options?: DocConvertOptions,
) {
  const constraints: QueryConstraint[] = [];
  if (filters.quizId) constraints.push(where('quizId', '==', filters.quizId));
  if (filters.userId) constraints.push(where('userId', '==', filters.userId));
  const q = query(collection(db, 'quizResults'), ...constraints);
  const snap = await getDocs(q);
  return docsToArray<T>(snap.docs, options);
}

/**
 * 특정 유저의 특정 퀴즈 결과 일괄 삭제.
 * writeBatch 500개씩 커밋.
 */
export async function deleteQuizResultsByUserAndQuiz(
  userId: string,
  quizId: string,
): Promise<number> {
  const snap = await getDocs(
    query(
      collection(db, 'quizResults'),
      where('userId', '==', userId),
      where('quizId', '==', quizId),
    ),
  );
  for (let i = 0; i < snap.docs.length; i += 500) {
    const batch = writeBatch(db);
    snap.docs.slice(i, i + 500).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  return snap.docs.length;
}

/** 퀴즈 결과 저장 */
export async function addQuizResult(data: Record<string, unknown>): Promise<string> {
  const ref = await addDoc(collection(db, 'quizResults'), {
    ...data,
    createdAt: data.createdAt ?? serverTimestamp(),
  });
  return ref.id;
}

/** 퀴즈 결과 부분 업데이트 (수정 플로우에서 원본 결과 갱신) */
export async function updateQuizResult(
  resultId: string,
  data: Record<string, unknown>,
): Promise<void> {
  await updateDoc(doc(db, 'quizResults', resultId), data);
}

// ============================================================
// 퀴즈 완료 여부 (quiz_completions)
// ============================================================

/** docId 규칙: `${quizId}_${userId}` */
function completionDocId(quizId: string, userId: string): string {
  return `${quizId}_${userId}`;
}

/** 단건 조회 */
export async function getQuizCompletion<T extends Record<string, unknown>>(
  quizId: string,
  userId: string,
  options?: DocConvertOptions,
): Promise<(T & { id: string }) | null> {
  const snap = await getDoc(doc(db, 'quiz_completions', completionDocId(quizId, userId)));
  return docToObject<T>(snap, options);
}

/** 완료 여부 boolean 확인 */
export async function isQuizCompleted(quizId: string, userId: string): Promise<boolean> {
  const snap = await getDoc(doc(db, 'quiz_completions', completionDocId(quizId, userId)));
  return snap.exists();
}

/** 완료 저장 (merge 아님, 전체 overwrite) */
export async function setQuizCompletion(
  quizId: string,
  userId: string,
  data: Record<string, unknown>,
): Promise<void> {
  await setDoc(doc(db, 'quiz_completions', completionDocId(quizId, userId)), data);
}

/** 완료 부분 병합 (setDoc merge: true) */
export async function mergeQuizCompletion(
  quizId: string,
  userId: string,
  data: Record<string, unknown>,
): Promise<void> {
  await setDoc(doc(db, 'quiz_completions', completionDocId(quizId, userId)), data, { merge: true });
}

/** 완료 삭제 */
export async function deleteQuizCompletion(quizId: string, userId: string): Promise<void> {
  await deleteDoc(doc(db, 'quiz_completions', completionDocId(quizId, userId)));
}

/** 특정 유저의 완료 퀴즈 실시간 구독 */
export function subscribeQuizCompletionsByUser(
  userId: string,
  callback: (completions: QuizCompletionDoc[]) => void,
  onError?: ErrorCallback,
): Unsubscribe {
  const q = query(collection(db, 'quiz_completions'), where('userId', '==', userId));
  return onSnapshot(
    q,
    (snap) => {
      const items: QuizCompletionDoc[] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      callback(items);
    },
    onError ? (err) => onError(err as Error) : undefined,
  );
}

/** 완료 docId 배열 배치 조회 (`${quizId}_${userId}` 패턴) */
export async function fetchQuizCompletionsByIds<T extends Record<string, unknown>>(
  completionIds: string[],
  options?: DocConvertOptions,
): Promise<(T & { id: string })[]> {
  return batchFetchByIn<T>('quiz_completions', documentId(), completionIds, [], options);
}

// ============================================================
// 피드백 (feedbacks) — 퀴즈 피드백
// ============================================================

/** 피드백 저장 */
export async function addFeedback(data: Record<string, unknown>): Promise<string> {
  const ref = await addDoc(collection(db, 'feedbacks'), {
    ...data,
    createdAt: data.createdAt ?? serverTimestamp(),
  });
  return ref.id;
}

/** 여러 퀴즈의 피드백 배치 조회 */
export async function fetchFeedbacksByQuizzes<T extends Record<string, unknown>>(
  quizIds: string[],
  options?: DocConvertOptions,
): Promise<(T & { id: string })[]> {
  return batchFetchByIn<T>('feedbacks', 'quizId', quizIds, [], options);
}

/** 특정 유저의 피드백 */
export async function fetchFeedbacksByUser<T extends Record<string, unknown>>(
  userId: string,
  options?: DocConvertOptions,
): Promise<(T & { id: string })[]> {
  const q = query(collection(db, 'feedbacks'), where('userId', '==', userId));
  const snap = await getDocs(q);
  return docsToArray<T>(snap.docs, options);
}

// ============================================================
// Jobs (AI 생성)
// ============================================================

/** Job 실시간 구독 */
export function subscribeJob(
  jobId: string,
  callback: (data: Record<string, unknown> | null) => void,
  onError?: ErrorCallback,
): Unsubscribe {
  return onSnapshot(
    doc(db, 'jobs', jobId),
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

/** Job 문서 생성 */
export async function createJob(jobId: string, data: Record<string, unknown>): Promise<void> {
  await setDoc(doc(db, 'jobs', jobId), {
    ...data,
    createdAt: serverTimestamp(),
  });
}

// ============================================================
// 배치 유틸 export (필요 시 호출측에서 직접 활용)
// ============================================================

export { writeBatch, Timestamp };
