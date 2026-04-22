/**
 * Quiz Repository — Supabase 구현체 (Phase 2 Step 3)
 *
 * Firebase quizRepo 와 **동일한 API 시그니처** 유지.
 * 반환 shape 는 Firestore 문서와 호환되도록 카멜케이스 매핑 + tsLike Timestamp.
 *
 * 테이블:
 *   public.quizzes
 *   public.quiz_results
 *   public.quiz_completions
 *   public.feedbacks
 *
 * 구독은 polling 기반 (실시간 기대치 낮음):
 *   - subscribeQuiz: 30초 (단건)
 *   - subscribeQuizzesByCreator / ForProfessor: 30초
 *   - subscribeQuizCompletionsByUser: 30초
 *
 * 쓰기 경로는 Firebase 위임 — CF onQuizSync / onQuizCreate / onQuizMakePublic 트리거가
 * Firestore 쓰기에 묶여있고 EXP 보상/AI 답변 로직이 Firestore 트리거로 흐르므로
 * Supabase 직접 insert 금지. 클라가 Firestore 에 쓰면 CF dual-write 로 Supabase 동기.
 *
 * jobs 컬렉션은 Supabase 이관 제외 → Firebase 전용 위임.
 */

import { getSupabaseClient } from '@/lib/clients/supabase';
import type { Unsubscribe, ErrorCallback, DocConvertOptions } from '../types';
import * as firebaseQuizRepo from '../firebase/quizRepo';

const DEFAULT_ORG_ID = process.env.NEXT_PUBLIC_DEFAULT_ORG_ID || '';
const POLL_INTERVAL_MS = 30_000;

// ============================================================
// 공통 타입 재export (Firebase 와 동일 시그니처)
// ============================================================

export type {
  QuizDoc,
  QuizResultDoc,
  QuizCompletionDoc,
  FeedbackDoc,
  QuizPageCursor,
  QuizPageResult,
  QuizFeedFilters,
} from '../firebase/quizRepo';

import type {
  QuizDoc,
  QuizResultDoc,
  QuizCompletionDoc,
  FeedbackDoc,
  QuizPageCursor,
  QuizPageResult,
  QuizFeedFilters,
} from '../firebase/quizRepo';

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

function resolveCourseCode(uuid: string | null): string | null {
  if (!uuid) return null;
  return _uuidToCodeCache.get(uuid) || null;
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

async function resolveQuizUuids(firestoreQuizIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const need: string[] = [];
  for (const id of firestoreQuizIds) {
    const cached = _quizIdToUuidCache.get(id);
    if (cached) out.set(id, cached);
    else if (cached !== null) need.push(id);
  }
  if (need.length === 0) return out;

  const supabase = getSupabaseClient();
  if (!supabase) return out;

  // 30개씩 배치
  for (let i = 0; i < need.length; i += 30) {
    const batch = need.slice(i, i + 30);
    const { data } = await supabase
      .from('quizzes')
      .select('id, source_firestore_id')
      .in('source_firestore_id', batch);
    for (const row of (data as Array<{ id: string; source_firestore_id: string }> | null) || []) {
      _quizIdToUuidCache.set(row.source_firestore_id, row.id);
      out.set(row.source_firestore_id, row.id);
    }
    // 없는 것은 null 로 음성 캐시
    for (const id of batch) {
      if (!out.has(id)) _quizIdToUuidCache.set(id, null);
    }
  }
  return out;
}

// ============================================================
// Row → Firestore 호환 doc 변환
// ============================================================

interface QuizRow {
  id: string;
  org_id: string;
  course_id: string | null;
  creator_id: string;
  creator_nickname: string | null;
  creator_class_type: string | null;
  title: string;
  description: string | null;
  category: string;
  difficulty: string | null;
  tags: string[];
  class_type: string | null;
  target_class: string | null;
  original_type: string | null;
  was_published: boolean | null;
  questions: unknown[];
  question_count: number;
  ox_count: number;
  multiple_choice_count: number;
  subjective_count: number;
  short_answer_count: number;
  is_public: boolean;
  is_published: boolean;
  is_ai_generated: boolean;
  participant_count: number;
  average_score: number | null;
  bookmark_count: number;
  feedback_count: number;
  rewarded: boolean;
  rewarded_at: string | null;
  exp_rewarded: number | null;
  public_rewarded: boolean;
  public_rewarded_at: string | null;
  user_scores: Record<string, number> | null;
  user_first_review_scores: Record<string, number> | null;
  semester: string | null;
  past_year: string | null;
  past_exam_type: string | null;
  uploaded_at: string | null;
  metadata: Record<string, unknown> | null;
  source_firestore_id: string | null;
  created_at: string;
  updated_at: string;
}

interface QuizResultRow {
  id: string;
  org_id: string;
  quiz_id: string;
  user_id: string;
  score: number;
  correct_count: number;
  total_count: number;
  answers: unknown[];
  attempt_no: number;
  attempt_key: string | null;
  is_first_attempt: boolean;
  duration_seconds: number | null;
  source_firestore_id: string | null;
  created_at: string;
}

interface QuizCompletionRow {
  id: string;
  org_id: string;
  quiz_id: string;
  user_id: string;
  best_score: number | null;
  completed_at: string;
}

interface FeedbackRow {
  id: string;
  org_id: string;
  quiz_id: string;
  user_id: string;
  content: string;
  rating: number | null;
  source_firestore_id: string | null;
  created_at: string;
}

function tsLike(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  const ms = d.getTime();
  const seconds = Math.floor(ms / 1000);
  return {
    toDate: () => d,
    toMillis: () => ms,
    seconds,
    nanoseconds: (ms % 1000) * 1_000_000,
    _seconds: seconds,
  };
}

function quizRowToDoc(row: QuizRow): QuizDoc {
  const clientId = row.source_firestore_id || row.id;
  const courseCode = resolveCourseCode(row.course_id);
  const metadata = row.metadata || {};

  return {
    id: clientId,
    // metadata 에 저장된 원본 Firestore 필드 먼저 전개 (스키마 외 필드 복원)
    ...metadata,
    // 스키마 컬럼은 metadata 를 덮어쓰기
    courseId: courseCode,
    creatorId: row.creator_id,
    creatorNickname: row.creator_nickname,
    creatorClassType: row.creator_class_type,
    // creatorUid 는 metadata 에 원본이 있으면 사용, 없으면 creator_id 로 폴백
    creatorUid:
      (metadata.creatorUid as string | undefined) ?? row.creator_id ?? null,
    title: row.title,
    description: row.description,
    type: row.category,
    difficulty: row.difficulty,
    tags: row.tags || [],
    classType: row.class_type,
    targetClass: row.target_class,
    originalType: row.original_type,
    wasPublished: row.was_published,
    questions: row.questions || [],
    questionCount: row.question_count,
    oxCount: row.ox_count,
    multipleChoiceCount: row.multiple_choice_count,
    subjectiveCount: row.subjective_count,
    shortAnswerCount: row.short_answer_count,
    isPublic: row.is_public,
    isPublished: row.is_published,
    isAiGenerated: row.is_ai_generated,
    participantCount: row.participant_count,
    averageScore: row.average_score,
    bookmarkCount: row.bookmark_count,
    feedbackCount: row.feedback_count,
    rewarded: row.rewarded,
    rewardedAt: tsLike(row.rewarded_at),
    publicRewarded: row.public_rewarded,
    publicRewardedAt: tsLike(row.public_rewarded_at),
    userScores: row.user_scores || {},
    userFirstReviewScores: row.user_first_review_scores || {},
    semester: row.semester,
    pastYear: row.past_year ? Number(row.past_year) : null,
    pastExamType: row.past_exam_type,
    uploadedAt: tsLike(row.uploaded_at),
    createdAt: tsLike(row.created_at),
    updatedAt: tsLike(row.updated_at),
  };
}

/**
 * quizzes 테이블 조인 시 끌어오는 denormalized 필드 셋.
 * Firestore quizResults / questionFeedbacks 문서가 저장하는 denorm 필드를
 * 복원하기 위해 각 fetcher 가 inner join 으로 조회해 quizResultRowToDoc /
 * feedbackRowToDoc 에 넘긴다.
 */
interface QuizInfoJoin {
  id?: string | null;
  source_firestore_id?: string | null;
  course_id?: string | null;
  title?: string | null;
  category?: string | null;
  is_public?: boolean | null;
  creator_id?: string | null;
  creator_class_type?: string | null;
}

/** quizzes 조인 컬럼 공통 select 절 */
const QUIZZES_JOIN_COLS =
  'id, source_firestore_id, course_id, title, category, is_public, creator_id, creator_class_type';

function quizResultRowToDoc(
  row: QuizResultRow,
  quizUuidToFirestoreId: Map<string, string>,
  quizInfo?: QuizInfoJoin,
): QuizResultDoc {
  const firestoreQuizId = quizUuidToFirestoreId.get(row.quiz_id) || row.quiz_id;
  const doc: QuizResultDoc & Record<string, unknown> = {
    id: row.source_firestore_id || row.id,
    userId: row.user_id,
    quizId: firestoreQuizId,
    score: row.score,
    correctCount: row.correct_count,
    totalCount: row.total_count,
    answers: row.answers || [],
    attemptNo: row.attempt_no,
    attemptKey: row.attempt_key,
    isFirstAttempt: row.is_first_attempt,
    durationSeconds: row.duration_seconds,
    createdAt: tsLike(row.created_at),
  };
  if (quizInfo) {
    // Firestore quizResults 문서의 denormalized 필드 복원
    if (quizInfo.title != null) doc.quizTitle = quizInfo.title;
    if (quizInfo.category != null) doc.quizType = quizInfo.category;
    if (quizInfo.is_public != null) doc.quizIsPublic = quizInfo.is_public;
    if (quizInfo.creator_id != null) doc.quizCreatorId = quizInfo.creator_id;
    const courseCode = quizInfo.course_id ? resolveCourseCode(quizInfo.course_id) : null;
    if (courseCode) doc.courseId = courseCode;
  }
  // attempt_no > 1 이면 isUpdate (Firestore denorm 필드 호환)
  doc.isUpdate = row.attempt_no > 1;
  return doc as QuizResultDoc;
}

function quizCompletionRowToDoc(
  row: QuizCompletionRow,
  quizUuidToFirestoreId: Map<string, string>,
): QuizCompletionDoc {
  const firestoreQuizId = quizUuidToFirestoreId.get(row.quiz_id) || row.quiz_id;
  return {
    // Firestore docId 는 `${quizId}_${userId}` 규칙
    id: `${firestoreQuizId}_${row.user_id}`,
    quizId: firestoreQuizId,
    userId: row.user_id,
    score: row.best_score,
    completedAt: tsLike(row.completed_at),
  };
}

function feedbackRowToDoc(
  row: FeedbackRow,
  quizUuidToFirestoreId: Map<string, string>,
  quizInfo?: QuizInfoJoin,
): FeedbackDoc {
  const firestoreQuizId = quizUuidToFirestoreId.get(row.quiz_id) || row.quiz_id;
  const doc: FeedbackDoc & Record<string, unknown> = {
    id: row.source_firestore_id || row.id,
    quizId: firestoreQuizId,
    userId: row.user_id,
    content: row.content,
    rating: row.rating,
    createdAt: tsLike(row.created_at),
  };
  if (quizInfo) {
    if (quizInfo.title != null) doc.quizTitle = quizInfo.title;
    if (quizInfo.category != null) doc.quizType = quizInfo.category;
    if (quizInfo.creator_id != null) doc.quizCreatorId = quizInfo.creator_id;
    const courseCode = quizInfo.course_id ? resolveCourseCode(quizInfo.course_id) : null;
    if (courseCode) doc.courseId = courseCode;
  }
  return doc as FeedbackDoc;
}

/** quiz_id(uuid) 세트 → 각 uuid 의 source_firestore_id 맵 구성 */
async function buildQuizUuidReverseMap(
  quizUuids: Set<string>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (quizUuids.size === 0) return out;
  const supabase = getSupabaseClient();
  if (!supabase) return out;
  const ids = Array.from(quizUuids);
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const { data } = await supabase
      .from('quizzes')
      .select('id, source_firestore_id')
      .in('id', batch);
    for (const row of (data as Array<{ id: string; source_firestore_id: string | null }> | null) || []) {
      if (row.source_firestore_id) out.set(row.id, row.source_firestore_id);
    }
  }
  return out;
}

// ============================================================
// 필터 쿼리 빌더
// ============================================================

/** 카테고리 필드는 Firestore `type` ↔ Supabase `category` */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyQuizFilters(query: any, filters: QuizFeedFilters, courseUuid: string | null): any {
  if (courseUuid) query = query.eq('course_id', courseUuid);
  if (filters.type) query = query.eq('category', filters.type);
  if (filters.typeIn && filters.typeIn.length > 0) {
    query = query.in('category', filters.typeIn);
  }
  if (filters.isPublished !== undefined) query = query.eq('is_published', filters.isPublished);
  if (filters.targetClass) query = query.eq('target_class', filters.targetClass);
  if (filters.creatorUid) query = query.eq('creator_id', filters.creatorUid);
  if (filters.creatorClassType) query = query.eq('creator_class_type', filters.creatorClassType);
  if (filters.isPublic !== undefined) query = query.eq('is_public', filters.isPublic);
  if (filters.pastYear !== undefined && filters.pastYear !== null) {
    query = query.eq('past_year', String(filters.pastYear));
  }
  if (filters.pastExamType) query = query.eq('past_exam_type', filters.pastExamType);
  return query;
}

// ============================================================
// 퀴즈 — 단건 조회 / 구독
// ============================================================

export async function getQuiz<T extends Record<string, unknown>>(
  quizId: string,
  _options?: DocConvertOptions,
): Promise<(T & { id: string }) | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  await buildCourseCaches();

  const { data, error } = await supabase
    .from('quizzes')
    .select('*')
    .eq('source_firestore_id', quizId)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') return null;
  if (!data) return null;
  return quizRowToDoc(data as QuizRow) as T & { id: string };
}

/** Raw snapshot 호환: Firebase 전용. 호출측이 .data()/.exists() 쓰는 케이스만 해당. */
export const getQuizRaw = firebaseQuizRepo.getQuizRaw;

export function subscribeQuiz<T extends Record<string, unknown>>(
  quizId: string,
  callback: (quiz: (T & { id: string }) | null) => void,
  onError?: ErrorCallback,
  _options?: DocConvertOptions,
): Unsubscribe {
  let cancelled = false;
  let timer: NodeJS.Timeout | null = null;

  const fetch = async () => {
    try {
      const doc = await getQuiz<T>(quizId);
      if (!cancelled) callback(doc);
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

// ============================================================
// 퀴즈 — 목록 조회 / 구독
// ============================================================

export function subscribeQuizzesByCreator(
  creatorId: string,
  callback: (quizzes: QuizDoc[]) => void,
  onError?: ErrorCallback,
): Unsubscribe {
  let cancelled = false;
  let timer: NodeJS.Timeout | null = null;

  const fetch = async () => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase || !DEFAULT_ORG_ID) {
        if (!cancelled) callback([]);
        return;
      }
      await buildCourseCaches();

      const { data, error } = await supabase
        .from('quizzes')
        .select('*')
        .eq('org_id', DEFAULT_ORG_ID)
        .eq('creator_id', creatorId);
      if (error) {
        if (!cancelled && onError) onError(error as unknown as Error);
        return;
      }
      if (!cancelled) {
        const quizzes = ((data as QuizRow[] | null) || []).map(quizRowToDoc);
        callback(quizzes);
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

export function subscribeQuizzesForProfessor(
  creatorUid: string,
  courseId: string,
  callback: (quizzes: QuizDoc[]) => void,
  onError?: ErrorCallback,
): Unsubscribe {
  let cancelled = false;
  let timer: NodeJS.Timeout | null = null;

  const fetch = async () => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase || !DEFAULT_ORG_ID) {
        if (!cancelled) callback([]);
        return;
      }
      await buildCourseCaches();
      const courseUuid = await resolveCourseUuid(courseId);
      if (!courseUuid) {
        if (!cancelled) callback([]);
        return;
      }

      const { data, error } = await supabase
        .from('quizzes')
        .select('*')
        .eq('org_id', DEFAULT_ORG_ID)
        .eq('creator_id', creatorUid)
        .eq('course_id', courseUuid)
        .order('created_at', { ascending: false });
      if (error) {
        if (!cancelled && onError) onError(error as unknown as Error);
        return;
      }
      if (!cancelled) {
        const quizzes = ((data as QuizRow[] | null) || []).map(quizRowToDoc);
        callback(quizzes);
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

export async function fetchQuizzesByCourse<T extends Record<string, unknown>>(
  courseId: string,
  _options?: DocConvertOptions,
): Promise<(T & { id: string })[]> {
  const supabase = getSupabaseClient();
  if (!supabase || !DEFAULT_ORG_ID) return [];
  await buildCourseCaches();
  const courseUuid = await resolveCourseUuid(courseId);
  if (!courseUuid) return [];
  const { data } = await supabase
    .from('quizzes')
    .select('*')
    .eq('org_id', DEFAULT_ORG_ID)
    .eq('course_id', courseUuid);
  return ((data as QuizRow[] | null) || []).map(quizRowToDoc) as (T & { id: string })[];
}

export async function fetchQuizzesByIds<T extends Record<string, unknown>>(
  quizIds: string[],
  _options?: DocConvertOptions,
): Promise<(T & { id: string })[]> {
  if (quizIds.length === 0) return [];
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  await buildCourseCaches();

  const out: QuizDoc[] = [];
  for (let i = 0; i < quizIds.length; i += 30) {
    const batch = quizIds.slice(i, i + 30);
    const { data } = await supabase
      .from('quizzes')
      .select('*')
      .in('source_firestore_id', batch);
    for (const row of (data as QuizRow[] | null) || []) {
      out.push(quizRowToDoc(row));
    }
  }
  return out as (T & { id: string })[];
}

export async function fetchQuizzesByCreator<T extends Record<string, unknown>>(
  creatorId: string,
  filters?: { courseId?: string | null; isPublic?: boolean },
  _options?: DocConvertOptions,
): Promise<(T & { id: string })[]> {
  const supabase = getSupabaseClient();
  if (!supabase || !DEFAULT_ORG_ID) return [];
  await buildCourseCaches();

  let query = supabase
    .from('quizzes')
    .select('*')
    .eq('org_id', DEFAULT_ORG_ID)
    .eq('creator_id', creatorId);
  if (filters?.courseId) {
    const courseUuid = await resolveCourseUuid(filters.courseId);
    if (!courseUuid) return [];
    query = query.eq('course_id', courseUuid);
  }
  if (filters?.isPublic !== undefined) query = query.eq('is_public', filters.isPublic);

  const { data } = await query;
  return ((data as QuizRow[] | null) || []).map(quizRowToDoc) as (T & { id: string })[];
}

/**
 * 교수 퀴즈 페이지네이션.
 * cursor 는 Firebase 타입과 다른 opaque 구조 — 타입 단언으로 호출측과 호환.
 */
export async function fetchQuizzesForProfessorPage(
  creatorUid: string,
  typeFilter: string[],
  pageSize: number,
  isPublished?: boolean,
  cursor?: QuizPageCursor | null,
): Promise<QuizPageResult> {
  const supabase = getSupabaseClient();
  if (!supabase || !DEFAULT_ORG_ID) {
    return { items: [], hasMore: false, nextCursor: null };
  }
  await buildCourseCaches();

  let query = supabase
    .from('quizzes')
    .select('*')
    .eq('org_id', DEFAULT_ORG_ID)
    .eq('creator_id', creatorUid)
    .in('category', typeFilter);
  if (isPublished !== undefined) query = query.eq('is_published', isPublished);

  if (cursor) {
    const c = (cursor as unknown as { __supabaseCursor?: { createdAt: string; id: string } })
      .__supabaseCursor;
    if (c) {
      // keyset: created_at < X OR (created_at = X AND id < Y)
      query = query.or(
        `created_at.lt.${c.createdAt},and(created_at.eq.${c.createdAt},id.lt.${c.id})`,
      );
    }
  }

  query = query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(pageSize);

  const { data } = await query;
  const rows = (data as QuizRow[] | null) || [];
  const items = rows.map(quizRowToDoc);
  const last = rows.length > 0 ? rows[rows.length - 1] : null;
  return {
    items,
    hasMore: rows.length === pageSize,
    nextCursor: last
      ? ({ __supabaseCursor: { createdAt: last.created_at, id: last.id } } as unknown as QuizPageCursor)
      : null,
  };
}

export async function fetchQuizzesByFilters(
  filters: QuizFeedFilters,
  pageSize: number,
  cursor?: QuizPageCursor | null,
): Promise<QuizPageResult> {
  const supabase = getSupabaseClient();
  if (!supabase || !DEFAULT_ORG_ID) {
    return { items: [], hasMore: false, nextCursor: null };
  }
  await buildCourseCaches();

  let courseUuid: string | null = null;
  if (filters.courseId) {
    courseUuid = await resolveCourseUuid(filters.courseId);
    if (!courseUuid) return { items: [], hasMore: false, nextCursor: null };
  }

  let query = supabase.from('quizzes').select('*').eq('org_id', DEFAULT_ORG_ID);
  query = applyQuizFilters(query, filters, courseUuid);

  if (cursor) {
    const c = (cursor as unknown as { __supabaseCursor?: { createdAt: string; id: string } })
      .__supabaseCursor;
    if (c) {
      query = query.or(
        `created_at.lt.${c.createdAt},and(created_at.eq.${c.createdAt},id.lt.${c.id})`,
      );
    }
  }

  query = query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(pageSize + 1);

  const { data } = await query;
  const rows = (data as QuizRow[] | null) || [];
  const hasMore = rows.length > pageSize;
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
  const items = pageRows.map(quizRowToDoc);
  const last = pageRows.length > 0 ? pageRows[pageRows.length - 1] : null;
  return {
    items,
    hasMore,
    nextCursor: last
      ? ({ __supabaseCursor: { createdAt: last.created_at, id: last.id } } as unknown as QuizPageCursor)
      : null,
  };
}

// ============================================================
// 퀴즈 결과 (quiz_results)
// ============================================================

export async function fetchQuizResultsByQuiz<T extends Record<string, unknown>>(
  quizId: string,
  _options?: DocConvertOptions,
): Promise<(T & { id: string })[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  const quizUuid = await resolveQuizUuid(quizId);
  if (!quizUuid) return [];
  const { data } = await supabase
    .from('quiz_results')
    .select(`*, quizzes!inner(${QUIZZES_JOIN_COLS})`)
    .eq('quiz_id', quizUuid);
  type JoinRow = QuizResultRow & { quizzes: QuizInfoJoin };
  const rows = (data as JoinRow[] | null) || [];
  const map = new Map<string, string>();
  map.set(quizUuid, quizId);
  return rows.map((r) => quizResultRowToDoc(r, map, r.quizzes)) as (T & { id: string })[];
}

export async function fetchQuizResultsByQuizzes<T extends Record<string, unknown>>(
  quizIds: string[],
  _options?: DocConvertOptions,
): Promise<(T & { id: string })[]> {
  if (quizIds.length === 0) return [];
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  const uuidMap = await resolveQuizUuids(quizIds);
  if (uuidMap.size === 0) return [];
  const uuids = Array.from(uuidMap.values());
  const reverseMap = new Map<string, string>();
  for (const [fsId, uuid] of uuidMap.entries()) reverseMap.set(uuid, fsId);

  type JoinRow = QuizResultRow & { quizzes: QuizInfoJoin };
  const out: QuizResultDoc[] = [];
  for (let i = 0; i < uuids.length; i += 30) {
    const batch = uuids.slice(i, i + 30);
    const { data } = await supabase
      .from('quiz_results')
      .select(`*, quizzes!inner(${QUIZZES_JOIN_COLS})`)
      .in('quiz_id', batch);
    for (const row of (data as JoinRow[] | null) || []) {
      out.push(quizResultRowToDoc(row, reverseMap, row.quizzes));
    }
  }
  return out as (T & { id: string })[];
}

export async function fetchQuizResultsByUser<T extends Record<string, unknown>>(
  userId: string,
  filters?: { courseId?: string | null },
  _options?: DocConvertOptions,
): Promise<(T & { id: string })[]> {
  const supabase = getSupabaseClient();
  if (!supabase || !DEFAULT_ORG_ID) return [];
  await buildCourseCaches();

  let query = supabase
    .from('quiz_results')
    .select(`*, quizzes!inner(${QUIZZES_JOIN_COLS})`)
    .eq('org_id', DEFAULT_ORG_ID)
    .eq('user_id', userId);
  if (filters?.courseId) {
    const courseUuid = await resolveCourseUuid(filters.courseId);
    if (!courseUuid) return [];
    query = query.eq('quizzes.course_id', courseUuid);
  }

  const { data } = await query;
  type JoinRow = QuizResultRow & { quizzes: QuizInfoJoin };
  const rows = (data as JoinRow[] | null) || [];
  const reverseMap = new Map<string, string>();
  for (const r of rows) {
    if (r.quizzes?.source_firestore_id) reverseMap.set(r.quiz_id, r.quizzes.source_firestore_id);
  }
  return rows.map((r) => quizResultRowToDoc(r, reverseMap, r.quizzes)) as (T & { id: string })[];
}

export async function fetchQuizResultsByUserAndQuiz<T extends Record<string, unknown>>(
  userId: string,
  quizId: string,
  listLimit?: number,
  _options?: DocConvertOptions,
): Promise<(T & { id: string })[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  const quizUuid = await resolveQuizUuid(quizId);
  if (!quizUuid) return [];
  let query = supabase
    .from('quiz_results')
    .select(`*, quizzes!inner(${QUIZZES_JOIN_COLS})`)
    .eq('user_id', userId)
    .eq('quiz_id', quizUuid);
  if (listLimit) query = query.limit(listLimit);
  const { data } = await query;
  const map = new Map<string, string>();
  map.set(quizUuid, quizId);
  type JoinRow = QuizResultRow & { quizzes: QuizInfoJoin };
  const rows = (data as JoinRow[] | null) || [];
  return rows.map((r) => quizResultRowToDoc(r, map, r.quizzes)) as (T & { id: string })[];
}

export async function getQuizResults<T extends Record<string, unknown>>(
  filters: { quizId?: string; userId?: string },
  _options?: DocConvertOptions,
): Promise<(T & { id: string })[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];

  let query = supabase
    .from('quiz_results')
    .select(`*, quizzes!inner(${QUIZZES_JOIN_COLS})`);
  let quizUuid: string | null = null;
  if (filters.quizId) {
    quizUuid = await resolveQuizUuid(filters.quizId);
    if (!quizUuid) return [];
    query = query.eq('quiz_id', quizUuid);
  }
  if (filters.userId) query = query.eq('user_id', filters.userId);

  const { data } = await query;
  type JoinRow = QuizResultRow & { quizzes: QuizInfoJoin };
  const rows = (data as JoinRow[] | null) || [];
  const reverseMap = new Map<string, string>();
  if (quizUuid && filters.quizId) reverseMap.set(quizUuid, filters.quizId);
  else {
    for (const r of rows) {
      if (r.quizzes?.source_firestore_id) reverseMap.set(r.quiz_id, r.quizzes.source_firestore_id);
    }
  }
  return rows.map((r) => quizResultRowToDoc(r, reverseMap, r.quizzes)) as (T & { id: string })[];
}

// ============================================================
// 퀴즈 완료 (quiz_completions)
// ============================================================

export async function getQuizCompletion<T extends Record<string, unknown>>(
  quizId: string,
  userId: string,
  _options?: DocConvertOptions,
): Promise<(T & { id: string }) | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const quizUuid = await resolveQuizUuid(quizId);
  if (!quizUuid) return null;
  const { data } = await supabase
    .from('quiz_completions')
    .select('*')
    .eq('quiz_id', quizUuid)
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) return null;
  const map = new Map<string, string>();
  map.set(quizUuid, quizId);
  return quizCompletionRowToDoc(data as QuizCompletionRow, map) as T & { id: string };
}

export async function isQuizCompleted(quizId: string, userId: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase) return false;
  const quizUuid = await resolveQuizUuid(quizId);
  if (!quizUuid) return false;
  const { data } = await supabase
    .from('quiz_completions')
    .select('id')
    .eq('quiz_id', quizUuid)
    .eq('user_id', userId)
    .maybeSingle();
  return !!data;
}

export function subscribeQuizCompletionsByUser(
  userId: string,
  callback: (completions: QuizCompletionDoc[]) => void,
  onError?: ErrorCallback,
): Unsubscribe {
  let cancelled = false;
  let timer: NodeJS.Timeout | null = null;

  const fetch = async () => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase || !DEFAULT_ORG_ID) {
        if (!cancelled) callback([]);
        return;
      }
      const { data, error } = await supabase
        .from('quiz_completions')
        .select('*, quizzes!inner(id, source_firestore_id)')
        .eq('org_id', DEFAULT_ORG_ID)
        .eq('user_id', userId);
      if (error) {
        if (!cancelled && onError) onError(error as unknown as Error);
        return;
      }
      type JoinRow = QuizCompletionRow & {
        quizzes: { id: string; source_firestore_id: string | null };
      };
      const rows = (data as JoinRow[] | null) || [];
      const reverseMap = new Map<string, string>();
      for (const r of rows) {
        if (r.quizzes?.source_firestore_id) reverseMap.set(r.quiz_id, r.quizzes.source_firestore_id);
      }
      if (!cancelled) {
        callback(rows.map((r) => quizCompletionRowToDoc(r, reverseMap)));
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

/**
 * Firestore completion docId 배열로 조회.
 * docId 규칙: `${firestoreQuizId}_${userId}` → quizId/userId 파싱 후 Supabase 조회.
 */
export async function fetchQuizCompletionsByIds<T extends Record<string, unknown>>(
  completionIds: string[],
  _options?: DocConvertOptions,
): Promise<(T & { id: string })[]> {
  if (completionIds.length === 0) return [];
  const supabase = getSupabaseClient();
  if (!supabase) return [];

  // docId → {firestoreQuizId, userId} 파싱
  const parsed: Array<{ firestoreQuizId: string; userId: string }> = [];
  for (const compId of completionIds) {
    const idx = compId.lastIndexOf('_');
    if (idx < 0) continue;
    parsed.push({
      firestoreQuizId: compId.slice(0, idx),
      userId: compId.slice(idx + 1),
    });
  }
  if (parsed.length === 0) return [];

  // 해당 firestoreQuizId 들의 uuid 일괄 해석
  const uniqueQuizIds = Array.from(new Set(parsed.map((p) => p.firestoreQuizId)));
  const uuidMap = await resolveQuizUuids(uniqueQuizIds);
  if (uuidMap.size === 0) return [];
  const reverseMap = new Map<string, string>();
  for (const [fsId, uuid] of uuidMap.entries()) reverseMap.set(uuid, fsId);

  // user_id 별로 쿼리 묶기 (IN (uuid) + IN (userId) 로 한 번에 가져오기)
  const userIds = Array.from(new Set(parsed.map((p) => p.userId)));
  const quizUuids = Array.from(uuidMap.values());
  if (userIds.length === 0 || quizUuids.length === 0) return [];

  const out: QuizCompletionDoc[] = [];
  for (let i = 0; i < quizUuids.length; i += 30) {
    const uuidBatch = quizUuids.slice(i, i + 30);
    const { data } = await supabase
      .from('quiz_completions')
      .select('*')
      .in('quiz_id', uuidBatch)
      .in('user_id', userIds);
    for (const row of (data as QuizCompletionRow[] | null) || []) {
      out.push(quizCompletionRowToDoc(row, reverseMap));
    }
  }

  // 요청된 completionId 조합만 필터링 (완료 매트릭스에서 교차 발생 방지)
  const requested = new Set(completionIds);
  return out.filter((c) => requested.has(c.id as string)) as (T & { id: string })[];
}

// ============================================================
// 피드백 (feedbacks)
// ============================================================

export async function fetchFeedbacksByQuizzes<T extends Record<string, unknown>>(
  quizIds: string[],
  _options?: DocConvertOptions,
): Promise<(T & { id: string })[]> {
  if (quizIds.length === 0) return [];
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  const uuidMap = await resolveQuizUuids(quizIds);
  if (uuidMap.size === 0) return [];
  const reverseMap = new Map<string, string>();
  for (const [fsId, uuid] of uuidMap.entries()) reverseMap.set(uuid, fsId);
  const uuids = Array.from(uuidMap.values());

  type JoinRow = FeedbackRow & { quizzes: QuizInfoJoin };
  const out: FeedbackDoc[] = [];
  for (let i = 0; i < uuids.length; i += 30) {
    const batch = uuids.slice(i, i + 30);
    const { data } = await supabase
      .from('feedbacks')
      .select(`*, quizzes!inner(${QUIZZES_JOIN_COLS})`)
      .in('quiz_id', batch);
    for (const row of (data as JoinRow[] | null) || []) {
      out.push(feedbackRowToDoc(row, reverseMap, row.quizzes));
    }
  }
  return out as (T & { id: string })[];
}

export async function fetchFeedbacksByUser<T extends Record<string, unknown>>(
  userId: string,
  _options?: DocConvertOptions,
): Promise<(T & { id: string })[]> {
  const supabase = getSupabaseClient();
  if (!supabase || !DEFAULT_ORG_ID) return [];
  const { data } = await supabase
    .from('feedbacks')
    .select(`*, quizzes!inner(${QUIZZES_JOIN_COLS})`)
    .eq('org_id', DEFAULT_ORG_ID)
    .eq('user_id', userId);
  type JoinRow = FeedbackRow & { quizzes: QuizInfoJoin };
  const rows = (data as JoinRow[] | null) || [];
  const reverseMap = new Map<string, string>();
  for (const r of rows) {
    if (r.quizzes?.source_firestore_id) reverseMap.set(r.quiz_id, r.quizzes.source_firestore_id);
  }
  return rows.map((r) => feedbackRowToDoc(r, reverseMap, r.quizzes)) as (T & { id: string })[];
}

// ============================================================
// 쓰기 경로 — Firebase 위임
//
// CF 트리거(onQuizSync, onQuizCreate, onQuizMakePublic, onQuizComplete 등)가
// Firestore 쓰기에 묶여있고 EXP/AI 로직을 수행하므로, 플래그 on 되어도
// 모든 CRUD 는 Firestore → CF dual-write → Supabase 경로로 흐름.
// ============================================================

export const createQuiz = firebaseQuizRepo.createQuiz;
export const createQuizWithId = firebaseQuizRepo.createQuizWithId;
export const updateQuiz = firebaseQuizRepo.updateQuiz;
export const updateQuizRaw = firebaseQuizRepo.updateQuizRaw;
export const deleteQuiz = firebaseQuizRepo.deleteQuiz;

export const addQuizResult = firebaseQuizRepo.addQuizResult;
export const updateQuizResult = firebaseQuizRepo.updateQuizResult;
export const deleteQuizResultsByUserAndQuiz = firebaseQuizRepo.deleteQuizResultsByUserAndQuiz;

export const setQuizCompletion = firebaseQuizRepo.setQuizCompletion;
export const mergeQuizCompletion = firebaseQuizRepo.mergeQuizCompletion;
export const deleteQuizCompletion = firebaseQuizRepo.deleteQuizCompletion;

export const addFeedback = firebaseQuizRepo.addFeedback;

// ============================================================
// Jobs — Firebase 전용 (Supabase 이관 제외)
// ============================================================

export const subscribeJob = firebaseQuizRepo.subscribeJob;
export const createJob = firebaseQuizRepo.createJob;

// ============================================================
// 배치 유틸 re-export
// ============================================================

export { writeBatch, Timestamp } from '../firebase/firestoreBase';
