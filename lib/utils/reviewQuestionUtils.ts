import type { ReviewItem } from '@/lib/hooks/useReview';
import type { DisplayItem } from '@/components/review/types';

/** 선지 번호 라벨 (최대 8개 지원) */
export const choiceLabels = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];

/** ㄱㄴㄷ 라벨 */
export const KOREAN_LABELS = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ'];

/**
 * questionId에서 주문제 번호와 하위문제 번호를 추출
 * 예: "q0" → [0, 0], "q1" → [1, 0], "q1-1" → [1, 1], "q1-2" → [1, 2]
 */
export function parseQuestionId(questionId: string): [number, number] {
  if (!questionId) return [0, 0];
  // 형식: "q{main}" 또는 "q{main}-{sub}" 또는 "q{main}_{sub}"
  const match = questionId.match(/q?(\d+)(?:[-_](\d+))?/i);
  if (match) {
    const main = parseInt(match[1], 10);
    const sub = match[2] ? parseInt(match[2], 10) : 0;
    return [main, sub];
  }
  // 숫자만 있는 경우
  const numMatch = questionId.match(/(\d+)/);
  return numMatch ? [parseInt(numMatch[1], 10), 0] : [0, 0];
}

/**
 * ReviewItem을 questionId 기준으로 정렬 (결합형 문제 순서 유지)
 */
export function sortByQuestionId<T extends { questionId: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const [aMain, aSub] = parseQuestionId(a.questionId);
    const [bMain, bSub] = parseQuestionId(b.questionId);
    if (aMain !== bMain) return aMain - bMain;
    return aSub - bSub;
  });
}

/**
 * 문제 목록을 displayItems로 변환 (결합형 그룹 처리)
 * combinedGroupId가 있는 문제만 결합형으로 그룹핑 (questionId 대시 형식만으로는 그룹핑하지 않음)
 */
export function createDisplayItems(questions: ReviewItem[]): DisplayItem[] {
  const sortedQuestions = sortByQuestionId(questions);
  const displayItems: DisplayItem[] = [];
  const processedGroupIds = new Set<string>();
  let displayNumber = 0;

  for (const question of sortedQuestions) {
    // 결합형 문제 - combinedGroupId가 있는 경우만 그룹핑
    if (question.combinedGroupId) {
      const groupId = question.combinedGroupId;

      // 이미 처리된 그룹이면 스킵
      if (processedGroupIds.has(groupId)) continue;
      processedGroupIds.add(groupId);

      // 같은 combinedGroupId의 모든 문제 찾기
      const groupItems = sortedQuestions.filter((q) => q.combinedGroupId === groupId);

      // combinedIndex 순서로 정렬 (공통 지문이 첫 번째 항목에 저장되어 있음)
      groupItems.sort((a, b) => {
        const aIndex = a.combinedIndex ?? 999;
        const bIndex = b.combinedIndex ?? 999;
        return aIndex - bIndex;
      });

      if (groupItems.length > 1) {
        displayNumber++;
        displayItems.push({
          type: 'combined_group',
          items: groupItems,
          combinedGroupId: groupId,
          displayNumber,
        });
      } else {
        // combinedGroupId가 있지만 단독이면 단일 문제로 표시
        displayNumber++;
        displayItems.push({
          type: 'single',
          item: question,
          displayNumber,
        });
      }
    } else {
      // 일반 문제
      displayNumber++;
      displayItems.push({
        type: 'single',
        item: question,
        displayNumber,
      });
    }
  }

  return displayItems;
}
