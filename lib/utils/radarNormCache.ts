/**
 * 레이더 정규화 데이터 캐시 (sessionStorage)
 * Stale-While-Revalidate 패턴 (rankingCache.ts와 동일 구조)
 *
 * TTL: 5분 (신선), 15분 (최대 허용)
 * CF가 10분마다 계산 → 5분 fresh로 불필요한 Firestore 읽기 50% 감소
 */

const FRESH_TTL = 5 * 60 * 1000; // 5분
const MAX_TTL = 15 * 60 * 1000;  // 15분

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
  growthByUid: Record<string, number>;  // 성장세 (0-100, 50=기준선)
  studentClassMap: Record<string, string>;
  quizCreationCounts: number[];
  communityScores: number[];
  activeReviewCounts: number[];
  expValues: number[];
  growthValues: number[];               // 성장세 백분위 배열
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
