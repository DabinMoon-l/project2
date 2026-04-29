// 토끼 도메인 Supabase dual-write 헬퍼 (Edge Function 용)
//
// 원본: functions/src/utils/supabase.ts 의 dual-write 함수들을 Edge 환경에 맞춰 포팅.
// - getCourseUuid: courses 테이블에서 code → uuid 캐시
// - rabbits / rabbit_holdings / user_profiles / exp_history upsert
//
// Wave 3 에서 PostgreSQL trigger 가 Firestore 트리거 체인을 대체하면 호출 측에서 모든 dual-write 가 사라지고
// 이 파일은 삭제된다.

import { getSupabaseAdmin, DEFAULT_ORG_ID } from "./supabaseAdmin.ts";

interface RabbitDiscoverer {
  userId: string;
  nickname: string;
  discoveryOrder: number;
}

// Firestore courseCode("biology") → courses.id(UUID) 캐시
const _courseUuidCache = new Map<string, string>();

export async function getCourseUuid(courseCode: string): Promise<string | null> {
  const cached = _courseUuidCache.get(courseCode);
  if (cached) return cached;

  const client = getSupabaseAdmin();
  const { data, error } = await client
    .from("courses")
    .select("id")
    .eq("org_id", DEFAULT_ORG_ID)
    .eq("code", courseCode)
    .maybeSingle();

  if (error || !data?.id) return null;
  _courseUuidCache.set(courseCode, data.id as string);
  return data.id as string;
}

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
  try {
    const courseUuid = await getCourseUuid(courseCode);
    if (!courseUuid) return;

    const row: Record<string, unknown> = {
      org_id: DEFAULT_ORG_ID,
      course_id: courseUuid,
      rabbit_id: rabbitId,
      source_firestore_id: `${courseCode}_${rabbitId}`,
    };
    if (fields.name !== undefined) row.name = fields.name;
    if (fields.firstDiscovererUserId !== undefined) {
      row.first_discoverer_user_id = fields.firstDiscovererUserId;
    }
    if (fields.firstDiscovererName !== undefined) {
      row.first_discoverer_name = fields.firstDiscovererName;
    }
    if (fields.firstDiscovererNickname !== undefined) {
      row.first_discoverer_nickname = fields.firstDiscovererNickname;
    }
    if (fields.discoverers !== undefined) row.discoverers = fields.discoverers;
    if (fields.discovererCount !== undefined) {
      row.discoverer_count = fields.discovererCount;
    }

    const { error } = await getSupabaseAdmin()
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
  try {
    const courseUuid = await getCourseUuid(courseCode);
    if (!courseUuid) return;

    const row: Record<string, unknown> = {
      org_id: DEFAULT_ORG_ID,
      course_id: courseUuid,
      user_id: userId,
      rabbit_id: rabbitId,
      source_firestore_id: `${userId}__${courseCode}_${rabbitId}`,
    };
    if (fields.level !== undefined) row.level = fields.level;
    if (fields.stats !== undefined) row.stats = fields.stats;
    if (fields.discoveryOrder !== undefined) {
      row.discovery_order = fields.discoveryOrder;
    }
    if (fields.discoveredAt !== undefined) {
      row.discovered_at = fields.discoveredAt.toISOString();
    }

    const { error } = await getSupabaseAdmin()
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

// Firestore users 필드 → user_profiles 컬럼 매핑.
const USER_FIELD_MAP: Record<string, string> = {
  nickname: "nickname",
  name: "name",
  role: "role",
  courseId: "course_id",
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

function toUserProfileRow(
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [fsKey, value] of Object.entries(patch)) {
    const sbKey = USER_FIELD_MAP[fsKey];
    if (!sbKey) continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const vObj = value as Record<string, unknown>;
      if ("_methodName" in vObj || "isEqual" in vObj) continue;
    }
    row[sbKey] = value;
  }
  return row;
}

export async function supabaseDualUpdateUserPartial(
  userId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  try {
    const row = toUserProfileRow(patch);
    if (Object.keys(row).length === 0) return;

    const { error } = await getSupabaseAdmin()
      .from("user_profiles")
      .update(row)
      .eq("org_id", DEFAULT_ORG_ID)
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
  try {
    const row: Record<string, unknown> = {
      org_id: DEFAULT_ORG_ID,
      user_id: input.userId,
      amount: input.amount,
      reason: input.reason,
      source_firestore_id: `${input.userId}__${input.expDocId}`,
    };
    if (input.type !== undefined) row.type = input.type;
    if (input.sourceId !== undefined) row.source_id = input.sourceId;
    if (input.sourceCollection !== undefined) {
      row.source_collection = input.sourceCollection;
    }
    if (input.previousExp !== undefined) row.previous_exp = input.previousExp;
    if (input.newExp !== undefined) row.new_exp = input.newExp;
    if (input.metadata !== undefined) row.metadata = input.metadata;

    const { error } = await getSupabaseAdmin()
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
