/**
 * 토끼 이름 캐시 (sessionStorage)
 *
 * 용도: `rabbits/{courseId}_{rabbitId}` 문서의 name 필드.
 *   - 랭킹 시트, 프로필 카드 등 여러 곳에서 동일 토끼 이름을 반복 조회 → 캐시로 Firestore 읽기 제거
 *   - 토끼 이름은 소유자(학생)가 뽑기 시 한 번 짓고 거의 바꾸지 않음 → 긴 TTL 허용
 *
 * 키: `rabbit_name_{courseId}_{rabbitId}`
 * TTL: 24시간 (신선), 7일 (최대 허용)
 * 누락분(존재하지 않는 토끼)도 null로 캐시해 재조회 방지.
 */

const FRESH_TTL = 24 * 60 * 60 * 1000; // 24시간
const MAX_TTL = 7 * 24 * 60 * 60 * 1000; // 7일

interface Envelope {
  name: string | null;
  ts: number;
}

/**
 * docId 형식 "{courseId}_{rabbitId}"에서 이름 조회.
 * @returns { name, isFresh, hit } — hit은 캐시에 entry가 있는지(네거티브 캐시 포함)
 */
export function readRabbitName(docId: string): {
  name: string | null;
  isFresh: boolean;
  hit: boolean;
} {
  try {
    if (typeof window === 'undefined') return { name: null, isFresh: false, hit: false };
    const raw = sessionStorage.getItem(`rabbit_name_${docId}`);
    if (!raw) return { name: null, isFresh: false, hit: false };

    const env: Envelope = JSON.parse(raw);
    const age = Date.now() - env.ts;
    if (age > MAX_TTL) {
      sessionStorage.removeItem(`rabbit_name_${docId}`);
      return { name: null, isFresh: false, hit: false };
    }
    return { name: env.name, isFresh: age < FRESH_TTL, hit: true };
  } catch {
    return { name: null, isFresh: false, hit: false };
  }
}

export function writeRabbitName(docId: string, name: string | null) {
  try {
    if (typeof window === 'undefined') return;
    const env: Envelope = { name, ts: Date.now() };
    sessionStorage.setItem(`rabbit_name_${docId}`, JSON.stringify(env));
  } catch {
    // sessionStorage 용량 초과 등 무시
  }
}

/**
 * docId 리스트에서 캐시 미스된 ID만 반환.
 * fresh가 아니면 revalidate 대상이지만 호출부에서는 일단 캐시 값으로 렌더링하고
 * 백그라운드에서 fetch해도 됨. 여기서는 `hit`만 기준으로 구분.
 */
export function partitionCacheMisses(
  docIds: string[],
): { hitsMap: Record<string, string | null>; misses: string[] } {
  const hitsMap: Record<string, string | null> = {};
  const misses: string[] = [];
  for (const id of docIds) {
    const { name, hit } = readRabbitName(id);
    if (hit) hitsMap[id] = name;
    else misses.push(id);
  }
  return { hitsMap, misses };
}

