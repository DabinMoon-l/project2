/**
 * 배틀 챕터 선택 기록 (과목별)
 *
 * 최근 N회 배틀에서 고른 챕터 이력을 localStorage 에 저장하고,
 * 다음 배틀 모달 오픈 시 "자주 선택한 챕터"를 디폴트로 복원.
 */

const STORAGE_KEY = 'tekken:recentChapters:v1';
const MAX_HISTORY = 10;
// 빈도 임계값: 최근 이력의 40% 이상에 등장한 챕터를 디폴트로 채택
const FREQUENCY_RATIO = 0.4;

type History = Record<string, string[][]>;

function load(): History {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as History) : {};
  } catch {
    return {};
  }
}

function save(h: History) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(h));
  } catch {
    // 저장 실패 시 조용히 무시 (quota 등)
  }
}

/** 배틀 확정 시 호출 — 선택한 챕터를 이력 맨 앞에 추가 */
export function recordBattleChapters(courseId: string, chapters: string[]) {
  if (!courseId || chapters.length === 0) return;
  const h = load();
  const list = h[courseId] ? [...h[courseId]] : [];
  list.unshift([...chapters]);
  h[courseId] = list.slice(0, MAX_HISTORY);
  save(h);
}

/**
 * 과목의 디폴트 챕터 목록 반환
 * - 최근 이력에서 40% 이상 등장한 챕터들을 반환
 * - 빈도 기반 결과가 없으면 가장 최근 선택을 폴백으로 사용
 */
export function getDefaultBattleChapters(courseId: string): string[] {
  if (!courseId) return [];
  const h = load();
  const list = h[courseId] || [];
  if (list.length === 0) return [];

  const counts = new Map<string, number>();
  for (const sel of list) {
    for (const num of sel) {
      counts.set(num, (counts.get(num) || 0) + 1);
    }
  }

  const threshold = Math.max(1, Math.ceil(list.length * FREQUENCY_RATIO));
  const frequent = [...counts.entries()]
    .filter(([, count]) => count >= threshold)
    .sort((a, b) => b[1] - a[1]) // 빈도 내림차순 — 첫 번째가 "가장 많이 고른 챕터"
    .map(([num]) => num);

  return frequent.length > 0 ? frequent : list[0];
}
