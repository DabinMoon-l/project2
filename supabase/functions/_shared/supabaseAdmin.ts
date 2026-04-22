// Supabase service role client (Edge Function 전용)
//
// - org_id 검증은 애플리케이션 레벨에서 수행 (service_role 은 RLS 우회)
// - 기본 org_id 는 env DEFAULT_ORG_ID (Phase 6 멀티테넌트 전 까지는 rabbitory-pilot 단일)
// - 프론트 Firebase Auth uid 를 user_id 로 그대로 사용 (Wave 1 기준)

import { createClient, SupabaseClient } from "@supabase/supabase-js";

export const DEFAULT_ORG_ID =
  Deno.env.get("DEFAULT_ORG_ID") ?? "13430b1a-0213-403c-9dd4-687bea914ec4";

let cached: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured");
  }
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}
