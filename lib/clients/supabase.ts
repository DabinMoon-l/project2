/**
 * Supabase 클라이언트 (브라우저 전용)
 *
 * Phase 1 마이그레이션: rankings / radar 읽기 전환용.
 * anon key만 사용 — RLS 정책으로 접근 제어.
 *
 * 서버(Cloud Functions / Next.js 서버 액션)에서는
 *   functions/src/utils/supabase.ts (admin, service_role) 사용.
 *
 * 환경변수가 없으면 null 반환 — Feature flag off일 때 초기화 생략.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null | undefined = undefined;

/**
 * 브라우저용 Supabase 클라이언트 싱글턴.
 * - 환경변수 미설정 시 null (Feature flag off 또는 마이그레이션 미준비)
 * - realtime/auth 세션은 현재 미사용 (Phase 1은 읽기 전용)
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (_client !== undefined) return _client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    if (typeof window !== 'undefined') {
      console.warn('[Supabase] URL/anon key not configured — skipping client init');
    }
    _client = null;
    return null;
  }

  _client = createClient(url, anonKey, {
    auth: {
      // Phase 1은 Firebase Auth만 사용 — Supabase auth 세션 비활성
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    realtime: {
      // Realtime은 Phase 2에서 활성화 (랭킹은 2h 스케줄이라 polling으로 충분)
      params: { eventsPerSecond: 2 },
    },
  });

  return _client;
}

/**
 * 테스트/로그아웃 등 초기화 용도로 싱글턴 리셋.
 * 일반 사용에서는 호출 불필요.
 */
export function resetSupabaseClient(): void {
  _client = undefined;
}
