/**
 * 레이더 정규화 데이터 캐시 (sessionStorage)
 * Stale-While-Revalidate 패턴 (rankingCache.ts와 동일 구조)
 *
 * TTL: 2분 (신선), 10분 (최대 허용)
 */

const FRESH_TTL = 2 * 60 * 1000; // 2분
const MAX_TTL = 10 * 60 * 1000;  // 10분

interface CacheEnvelope<T> {
  data: T;
  timestamp: number;
}

/** Firestore radarNorm/{courseId} 문서 구조 */
export interface RadarNormData {
  quizCreationByUid: Record<string, number>;
  communityByUid: Record<string, number>;
  activeReviewByUid: Record<string, number>;
  expByUid: Record<string, number>;
  weightedScoreByUid: Record<string, number>;
  studentClassMap: Record<string, string>;
  quizCreationCounts: number[];
  communityScores: number[];
  activeReviewCounts: number[];
  expValues: number[];
  totalStudents: number;
}

const CACHE_KEY = (courseId: string) => `radarNorm_${courseId}`;

export function readRadarNormCache(courseId: string): { data: RadarNormData | null; isFresh: boolean } {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY(courseId));
    if (!raw) return { data: null, isFresh: false };

    const envelope: CacheEnvelope<RadarNormData> = JSON.parse(raw);
    const age = Date.now() - envelope.timestamp;

    if (age > MAX_TTL) {
      sessionStorage.removeItem(CACHE_KEY(courseId));
      return { data: null, isFresh: false };
    }

    return { data: envelope.data, isFresh: age < FRESH_TTL };
  } catch {
    return { data: null, isFresh: false };
  }
}

export function writeRadarNormCache(courseId: string, data: RadarNormData) {
  try {
    const envelope: CacheEnvelope<RadarNormData> = { data, timestamp: Date.now() };
    sessionStorage.setItem(CACHE_KEY(courseId), JSON.stringify(envelope));
  } catch {
    // sessionStorage 용량 초과 등 무시
  }
}
