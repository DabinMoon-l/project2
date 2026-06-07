/**
 * 복습 풀이 전용 — 객관식(multiple) 선지 순서 셔플
 *
 * 목적: 같은 퀴즈를 복습할 때 선지 위치를 외워서 푸는 것을 방지.
 *       options / choiceExplanations / correctAnswer(복수정답 포함)를 **함께** 재배치해
 *       채점 결과가 절대 달라지지 않도록 한다.
 *
 * 안전 원칙 (시험기간 버그 방지):
 *  - 객관식이 아니면 손대지 않음 (OX·단답·서술·결합 지문 등 그대로)
 *  - 선지가 2개 미만이거나 정답 정보가 비정상(빈값/범위 밖)이면 원본 그대로 반환
 *  - 원본은 변형하지 않고 새 객체를 반환 (다른 화면/저장 로직 영향 없음)
 *  - 문제 발생 시 ENABLE_REVIEW_CHOICE_SHUFFLE = false 로 즉시 비활성화 가능
 */

import type { ReviewItem } from '@/lib/hooks/useReview';

/** 킬스위치 — 버그 발생 시 false 로 바꿔 재배포하면 셔플 전체 비활성화 */
export const ENABLE_REVIEW_CHOICE_SHUFFLE = true;

/** 결정적 PRNG (mulberry32) — 같은 seed 면 같은 순서 → 새로고침에도 일관 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 문자열 → 32bit 해시 (FNV-1a) — 문제별로 다른 순서를 만들기 위한 seed 보정 */
function hashString(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 객관식 한 문제의 선지 순서를 섞는다.
 * 객관식이 아니거나 데이터가 비정상이면 **원본을 그대로** 반환한다.
 */
export function shuffleChoicesForItem(item: ReviewItem, seed: number): ReviewItem {
  if (item.type !== 'multiple') return item;

  const options = item.options;
  if (!options || options.length < 2) return item;

  // 정답 인덱스 파싱 — 단일 "2" / 복수 "0,2"
  const correctStr = item.correctAnswer?.toString().trim() ?? '';
  const oldCorrect = correctStr
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));

  // 정답 정보가 없거나 선지 범위를 벗어나면 셔플하지 않음 (안전 우선)
  if (oldCorrect.length === 0) return item;
  if (oldCorrect.some((i) => i < 0 || i >= options.length)) return item;

  // 결정적 Fisher-Yates — perm[newPos] = oldIndex
  const rng = mulberry32((seed ^ hashString(item.id)) >>> 0);
  let perm = options.map((_, i) => i);
  for (let i = perm.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }

  // 우연히 원본과 동일한 순서가 나오면 1칸 회전시켜 "다른 순서" 보장
  if (perm.every((v, i) => v === i)) {
    perm = perm.map((_, i) => (i + 1) % perm.length);
  }

  const newOptions = perm.map((i) => options[i]);
  const newChoiceExplanations = item.choiceExplanations
    ? perm.map((i) => item.choiceExplanations![i] ?? '')
    : undefined;

  // oldIndex 가 새로 놓인 위치 = perm.indexOf(oldIndex)
  const newCorrect = oldCorrect
    .map((old) => perm.indexOf(old))
    .sort((a, b) => a - b)
    .join(',');

  return {
    ...item,
    options: newOptions,
    correctAnswer: newCorrect,
    ...(newChoiceExplanations ? { choiceExplanations: newChoiceExplanations } : {}),
  };
}

/** 복습 아이템 목록 전체에 선지 셔플 적용 (객관식만, 나머지는 원본 유지) */
export function shuffleReviewChoices(items: ReviewItem[], seed: number): ReviewItem[] {
  if (!ENABLE_REVIEW_CHOICE_SHUFFLE) return items;
  return items.map((item) => shuffleChoicesForItem(item, seed));
}
