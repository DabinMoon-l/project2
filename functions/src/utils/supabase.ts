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
    console.error("[Supabase reviews upsert] 예외:", err);
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
  const ALLOWED_TAGS = new Set(["학술", "기타", "학사", "비공개"]);
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
      .from("posts")
      .upsert(row, { onConflict: "source_firestore_id" });
    if (error) {
      console.error(
        `[Supabase post upsert] ${input.firestoreId} 실패:`,
        error.message,
        error.details ?? "",
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
      .from("posts")
      .update(patch)
      .eq("source_firestore_id", firestoreId);
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
      .from("posts")
      .delete()
      .eq("source_firestore_id", firestoreId);
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
    .from("posts")
    .select("id")
    .eq("source_firestore_id", firestoreId)
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
    .from("comments")
    .select("id")
    .eq("source_firestore_id", firestoreId)
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
      .from("comments")
      .upsert(row, { onConflict: "source_firestore_id" });
    if (error) {
      console.error(
        `[Supabase comment upsert] ${input.firestoreId} 실패:`,
        error.message,
        error.details ?? "",
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
      .from("comments")
      .update(patch)
      .eq("source_firestore_id", firestoreId);
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
      .from("comments")
      .delete()
      .eq("source_firestore_id", firestoreId);
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
        .from("posts")
        .update(postPatch)
        .eq("source_firestore_id", firestorePostId);
      if (postErr) {
        console.error(
          `[Supabase accept comment — post] ${firestorePostId} 실패:`,
          postErr.message,
        );
      }
    }

    const { error: commErr } = await client
      .from("comments")
      .update({
        is_accepted: true,
        accepted_at: new Date().toISOString(),
      })
      .eq("source_firestore_id", firestoreCommentId);
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

// ============================================================
// quizzes / quiz_results / quiz_completions / feedbacks 듀얼 라이트 (Phase 2 Step 3 - quiz)
// ============================================================

const VALID_QUIZ_CATEGORIES = new Set([
  "midterm", "final", "past",
  "independent", "custom", "ai-generated",
  "professor", "professor-ai",
]);

// Firestore quiz doc 에서 Supabase 컬럼으로 매핑되는 필드 (metadata 흡수 대상 제외)
const MAPPED_QUIZ_FIELDS = new Set([
  "title", "description", "type", "difficulty", "tags",
  "courseId", "creatorId", "creatorUid", "creatorNickname", "creatorClassType",
  "classType", "targetClass", "originalType", "wasPublished",
  "questions", "questionCount",
  "oxCount", "multipleChoiceCount", "subjectiveCount", "shortAnswerCount",
  "isPublic", "isPublished", "isAiGenerated",
  "participantCount", "averageScore", "bookmarkCount", "feedbackCount",
  "rewarded", "rewardedAt", "publicRewarded", "publicRewardedAt",
  "userScores", "userFirstReviewScores",
  "semester", "pastYear", "pastExamType", "uploadedAt",
  "createdAt", "updatedAt", "expRewarded",
]);

function fsTimestampToIso(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString();
  const obj = v as {
    toDate?: () => Date;
    _seconds?: number;
    seconds?: number;
  };
  if (typeof obj.toDate === "function") return obj.toDate().toISOString();
  if (typeof obj._seconds === "number") return new Date(obj._seconds * 1000).toISOString();
  if (typeof obj.seconds === "number") return new Date(obj.seconds * 1000).toISOString();
  return null;
}

function toIntOrZero(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function toRealOrNullV(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Firestore quiz doc → Supabase quizzes row.
 * migrate-quizzes.js 의 mapQuizDoc 과 동일한 매핑.
 * category CHECK 위반이나 course 매핑 실패 시 null 반환 → 호출부 skip.
 */
async function buildQuizRow(
  firestoreId: string,
  data: Record<string, unknown>,
  orgId: string,
): Promise<Record<string, unknown> | null> {
  const courseCode = data.courseId as string | undefined;
  if (!courseCode) {
    console.warn(`[Supabase quiz upsert] courseId 없음 — skip ${firestoreId}`);
    return null;
  }
  const courseUuid = await getCourseUuid(courseCode);
  if (!courseUuid) {
    console.warn(
      `[Supabase quiz upsert] courseId '${courseCode}' 매핑 실패 — skip ${firestoreId}`,
    );
    return null;
  }

  const rawType = String(data.type || "").toLowerCase();
  if (!VALID_QUIZ_CATEGORIES.has(rawType)) {
    console.warn(
      `[Supabase quiz upsert] category '${rawType}' 미허용 — skip ${firestoreId}`,
    );
    return null;
  }

  let difficulty: string | null = null;
  if (data.difficulty) {
    const dl = String(data.difficulty).toLowerCase();
    if (["easy", "medium", "hard"].includes(dl)) difficulty = dl;
  }

  // 스키마 외 필드는 metadata jsonb 에 흡수
  const metadata: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (MAPPED_QUIZ_FIELDS.has(k)) continue;
    if (v && typeof v === "object" && typeof (v as { toDate?: unknown }).toDate === "function") {
      metadata[k] = fsTimestampToIso(v);
    } else {
      metadata[k] = v;
    }
  }

  return {
    org_id: orgId,
    course_id: courseUuid,
    creator_id:
      (data.creatorId as string) || (data.creatorUid as string) || "unknown",
    creator_nickname: (data.creatorNickname as string) || null,
    creator_class_type: (data.creatorClassType as string) || null,

    title: (data.title as string) || "(제목없음)",
    description: (data.description as string) || null,
    category: rawType,
    difficulty,
    tags: Array.isArray(data.tags) ? data.tags : [],

    class_type: (data.classType as string) || null,
    target_class: (data.targetClass as string) || null,
    original_type: (data.originalType as string) || null,
    was_published: data.wasPublished == null ? null : !!data.wasPublished,

    questions: Array.isArray(data.questions) ? data.questions : [],
    question_count: toIntOrZero(data.questionCount),
    ox_count: toIntOrZero(data.oxCount),
    multiple_choice_count: toIntOrZero(data.multipleChoiceCount),
    subjective_count: toIntOrZero(data.subjectiveCount),
    short_answer_count: toIntOrZero(data.shortAnswerCount),

    is_public: !!data.isPublic,
    is_published: !!data.isPublished,
    is_ai_generated:
      data.isAiGenerated == null
        ? rawType.startsWith("ai")
        : !!data.isAiGenerated,

    participant_count: toIntOrZero(data.participantCount),
    average_score: toRealOrNullV(data.averageScore),
    bookmark_count: toIntOrZero(data.bookmarkCount),
    feedback_count: toIntOrZero(data.feedbackCount),

    rewarded: !!data.rewarded,
    rewarded_at: fsTimestampToIso(data.rewardedAt),
    // Firestore expRewarded 는 boolean 또는 number — 실 지급액은 exp_history 에서 집계
    exp_rewarded: null,
    public_rewarded: !!data.publicRewarded,
    public_rewarded_at: fsTimestampToIso(data.publicRewardedAt),

    user_scores:
      data.userScores && typeof data.userScores === "object"
        ? data.userScores
        : {},
    user_first_review_scores:
      data.userFirstReviewScores && typeof data.userFirstReviewScores === "object"
        ? data.userFirstReviewScores
        : {},

    semester: data.semester != null ? String(data.semester) : null,
    past_year: data.pastYear != null ? String(data.pastYear) : null,
    past_exam_type: (data.pastExamType as string) || null,
    uploaded_at: fsTimestampToIso(data.uploadedAt),

    metadata,
    source_firestore_id: firestoreId,
    created_at:
      fsTimestampToIso(data.createdAt) || new Date().toISOString(),
    updated_at:
      fsTimestampToIso(data.updatedAt) ||
      fsTimestampToIso(data.createdAt) ||
      new Date().toISOString(),
  };
}

/** quizzes 전체 upsert (onDocumentWritten 트리거 또는 직접 호출) */
export async function supabaseDualWriteQuiz(
  firestoreId: string,
  data: Record<string, unknown>,
): Promise<void> {
  if (!isSupabaseDualWriteEnabled()) return;
  const client = getSupabaseAdmin();
  const orgId = getDefaultOrgId();
  if (!client || !orgId) return;
  try {
    const row = await buildQuizRow(firestoreId, data, orgId);
    if (!row) return;
    const { error } = await client
      .from("quizzes")
      .upsert(row, { onConflict: "source_firestore_id" });
    if (error) {
      console.error(
        `[Supabase quiz upsert] ${firestoreId} 실패:`,
        error.message,
        error.details ?? "",
      );
    } else {
      // 성공 시 quizUuid 캐시 갱신 (다음 quiz_result 쓰기 최적화)
      _quizUuidCache.delete(firestoreId);
    }
  } catch (err) {
    console.error(`[Supabase quiz upsert] ${firestoreId} 예외:`, err);
  }
}

/** quizzes 부분 update (source_firestore_id 기준). patch 키는 snake_case 로 전달. */
export async function supabaseDualUpdateQuizPartial(
  firestoreId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  if (!isSupabaseDualWriteEnabled()) return;
  if (Object.keys(patch).length === 0) return;
  const client = getSupabaseAdmin();
  if (!client) return;
  try {
    const { error } = await client
      .from("quizzes")
      .update(patch)
      .eq("source_firestore_id", firestoreId);
    if (error) {
      console.error(
        `[Supabase quiz update] ${firestoreId} 실패:`,
        error.message,
      );
    }
  } catch (err) {
    console.error(`[Supabase quiz update] ${firestoreId} 예외:`, err);
  }
}

/** quizzes 삭제 — CASCADE 로 quiz_results/quiz_completions/feedbacks 자동 정리. */
export async function supabaseDualDeleteQuiz(firestoreId: string): Promise<void> {
  if (!isSupabaseDualWriteEnabled()) return;
  const client = getSupabaseAdmin();
  if (!client) return;
  try {
    const { error } = await client
      .from("quizzes")
      .delete()
      .eq("source_firestore_id", firestoreId);
    if (error) {
      console.error(`[Supabase quiz delete] ${firestoreId} 실패:`, error.message);
    }
    _quizUuidCache.delete(firestoreId);
  } catch (err) {
    console.error(`[Supabase quiz delete] ${firestoreId} 예외:`, err);
  }
}

/**
 * quizzes.user_scores[userId]=score 머지 + participantCount/averageScore 업데이트.
 *
 * recordAttempt 직후 호출. 현재 row 를 읽어서 user_scores 맵 병합.
 */
export async function supabaseDualUpsertUserScore(
  firestoreQuizId: string,
  userId: string,
  score: number,
  extra?: { participantCount?: number; averageScore?: number },
): Promise<void> {
  if (!isSupabaseDualWriteEnabled()) return;
  const client = getSupabaseAdmin();
  if (!client) return;
  try {
    const { data, error: readErr } = await client
      .from("quizzes")
      .select("id, user_scores")
      .eq("source_firestore_id", firestoreQuizId)
      .maybeSingle();
    if (readErr || !data?.id) {
      // quiz 매핑 없음 (아직 dual-write 안 됨) — skip
      return;
    }
    const merged = {
      ...((data.user_scores as Record<string, unknown>) || {}),
      [userId]: score,
    };
    const patch: Record<string, unknown> = {
      user_scores: merged,
      updated_at: new Date().toISOString(),
    };
    if (extra?.participantCount !== undefined)
      patch.participant_count = extra.participantCount;
    if (extra?.averageScore !== undefined)
      patch.average_score = extra.averageScore;
    const { error } = await client
      .from("quizzes")
      .update(patch)
      .eq("id", data.id);
    if (error) {
      console.error(
        `[Supabase quiz userScores] ${firestoreQuizId}/${userId} 실패:`,
        error.message,
      );
    }
  } catch (err) {
    console.error(
      `[Supabase quiz userScores] ${firestoreQuizId}/${userId} 예외:`,
      err,
    );
  }
}

export interface SupabaseQuizResultInput {
  firestoreId: string;          // Firestore quizResults/{id} doc id
  firestoreQuizId: string;      // Firestore quizzes/{id}
  userId: string;
  score: number;
  correctCount: number;
  totalCount: number;
  answers?: unknown[];
  attemptNo?: number;
  attemptKey?: string | null;
  durationSeconds?: number | null;
  createdAt?: Date | null;
}

/**
 * quiz_results insert. source_firestore_id 에 이미 존재 시 중복 insert 를 피하려
 * 선조회 후 insert 한다 (partial unique index 는 onConflict 안 먹음).
 */
export async function supabaseDualWriteQuizResult(
  input: SupabaseQuizResultInput,
): Promise<void> {
  if (!isSupabaseDualWriteEnabled()) return;
  const client = getSupabaseAdmin();
  const orgId = getDefaultOrgId();
  if (!client || !orgId) return;
  try {
    const quizUuid = await getQuizUuidByFirestoreId(input.firestoreQuizId);
    if (!quizUuid) {
      console.warn(
        `[Supabase quiz_result upsert] quiz 매핑 실패: ${input.firestoreQuizId} — skip ${input.firestoreId}`,
      );
      return;
    }
    // 중복 방지 (멱등)
    const { data: existing } = await client
      .from("quiz_results")
      .select("id")
      .eq("source_firestore_id", input.firestoreId)
      .maybeSingle();
    if (existing?.id) return;

    const row: Record<string, unknown> = {
      org_id: orgId,
      quiz_id: quizUuid,
      user_id: input.userId,
      score: input.score,
      correct_count: input.correctCount,
      total_count: input.totalCount,
      answers: input.answers ?? [],
      attempt_no: input.attemptNo ?? 1,
      attempt_key: input.attemptKey ?? null,
      is_first_attempt: (input.attemptNo ?? 1) === 1,
      duration_seconds: input.durationSeconds ?? null,
      source_firestore_id: input.firestoreId,
      created_at: input.createdAt
        ? input.createdAt.toISOString()
        : new Date().toISOString(),
    };
    const { error } = await client.from("quiz_results").insert(row);
    if (error) {
      console.error(
        `[Supabase quiz_result insert] ${input.firestoreId} 실패:`,
        error.message,
        error.details ?? "",
      );
    }
  } catch (err) {
    console.error(
      `[Supabase quiz_result insert] ${input.firestoreId} 예외:`,
      err,
    );
  }
}

/** quiz_results 부분 update (source_firestore_id 기준) — regrade/rewarded 등. */
export async function supabaseDualUpdateQuizResult(
  firestoreId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  if (!isSupabaseDualWriteEnabled()) return;
  if (Object.keys(patch).length === 0) return;
  const client = getSupabaseAdmin();
  if (!client) return;
  try {
    const { error } = await client
      .from("quiz_results")
      .update(patch)
      .eq("source_firestore_id", firestoreId);
    if (error) {
      console.error(
        `[Supabase quiz_result update] ${firestoreId} 실패:`,
        error.message,
      );
    }
  } catch (err) {
    console.error(`[Supabase quiz_result update] ${firestoreId} 예외:`, err);
  }
}

/**
 * quiz_results 배치 upsert (regrade 용).
 * source_firestore_id 있는 row 만 처리, 기존 row 찾아서 update.
 */
export async function supabaseDualBatchUpdateQuizResults(
  updates: Array<{ firestoreId: string; patch: Record<string, unknown> }>,
): Promise<void> {
  if (!isSupabaseDualWriteEnabled()) return;
  if (updates.length === 0) return;
  // 간단히 직렬 처리 (배치 100건 내외 예상)
  for (const { firestoreId, patch } of updates) {
    await supabaseDualUpdateQuizResult(firestoreId, patch);
  }
}

/** quiz_completions upsert (UNIQUE quiz_id + user_id 기준). */
export async function supabaseDualUpsertCompletion(
  firestoreQuizId: string,
  userId: string,
  fields: {
    bestScore?: number | null;
    completedAt?: Date | null;
  },
): Promise<void> {
  if (!isSupabaseDualWriteEnabled()) return;
  const client = getSupabaseAdmin();
  const orgId = getDefaultOrgId();
  if (!client || !orgId) return;
  try {
    const quizUuid = await getQuizUuidByFirestoreId(firestoreQuizId);
    if (!quizUuid) {
      console.warn(
        `[Supabase quiz_completion upsert] quiz 매핑 실패: ${firestoreQuizId}/${userId} — skip`,
      );
      return;
    }
    const row: Record<string, unknown> = {
      org_id: orgId,
      quiz_id: quizUuid,
      user_id: userId,
      completed_at: fields.completedAt
        ? fields.completedAt.toISOString()
        : new Date().toISOString(),
    };
    if (fields.bestScore !== undefined) row.best_score = fields.bestScore;
    const { error } = await client
      .from("quiz_completions")
      .upsert(row, { onConflict: "quiz_id,user_id" });
    if (error) {
      console.error(
        `[Supabase quiz_completion upsert] ${firestoreQuizId}/${userId} 실패:`,
        error.message,
      );
    }
  } catch (err) {
    console.error(
      `[Supabase quiz_completion upsert] ${firestoreQuizId}/${userId} 예외:`,
      err,
    );
  }
}

/** 특정 유저의 quiz_results 전체 삭제 (학기 전환 / 계정 삭제 용). */
export async function supabaseDualDeleteQuizResultsByUser(
  userId: string,
): Promise<void> {
  if (!isSupabaseDualWriteEnabled()) return;
  const client = getSupabaseAdmin();
  if (!client) return;
  try {
    const { error } = await client
      .from("quiz_results")
      .delete()
      .eq("user_id", userId);
    if (error) {
      console.error(
        `[Supabase quiz_results delete by user] ${userId} 실패:`,
        error.message,
      );
    }
  } catch (err) {
    console.error(
      `[Supabase quiz_results delete by user] ${userId} 예외:`,
      err,
    );
  }
}

/** 특정 유저의 quiz_completions 전체 삭제 (학기 전환 / 계정 삭제 용). */
export async function supabaseDualDeleteCompletionsByUser(
  userId: string,
): Promise<void> {
  if (!isSupabaseDualWriteEnabled()) return;
  const client = getSupabaseAdmin();
  if (!client) return;
  try {
    const { error } = await client
      .from("quiz_completions")
      .delete()
      .eq("user_id", userId);
    if (error) {
      console.error(
        `[Supabase quiz_completions delete by user] ${userId} 실패:`,
        error.message,
      );
    }
  } catch (err) {
    console.error(
      `[Supabase quiz_completions delete by user] ${userId} 예외:`,
      err,
    );
  }
}

/** quiz_completions 삭제 (학기 전환 / 재설정 용). */
export async function supabaseDualDeleteCompletion(
  firestoreQuizId: string,
  userId: string,
): Promise<void> {
  if (!isSupabaseDualWriteEnabled()) return;
  const client = getSupabaseAdmin();
  if (!client) return;
  try {
    const quizUuid = await getQuizUuidByFirestoreId(firestoreQuizId);
    if (!quizUuid) return;
    const { error } = await client
      .from("quiz_completions")
      .delete()
      .eq("quiz_id", quizUuid)
      .eq("user_id", userId);
    if (error) {
      console.error(
        `[Supabase quiz_completion delete] ${firestoreQuizId}/${userId} 실패:`,
        error.message,
      );
    }
  } catch (err) {
    console.error(
      `[Supabase quiz_completion delete] ${firestoreQuizId}/${userId} 예외:`,
      err,
    );
  }
}

export interface SupabaseFeedbackInput {
  firestoreId: string;
  firestoreQuizId: string;
  userId: string;
  content: string;
  rating?: number | null;
  createdAt?: Date | null;
}

/** feedbacks insert (source_firestore_id UNIQUE 기준 upsert). */
export async function supabaseDualWriteFeedback(
  input: SupabaseFeedbackInput,
): Promise<void> {
  if (!isSupabaseDualWriteEnabled()) return;
  const client = getSupabaseAdmin();
  const orgId = getDefaultOrgId();
  if (!client || !orgId) return;
  try {
    const quizUuid = await getQuizUuidByFirestoreId(input.firestoreQuizId);
    if (!quizUuid) {
      console.warn(
        `[Supabase feedback upsert] quiz 매핑 실패: ${input.firestoreQuizId} — skip ${input.firestoreId}`,
      );
      return;
    }
    const row: Record<string, unknown> = {
      org_id: orgId,
      quiz_id: quizUuid,
      user_id: input.userId,
      content: input.content,
      rating: input.rating ?? null,
      source_firestore_id: input.firestoreId,
      created_at: input.createdAt
        ? input.createdAt.toISOString()
        : new Date().toISOString(),
    };
    const { error } = await client
      .from("feedbacks")
      .upsert(row, { onConflict: "source_firestore_id" });
    if (error) {
      console.error(
        `[Supabase feedback upsert] ${input.firestoreId} 실패:`,
        error.message,
      );
    }
  } catch (err) {
    console.error(
      `[Supabase feedback upsert] ${input.firestoreId} 예외:`,
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

// ============================================================
// user_profiles / exp_history 듀얼 라이트 (Phase 2 Step 3 — userRepo)
// ============================================================

/**
 * Firestore users 필드 → user_profiles 컬럼 매핑.
 * 알려지지 않은 필드는 스킵. FieldValue 센티넬은 호출부가 계산된 새 값으로 대체해야 함.
 */
const USER_FIELD_MAP: Record<string, string> = {
  nickname: "nickname",
  name: "name",
  role: "role",
  courseId: "course_id",
  // Firestore 실제 필드명은 classId. classType 은 레거시/UI 변환 호환.
  // 둘 다 같은 Supabase class_type 컬럼으로 매핑.
  classId: "class_type",
  classType: "class_type",
  totalExp: "total_exp",
  level: "level",
  rank: "rank",
  badges: "badges",
  equippedRabbits: "equipped_rabbits",
  profileRabbitId: "profile_rabbit_id",
  totalCorrect: "total_correct",
  totalAttemptedQuestions: "total_attempted_questions",
  professorQuizzesCompleted: "professor_quizzes_completed",
  tekkenTotal: "tekken_total",
  feedbackCount: "feedback_count",
  lastGachaExp: "last_gacha_exp",
  spinLock: "spin_lock",
  recoveryEmail: "recovery_email",
  assignedCourses: "assigned_courses",
};

/**
 * Firestore patch(camelCase)를 Supabase row(snake_case)로 변환.
 * FieldValue.increment / arrayUnion / serverTimestamp 같은 센티넬은 스킵
 * (호출부에서 계산된 실제 값으로 전달해야 함).
 */
function toUserProfileRow(
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [fsKey, value] of Object.entries(patch)) {
    const sbKey = USER_FIELD_MAP[fsKey];
    if (!sbKey) continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const vObj = value as Record<string, unknown>;
      // Firestore Sentinel 감지
      if ("_methodName" in vObj || "isEqual" in vObj) continue;
    }
    row[sbKey] = value;
  }
  return row;
}

/**
 * user_profiles 전체 upsert.
 *
 * 최초 가입(registerStudent / initProfessorAccount) 시 Firestore 커밋 후 호출.
 * nickname / role 은 필수이므로 누락 시 기본값 처리.
 */
export async function supabaseDualUpsertUser(
  userId: string,
  data: Record<string, unknown>,
): Promise<void> {
  if (!isSupabaseDualWriteEnabled()) return;
  const client = getSupabaseAdmin();
  const orgId = getDefaultOrgId();
  if (!client || !orgId) return;

  try {
    const row: Record<string, unknown> = {
      org_id: orgId,
      user_id: userId,
      ...toUserProfileRow(data),
    };
    if (!("nickname" in row)) {
      row.nickname = typeof data.nickname === "string" ? data.nickname : userId;
    }
    if (!("role" in row)) {
      row.role = typeof data.role === "string" ? data.role : "student";
    }

    const { error } = await client
      .from("user_profiles")
      .upsert(row, { onConflict: "org_id,user_id" });

    if (error) {
      console.error(
        `[Supabase user upsert] ${userId} 실패:`,
        error.message,
        error.details ?? "",
      );
    }
  } catch (err) {
    console.error(`[Supabase user upsert] ${userId} 예외:`, err);
  }
}

/**
 * user_profiles 부분 업데이트.
 *
 * EXP/가챠/레벨업/장착 등 Firestore update 후 호출.
 * 호출부는 FieldValue.increment/arrayUnion 대신 **계산된 새 값**을 넘겨야 함.
 * (rabbitRepo 패턴 그대로)
 */
export async function supabaseDualUpdateUserPartial(
  userId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  if (!isSupabaseDualWriteEnabled()) return;
  const client = getSupabaseAdmin();
  const orgId = getDefaultOrgId();
  if (!client || !orgId) return;

  try {
    const row = toUserProfileRow(patch);
    if (Object.keys(row).length === 0) return;

    const { error } = await client
      .from("user_profiles")
      .update(row)
      .eq("org_id", orgId)
      .eq("user_id", userId);

    if (error) {
      console.error(
        `[Supabase user update] ${userId} 실패:`,
        error.message,
        error.details ?? "",
      );
    }
  } catch (err) {
    console.error(`[Supabase user update] ${userId} 예외:`, err);
  }
}

/**
 * user_profiles 삭제.
 *
 * Firestore users/{uid} 삭제 후 호출.
 * 연관 데이터(quiz_results/reviews 등)는 별도 dual-delete 헬퍼가 처리.
 */
export async function supabaseDualDeleteUser(userId: string): Promise<void> {
  if (!isSupabaseDualWriteEnabled()) return;
  const client = getSupabaseAdmin();
  const orgId = getDefaultOrgId();
  if (!client || !orgId) return;

  try {
    const { error } = await client
      .from("user_profiles")
      .delete()
      .eq("org_id", orgId)
      .eq("user_id", userId);

    if (error) {
      console.error(
        `[Supabase user delete] ${userId} 실패:`,
        error.message,
        error.details ?? "",
      );
    }
  } catch (err) {
    console.error(`[Supabase user delete] ${userId} 예외:`, err);
  }
}

/**
 * exp_history 추가 (append-only).
 *
 * utils/gold.ts addExpInTransaction 이 expHistory 서브컬렉션에 쓸 때 함께 호출.
 * source_firestore_id 는 `{userId}__{expDocId}` 로 합성 (uid 간 docId 중복 회피).
 */
export interface SupabaseExpHistoryInput {
  userId: string;
  expDocId: string;
  amount: number;
  reason: string;
  type?: string;
  sourceId?: string;
  sourceCollection?: string;
  previousExp?: number;
  newExp?: number;
  metadata?: Record<string, unknown>;
}

export async function supabaseDualWriteExpHistory(
  input: SupabaseExpHistoryInput,
): Promise<void> {
  if (!isSupabaseDualWriteEnabled()) return;
  const client = getSupabaseAdmin();
  const orgId = getDefaultOrgId();
  if (!client || !orgId) return;

  try {
    const row: Record<string, unknown> = {
      org_id: orgId,
      user_id: input.userId,
      amount: input.amount,
      reason: input.reason,
      source_firestore_id: `${input.userId}__${input.expDocId}`,
    };
    if (input.type !== undefined) row.type = input.type;
    if (input.sourceId !== undefined) row.source_id = input.sourceId;
    if (input.sourceCollection !== undefined)
      row.source_collection = input.sourceCollection;
    if (input.previousExp !== undefined) row.previous_exp = input.previousExp;
    if (input.newExp !== undefined) row.new_exp = input.newExp;
    if (input.metadata !== undefined) row.metadata = input.metadata;

    const { error } = await client
      .from("exp_history")
      .upsert(row, { onConflict: "source_firestore_id" });

    if (error) {
      console.error(
        `[Supabase exp_history upsert] ${input.userId}__${input.expDocId} 실패:`,
        error.message,
        error.details ?? "",
      );
    }
  } catch (err) {
    console.error(
      `[Supabase exp_history upsert] ${input.userId}__${input.expDocId} 예외:`,
      err,
    );
  }
}
