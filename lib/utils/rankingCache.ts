/**
 * 랭킹 데이터 캐시 (sessionStorage)
 * Stale-While-Revalidate 패턴:
 * - 캐시 있으면 즉시 반환 → 백그라운드에서 갱신
 * - 캐시 없으면 fetch 후 저장
 *
 * TTL: 2분 (신선), 10분 (최대 허용)
 *
 * 키 분리:
 * - home: 홈 RankingSection용 (간소 데이터)
 * - full: 랭킹 페이지용 (전체 유저 데이터)
 */

const FRESH_TTL = 2 * 60 * 1000; // 2분
const MAX_TTL = 10 * 60 * 1000;  // 10분

interface CacheEnvelope<T> {
  data: T;
  timestamp: number;
}

// ── 홈 랭킹 섹션 캐시 ──

export interface HomeCacheData {
  teamRanks: Record<string, number>;
  personalRank: number;
  totalStudents: number;
}

const HOME_KEY = (courseId: string) => `ranking_home_${courseId}`;

export function readHomeCache(courseId: string): { data: HomeCacheData | null; isFresh: boolean } {
  return readCache<HomeCacheData>(HOME_KEY(courseId));
}

export function writeHomeCache(courseId: string, data: HomeCacheData) {
  writeCache(HOME_KEY(courseId), data);
}

// ── 랭킹 페이지 캐시 ──

export interface FullCacheData {
  rankedUsers: any[];
}

const FULL_KEY = (courseId: string) => `ranking_full_${courseId}`;

export function readFullCache(courseId: string): { data: FullCacheData | null; isFresh: boolean } {
  return readCache<FullCacheData>(FULL_KEY(courseId));
}

export function writeFullCache(courseId: string, data: FullCacheData) {
  writeCache(FULL_KEY(courseId), data);
}

// ── 공통 ──

function readCache<T>(key: string): { data: T | null; isFresh: boolean } {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return { data: null, isFresh: false };

    const envelope: CacheEnvelope<T> = JSON.parse(raw);
    const age = Date.now() - envelope.timestamp;

    if (age > MAX_TTL) {
      sessionStorage.removeItem(key);
      return { data: null, isFresh: false };
    }

    return { data: envelope.data, isFresh: age < FRESH_TTL };
  } catch {
    return { data: null, isFresh: false };
  }
}

function writeCache<T>(key: string, data: T) {
  try {
    const envelope: CacheEnvelope<T> = { data, timestamp: Date.now() };
    sessionStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    // sessionStorage 용량 초과 등 무시
  }
}
