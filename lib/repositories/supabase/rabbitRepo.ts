/**
 * Rabbit Repository — Supabase 구현체 (Phase 2 Step 3)
 *
 * Firebase rabbitRepo 와 **동일한 API 시그니처** 유지.
 * 반환 shape 는 Firestore 문서와 호환되도록 카멜케이스 매핑.
 *
 * 테이블:
 *   public.rabbits          (과목당 80마리 도감)
 *   public.rabbit_holdings  (유저별 보유/레벨)
 *
 * 구독은 polling(30초). 토끼 변경은 가챠/레벨업 시에만 발생하므로 충분.
 * 즉시 반영이 필요한 경우 CF 호출 후 클라이언트가 별도 refresh 수행.
 */

import { getSupabaseClient } from '@/lib/clients/supabase';
import type { Unsubscribe, ErrorCallback } from '../types';

const DEFAULT_ORG_ID = process.env.NEXT_PUBLIC_DEFAULT_ORG_ID || '';
const POLL_INTERVAL_MS = 30_000;

// courseCode → courses.id(uuid) 캐시
const _courseUuidCache = new Map<string, string>();

async function resolveCourseUuid(courseCode: string): Promise<string | null> {
  const cached = _courseUuidCache.get(courseCode);
  if (cached) return cached;

  const supabase = getSupabaseClient();
  if (!supabase || !DEFAULT_ORG_ID) return null;

  const { data, error } = await supabase
    .from('courses')
    .select('id, code')
    .eq('org_id', DEFAULT_ORG_ID);

  if (error || !data) return null;
  for (const row of data as Array<{ id: string; code: string }>) {
    _courseUuidCache.set(row.code, row.id);
  }
  return _courseUuidCache.get(courseCode) || null;
}

// courses.id(uuid) → code 역매핑 (rabbits 쿼리 결과 매핑용)
const _uuidToCodeCache = new Map<string, string>();
async function buildUuidToCodeMap(): Promise<void> {
  if (_uuidToCodeCache.size > 0) return;
  const supabase = getSupabaseClient();
  if (!supabase || !DEFAULT_ORG_ID) return;
  const { data } = await supabase
    .from('courses')
    .select('id, code')
    .eq('org_id', DEFAULT_ORG_ID);
  for (const row of (data as Array<{ id: string; code: string }> | null) || []) {
    _uuidToCodeCache.set(row.id, row.code);
    _courseUuidCache.set(row.code, row.id);
  }
}

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

interface RabbitRow {
  id: string;
  course_id: string;
  rabbit_id: number;
  name: string | null;
  first_discoverer_user_id: string | null;
  first_discoverer_name: string | null;
  first_discoverer_nickname: string | null;
  discoverers: Array<{ userId: string; nickname: string; discoveryOrder: number }>;
  discoverer_count: number;
  created_at: string;
  updated_at: string;
}

interface HoldingRow {
  id: string;
  course_id: string;
  user_id: string;
  rabbit_id: number;
  level: number;
  stats: { hp?: number; atk?: number; def?: number };
  discovery_order: number | null;
  discovered_at: string | null;
  created_at: string;
}

function rabbitRowToDoc(row: RabbitRow): Record<string, unknown> {
  const courseCode = _uuidToCodeCache.get(row.course_id) || row.course_id;
  return {
    id: `${courseCode}_${row.rabbit_id}`,
    courseId: courseCode,
    rabbitId: row.rabbit_id,
    name: row.name,
    firstDiscovererUserId: row.first_discoverer_user_id,
    firstDiscovererName: row.first_discoverer_name,
    discovererCount: row.discoverer_count,
    discoverers: row.discoverers || [],
    createdAt: tsLike(row.created_at),
    updatedAt: tsLike(row.updated_at),
  };
}

function holdingRowToDoc(row: HoldingRow): Record<string, unknown> {
  const courseCode = _uuidToCodeCache.get(row.course_id) || row.course_id;
  return {
    id: `${courseCode}_${row.rabbit_id}`,
    rabbitId: row.rabbit_id,
    courseId: courseCode,
    discoveryOrder: row.discovery_order ?? 1,
    discoveredAt: tsLike(row.discovered_at || row.created_at),
    level: row.level ?? 1,
    stats: row.stats || {},
  };
}

// ============================================================
// 토끼 보유 목록 구독 (유저별)
// ============================================================

export function subscribeHoldings(
  uid: string,
  callback: (holdings: Record<string, unknown>[]) => void,
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
      await buildUuidToCodeMap();

      const { data, error } = await supabase
        .from('rabbit_holdings')
        .select('id, course_id, user_id, rabbit_id, level, stats, discovery_order, discovered_at, created_at')
        .eq('org_id', DEFAULT_ORG_ID)
        .eq('user_id', uid);

      if (error) {
        if (!cancelled && onError) onError(error as unknown as Error);
        return;
      }
      if (!cancelled) {
        const holdings = ((data as HoldingRow[] | null) || []).map(holdingRowToDoc);
        callback(holdings);
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

// ============================================================
// 특정 토끼 문서 구독
// ============================================================

export function subscribeRabbitDoc(
  courseId: string,
  rabbitId: number,
  callback: (rabbit: Record<string, unknown> | null) => void,
  onError?: ErrorCallback,
): Unsubscribe {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const fetch = async () => {
    if (cancelled) return;
    try {
      const supabase = getSupabaseClient();
      if (!supabase || !DEFAULT_ORG_ID) {
        if (!cancelled) callback(null);
        return;
      }
      const courseUuid = await resolveCourseUuid(courseId);
      if (!courseUuid) {
        if (!cancelled) callback(null);
        return;
      }
      await buildUuidToCodeMap();

      const { data, error } = await supabase
        .from('rabbits')
        .select('id, course_id, rabbit_id, name, first_discoverer_user_id, first_discoverer_name, first_discoverer_nickname, discoverers, discoverer_count, created_at, updated_at')
        .eq('org_id', DEFAULT_ORG_ID)
        .eq('course_id', courseUuid)
        .eq('rabbit_id', rabbitId)
        .maybeSingle();

      if (error) {
        if (error.code !== 'PGRST116') {
          if (!cancelled && onError) onError(error as unknown as Error);
          return;
        }
      }
      if (!cancelled) {
        callback(data ? rabbitRowToDoc(data as RabbitRow) : null);
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

// ============================================================
// 과목별 토끼 도감 구독
// ============================================================

export function subscribeRabbitsForCourse(
  courseId: string,
  callback: (rabbits: Record<string, unknown>[]) => void,
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
      const courseUuid = await resolveCourseUuid(courseId);
      if (!courseUuid) {
        if (!cancelled) callback([]);
        return;
      }
      await buildUuidToCodeMap();

      const { data, error } = await supabase
        .from('rabbits')
        .select('id, course_id, rabbit_id, name, first_discoverer_user_id, first_discoverer_name, first_discoverer_nickname, discoverers, discoverer_count, created_at, updated_at')
        .eq('org_id', DEFAULT_ORG_ID)
        .eq('course_id', courseUuid)
        .order('rabbit_id', { ascending: true });

      if (error) {
        if (!cancelled && onError) onError(error as unknown as Error);
        return;
      }
      if (!cancelled) {
        const rabbits = ((data as RabbitRow[] | null) || []).map(rabbitRowToDoc);
        callback(rabbits);
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
