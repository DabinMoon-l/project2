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
