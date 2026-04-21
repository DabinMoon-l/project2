/**
 * Review Repository — Supabase 구현체 (Phase 2 Step 3)
 *
 * Firebase reviewRepo 와 **동일한 API 시그니처** 유지.
 * 반환 shape 는 Firestore 문서와 호환되도록 카멜케이스 매핑 + question_data jsonb 평탄화.
 *
 * 테이블:
 *   public.reviews
 *   public.custom_folders
 *
 * 구독은 polling 15초 (customFolders — 학생이 자주 안 만들지만 실시간 기대 있음).
 * 페이지 커서는 opaque 객체 — 내부에 { createdAt, id } 보관.
 *
 * 휴지통(deletedReviewItems) 은 Phase 2에서 Supabase 이관 제외 → Firebase 전용 위임.
 */

import { getSupabaseClient } from '@/lib/clients/supabase';
import type { Unsubscribe, ErrorCallback } from '../types';
import * as firebaseReviewRepo from '../firebase/reviewRepo';

const DEFAULT_ORG_ID = process.env.NEXT_PUBLIC_DEFAULT_ORG_ID || '';
const POLL_INTERVAL_MS = 15_000;

// ============================================================
// 공통 타입 (Firebase reviewRepo 와 호환)
// ============================================================

export interface ReviewDoc {
  id: string;
  [key: string]: unknown;
}

export interface ReviewPageCursor {
  readonly __supabaseCursor: { createdAt: string; id: string };
}

export interface ReviewPageResult {
  items: ReviewDoc[];
  hasMore: boolean;
  nextCursor: ReviewPageCursor | null;
}

export interface FetchReviewsPageParams {
  userId: string;
  reviewType: 'wrong' | 'bookmark' | 'solved';
  courseId?: string | null;
  pageSize: number;
  cursor?: ReviewPageCursor | null;
}

// ============================================================
// course UUID ↔ code 양방향 캐시
// ============================================================

const _courseUuidCache = new Map<string, string>(); // code → uuid
const _uuidToCodeCache = new Map<string, string>(); // uuid → code

async function buildCourseCaches(): Promise<void> {
  if (_courseUuidCache.size > 0) return;
  const supabase = getSupabaseClient();
  if (!supabase || !DEFAULT_ORG_ID) return;
  const { data } = await supabase
    .from('courses')
    .select('id, code')
    .eq('org_id', DEFAULT_ORG_ID);
  for (const row of (data as Array<{ id: string; code: string }> | null) || []) {
    _courseUuidCache.set(row.code, row.id);
    _uuidToCodeCache.set(row.id, row.code);
  }
}

async function resolveCourseUuid(courseCode: string): Promise<string | null> {
  await buildCourseCaches();
  return _courseUuidCache.get(courseCode) || null;
}

// ============================================================
// Firestore quizId ↔ Supabase quizzes.id UUID 캐시
// ============================================================

const _quizIdToUuidCache = new Map<string, string | null>();

async function resolveQuizUuid(firestoreQuizId: string): Promise<string | null> {
  const cached = _quizIdToUuidCache.get(firestoreQuizId);
  if (cached !== undefined) return cached;

  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const { data } = await supabase
    .from('quizzes')
    .select('id')
    .eq('source_firestore_id', firestoreQuizId)
    .maybeSingle();

  const uuid = (data as { id?: string } | null)?.id || null;
  _quizIdToUuidCache.set(firestoreQuizId, uuid);
  return uuid;
}

// ============================================================
// Row → Firestore 호환 Doc 변환
// ============================================================

/** Firestore Timestamp 호환 shim — toDate/toMillis 양쪽 제공 */
function tsLike(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  const ms = d.getTime();
  return {
    toDate: () => d,
    toMillis: () => ms,
    seconds: Math.floor(ms / 1000),
    nanoseconds: (ms % 1000) * 1e6,
  };
}

interface ReviewRow {
  id: string;
  org_id: string;
  course_id: string | null;
  user_id: string;
  quiz_id: string | null;
  question_id: string;
  chapter_id: string | null;
  chapter_detail_id: string | null;
  question_data: Record<string, unknown>;
  is_correct: boolean | null;
  is_bookmarked: boolean;
  review_count: number;
  review_type: string | null;
  folder_id: string | null;
  last_reviewed_at: string | null;
  metadata: Record<string, unknown> | null;
  source_firestore_id: string | null;
  created_at: string;
  updated_at: string;
}

interface FolderRow {
  id: string;
  org_id: string;
  course_id: string | null;
  user_id: string;
  name: string;
  sort_order: number;
  questions: Array<Record<string, unknown>>;
  source_firestore_id: string | null;
  created_at: string;
  updated_at: string;
}

function reviewRowToDoc(row: ReviewRow): ReviewDoc {
  const courseCode = row.course_id ? _uuidToCodeCache.get(row.course_id) || null : null;
  const metadata = row.metadata || {};
  const quizIdForClient =
    (metadata.originalQuizId as string | undefined) ||
    row.quiz_id ||
    null;

  return {
    id: row.id,
    userId: row.user_id,
    quizId: quizIdForClient,
    questionId: row.question_id,
    chapterId: row.chapter_id,
    chapterDetailId: row.chapter_detail_id,
    isCorrect: row.is_correct,
    isBookmarked: row.is_bookmarked,
    reviewCount: row.review_count,
    reviewType: row.review_type,
    folderId: row.folder_id,
    courseId: courseCode,
    lastReviewedAt: tsLike(row.last_reviewed_at as string | null),
    createdAt: tsLike(row.created_at),
    updatedAt: tsLike(row.updated_at),
    // metadata 평탄화 (quizTitle, quizCreatorId, quizUpdatedAt 등)
    ...metadata,
    // question_data 평탄화 (question, type, options, correctAnswer, userAnswer, explanation, ...)
    ...(row.question_data || {}),
  };
}

function folderRowToDoc(row: FolderRow): ReviewDoc {
  const courseCode = row.course_id ? _uuidToCodeCache.get(row.course_id) || null : null;
  return {
    id: row.id,
    userId: row.user_id,
    courseId: courseCode,
    name: row.name,
    sortOrder: row.sort_order,
    questions: row.questions || [],
    createdAt: tsLike(row.created_at),
    updatedAt: tsLike(row.updated_at),
  };
}

// ============================================================
// Doc(클라이언트 입력) → Row(Supabase 컬럼) 분리
// ============================================================

// reviews.question_data 로 들어갈 필드 (jsonb 평탄 저장)
const QUESTION_DATA_KEYS = new Set([
  'question',
  'type',
  'options',
  'correctAnswer',
  'userAnswer',
  'explanation',
  'choiceExplanations',
  'image',
  'imageUrl',
  'rubric',
  'mixedExamples',
  'subQuestionOptions',
  'subQuestionOptionsType',
  'subQuestionImage',
  'passage',
  'passageType',
  'passageImage',
  'koreanAbcItems',
  'passageMixedExamples',
  'commonQuestion',
  'combinedMainText',
  'bogi',
  'bogiQuestionText',
  'passagePrompt',
  'combinedGroupId',
  'combinedIndex',
  'combinedTotal',
]);

// reviews.metadata 로 들어갈 필드
const METADATA_KEYS = new Set([
  'quizTitle',
  'quizCreatorId',
  'quizUpdatedAt',
  'quizType',
  'quizIsPublic',
]);

// reviews 최상위 컬럼 매핑
const REVIEW_TOP_KEYS: Record<string, string> = {
  userId: 'user_id',
  questionId: 'question_id',
  chapterId: 'chapter_id',
  chapterDetailId: 'chapter_detail_id',
  isCorrect: 'is_correct',
  isBookmarked: 'is_bookmarked',
  reviewCount: 'review_count',
  reviewType: 'review_type',
  folderId: 'folder_id',
};

async function reviewDocToRow(
  data: Record<string, unknown>,
  mode: 'insert' | 'update',
): Promise<Record<string, unknown>> {
  const row: Record<string, unknown> = {};
  const questionData: Record<string, unknown> = {};
  const metadata: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (key === 'quizId') {
      const quizIdStr = value as string | null;
      if (quizIdStr) {
        const uuid = await resolveQuizUuid(quizIdStr);
        if (uuid) {
          row.quiz_id = uuid;
        } else {
          metadata.originalQuizId = quizIdStr;
        }
      }
      continue;
    }
    if (key === 'courseId') {
      const courseCode = value as string | null;
      if (courseCode) {
        const uuid = await resolveCourseUuid(courseCode);
        if (uuid) row.course_id = uuid;
      }
      continue;
    }
    if (key === 'lastReviewedAt') {
      // Firestore Timestamp 객체 or null
      if (value === null || value === undefined) {
        row.last_reviewed_at = null;
      } else if (
        typeof value === 'object' &&
        value !== null &&
        'toDate' in value &&
        typeof (value as { toDate: () => Date }).toDate === 'function'
      ) {
        row.last_reviewed_at = (value as { toDate: () => Date }).toDate().toISOString();
      } else if (value instanceof Date) {
        row.last_reviewed_at = value.toISOString();
      }
      continue;
    }
    if (key === 'createdAt') {
      // 호출측이 serverTimestamp() 보내올 수 있음 — insert 시 DB default로 처리, update 시 무시
      continue;
    }
    if (REVIEW_TOP_KEYS[key]) {
      row[REVIEW_TOP_KEYS[key]] = value;
      continue;
    }
    if (QUESTION_DATA_KEYS.has(key)) {
      questionData[key] = value;
      continue;
    }
    if (METADATA_KEYS.has(key)) {
      metadata[key] = value;
      continue;
    }
    // 알 수 없는 필드도 metadata에 보존 (손실 방지)
    metadata[key] = value;
  }

  if (Object.keys(questionData).length > 0) {
    row.question_data = questionData;
  }
  if (Object.keys(metadata).length > 0) {
    row.metadata = metadata;
  }
  if (mode === 'insert' && DEFAULT_ORG_ID && !row.org_id) {
    row.org_id = DEFAULT_ORG_ID;
  }
  return row;
}

// ============================================================
// 리뷰 페이지네이션 READ
// ============================================================

export async function fetchReviewsPage(params: FetchReviewsPageParams): Promise<ReviewPageResult> {
  const { userId, reviewType, courseId, pageSize, cursor } = params;

  const supabase = getSupabaseClient();
  if (!supabase || !DEFAULT_ORG_ID) {
    return { items: [], hasMore: false, nextCursor: null };
  }
  await buildCourseCaches();

  let query = supabase
    .from('reviews')
    .select('*')
    .eq('org_id', DEFAULT_ORG_ID)
    .eq('user_id', userId)
    .eq('review_type', reviewType)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(pageSize + 1);

  if (courseId) {
    const courseUuid = await resolveCourseUuid(courseId);
    if (courseUuid) query = query.eq('course_id', courseUuid);
  }
  if (cursor) {
    // keyset: (createdAt, id) desc — 다음 페이지는 더 작은 createdAt 혹은 같은 createdAt이면서 id가 더 작은 것
    const { createdAt, id } = cursor.__supabaseCursor;
    query = query.or(`created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data as ReviewRow[] | null) || [];
  const hasMore = rows.length > pageSize;
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
  const items = pageRows.map(reviewRowToDoc);
  const lastRow = pageRows.length > 0 ? pageRows[pageRows.length - 1] : null;

  return {
    items,
    hasMore,
    nextCursor: lastRow
      ? { __supabaseCursor: { createdAt: lastRow.created_at, id: lastRow.id } }
      : null,
  };
}

// ============================================================
// 리뷰 단건 / 퀴즈별 READ
// ============================================================

export async function getReview(reviewId: string): Promise<ReviewDoc | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  await buildCourseCaches();

  const { data, error } = await supabase
    .from('reviews')
    .select('*')
    .eq('id', reviewId)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') throw error;
  if (!data) return null;
  return reviewRowToDoc(data as ReviewRow);
}

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
  const supabase = getSupabaseClient();
  if (!supabase || !DEFAULT_ORG_ID) return [];
  await buildCourseCaches();

  const quizUuid = await resolveQuizUuid(quizId);

  let query = supabase
    .from('reviews')
    .select('*')
    .eq('org_id', DEFAULT_ORG_ID)
    .eq('user_id', userId);

  if (quizUuid) {
    query = query.eq('quiz_id', quizUuid);
  } else {
    // Supabase quizzes 매핑 없음 → metadata->>originalQuizId 로 매칭 (tekken 등)
    query = query.filter('metadata->>originalQuizId', 'eq', quizId);
  }

  if (options?.reviewType) query = query.eq('review_type', options.reviewType);
  if (options?.chapterId) query = query.eq('chapter_id', options.chapterId);
  if (options?.flaggedOnly) query = query.eq('is_bookmarked', true);
  if (options?.questionId) query = query.eq('question_id', options.questionId);

  const { data, error } = await query;
  if (error) throw error;
  return ((data as ReviewRow[] | null) || []).map(reviewRowToDoc);
}

export async function fetchReviewsByQuestionIds(
  userId: string,
  quizId: string,
  questionIds: string[],
  options?: {
    reviewType?: 'wrong' | 'bookmark' | 'solved';
  },
): Promise<ReviewDoc[]> {
  if (questionIds.length === 0) return [];
  const supabase = getSupabaseClient();
  if (!supabase || !DEFAULT_ORG_ID) return [];
  await buildCourseCaches();

  const quizUuid = await resolveQuizUuid(quizId);

  let query = supabase
    .from('reviews')
    .select('*')
    .eq('org_id', DEFAULT_ORG_ID)
    .eq('user_id', userId)
    .in('question_id', questionIds);

  if (quizUuid) {
    query = query.eq('quiz_id', quizUuid);
  } else {
    query = query.filter('metadata->>originalQuizId', 'eq', quizId);
  }
  if (options?.reviewType) query = query.eq('review_type', options.reviewType);

  const { data, error } = await query;
  if (error) throw error;
  return ((data as ReviewRow[] | null) || []).map(reviewRowToDoc);
}

export async function fetchReviewsByUser(
  userId: string,
  options?: {
    reviewType?: 'wrong' | 'bookmark' | 'solved';
    courseId?: string | null;
  },
): Promise<ReviewDoc[]> {
  const supabase = getSupabaseClient();
  if (!supabase || !DEFAULT_ORG_ID) return [];
  await buildCourseCaches();

  let query = supabase
    .from('reviews')
    .select('*')
    .eq('org_id', DEFAULT_ORG_ID)
    .eq('user_id', userId);

  if (options?.reviewType) query = query.eq('review_type', options.reviewType);
  if (options?.courseId) {
    const courseUuid = await resolveCourseUuid(options.courseId);
    if (courseUuid) query = query.eq('course_id', courseUuid);
  }

  const { data, error } = await query;
  if (error) throw error;
  return ((data as ReviewRow[] | null) || []).map(reviewRowToDoc);
}

// ============================================================
// 리뷰 CRUD
// ============================================================

export async function addReview(data: Record<string, unknown>): Promise<string> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase 클라이언트 미초기화');

  const row = await reviewDocToRow(data, 'insert');
  const { data: inserted, error } = await supabase
    .from('reviews')
    .insert(row)
    .select('id')
    .single();

  if (error) throw error;
  return (inserted as { id: string }).id;
}

export async function updateReview(reviewId: string, data: Record<string, unknown>): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase 클라이언트 미초기화');

  const row = await reviewDocToRow(data, 'update');
  const { error } = await supabase.from('reviews').update(row).eq('id', reviewId);
  if (error) throw error;
}

export async function deleteReview(reviewId: string): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase 클라이언트 미초기화');
  const { error } = await supabase.from('reviews').delete().eq('id', reviewId);
  if (error) throw error;
}

export async function batchAddReviews(reviews: Record<string, unknown>[]): Promise<void> {
  if (reviews.length === 0) return;
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase 클라이언트 미초기화');

  for (let i = 0; i < reviews.length; i += 500) {
    const chunk = reviews.slice(i, i + 500);
    const rows = await Promise.all(chunk.map((r) => reviewDocToRow(r, 'insert')));
    const { error } = await supabase.from('reviews').insert(rows);
    if (error) throw error;
  }
}

export async function batchDeleteReviews(reviewIds: string[]): Promise<void> {
  if (reviewIds.length === 0) return;
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase 클라이언트 미초기화');

  for (let i = 0; i < reviewIds.length; i += 500) {
    const chunk = reviewIds.slice(i, i + 500);
    const { error } = await supabase.from('reviews').delete().in('id', chunk);
    if (error) throw error;
  }
}

export async function batchUpdateReviews(
  reviewIds: string[],
  data: Record<string, unknown>,
): Promise<void> {
  if (reviewIds.length === 0) return;
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase 클라이언트 미초기화');

  const row = await reviewDocToRow(data, 'update');
  for (let i = 0; i < reviewIds.length; i += 500) {
    const chunk = reviewIds.slice(i, i + 500);
    const { error } = await supabase.from('reviews').update(row).in('id', chunk);
    if (error) throw error;
  }
}

export async function incrementReviewCount(reviewId: string): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase 클라이언트 미초기화');

  // 현재 값 읽고 +1 (FieldValue.increment 대체)
  const { data, error: readErr } = await supabase
    .from('reviews')
    .select('review_count')
    .eq('id', reviewId)
    .maybeSingle();
  if (readErr) throw readErr;
  const current = ((data as { review_count?: number } | null)?.review_count) ?? 0;

  const { error } = await supabase
    .from('reviews')
    .update({
      review_count: current + 1,
      last_reviewed_at: new Date().toISOString(),
    })
    .eq('id', reviewId);
  if (error) throw error;
}

// ============================================================
// 커스텀 폴더
// ============================================================

export function subscribeCustomFolders(
  userId: string,
  courseId: string | null | undefined,
  callback: (folders: ReviewDoc[]) => void,
  onError?: ErrorCallback,
): Unsubscribe {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const fetch = async () => {
    if (cancelled) return;
    try {
      const supabase = getSupabaseClient();
      if (!supabase || !DEFAULT_ORG_ID) {
        if (!cancelled) callback([]);
        return;
      }
      await buildCourseCaches();

      let query = supabase
        .from('custom_folders')
        .select('*')
        .eq('org_id', DEFAULT_ORG_ID)
        .eq('user_id', userId);

      if (courseId) {
        const courseUuid = await resolveCourseUuid(courseId);
        if (courseUuid) query = query.eq('course_id', courseUuid);
      }

      const { data, error } = await query;
      if (error) {
        if (!cancelled && onError) onError(error as unknown as Error);
        return;
      }
      if (!cancelled) {
        const folders = ((data as FolderRow[] | null) || []).map(folderRowToDoc);
        callback(folders);
      }
    } catch (err) {
      if (!cancelled && onError) onError(err as Error);
    } finally {
      if (!cancelled) timer = setTimeout(fetch, POLL_INTERVAL_MS);
    }
  };

  fetch();

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}

export async function getFolder(folderId: string): Promise<ReviewDoc | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  await buildCourseCaches();

  const { data, error } = await supabase
    .from('custom_folders')
    .select('*')
    .eq('id', folderId)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') throw error;
  if (!data) return null;
  return folderRowToDoc(data as FolderRow);
}

export async function addFolder(data: Record<string, unknown>): Promise<string> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase 클라이언트 미초기화');

  const row: Record<string, unknown> = {
    org_id: DEFAULT_ORG_ID,
    user_id: data.userId,
    name: data.name,
    sort_order: data.sortOrder ?? 0,
    questions: data.questions ?? [],
  };
  if (data.courseId) {
    const courseUuid = await resolveCourseUuid(data.courseId as string);
    if (courseUuid) row.course_id = courseUuid;
  }

  const { data: inserted, error } = await supabase
    .from('custom_folders')
    .insert(row)
    .select('id')
    .single();
  if (error) throw error;
  return (inserted as { id: string }).id;
}

export async function updateFolder(
  folderId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase 클라이언트 미초기화');

  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === 'userId') row.user_id = value;
    else if (key === 'name') row.name = value;
    else if (key === 'sortOrder') row.sort_order = value;
    else if (key === 'questions') row.questions = value;
    else if (key === 'courseId' && value) {
      const courseUuid = await resolveCourseUuid(value as string);
      if (courseUuid) row.course_id = courseUuid;
    }
  }

  const { error } = await supabase.from('custom_folders').update(row).eq('id', folderId);
  if (error) throw error;
}

export async function deleteFolder(folderId: string): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase 클라이언트 미초기화');
  const { error } = await supabase.from('custom_folders').delete().eq('id', folderId);
  if (error) throw error;
}

// ============================================================
// 휴지통 (deletedReviewItems)
//
// Phase 2에서 Supabase 이관 제외 — Firebase 전용 위임.
// ============================================================

export const fetchDeletedItems = firebaseReviewRepo.fetchDeletedItems;
export const getDeletedItem = firebaseReviewRepo.getDeletedItem;
export const addDeletedItem = firebaseReviewRepo.addDeletedItem;
export const deleteDeletedItem = firebaseReviewRepo.deleteDeletedItem;
