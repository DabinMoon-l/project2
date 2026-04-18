/**
 * Ranking Repository — Supabase 구현체 (Phase 1)
 *
 * Firebase rankingRepo와 **동일한 API 시그니처** 유지.
 * 반환 shape도 Firestore와 동일: { id, ...Firestore 문서 필드 }
 *
 * 테이블 구조:
 *   public.rankings { course_id, data jsonb, updated_at }
 *
 * `data`에 Firestore 문서를 그대로 저장하므로 { id: course_id, ...data } 형태로 반환.
 */

import { getSupabaseClient } from '@/lib/clients/supabase';
import type { Unsubscribe, ErrorCallback } from '../types';

// ============================================================
// 내부 유틸
// ============================================================

function toDocShape(row: { course_id: string; data: Record<string, unknown> | null; updated_at: string } | null): Record<string, unknown> | null {
  if (!row || !row.data) return null;
  // updated_at은 Firestore Timestamp 형태로 쓰던 필드라 포맷 차이 있음
  // 프론트에서 updatedAt?.toDate?.() 체크하므로 Date 객체로 변환 제공
  return {
    id: row.course_id,
    ...row.data,
    // Supabase의 updated_at은 ISO string → Date로 래핑 (toDate() 호환 최소한)
    // Firestore에서 오던 필드가 있으면 data에 이미 updatedAt이 있을 수 있어 덮어쓰기 안 함
    ...(row.data.updatedAt
      ? {}
      : { updatedAt: { toDate: () => new Date(row.updated_at) } }),
  };
}

// ============================================================
// 랭킹
// ============================================================

/** 랭킹 조회 (1회성) */
export async function getRanking(courseId: string): Promise<Record<string, unknown> | null> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('[Supabase] 클라이언트가 초기화되지 않았습니다. NEXT_PUBLIC_SUPABASE_URL/ANON_KEY 확인.');
  }

  const { data, error } = await supabase
    .from('rankings')
    .select('course_id, data, updated_at')
    .eq('course_id', courseId)
    .maybeSingle();

  if (error) {
    // PGRST116 = no rows (maybeSingle로 피하긴 하지만 방어)
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return toDocShape(data);
}

/**
 * 랭킹 실시간 구독
 *
 * Phase 1 구현 방식: **polling** (Supabase Realtime 대신).
 * 이유:
 * - 랭킹은 2시간(추후 10분) 스케줄이라 polling 간격 60초로 충분
 * - Realtime은 connection 비용 + Phase 2에서 활성화
 *
 * Firestore onSnapshot과 동일한 인터페이스 유지 — 구독/해제 패턴.
 */
export function subscribeRanking(
  courseId: string,
  callback: (data: Record<string, unknown> | null) => void,
  onError?: ErrorCallback,
): Unsubscribe {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const POLL_INTERVAL_MS = 60_000;

  const fetch = async () => {
    if (cancelled) return;
    try {
      const data = await getRanking(courseId);
      if (!cancelled) callback(data);
    } catch (err) {
      if (!cancelled && onError) onError(err as Error);
    } finally {
      if (!cancelled) {
        timer = setTimeout(fetch, POLL_INTERVAL_MS);
      }
    }
  };

  fetch();

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}

// ============================================================
// 레이더 정규화
// ============================================================

/** 레이더 정규화 조회 (1회성, TTL 캐시는 호출부에서) */
export async function getRadarNorm(courseId: string): Promise<Record<string, unknown> | null> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('[Supabase] 클라이언트가 초기화되지 않았습니다.');
  }

  const { data, error } = await supabase
    .from('radar_norms')
    .select('course_id, data, updated_at')
    .eq('course_id', courseId)
    .maybeSingle();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return toDocShape(data);
}
