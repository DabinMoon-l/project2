/**
 * 퀴즈 정답 0-indexed 통일성 검증 테스트
 *
 * CLAUDE.md 명시: "answer 인덱싱: 모두 0-indexed (통일됨)"
 * 이 불변식이 깨지면 채점이 틀어지므로, 여러 모듈의 채점 함수를
 * 동일 입력으로 cross-check하여 일관성을 보장한다.
 *
 * 대상 모듈:
 * - checkSingleAnswer (components/review/reviewPracticeUtils) — 복습 채점
 * - checkCorrect (components/quiz/manage/quizStatsUtils) — 교수 통계 재판정
 * - gradeQuestion (functions/src/utils/gradeQuestion) — 서버 채점 (CF)
 * - answerToString (components/quiz/manage/quizStatsUtils) — 직렬화
 * - flattenQuestionsForSave (lib/utils/questionSerializer) — Firestore 저장
 */

import { describe, it, expect, vi } from 'vitest';

// Firebase 초기화 방지 — questionSerializer가 Timestamp를 import하면서 트리거됨
vi.mock('@/lib/repositories', () => ({
  Timestamp: {
    now: () => ({ seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 }),
  },
}));

import { checkSingleAnswer } from '@/components/review/reviewPracticeUtils';
import { checkCorrect, answerToString } from '@/components/quiz/manage/quizStatsUtils';
import { gradeQuestion } from '../../functions/src/utils/gradeQuestion';
import { flattenQuestionsForSave } from '@/lib/utils/questionSerializer';

// ============================================================
// 헬퍼: ReviewItem 최소 구성
// ============================================================
function makeReviewItem(overrides: Record<string, unknown>) {
  return {
    id: 'r1',
    userId: 'u1',
    quizId: 'q1',
    questionId: 'qn1',
    question: '테스트 문제',
    type: 'multiple' as const,
    correctAnswer: '0',
    userAnswer: '0',
    reviewType: 'wrong' as const,
    isBookmarked: false,
    reviewCount: 0,
    lastReviewedAt: null,
    createdAt: { seconds: 0, nanoseconds: 0 },
    ...overrides,
  };
}

// 헬퍼: FlattenedQuestion 최소 구성
function makeFlatQ(overrides: Record<string, unknown>) {
  return {
    id: 'fq1',
    text: '테스트 문제',
    type: 'multiple' as 'ox' | 'multiple' | 'short_answer' | 'short' | 'essay',
    answer: '0',
    ...overrides,
  };
}

// ============================================================
// 1. 0-indexed 통일 검증 — 객관식
// ============================================================
describe('객관식 0-indexed 통일 검증', () => {
  it('첫 번째 선지 정답 = index 0 (NOT 1)', () => {
    // checkSingleAnswer: correctAnswer="0", userAnswer=0
    const item = makeReviewItem({ type: 'multiple', correctAnswer: '0' });
    expect(checkSingleAnswer(item as never, 0)).toBe(true);

    // checkCorrect: answer="0", userAnswer="0"
    const fq = makeFlatQ({ type: 'multiple', answer: '0' });
    expect(checkCorrect(fq, '0')).toBe(true);

    // gradeQuestion: answer=0, userAnswer=0
    const result = gradeQuestion(
      { type: 'multiple', answer: 0 },
      { questionId: 'q1', answer: 0 },
      0,
    );
    expect(result.isCorrect).toBe(true);
  });

  it('두 번째 선지 정답 = index 1', () => {
    const item = makeReviewItem({ type: 'multiple', correctAnswer: '1' });
    expect(checkSingleAnswer(item as never, 1)).toBe(true);

    const fq = makeFlatQ({ type: 'multiple', answer: '1' });
    expect(checkCorrect(fq, '1')).toBe(true);

    const result = gradeQuestion(
      { type: 'multiple', answer: 1 },
      { questionId: 'q1', answer: 1 },
      0,
    );
    expect(result.isCorrect).toBe(true);
  });

  it('마지막 선지 (5개 중) = index 4', () => {
    const item = makeReviewItem({ type: 'multiple', correctAnswer: '4' });
    expect(checkSingleAnswer(item as never, 4)).toBe(true);

    const fq = makeFlatQ({ type: 'multiple', answer: '4' });
    expect(checkCorrect(fq, '4')).toBe(true);

    const result = gradeQuestion(
      { type: 'multiple', answer: 4 },
      { questionId: 'q1', answer: 4 },
      0,
    );
    expect(result.isCorrect).toBe(true);
  });

  it('1-indexed 값(1)으로 제출하면 0-indexed 정답(0)과 불일치', () => {
    // 정답이 첫 번째 선지(0)인데 1을 제출하면 오답
    const item = makeReviewItem({ type: 'multiple', correctAnswer: '0' });
    expect(checkSingleAnswer(item as never, 1)).toBe(false);

    const fq = makeFlatQ({ type: 'multiple', answer: '0' });
    expect(checkCorrect(fq, '1')).toBe(false);

    const result = gradeQuestion(
      { type: 'multiple', answer: 0 },
      { questionId: 'q1', answer: 1 },
      0,
    );
    expect(result.isCorrect).toBe(false);
  });
});

// ============================================================
// 2. OX 인덱싱
// ============================================================
describe('OX 인덱싱', () => {
  it('O = 0 — 숫자 0은 O로 해석', () => {
    // checkSingleAnswer: 정답 "0", 사용자 "O" → 정답
    const item = makeReviewItem({ type: 'ox', correctAnswer: '0' });
    expect(checkSingleAnswer(item as never, 'O')).toBe(true);

    // checkCorrect
    const fq = makeFlatQ({ type: 'ox', answer: '0' });
    expect(checkCorrect(fq, 'O')).toBe(true);

    // gradeQuestion
    const result = gradeQuestion(
      { type: 'ox', answer: 0 },
      { questionId: 'q1', answer: 'O' },
      0,
    );
    expect(result.isCorrect).toBe(true);
  });

  it('X = 1 — 숫자 1은 X로 해석', () => {
    const item = makeReviewItem({ type: 'ox', correctAnswer: '1' });
    expect(checkSingleAnswer(item as never, 'X')).toBe(true);

    const fq = makeFlatQ({ type: 'ox', answer: '1' });
    expect(checkCorrect(fq, 'X')).toBe(true);

    const result = gradeQuestion(
      { type: 'ox', answer: 1 },
      { questionId: 'q1', answer: 'X' },
      0,
    );
    expect(result.isCorrect).toBe(true);
  });

  it('0 → "O" 변환 일관성: 정답 0, 사용자 0 → 정답', () => {
    const item = makeReviewItem({ type: 'ox', correctAnswer: '0' });
    expect(checkSingleAnswer(item as never, 0)).toBe(true);

    const fq = makeFlatQ({ type: 'ox', answer: '0' });
    expect(checkCorrect(fq, '0')).toBe(true);

    const result = gradeQuestion(
      { type: 'ox', answer: 0 },
      { questionId: 'q1', answer: 0 },
      0,
    );
    expect(result.isCorrect).toBe(true);
  });

  it('1 → "X" 변환 일관성: 정답 1, 사용자 1 → 정답', () => {
    const item = makeReviewItem({ type: 'ox', correctAnswer: '1' });
    expect(checkSingleAnswer(item as never, 1)).toBe(true);

    const fq = makeFlatQ({ type: 'ox', answer: '1' });
    expect(checkCorrect(fq, '1')).toBe(true);

    const result = gradeQuestion(
      { type: 'ox', answer: 1 },
      { questionId: 'q1', answer: 1 },
      0,
    );
    expect(result.isCorrect).toBe(true);
  });

  it('O(정답)에 X 제출 → 오답 (세 모듈 모두)', () => {
    const item = makeReviewItem({ type: 'ox', correctAnswer: '0' });
    expect(checkSingleAnswer(item as never, 'X')).toBe(false);

    const fq = makeFlatQ({ type: 'ox', answer: '0' });
    expect(checkCorrect(fq, 'X')).toBe(false);

    const result = gradeQuestion(
      { type: 'ox', answer: 0 },
      { questionId: 'q1', answer: 'X' },
      0,
    );
    expect(result.isCorrect).toBe(false);
  });
});

// ============================================================
// 3. 복수정답 인덱싱
// ============================================================
describe('복수정답 인덱싱 (0-indexed)', () => {
  it('[0, 2] = 첫 번째와 세 번째 선지', () => {
    // checkSingleAnswer: correctAnswer="0,2", userAnswer=[0,2]
    const item = makeReviewItem({ type: 'multiple', correctAnswer: '0,2' });
    expect(checkSingleAnswer(item as never, [0, 2])).toBe(true);

    // checkCorrect: answer="0,2", userAnswer="0,2"
    const fq = makeFlatQ({ type: 'multiple', answer: '0,2' });
    expect(checkCorrect(fq, '0,2')).toBe(true);

    // gradeQuestion: answer=[0,2], userAnswer=[0,2]
    const result = gradeQuestion(
      { type: 'multiple', answer: [0, 2] },
      { questionId: 'q1', answer: [0, 2] },
      0,
    );
    expect(result.isCorrect).toBe(true);
  });

  it('"0,2" 문자열 → [0, 2] 파싱 후 순서 무관 비교', () => {
    // 사용자가 [2, 0] 순서로 제출해도 정답
    const item = makeReviewItem({ type: 'multiple', correctAnswer: '0,2' });
    expect(checkSingleAnswer(item as never, [2, 0])).toBe(true);

    const fq = makeFlatQ({ type: 'multiple', answer: '0,2' });
    expect(checkCorrect(fq, '2,0')).toBe(true);

    const result = gradeQuestion(
      { type: 'multiple', answer: [0, 2] },
      { questionId: 'q1', answer: [2, 0] },
      0,
    );
    expect(result.isCorrect).toBe(true);
  });

  it('1-indexed가 섞이면 오답 — 정답 [0,2]에 [1,3] 제출', () => {
    const item = makeReviewItem({ type: 'multiple', correctAnswer: '0,2' });
    expect(checkSingleAnswer(item as never, [1, 3])).toBe(false);

    const fq = makeFlatQ({ type: 'multiple', answer: '0,2' });
    expect(checkCorrect(fq, '1,3')).toBe(false);

    const result = gradeQuestion(
      { type: 'multiple', answer: [0, 2] },
      { questionId: 'q1', answer: [1, 3] },
      0,
    );
    expect(result.isCorrect).toBe(false);
  });
});

// ============================================================
// 4. 단답형 구분자
// ============================================================
describe('단답형 ||| 구분자', () => {
  it('"정답1|||정답2|||정답3" → 3개 허용 정답 중 하나면 정답', () => {
    const item = makeReviewItem({
      type: 'short_answer',
      correctAnswer: '미토콘드리아|||미토콘드리아(mitochondria)|||mitochondria',
    });
    expect(checkSingleAnswer(item as never, '미토콘드리아')).toBe(true);
    expect(checkSingleAnswer(item as never, 'mitochondria')).toBe(true);

    const fq = makeFlatQ({
      type: 'short_answer',
      answer: '미토콘드리아|||미토콘드리아(mitochondria)|||mitochondria',
    });
    expect(checkCorrect(fq, '미토콘드리아')).toBe(true);
    expect(checkCorrect(fq, 'mitochondria')).toBe(true);

    const result = gradeQuestion(
      { type: 'short_answer', answer: '미토콘드리아|||미토콘드리아(mitochondria)|||mitochondria' },
      { questionId: 'q1', answer: '미토콘드리아' },
      0,
    );
    expect(result.isCorrect).toBe(true);
  });

  it('구분자 없는 단일 정답', () => {
    const item = makeReviewItem({ type: 'short_answer', correctAnswer: 'ATP' });
    expect(checkSingleAnswer(item as never, 'atp')).toBe(true); // 대소문자 무시

    const fq = makeFlatQ({ type: 'short_answer', answer: 'ATP' });
    expect(checkCorrect(fq, 'atp')).toBe(true);

    const result = gradeQuestion(
      { type: 'short_answer', answer: 'ATP' },
      { questionId: 'q1', answer: 'atp' },
      0,
    );
    expect(result.isCorrect).toBe(true);
  });
});

// ============================================================
// 5. 결합형 문제 — 하위 문제 독립 0-indexed
// ============================================================
describe('결합형 문제 하위 문제 독립 0-indexed', () => {
  it('하위 문제 각각 독립적 0-indexed 답안', () => {
    // flattenQuestionsForSave로 결합형 → 개별 문제 변환 후 answer 확인
    const editableQuestions = [
      {
        id: 'combined1',
        text: '공통 지문',
        type: 'combined' as const,
        choices: [],
        answerIndex: -1,
        answerText: '',
        explanation: '',
        subQuestions: [
          {
            id: 'sub1',
            text: '하위 문제 1',
            type: 'multiple' as const,
            choices: ['A', 'B', 'C', 'D'],
            answerIndex: 0, // 첫 번째 선지 = 0
            answerText: '',
          },
          {
            id: 'sub2',
            text: '하위 문제 2',
            type: 'multiple' as const,
            choices: ['가', '나', '다', '라'],
            answerIndex: 2, // 세 번째 선지 = 2
            answerText: '',
          },
          {
            id: 'sub3',
            text: '하위 문제 3',
            type: 'ox' as const,
            choices: [],
            answerIndex: 0, // O = 0
            answerText: '',
          },
        ],
      },
    ];

    const flattened = flattenQuestionsForSave(editableQuestions, []);

    // 하위 문제 3개로 펼쳐져야 함
    expect(flattened).toHaveLength(3);

    // 각 하위 문제의 answer가 0-indexed
    expect(flattened[0].answer).toBe(0); // 첫 번째 선지
    expect(flattened[1].answer).toBe(2); // 세 번째 선지
    expect(flattened[2].answer).toBe(0); // OX의 O = 0
  });

  it('결합형 복수정답 하위 문제도 0-indexed 배열', () => {
    const editableQuestions = [
      {
        id: 'combined2',
        text: '공통 지문',
        type: 'combined' as const,
        choices: [],
        answerIndex: -1,
        answerText: '',
        explanation: '',
        subQuestions: [
          {
            id: 'sub_multi',
            text: '복수정답 하위',
            type: 'multiple' as const,
            choices: ['A', 'B', 'C', 'D', 'E'],
            answerIndex: -1,
            answerIndices: [0, 3], // 첫 번째 + 네 번째
            answerText: '',
            isMultipleAnswer: true,
          },
        ],
      },
    ];

    const flattened = flattenQuestionsForSave(editableQuestions, []);
    expect(flattened).toHaveLength(1);
    expect(flattened[0].answer).toEqual([0, 3]); // 0-indexed 배열
  });
});

// ============================================================
// 6. 경계값 테스트
// ============================================================
describe('경계값', () => {
  it('answer: 0 은 유효한 정답 (첫 번째 선지), NOT falsy', () => {
    // 0이 falsy로 처리되어 무효가 되면 안 됨
    const fq = makeFlatQ({ type: 'multiple', answer: '0' });
    // checkCorrect 내부에서 answer가 '0'이면 유효해야 함
    expect(checkCorrect(fq, '0')).toBe(true);

    // gradeQuestion에서도 answer=0은 유효
    const result = gradeQuestion(
      { type: 'multiple', answer: 0 },
      { questionId: 'q1', answer: 0 },
      0,
    );
    expect(result.isCorrect).toBe(true);
    expect(result.correctAnswerStr).toBe('0');
  });

  it('answer: "" 빈 문자열은 무효 — 채점 결과 false', () => {
    const fq = makeFlatQ({ type: 'short_answer', answer: '' });
    expect(checkCorrect(fq, '무언가')).toBe(false);

    const result = gradeQuestion(
      { type: 'short_answer', answer: '' },
      { questionId: 'q1', answer: '무언가' },
      0,
    );
    // 빈 문자열 정답은 어떤 답과도 일치하지 않음
    expect(result.isCorrect).toBe(false);
  });

  it('answer: null은 무효 — checkSingleAnswer에서 false', () => {
    const item = makeReviewItem({ type: 'multiple', correctAnswer: '0' });
    expect(checkSingleAnswer(item as never, null)).toBe(false);
  });

  it('userAnswer: null은 무효 — checkCorrect에서 false', () => {
    const fq = makeFlatQ({ type: 'multiple', answer: '0' });
    expect(checkCorrect(fq, null)).toBe(false);
  });
});

// ============================================================
// 7. answerToString 직렬화 일관성
// ============================================================
describe('answerToString 직렬화', () => {
  it('0-indexed 숫자 → 문자열 보존', () => {
    expect(answerToString(0)).toBe('0');
    expect(answerToString(4)).toBe('4');
  });

  it('복수정답 배열 → 쉼표 구분 문자열', () => {
    expect(answerToString([0, 2])).toBe('0,2');
    expect(answerToString([1, 3, 4])).toBe('1,3,4');
  });

  it('null/undefined → undefined 반환', () => {
    expect(answerToString(null)).toBeUndefined();
    expect(answerToString(undefined)).toBeUndefined();
  });

  it('문자열 정답 그대로 보존', () => {
    expect(answerToString('미토콘드리아')).toBe('미토콘드리아');
    expect(answerToString('ATP|||atp')).toBe('ATP|||atp');
  });
});

// ============================================================
// 8. 세 모듈 동일 입력 cross-check
// ============================================================
describe('checkSingleAnswer ↔ checkCorrect ↔ gradeQuestion cross-check', () => {
  const cases = [
    {
      label: '객관식 정답 index 0',
      reviewItem: { type: 'multiple', correctAnswer: '0' },
      flatQ: { type: 'multiple', answer: '0' },
      gradeQ: { type: 'multiple', answer: 0 },
      userReview: 0 as number | string | number[],
      userFlat: '0',
      userGrade: 0 as number | string | number[],
      expected: true,
    },
    {
      label: '객관식 오답 (정답 2, 제출 3)',
      reviewItem: { type: 'multiple', correctAnswer: '2' },
      flatQ: { type: 'multiple', answer: '2' },
      gradeQ: { type: 'multiple', answer: 2 },
      userReview: 3 as number | string | number[],
      userFlat: '3',
      userGrade: 3 as number | string | number[],
      expected: false,
    },
    {
      label: 'OX 정답 O (0)',
      reviewItem: { type: 'ox', correctAnswer: '0' },
      flatQ: { type: 'ox', answer: '0' },
      gradeQ: { type: 'ox', answer: 0 },
      userReview: 'O' as number | string | number[],
      userFlat: 'O',
      userGrade: 'O' as number | string | number[],
      expected: true,
    },
    {
      label: '단답형 대소문자 무시',
      reviewItem: { type: 'short_answer', correctAnswer: 'DNA' },
      flatQ: { type: 'short_answer', answer: 'DNA' },
      gradeQ: { type: 'short_answer', answer: 'DNA' },
      userReview: 'dna' as number | string | number[],
      userFlat: 'dna',
      userGrade: 'dna' as number | string | number[],
      expected: true,
    },
  ];

  cases.forEach(({ label, reviewItem, flatQ, gradeQ, userReview, userFlat, userGrade, expected }) => {
    it(label, () => {
      const item = makeReviewItem(reviewItem);
      const fq = makeFlatQ(flatQ);

      const r1 = checkSingleAnswer(item as never, userReview);
      const r2 = checkCorrect(fq, userFlat);
      const r3 = gradeQuestion(
        gradeQ as never,
        { questionId: 'q1', answer: userGrade },
        0,
      ).isCorrect;

      // 세 모듈 결과 일치
      expect(r1).toBe(expected);
      expect(r2).toBe(expected);
      expect(r3).toBe(expected);

      // 상호 일관성
      expect(r1).toBe(r2);
      expect(r2).toBe(r3);
    });
  });
});
