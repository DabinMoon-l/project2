/**
 * useReview 유틸리티 함수
 *
 * 문제 정렬, 그룹핑, 카운트 등 순수 함수 모음
 */

import { getChapterById } from '../courseIndex';
import type { ReviewItem, GroupedReviewItems, ChapterGroupedWrongItems } from './useReviewTypes';

/**
 * ReviewItem 배열에서 실제 문제 수 계산 (결합형 문제는 1개로 계산)
 */
export function calculateActualQuestionCount(items: ReviewItem[]): number {
  const seenCombinedGroups = new Set<string>();
  let count = 0;

  for (const item of items) {
    if (item.combinedGroupId) {
      // 결합형 문제: 그룹당 1개로 계산
      if (!seenCombinedGroups.has(item.combinedGroupId)) {
        seenCombinedGroups.add(item.combinedGroupId);
        count++;
      }
    } else {
      // 비결합형 문제: 각각 1개
      count++;
    }
  }

  return count;
}

/**
 * CustomFolderQuestion 배열에서 실제 문제 수 계산 (결합형 문제는 1개로 계산)
 */
export function calculateCustomFolderQuestionCount(
  questions: { combinedGroupId?: string | null }[]
): number {
  const seenCombinedGroups = new Set<string>();
  let count = 0;

  for (const q of questions) {
    if (q.combinedGroupId) {
      // 결합형 문제: 그룹당 1개로 계산
      if (!seenCombinedGroups.has(q.combinedGroupId)) {
        seenCombinedGroups.add(q.combinedGroupId);
        count++;
      }
    } else {
      // 비결합형 문제: 각각 1개
      count++;
    }
  }

  return count;
}

/**
 * questionId에서 주문제 번호와 하위문제 번호를 추출
 * 예: "q0" → [0, 0], "q1" → [1, 0], "q1-1" → [1, 1], "q1-2" → [1, 2]
 */
function parseQuestionId(questionId: string): [number, number] {
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
 * 문제를 questionId 기준으로 정렬하는 비교 함수
 * 결합형 문제 ID (q1-1, q1-2) 를 올바르게 처리
 */
function compareQuestionIds(a: ReviewItem, b: ReviewItem): number {
  const [aMain, aSub] = parseQuestionId(a.questionId);
  const [bMain, bSub] = parseQuestionId(b.questionId);

  // 주문제 번호로 먼저 정렬
  if (aMain !== bMain) {
    return aMain - bMain;
  }
  // 같은 주문제면 하위문제 번호로 정렬
  return aSub - bSub;
}

/**
 * 복습 문제를 퀴즈별로 그룹핑
 */
export function groupByQuiz(items: ReviewItem[]): GroupedReviewItems[] {
  const grouped = new Map<string, GroupedReviewItems>();

  items.forEach((item) => {
    const existing = grouped.get(item.quizId);
    if (existing) {
      existing.items.push(item);
    } else {
      grouped.set(item.quizId, {
        quizId: item.quizId,
        quizTitle: item.quizTitle || '퀴즈',
        items: [item],
        questionCount: 0, // 나중에 계산
      });
    }
  });

  // 각 그룹 내 문제를 questionId 기준으로 정렬 (결합형 문제 순서 유지)
  // 그리고 실제 문제 수 계산 (결합형은 1개로 계산)
  for (const group of grouped.values()) {
    group.items.sort(compareQuestionIds);
    group.questionCount = calculateActualQuestionCount(group.items);
  }

  // 그룹은 최신 추가 순으로 정렬
  return Array.from(grouped.values()).sort((a, b) => {
    const aTime = a.items[0]?.createdAt?.toMillis() || 0;
    const bTime = b.items[0]?.createdAt?.toMillis() || 0;
    return bTime - aTime;
  });
}

/**
 * 오답 문제를 챕터별로 그룹핑 (챕터 → 문제지 구조)
 * 1차: chapterId로 카테고리 생성
 * 2차: 각 카테고리 내에서 quizId로 폴더 생성
 */
export function groupByChapterAndQuiz(items: ReviewItem[], courseId?: string): ChapterGroupedWrongItems[] {
  // 1차: chapterId로 그룹핑
  // 챕터 인덱스에서 찾을 수 없는 chapterId는 null(미분류)로 통합
  const chapterMap = new Map<string | null, ReviewItem[]>();

  items.forEach(item => {
    let chapterId = item.chapterId || null;

    // chapterId가 존재하지만 과목 인덱스에서 찾을 수 없으면 미분류(null)로 통합
    if (chapterId && courseId) {
      const chapter = getChapterById(courseId, chapterId);
      if (!chapter) {
        chapterId = null;
      }
    } else if (chapterId && !courseId) {
      // courseId가 없으면 챕터를 해석할 수 없으므로 미분류로 통합
      chapterId = null;
    }

    const existing = chapterMap.get(chapterId);
    if (existing) {
      existing.push(item);
    } else {
      chapterMap.set(chapterId, [item]);
    }
  });

  // 2차: 각 챕터 내에서 quizId로 그룹핑
  const result: ChapterGroupedWrongItems[] = [];

  chapterMap.forEach((chapterItems, chapterId) => {
    // 챕터 내 문제를 퀴즈별로 그룹핑
    const folders = groupByQuiz(chapterItems);
    // 결합형 문제를 1문제로 계산한 총 문제 수
    const totalCount = folders.reduce((sum, f) => sum + f.questionCount, 0);

    // 챕터 이름 가져오기
    let chapterName = '미분류';
    if (chapterId && courseId) {
      const chapter = getChapterById(courseId, chapterId);
      if (chapter) {
        chapterName = chapter.name;
      }
    }

    result.push({
      chapterId,
      chapterName,
      folders,
      totalCount,
    });
  });

  // 챕터 순서대로 정렬 (미분류는 마지막)
  return result.sort((a, b) => {
    if (!a.chapterId) return 1;  // 미분류는 마지막
    if (!b.chapterId) return -1;
    return a.chapterId.localeCompare(b.chapterId);
  });
}
