import { describe, it, expect } from 'vitest';
import { checkSingleAnswer } from './reviewPracticeUtils';
import type { ReviewItem } from '@/lib/hooks/useReview';
import type { AnswerType } from './reviewPracticeTypes';

// ─── 헬퍼: 최소 ReviewItem 모킹 ───

function makeItem(
  type: ReviewItem['type'],
  correctAnswer: string,
): ReviewItem {
  return {
    id: 'rev1',
    userId: 'u1',
    quizId: 'quiz1',
    questionId: 'q1',
    question: '테스트 문제',
    type,
    correctAnswer,
    userAnswer: '',
    reviewType: 'wrong',
    isBookmarked: false,
    reviewCount: 0,
    lastReviewedAt: null,
    createdAt: { seconds: 0, nanoseconds: 0 } as never,
  };
}

// ============================================================
// OX 문제
// ============================================================

describe('checkSingleAnswer — OX 문제', () => {
  it("정답 'O', 유저 'O' → true", () => {
    const item = makeItem('ox', 'O');
    expect(checkSingleAnswer(item, 'O')).toBe(true);
  });

  it("정답 'O', 유저 'X' → false", () => {
    const item = makeItem('ox', 'O');
    expect(checkSingleAnswer(item, 'X')).toBe(false);
  });

  it("정답 숫자 0 → 유저 'O' → true (0→O 변환)", () => {
    // correctAnswer가 "0"으로 저장된 경우
    const item = makeItem('ox', '0');
    expect(checkSingleAnswer(item, 'O')).toBe(true);
  });

  it("정답 숫자 1 → 유저 'X' → true (1→X 변환)", () => {
    const item = makeItem('ox', '1');
    expect(checkSingleAnswer(item, 'X')).toBe(true);
  });

  it("정답 'o'(소문자) → 유저 'O' → true (대소문자 무시)", () => {
    const item = makeItem('ox', 'o');
    expect(checkSingleAnswer(item, 'O')).toBe(true);
  });

  it("정답 'X' → 유저 'X' → true", () => {
    const item = makeItem('ox', 'X');
    expect(checkSingleAnswer(item, 'X')).toBe(true);
  });

  it("정답 'X' → 유저 'O' → false", () => {
    const item = makeItem('ox', 'X');
    expect(checkSingleAnswer(item, 'O')).toBe(false);
  });

  it('null 답안 → false', () => {
    const item = makeItem('ox', 'O');
    expect(checkSingleAnswer(item, null)).toBe(false);
  });

  it("정답 '0' → 유저 숫자 0(문자열) → true", () => {
    const item = makeItem('ox', '0');
    // userAnswer가 0(숫자)으로 전달될 때 — toString()으로 '0' → 'O' 변환
    expect(checkSingleAnswer(item, 0 as unknown as AnswerType)).toBe(true);
  });
});

// ============================================================
// 객관식 (단일 정답)
// ============================================================

describe('checkSingleAnswer — 객관식 (단일)', () => {
  it('정답 2, 유저 2 → true (0-indexed)', () => {
    const item = makeItem('multiple', '2');
    expect(checkSingleAnswer(item, 2)).toBe(true);
  });

  it('정답 2, 유저 3 → false', () => {
    const item = makeItem('multiple', '2');
    expect(checkSingleAnswer(item, 3)).toBe(false);
  });

  it('정답 "2"(문자열), 유저 2(숫자) → true (문자열↔숫자 호환)', () => {
    const item = makeItem('multiple', '2');
    expect(checkSingleAnswer(item, 2)).toBe(true);
  });

  it('정답 0, 유저 0 → true (첫 번째 선지)', () => {
    const item = makeItem('multiple', '0');
    expect(checkSingleAnswer(item, 0)).toBe(true);
  });

  it('유저가 문자열 답안 제출 → false (객관식은 숫자만 허용)', () => {
    const item = makeItem('multiple', '2');
    expect(checkSingleAnswer(item, 'abc')).toBe(false);
  });

  it('null 답안 → false', () => {
    const item = makeItem('multiple', '1');
    expect(checkSingleAnswer(item, null)).toBe(false);
  });
});

// ============================================================
// 객관식 (복수 정답)
// ============================================================

describe('checkSingleAnswer — 객관식 (복수정답)', () => {
  it('정답 "0,2", 유저 [0,2] → true', () => {
    const item = makeItem('multiple', '0,2');
    expect(checkSingleAnswer(item, [0, 2])).toBe(true);
  });

  it('정답 "0,2", 유저 [2,0] → true (순서 무관)', () => {
    const item = makeItem('multiple', '0,2');
    expect(checkSingleAnswer(item, [2, 0])).toBe(true);
  });

  it('정답 "0,2", 유저 [0] → false (부분 정답)', () => {
    const item = makeItem('multiple', '0,2');
    expect(checkSingleAnswer(item, [0])).toBe(false);
  });

  it('정답 "0,2", 유저 [0,1,2] → false (초과 선택)', () => {
    const item = makeItem('multiple', '0,2');
    expect(checkSingleAnswer(item, [0, 1, 2])).toBe(false);
  });

  it('정답 "1,3,4", 유저 [4,1,3] → true (3개 복수정답 순서 무관)', () => {
    const item = makeItem('multiple', '1,3,4');
    expect(checkSingleAnswer(item, [4, 1, 3])).toBe(true);
  });

  it('복수정답에 숫자 단일 값 제출 → false (배열이 아님)', () => {
    const item = makeItem('multiple', '0,2');
    expect(checkSingleAnswer(item, 0)).toBe(false);
  });

  it('null 답안 → false', () => {
    const item = makeItem('multiple', '0,2');
    expect(checkSingleAnswer(item, null)).toBe(false);
  });
});

// ============================================================
// 단답형 / 주관식
// ============================================================

describe('checkSingleAnswer — 단답형', () => {
  it('정확히 일치 → true', () => {
    const item = makeItem('short_answer', '미토콘드리아');
    expect(checkSingleAnswer(item, '미토콘드리아')).toBe(true);
  });

  it('다른 답 → false', () => {
    const item = makeItem('short_answer', '답');
    expect(checkSingleAnswer(item, '오답')).toBe(false);
  });

  it('복수정답 "apple|||apples" → "apples" → true', () => {
    const item = makeItem('short_answer', 'apple|||apples');
    expect(checkSingleAnswer(item, 'apples')).toBe(true);
  });

  it('복수정답 "apple|||apples" → "apple" → true', () => {
    const item = makeItem('short_answer', 'apple|||apples');
    expect(checkSingleAnswer(item, 'apple')).toBe(true);
  });

  it('복수정답 "Apple|||APPLE" → "apple" → true (대소문자 무시)', () => {
    const item = makeItem('short_answer', 'Apple|||APPLE');
    expect(checkSingleAnswer(item, 'apple')).toBe(true);
  });

  it('"ATP" → "atp" → true (대소문자 무시)', () => {
    const item = makeItem('short_answer', 'ATP');
    expect(checkSingleAnswer(item, 'atp')).toBe(true);
  });

  it('빈 문자열 → false', () => {
    const item = makeItem('short_answer', '정답');
    expect(checkSingleAnswer(item, '')).toBe(false);
  });

  it('null 답안 → false', () => {
    const item = makeItem('short_answer', '정답');
    expect(checkSingleAnswer(item, null)).toBe(false);
  });

  it('공백 포함 답안 trim 처리 → true', () => {
    const item = makeItem('short_answer', 'ATP');
    expect(checkSingleAnswer(item, ' atp ')).toBe(true);
  });

  it('type "short"도 단답형으로 처리', () => {
    const item = makeItem('short', '답');
    expect(checkSingleAnswer(item, '답')).toBe(true);
  });
});

// ============================================================
// 엣지 케이스
// ============================================================

describe('checkSingleAnswer — 엣지 케이스', () => {
  it('item이 null이면 false', () => {
    expect(checkSingleAnswer(null as unknown as ReviewItem, 'O')).toBe(false);
  });

  it('correctAnswer가 undefined이면 빈 문자열로 폴백', () => {
    const item = makeItem('short_answer', '');
    // correctAnswer가 빈 문자열이면 빈 답안과 일치 가능 (trim 후 비교)
    // 빈 userAnswer('')는 51줄에서 toLowerCase 결과로 '' → correctAnswerStr '' 와 비교 → true
    expect(checkSingleAnswer(item, '')).toBe(true);
  });
});
