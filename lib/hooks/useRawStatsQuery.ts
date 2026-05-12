'use client';

import { useState, useEffect, useRef } from 'react';
import {
  collection,
  query,
  where,
  getDocs,
  Timestamp,
  db,
} from '@/lib/repositories';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function toKstDateString(date: Date): string {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')}`;
}

function toKstHour(date: Date): number {
  return new Date(date.getTime() + KST_OFFSET_MS).getUTCHours();
}

// 월=0 ~ 일=6
function toKstDayOfWeek(date: Date): number {
  const day = new Date(date.getTime() + KST_OFFSET_MS).getUTCDay();
  return day === 0 ? 6 : day - 1;
}

export interface PageViewRow {
  userId: string;
  classId: string;
  category: string;
  path: string;
  /** KST YYYY-MM-DD */
  date: string;
  /** KST 0~23 */
  hour: number;
  /** 월=0 ~ 일=6 */
  dayOfWeek: number;
  /** 체류시간(ms) — 없는 경우 0 */
  durationMs: number;
  sessionId?: string;
}

export interface RawStatsResult {
  pageViews: PageViewRow[];
  loading: boolean;
  error: string | null;
  fetchedCount: number;
}

interface CacheEntry {
  rows: PageViewRow[];
  ts: number;
}
const _cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * 교수 통계탭용 raw pageViews 쿼리.
 * - 날짜 범위 안의 페이지뷰를 timestamp 기준으로 fetch
 * - 5분 캐시 (같은 범위 재요청 시 비용 절감)
 */
export function useRawStatsQuery(
  courseId: string,
  startDate: Date,
  endDate: Date,
  enabled = true,
): RawStatsResult {
  const [state, setState] = useState<RawStatsResult>({
    pageViews: [],
    loading: false,
    error: null,
    fetchedCount: 0,
  });

  const startMs = startDate.getTime();
  const endMs = endDate.getTime();
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (!enabled || !courseId) {
      setState(s => ({ ...s, loading: false }));
      return;
    }

    const cacheKey = `${courseId}|${startMs}|${endMs}`;
    const cached = _cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      setState({ pageViews: cached.rows, loading: false, error: null, fetchedCount: cached.rows.length });
      return;
    }

    const reqId = ++reqIdRef.current;
    setState(s => ({ ...s, loading: true, error: null }));

    (async () => {
      try {
        const q = query(
          collection(db, 'pageViews'),
          where('courseId', '==', courseId),
          where('timestamp', '>=', Timestamp.fromDate(new Date(startMs))),
          where('timestamp', '<=', Timestamp.fromDate(new Date(endMs))),
        );

        const snap = await getDocs(q);
        if (reqId !== reqIdRef.current) return;

        const rows: PageViewRow[] = [];
        snap.docs.forEach(d => {
          const data = d.data();
          const tsRaw = data.timestamp;
          if (!tsRaw || typeof tsRaw.toDate !== 'function') return;
          const ts: Date = tsRaw.toDate();
          rows.push({
            userId: data.userId || '',
            classId: data.classId || '',
            category: data.category || 'other',
            path: data.path || '',
            date: toKstDateString(ts),
            hour: toKstHour(ts),
            dayOfWeek: toKstDayOfWeek(ts),
            durationMs: typeof data.durationMs === 'number' ? data.durationMs : 0,
            sessionId: data.sessionId,
          });
        });

        _cache.set(cacheKey, { rows, ts: Date.now() });
        setState({ pageViews: rows, loading: false, error: null, fetchedCount: rows.length });
      } catch (err) {
        if (reqId !== reqIdRef.current) return;
        const msg = err instanceof Error ? err.message : '데이터 조회 실패';
        setState(s => ({ ...s, loading: false, error: msg }));
      }
    })();
  }, [courseId, startMs, endMs, enabled]);

  return state;
}
