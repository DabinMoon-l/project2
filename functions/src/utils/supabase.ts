/**
 * Supabase Admin 클라이언트 (Cloud Functions 전용)
 *
 * service_role 키 사용 — RLS bypass, 모든 테이블 전체 접근.
 * 절대 클라이언트 번들에 포함되면 안 됨 (이 파일은 functions/ 하위라 분리됨).
 *
 * 사용처: computeRankingsScheduled, computeRadarNormScheduled 듀얼 라이트.
 *
 * 환경변수 미설정 시 null 반환 → 호출부에서 Firestore-only 모드로 폴백.
 * 배포 시 Firebase Functions 환경변수로 주입:
 *   firebase functions:config:set supabase.url="..." supabase.service_role="..."
 * 또는 v2 방식:
 *   defineSecret("SUPABASE_URL"), defineSecret("SUPABASE_SERVICE_ROLE_KEY")
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { defineSecret } from "firebase-functions/params";

/**
 * Firebase Functions v2 secrets.
 * 각 Cloud Function의 `secrets: [...]` 배열에 포함시켜야 런타임 process.env에 주입됨.
 *
 * 배포 전 설정:
 *   firebase functions:secrets:set SUPABASE_URL
 *   firebase functions:secrets:set SUPABASE_SERVICE_ROLE_KEY
 */
export const SUPABASE_URL_SECRET = defineSecret("SUPABASE_URL");
export const SUPABASE_SERVICE_ROLE_SECRET = defineSecret("SUPABASE_SERVICE_ROLE_KEY");

let _client: SupabaseClient | null | undefined = undefined;

/**
 * Cloud Function 안에서 호출. 환경변수 없으면 null → 호출부가 skip 결정.
 *
 * Firebase Functions v2에서는 secrets API 권장:
 *   import { defineSecret } from "firebase-functions/params";
 *   const SUPABASE_URL = defineSecret("SUPABASE_URL");
 *   const SUPABASE_SERVICE_ROLE = defineSecret("SUPABASE_SERVICE_ROLE_KEY");
 *   export const fn = onSchedule({ secrets: [SUPABASE_URL, SUPABASE_SERVICE_ROLE], ... }, ...);
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  if (_client !== undefined) return _client;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    console.warn("[Supabase Admin] URL/service_role not configured — dual-write skipped");
    _client = null;
    return null;
  }

  _client = createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    db: {
      // 여러 CF 호출이 동시에 같은 테이블 upsert 시 direct connection 권장
      schema: "public",
    },
  });

  return _client;
}

/**
 * 듀얼 라이트 활성 여부.
 *
 * 기본: secrets(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)가 바인딩되어 있으면 활성.
 * Kill switch: SUPABASE_DUAL_WRITE=false 로 명시적 비활성화 가능 (장애 시 긴급 롤백).
 */
export function isSupabaseDualWriteEnabled(): boolean {
  if (process.env.SUPABASE_DUAL_WRITE === "false") return false;
  if (!process.env.SUPABASE_URL) return false;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return false;
  return true;
}

/**
 * 기본 org_id (Phase 2 단일 테넌트 단계).
 *
 * Functions 런타임에서는 NEXT_PUBLIC_* 가 자동 주입되지 않으므로
 * `firebase functions:secrets:set DEFAULT_ORG_ID` 로 등록한 값을 사용.
 * 미설정 시 듀얼 라이트는 자동 skip.
 */
export const DEFAULT_ORG_ID_SECRET = defineSecret("DEFAULT_ORG_ID");

function getDefaultOrgId(): string | null {
  return process.env.DEFAULT_ORG_ID || null;
}

// courseCode("biology") → courses.id(UUID) 캐시. 인스턴스 수명 동안 유지.
const _courseUuidCache = new Map<string, string>();

async function getCourseUuid(courseCode: string): Promise<string | null> {
  const cached = _courseUuidCache.get(courseCode);
  if (cached) return cached;

  const client = getSupabaseAdmin();
  const orgId = getDefaultOrgId();
  if (!client || !orgId) return null;

  const { data, error } = await client
    .from("courses")
    .select("id")
    .eq("org_id", orgId)
    .eq("code", courseCode)
    .maybeSingle();

  if (error || !data?.id) return null;
  _courseUuidCache.set(courseCode, data.id as string);
  return data.id as string;
}

/**
 * enrolled_students upsert (UNIQUE course_id + student_id 기준).
 *
 * 호출 패턴: Firestore enrolledStudents/{courseCode}/students/{studentId} 쓰기 직후.
 * Supabase 실패는 Firestore 쓰기에 영향 없음 (try-catch 격리).
 *
 * fields는 변경할 컬럼만 부분 전달 가능 — name 같은 필수 컬럼은 신규 생성 시
 * 호출부에서 같이 넘겨야 함 (NOT NULL constraint).
 */
export async function supabaseDualWriteEnrollment(
  courseCode: string,
  studentId: string,
  fields: {
    name?: string;
    classId?: string | null;
    isRegistered?: boolean;
    registeredUid?: string | null;
  },
): Promise<void> {
  if (!isSupabaseDualWriteEnabled()) return;
  const client = getSupabaseAdmin();
  const orgId = getDefaultOrgId();
  if (!client || !orgId) return;

  try {
    const courseUuid = await getCourseUuid(courseCode);
    if (!courseUuid) {
      console.warn(
        `[Supabase enrollment] course UUID 매핑 실패: ${courseCode} — skip`,
      );
      return;
    }

    const row: Record<string, unknown> = {
      org_id: orgId,
      course_id: courseUuid,
      student_id: studentId,
    };
    if (fields.name !== undefined) row.name = fields.name;
    if (fields.classId !== undefined) row.class_id = fields.classId;
    if (fields.isRegistered !== undefined) row.is_registered = fields.isRegistered;
    if (fields.registeredUid !== undefined) row.registered_uid = fields.registeredUid;

    const { error } = await client
      .from("enrolled_students")
      .upsert(row, { onConflict: "course_id,student_id" });

    if (error) {
      console.error(
        `[Supabase enrollment upsert] ${courseCode}/${studentId} 실패:`,
        error.message,
        error.details ?? "",
      );
    }
  } catch (err) {
    console.error(
      `[Supabase enrollment upsert] ${courseCode}/${studentId} 예외:`,
      err,
    );
  }
}

/** enrolled_students 삭제 (removeEnrolledStudent CF 용). */
export async function supabaseDualDeleteEnrollment(
  courseCode: string,
  studentId: string,
): Promise<void> {
  if (!isSupabaseDualWriteEnabled()) return;
  const client = getSupabaseAdmin();
  if (!client) return;

  try {
    const courseUuid = await getCourseUuid(courseCode);
    if (!courseUuid) return;

    const { error } = await client
      .from("enrolled_students")
      .delete()
      .eq("course_id", courseUuid)
      .eq("student_id", studentId);

    if (error) {
      console.error(
        `[Supabase enrollment delete] ${courseCode}/${studentId} 실패:`,
        error.message,
      );
    }
  } catch (err) {
    console.error(
      `[Supabase enrollment delete] ${courseCode}/${studentId} 예외:`,
      err,
    );
  }
}

// ============================================================
// rabbits / rabbit_holdings 듀얼 라이트 (Phase 2 Step 3)
// ============================================================

interface RabbitDiscoverer {
  userId: string;
  nickname: string;
  discoveryOrder: number;
}

/**
 * rabbits 테이블 upsert.
 *
 * Firestore `rabbits/{courseId}_{rabbitId}` 트랜잭션 커밋 후 호출.
 * source_firestore_id = "{courseCode}_{rabbitId}" 로 매핑.
 *
 * fields 는 변경된 컬럼만 넘기면 됨 — null 의미를 가지는 필드는 명시적으로 전달.
 */
export async function supabaseDualWriteRabbit(
  courseCode: string,
  rabbitId: number,
  fields: {
    name?: string | null;
    firstDiscovererUserId?: string;
    firstDiscovererName?: string;
    firstDiscovererNickname?: string;
    discoverers?: RabbitDiscoverer[];
    discovererCount?: number;
  },
): Promise<void> {
  if (!isSupabaseDualWriteEnabled()) return;
  const client = getSupabaseAdmin();
  const orgId = getDefaultOrgId();
  if (!client || !orgId) return;

  try {
    const courseUuid = await getCourseUuid(courseCode);
    if (!courseUuid) return;

    const row: Record<string, unknown> = {
      org_id: orgId,
      course_id: courseUuid,
      rabbit_id: rabbitId,
      source_firestore_id: `${courseCode}_${rabbitId}`,
    };
    if (fields.name !== undefined) row.name = fields.name;
    if (fields.firstDiscovererUserId !== undefined)
      row.first_discoverer_user_id = fields.firstDiscovererUserId;
    if (fields.firstDiscovererName !== undefined)
      row.first_discoverer_name = fields.firstDiscovererName;
    if (fields.firstDiscovererNickname !== undefined)
      row.first_discoverer_nickname = fields.firstDiscovererNickname;
    if (fields.discoverers !== undefined) row.discoverers = fields.discoverers;
    if (fields.discovererCount !== undefined)
      row.discoverer_count = fields.discovererCount;

    const { error } = await client
      .from("rabbits")
      .upsert(row, { onConflict: "org_id,course_id,rabbit_id" });

    if (error) {
      console.error(
        `[Supabase rabbit upsert] ${courseCode}/${rabbitId} 실패:`,
        error.message,
        error.details ?? "",
      );
    }
  } catch (err) {
    console.error(
      `[Supabase rabbit upsert] ${courseCode}/${rabbitId} 예외:`,
      err,
    );
  }
}

/**
 * rabbit_holdings 테이블 upsert.
 *
 * Firestore `users/{uid}/rabbitHoldings/{courseId}_{rabbitId}` 커밋 후 호출.
 */
export async function supabaseDualWriteRabbitHolding(
  courseCode: string,
  userId: string,
  rabbitId: number,
  fields: {
    level?: number;
    stats?: { hp: number; atk: number; def: number };
    discoveryOrder?: number;
    discoveredAt?: Date;
  },
): Promise<void> {
  if (!isSupabaseDualWriteEnabled()) return;
  const client = getSupabaseAdmin();
  const orgId = getDefaultOrgId();
  if (!client || !orgId) return;

  try {
    const courseUuid = await getCourseUuid(courseCode);
    if (!courseUuid) return;

    const row: Record<string, unknown> = {
      org_id: orgId,
      course_id: courseUuid,
      user_id: userId,
      rabbit_id: rabbitId,
      source_firestore_id: `${userId}__${courseCode}_${rabbitId}`,
    };
    if (fields.level !== undefined) row.level = fields.level;
    if (fields.stats !== undefined) row.stats = fields.stats;
    if (fields.discoveryOrder !== undefined)
      row.discovery_order = fields.discoveryOrder;
    if (fields.discoveredAt !== undefined)
      row.discovered_at = fields.discoveredAt.toISOString();

    const { error } = await client
      .from("rabbit_holdings")
      .upsert(row, { onConflict: "org_id,user_id,course_id,rabbit_id" });

    if (error) {
      console.error(
        `[Supabase holding upsert] ${userId}/${courseCode}/${rabbitId} 실패:`,
        error.message,
        error.details ?? "",
      );
    }
  } catch (err) {
    console.error(
      `[Supabase holding upsert] ${userId}/${courseCode}/${rabbitId} 예외:`,
      err,
    );
  }
}

// ============================================================
// reviews / custom_folders 듀얼 라이트 (Phase 2 Step 3)
// ============================================================

// Firestore quizId("abc123") → Supabase quizzes.id(UUID) 캐시
const _quizUuidCache = new Map<string, string>();

/**
 * Firestore quizId로 Supabase quizzes.id(UUID) 조회 (캐시됨).
 *
 * - quizzes 테이블은 이관 시 source_firestore_id 에 원본 Firestore doc id 저장
 * - 없으면 null (tekken 배틀 문제 등)
 */
export async function getQuizUuidByFirestoreId(
  firestoreQuizId: string,
): Promise<string | null> {
  const cached = _quizUuidCache.get(firestoreQuizId);
  if (cached !== undefined) return cached || null;

  const client = getSupabaseAdmin();
  if (!client) return null;

  const { data, error } = await client
    .from("quizzes")
    .select("id")
    .eq("source_firestore_id", firestoreQuizId)
    .maybeSingle();

  if (error || !data?.id) {
    _quizUuidCache.set(firestoreQuizId, ""); // 음성 캐시 (재조회 방지)
    return null;
  }
  const uuid = data.id as string;
  _quizUuidCache.set(firestoreQuizId, uuid);
  return uuid;
}

/** Firestore review 문서 1건을 Supabase row 형식으로 변환 */
export interface SupabaseReviewInput {
  firestoreId: string;                 // Firestore doc id (source_firestore_id 용)
  userId: string;
  firestoreQuizId: string | null;      // null 이면 metadata 에만 보존 (tekken 등)
  originalFirestoreQuizId?: string;    // Supabase quizzes 에 없지만 보존할 원본 id (tekken)
  courseCode: string | null;           // biology/microbiology/pathophysiology
  questionId: string;
  chapterId?: string | null;
  chapterDetailId?: string | null;
  reviewType?: string | null;
  isCorrect?: boolean | null;
  isBookmarked?: boolean;
  reviewCount?: number;
  lastReviewedAt?: Date | null;
  questionData: Record<string, unknown>;   // 문제 본문 + 채점정보
  metadata?: Record<string, unknown>;
  folderId?: string | null;
  createdAt?: Date | null;
}

async function buildReviewRow(
  input: SupabaseReviewInput,
  orgId: string,
): Promise<Record<string, unknown> | null> {
  const courseUuid = input.courseCode ? await getCourseUuid(input.courseCode) : null;
  let quizUuid: string | null = null;
  if (input.firestoreQuizId) {
    quizUuid = await getQuizUuidByFirestoreId(input.firestoreQuizId);
  }

  const metadata: Record<string, unknown> = { ...(input.metadata || {}) };
  if (input.originalFirestoreQuizId && !quizUuid) {
    metadata.originalQuizId = input.originalFirestoreQuizId;
  }
  if (input.firestoreQuizId && !quizUuid) {
    // Firestore 엔 quizId 있지만 Supabase 에 없음 — metadata 에 보존
    metadata.originalQuizId = input.firestoreQuizId;
  }

  return {
    org_id: orgId,
    course_id: courseUuid,
    user_id: input.userId,
    quiz_id: quizUuid,
    question_id: input.questionId,
    chapter_id: input.chapterId ?? null,
    chapter_detail_id: input.chapterDetailId ?? null,
    question_data: input.questionData,
    is_correct: input.isCorrect ?? null,
    is_bookmarked: input.isBookmarked ?? false,
    review_count: input.reviewCount ?? 0,
    review_type: input.reviewType ?? null,
    folder_id: input.folderId ?? null,
    last_reviewed_at: input.lastReviewedAt ? input.lastReviewedAt.toISOString() : null,
    metadata: Object.keys(metadata).length > 0 ? metadata : null,
    source_firestore_id: input.firestoreId,
    created_at: input.createdAt ? input.createdAt.toISOString() : new Date().toISOString(),
  };
}

/**
 * 같은 user_id + quiz_id(원본 Firestore id) 의 reviews 전체 삭제.
 *
 * reviewsGenerator 재시도 플로우에서 Firestore 삭제와 맞춤.
 * Supabase quizzes 에 매핑이 있으면 quiz_id 로, 없으면 metadata->>originalQuizId 로 삭제.
 */
export async function supabaseDualDeleteReviewsByQuiz(
  userId: string,
  firestoreQuizId: string,
): Promise<void> {
  if (!isSupabaseDualWriteEnabled()) return;
  const client = getSupabaseAdmin();
  if (!client) return;

  try {
    const quizUuid = await getQuizUuidByFirestoreId(firestoreQuizId);
    if (quizUuid) {
      const { error } = await client
        .from("reviews")
        .delete()
        .eq("user_id", userId)
        .eq("quiz_id", quizUuid);
      if (error) {
        console.error(
          `[Supabase reviews delete] ${userId}/${firestoreQuizId} 실패:`,
          error.message,
        );
      }
    } else {
      // quiz_id 매핑 없음 → metadata->>originalQuizId 로 매칭
      const { error } = await client
        .from("reviews")
        .delete()
        .eq("user_id", userId)
        .filter("metadata->>originalQuizId", "eq", firestoreQuizId);
      if (error) {
        console.error(
          `[Supabase reviews delete via metadata] ${userId}/${firestoreQuizId} 실패:`,
          error.message,
        );
      }
    }
  } catch (err) {
    console.error(
      `[Supabase reviews delete] ${userId}/${firestoreQuizId} 예외:`,
      err,
    );
  }
}

/**
 * reviews 배치 upsert (source_firestore_id 기준).
 *
 * reviewsGenerator 재생성 플로우 또는 tekkenRound 등에서 사용.
 * 1회 RPC = 최대 500건 권장 (Supabase 는 크게 제한 없음, 안전 마진).
 */
export async function supabaseDualBatchUpsertReviews(
  inputs: SupabaseReviewInput[],
): Promise<void> {
  if (!isSupabaseDualWriteEnabled()) return;
  if (inputs.length === 0) return;
  const client = getSupabaseAdmin();
  const orgId = getDefaultOrgId();
  if (!client || !orgId) return;

  try {
    const rows: Record<string, unknown>[] = [];
    for (const input of inputs) {
      const row = await buildReviewRow(input, orgId);
      if (row) rows.push(row);
    }
    if (rows.length === 0) return;

    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await client
        .from("reviews")
        .upsert(chunk, { onConflict: "source_firestore_id" });
      if (error) {
        console.error(
          `[Supabase reviews upsert] chunk=${i} size=${chunk.length} 실패:`,
          error.message,
          error.details ?? "",
        );
      }
    }
  } catch (err) {
    console.error(`[Supabase reviews upsert] 예외:`, err);
  }
}

/** 단건 review upsert (tekkenRound 등). */
export async function supabaseDualWriteReview(
  input: SupabaseReviewInput,
): Promise<void> {
  await supabaseDualBatchUpsertReviews([input]);
}

/** 유저 기준 reviews 전체 삭제 (semesterTransition 용). */
export async function supabaseDualDeleteReviewsByUser(
  userId: string,
): Promise<void> {
  if (!isSupabaseDualWriteEnabled()) return;
  const client = getSupabaseAdmin();
  if (!client) return;

  try {
    const { error } = await client.from("reviews").delete().eq("user_id", userId);
    if (error) {
      console.error(
        `[Supabase reviews delete by user] ${userId} 실패:`,
        error.message,
      );
    }
  } catch (err) {
    console.error(`[Supabase reviews delete by user] ${userId} 예외:`, err);
  }
}

/** 유저 기준 custom_folders 전체 삭제 (semesterTransition 용). */
export async function supabaseDualDeleteFoldersByUser(
  userId: string,
): Promise<void> {
  if (!isSupabaseDualWriteEnabled()) return;
  const client = getSupabaseAdmin();
  if (!client) return;

  try {
    const { error } = await client.from("custom_folders").delete().eq("user_id", userId);
    if (error) {
      console.error(
        `[Supabase folders delete by user] ${userId} 실패:`,
        error.message,
      );
    }
  } catch (err) {
    console.error(`[Supabase folders delete by user] ${userId} 예외:`, err);
  }
}

// ============================================================
// posts / comments 듀얼 라이트 (Phase 2 Step 3 - board)
// ============================================================

export interface SupabasePostInput {
  firestoreId: string;
  courseCode: string | null;
  authorId: string;
  authorNickname?: string | null;
  authorClassType?: string | null;
  title: string;
  content: string;
  category?: string | null;
  tag?: string | null;
  chapterTags?: string[];
  isAnonymous?: boolean;
  isNotice?: boolean;
  isPrivate?: boolean;
  toProfessor?: boolean;
  imageUrl?: string | null;
  imageUrls?: string[];
  fileUrls?: string[];
  aiDetailedAnswer?: string | null;
  likes?: number;
  likeCount?: number;
  likedBy?: string[];
  commentCount?: number;
  viewCount?: number;
  acceptedCommentId?: string | null;
  isPinned?: boolean;
  pinnedAt?: Date | null;
  pinnedBy?: string | null;
  rewarded?: boolean;
  rewardedAt?: Date | null;
  expRewarded?: number | null;
  createdAt?: Date | null;
  metadata?: Record<string, unknown>;
}

function toIsoOrNull(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

async function buildPostRow(
  input: SupabasePostInput,
  orgId: string,
): Promise<Record<string, unknown> | null> {
  const courseUuid = input.courseCode ? await getCourseUuid(input.courseCode) : null;
  if (!courseUuid) {
    console.warn(
      `[Supabase post upsert] course UUID 매핑 실패: ${input.courseCode} — skip ${input.firestoreId}`,
    );
    return null;
  }

  // Supabase tag CHECK 제약: '학술' | '기타' | '학사' | '비공개' 만 허용
  const ALLOWED_TAGS = new Set(['학술', '기타', '학사', '비공개']);
  const tag = input.tag && ALLOWED_TAGS.has(input.tag) ? input.tag : null;

  return {
    org_id: orgId,
    course_id: courseUuid,
    author_id: input.authorId,
    author_nickname: input.authorNickname ?? null,
    author_class_type: input.authorClassType ?? null,
    title: input.title,
    content: input.content,
    category: input.category ?? null,
    tag,
    chapter_tags: input.chapterTags ?? [],
    is_anonymous: input.isAnonymous ?? false,
    is_notice: input.isNotice ?? false,
    is_private: input.isPrivate ?? false,
    to_professor: input.toProfessor ?? false,
    image_url: input.imageUrl ?? null,
    image_urls: input.imageUrls ?? [],
    file_urls: input.fileUrls ?? [],
    ai_detailed_answer: input.aiDetailedAnswer ?? null,
    likes: input.likes ?? 0,
    like_count: input.likeCount ?? 0,
    liked_by: input.likedBy ?? [],
    comment_count: input.commentCount ?? 0,
    view_count: input.viewCount ?? 0,
    accepted_comment_id: null, // id 는 Firestore id 라 별도 매핑 필요 — acceptComment 헬퍼에서 처리
    rewarded: input.rewarded ?? false,
    rewarded_at: toIsoOrNull(input.rewardedAt),
    exp_rewarded: input.expRewarded ?? null,
    metadata: input.metadata
      ? {
          ...input.metadata,
          // Firestore 원본의 isPinned/pinnedAt 등 Supabase 스키마에 없는 필드 보존
          isPinned: input.isPinned ?? false,
          pinnedAt: toIsoOrNull(input.pinnedAt ?? null),
          pinnedBy: input.pinnedBy ?? null,
          acceptedCommentId: input.acceptedCommentId ?? null,
        }
      : {
          isPinned: input.isPinned ?? false,
          pinnedAt: toIsoOrNull(input.pinnedAt ?? null),
          pinnedBy: input.pinnedBy ?? null,
          acceptedCommentId: input.acceptedCommentId ?? null,
        },
    source_firestore_id: input.firestoreId,
    created_at: toIsoOrNull(input.createdAt) || new Date().toISOString(),
  };
}

/** posts 단건 upsert (source_firestore_id 기준) */
export async function supabaseDualUpsertPost(
  input: SupabasePostInput,
): Promise<void> {
  if (!isSupabaseDualWriteEnabled()) return;
  const client = getSupabaseAdmin();
  const orgId = getDefaultOrgId();
  if (!client || !orgId) return;

  try {
    const row = await buildPostRow(input, orgId);
    if (!row) return;

    const { error } = await client
      .from('posts')
      .upsert(row, { onConflict: 'source_firestore_id' });
    if (error) {
      console.error(
        `[Supabase post upsert] ${input.firestoreId} 실패:`,
        error.message,
        error.details ?? '',
      );
    }
  } catch (err) {
    console.error(`[Supabase post upsert] ${input.firestoreId} 예외:`, err);
  }
}

/** posts 부분 update (source_firestore_id 기준) — liked_by/like_count/commentCount 등 */
export async function supabaseDualUpdatePostPartial(
  firestoreId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  if (!isSupabaseDualWriteEnabled()) return;
  const client = getSupabaseAdmin();
  if (!client) return;

  try {
    const { error } = await client
      .from('posts')
      .update(patch)
      .eq('source_firestore_id', firestoreId);
    if (error) {
      console.error(
        `[Supabase post update] ${firestoreId} 실패:`,
        error.message,
      );
    }
  } catch (err) {
    console.error(`[Supabase post update] ${firestoreId} 예외:`, err);
  }
}

/** posts 삭제 (cascade 로 comments 자동 삭제) */
export async function supabaseDualDeletePost(firestoreId: string): Promise<void> {
  if (!isSupabaseDualWriteEnabled()) return;
  const client = getSupabaseAdmin();
  if (!client) return;

  try {
    const { error } = await client
      .from('posts')
      .delete()
      .eq('source_firestore_id', firestoreId);
    if (error) {
      console.error(`[Supabase post delete] ${firestoreId} 실패:`, error.message);
    }
  } catch (err) {
    console.error(`[Supabase post delete] ${firestoreId} 예외:`, err);
  }
}

export interface SupabaseCommentInput {
  firestoreId: string;
  firestorePostId: string;
  firestoreParentId?: string | null;
  authorId: string;
  authorNickname?: string | null;
  authorClassType?: string | null;
  content: string;
  imageUrls?: string[];
  isAnonymous?: boolean;
  isAiReply?: boolean;
  isAccepted?: boolean;
  acceptedAt?: Date | null;
  likes?: number;
  likeCount?: number;
  likedBy?: string[];
  rewarded?: boolean;
  rewardedAt?: Date | null;
  expRewarded?: number | null;
  createdAt?: Date | null;
  metadata?: Record<string, unknown>;
}

// Supabase posts.id(UUID) 를 Firestore post id 로 조회하는 캐시
const _postUuidCache = new Map<string, string>();

async function getPostUuidByFirestoreId(firestoreId: string): Promise<string | null> {
  const cached = _postUuidCache.get(firestoreId);
  if (cached) return cached;
  const client = getSupabaseAdmin();
  if (!client) return null;
  const { data } = await client
    .from('posts')
    .select('id')
    .eq('source_firestore_id', firestoreId)
    .maybeSingle();
  const uuid = (data as { id?: string } | null)?.id || null;
  if (uuid) _postUuidCache.set(firestoreId, uuid);
  return uuid;
}

// Supabase comments.id(UUID) 를 Firestore comment id 로 조회
async function getCommentUuidByFirestoreId(firestoreId: string): Promise<string | null> {
  const client = getSupabaseAdmin();
  if (!client) return null;
  const { data } = await client
    .from('comments')
    .select('id')
    .eq('source_firestore_id', firestoreId)
    .maybeSingle();
  return (data as { id?: string } | null)?.id || null;
}

async function buildCommentRow(
  input: SupabaseCommentInput,
  orgId: string,
): Promise<Record<string, unknown> | null> {
  const postUuid = await getPostUuidByFirestoreId(input.firestorePostId);
  if (!postUuid) {
    console.warn(
      `[Supabase comment upsert] post UUID 매핑 실패: ${input.firestorePostId} — skip ${input.firestoreId}`,
    );
    return null;
  }
  let parentUuid: string | null = null;
  if (input.firestoreParentId) {
    parentUuid = await getCommentUuidByFirestoreId(input.firestoreParentId);
    // parent 매핑 실패 시 null 로 fallback (루트로 처리)
  }

  return {
    org_id: orgId,
    post_id: postUuid,
    parent_id: parentUuid,
    author_id: input.authorId,
    author_nickname: input.authorNickname ?? null,
    author_class_type: input.authorClassType ?? null,
    content: input.content,
    image_urls: input.imageUrls ?? [],
    is_anonymous: input.isAnonymous ?? false,
    is_ai_reply: input.isAiReply ?? false,
    is_accepted: input.isAccepted ?? false,
    accepted_at: toIsoOrNull(input.acceptedAt),
    likes: input.likes ?? 0,
    like_count: input.likeCount ?? 0,
    liked_by: input.likedBy ?? [],
    rewarded: input.rewarded ?? false,
    rewarded_at: toIsoOrNull(input.rewardedAt),
    exp_rewarded: input.expRewarded ?? null,
    metadata: input.metadata || null,
    source_firestore_id: input.firestoreId,
    created_at: toIsoOrNull(input.createdAt) || new Date().toISOString(),
  };
}

/** comments 단건 upsert */
export async function supabaseDualUpsertComment(
  input: SupabaseCommentInput,
): Promise<void> {
  if (!isSupabaseDualWriteEnabled()) return;
  const client = getSupabaseAdmin();
  const orgId = getDefaultOrgId();
  if (!client || !orgId) return;

  try {
    const row = await buildCommentRow(input, orgId);
    if (!row) return;
    const { error } = await client
      .from('comments')
      .upsert(row, { onConflict: 'source_firestore_id' });
    if (error) {
      console.error(
        `[Supabase comment upsert] ${input.firestoreId} 실패:`,
        error.message,
        error.details ?? '',
      );
    }
  } catch (err) {
    console.error(`[Supabase comment upsert] ${input.firestoreId} 예외:`, err);
  }
}

/** comments 부분 update (likes / is_accepted 등) */
export async function supabaseDualUpdateCommentPartial(
  firestoreId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  if (!isSupabaseDualWriteEnabled()) return;
  const client = getSupabaseAdmin();
  if (!client) return;

  try {
    const { error } = await client
      .from('comments')
      .update(patch)
      .eq('source_firestore_id', firestoreId);
    if (error) {
      console.error(
        `[Supabase comment update] ${firestoreId} 실패:`,
        error.message,
      );
    }
  } catch (err) {
    console.error(`[Supabase comment update] ${firestoreId} 예외:`, err);
  }
}

/** comments 삭제 */
export async function supabaseDualDeleteComment(firestoreId: string): Promise<void> {
  if (!isSupabaseDualWriteEnabled()) return;
  const client = getSupabaseAdmin();
  if (!client) return;

  try {
    const { error } = await client
      .from('comments')
      .delete()
      .eq('source_firestore_id', firestoreId);
    if (error) {
      console.error(
        `[Supabase comment delete] ${firestoreId} 실패:`,
        error.message,
      );
    }
  } catch (err) {
    console.error(`[Supabase comment delete] ${firestoreId} 예외:`, err);
  }
}

/** 게시글 채택 처리: posts.accepted_comment_id + 해당 comment.is_accepted/accepted_at */
export async function supabaseDualAcceptComment(
  firestorePostId: string,
  firestoreCommentId: string,
): Promise<void> {
  if (!isSupabaseDualWriteEnabled()) return;
  const client = getSupabaseAdmin();
  if (!client) return;

  try {
    const commentUuid = await getCommentUuidByFirestoreId(firestoreCommentId);
    // posts metadata.acceptedCommentId 업데이트 (스키마의 accepted_comment_id 는 uuid)
    const postPatch: Record<string, unknown> = {};
    if (commentUuid) postPatch.accepted_comment_id = commentUuid;

    if (Object.keys(postPatch).length > 0) {
      const { error: postErr } = await client
        .from('posts')
        .update(postPatch)
        .eq('source_firestore_id', firestorePostId);
      if (postErr) {
        console.error(
          `[Supabase accept comment — post] ${firestorePostId} 실패:`,
          postErr.message,
        );
      }
    }

    const { error: commErr } = await client
      .from('comments')
      .update({
        is_accepted: true,
        accepted_at: new Date().toISOString(),
      })
      .eq('source_firestore_id', firestoreCommentId);
    if (commErr) {
      console.error(
        `[Supabase accept comment — comment] ${firestoreCommentId} 실패:`,
        commErr.message,
      );
    }
  } catch (err) {
    console.error(
      `[Supabase accept comment] ${firestorePostId}/${firestoreCommentId} 예외:`,
      err,
    );
  }
}

/**
 * rankings/radar_norms 테이블에서 단일 row 읽기.
 *
 * Supabase가 primary 소스가 된 이후 (2026-04-19) prevDayRanks/updatedAt 계산에
 * 기존 Firestore 문서 대신 Supabase row를 사용해야 순위 변동이 정확히 유지됨.
 *
 * 반환: { data, updatedAt } (row 없거나 설정 미비 시 null)
 */
export async function supabaseReadDoc(
  table: "rankings" | "radar_norms",
  courseId: string,
): Promise<{ data: Record<string, unknown>; updatedAt: Date } | null> {
  if (!isSupabaseDualWriteEnabled()) return null;
  const client = getSupabaseAdmin();
  if (!client) return null;

  try {
    const { data, error } = await client
      .from(table)
      .select("data, updated_at")
      .eq("course_id", courseId)
      .maybeSingle();

    if (error) {
      if (error.code === "PGRST116") return null;
      console.error(
        `[Supabase read] ${table}/${courseId} 실패:`,
        error.message,
        error.details ?? "",
      );
      return null;
    }
    if (!data?.data) return null;
    return {
      data: data.data as Record<string, unknown>,
      updatedAt: new Date(data.updated_at as string),
    };
  } catch (err) {
    console.error(`[Supabase read] ${table}/${courseId} 예외:`, err);
    return null;
  }
}

/**
 * rankings/radar_norms 테이블에 { course_id, data, updated_at } upsert.
 *
 * - Firestore 쓰기 직후 호출
 * - Supabase 실패는 Firestore 쓰기에 영향 X (try-catch로 격리, 로그만)
 * - data에 Firestore 센티넬(FieldValue.serverTimestamp 등) 포함 시 직렬화 오류 가능 → 호출부에서 제거
 */
export async function supabaseDualWriteUpsert(
  table: "rankings" | "radar_norms",
  courseId: string,
  data: Record<string, unknown>,
): Promise<void> {
  if (!isSupabaseDualWriteEnabled()) return;
  const client = getSupabaseAdmin();
  if (!client) return;

  try {
    const { error } = await client
      .from(table)
      .upsert(
        {
          course_id: courseId,
          data,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "course_id" },
      );

    if (error) {
      console.error(
        `[Supabase dual-write] ${table}/${courseId} 실패:`,
        error.message,
        error.details ?? "",
      );
    }
  } catch (err) {
    console.error(`[Supabase dual-write] ${table}/${courseId} 예외:`, err);
  }
}
