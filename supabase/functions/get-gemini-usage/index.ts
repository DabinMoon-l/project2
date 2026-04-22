// get-gemini-usage — Gemini 일일 사용량 조회
//
// Phase 3 Wave 0 검증용. 가장 가벼운 조회 함수로 Edge Functions 파이프라인(번들/배포/인증/Supabase 접근)
// 전체 체인을 확인한다.
//
// 이전 Cloud Function: functions/src/gemini.ts 의 getGeminiUsage
// Firestore 경로: geminiUsage/users/{userId}/{YYYY-MM-DD}.count
// Supabase 경로:  ai_usage_logs (org_id, user_id, date, count)

import { createClient } from "@supabase/supabase-js";
import { corsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { verifyFirebaseIdToken, uidOf } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEFAULT_ORG_ID = Deno.env.get("DEFAULT_ORG_ID") ?? "13430b1a-0213-403c-9dd4-687bea914ec4";

const DAILY_USER_LIMIT = 10;
const DAILY_TOTAL_LIMIT = 1500;

function todayKst(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;

  const claims = await verifyFirebaseIdToken(req);
  const uid = claims ? uidOf(claims) : null;
  if (!uid) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  const today = todayKst();

  const [userRes, totalRes] = await Promise.all([
    supabase
      .from("ai_usage_logs")
      .select("count")
      .eq("org_id", DEFAULT_ORG_ID)
      .eq("user_id", uid)
      .eq("date", today)
      .maybeSingle(),
    supabase
      .from("ai_usage_logs")
      .select("count")
      .eq("org_id", DEFAULT_ORG_ID)
      .eq("date", today),
  ]);

  if (userRes.error) console.error("user usage error", userRes.error);
  if (totalRes.error) console.error("total usage error", totalRes.error);

  const userCount = userRes.data?.count ?? 0;
  const totalCount = (totalRes.data ?? []).reduce((acc, row) => acc + (row.count ?? 0), 0);

  return new Response(
    JSON.stringify({
      ok: true,
      userCount,
      userLimit: DAILY_USER_LIMIT,
      userRemaining: Math.max(0, DAILY_USER_LIMIT - userCount),
      totalCount,
      totalLimit: DAILY_TOTAL_LIMIT,
      totalRemaining: Math.max(0, DAILY_TOTAL_LIMIT - totalCount),
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
