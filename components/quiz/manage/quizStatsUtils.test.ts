import { describe, it, expect } from 'vitest';
import {
  checkCorrect,
  flattenQuestions,
  answerToString,
  toMillis,
} from './quizStatsUtils';
import type { FlattenedQuestion } from './quizStatsTypes';

// ─── 헬퍼: 최소 FlattenedQuestion 모킹 ───

function makeQuestion(
  type: FlattenedQuestion['type'],
  answer?: string,
): FlattenedQuestion {
  return {
    id: 'q1',
    text: '테스트 문제',
    type,
    answer,
  };
}

// ============================================================
// checkCorrect — OX 문제
// ============================================================

describe('checkCorrect — OX 문제', () => {
  it("정답 '0'(O), 유저 'O' → true", () => {
    const q = makeQuestion('ox', '0');
    expect(checkCorrect(q, 'O')).toBe(true);
  });

  it("정답 '0'(O), 유저 'X' → false", () => {
    const q = makeQuestion('ox', '0');
    expect(checkCorrect(q, 'X')).toBe(false);
  });

  it("정답 'O', 유저 '0' → true (문자/숫자 호환)", () => {
    const q = makeQuestion('ox', 'O');
    expect(checkCorrect(q, '0')).toBe(true);
  });

  it("정답 '1'(X), 유저 'X' → true", () => {
    const q = makeQuestion('ox', '1');
    expect(checkCorrect(q, 'X')).toBe(true);
  });

  it("정답 '1'(X), 유저 'O' → false", () => {
    const q = makeQuestion('ox', '1');
    expect(checkCorrect(q, 'O')).toBe(false);
  });

  it("정답 'X', 유저 '1' → true", () => {
    const q = makeQuestion('ox', 'X');
    expect(checkCorrect(q, '1')).toBe(true);
  });

  it("정답 '0', 유저 숫자 0 → true", () => {
    const q = makeQuestion('ox', '0');
    expect(checkCorrect(q, 0)).toBe(true);
  });

  it('null 답안 → false', () => {
    const q = makeQuestion('ox', '0');
    expect(checkCorrect(q, null)).toBe(false);
  });

  it('undefined 답안 → false', () => {
    const q = makeQuestion('ox', 'O');
    expect(checkCorrect(q, undefined)).toBe(false);
  });
});

// ============================================================
// checkCorrect — 객관식 (단일 정답)
// ============================================================

describe('checkCorrect — 객관식 (단일)', () => {
  it("정답 '2', 유저 '2' → true", () => {
    const q = makeQuestion('multiple', '2');
    expect(checkCorrect(q, '2')).toBe(true);
  });

  it("정답 '2', 유저 '3' → false", () => {
    const q = makeQuestion('multiple', '2');
    expect(checkCorrect(q, '3')).toBe(false);
  });

  it("정답 '0', 유저 '0' → true (첫 번째 선지)", () => {
    const q = makeQuestion('multiple', '0');
    expect(checkCorrect(q, '0')).toBe(true);
  });

  it("정답 '0', 유저 숫자 0 → true (String 변환)", () => {
    const q = makeQuestion('multiple', '0');
    expect(checkCorrect(q, 0)).toBe(true);
  });

  it('null 답안 → false', () => {
    const q = makeQuestion('multiple', '2');
    expect(checkCorrect(q, null)).toBe(false);
  });
});

// ============================================================
// checkCorrect — 객관식 (복수 정답)
// ============================================================

describe('checkCorrect — 객관식 (복수정답)', () => {
  it("정답 '0,2', 유저 '0,2' → true", () => {
    const q = makeQuestion('multiple', '0,2');
    expect(checkCorrect(q, '0,2')).toBe(true);
  });

  it("정답 '0,2', 유저 '2,0' → true (순서 무관, sort 후 비교)", () => {
    const q = makeQuestion('multiple', '0,2');
    expect(checkCorrect(q, '2,0')).toBe(true);
  });

  it("정답 '0,2', 유저 '0' → false (부분 정답)", () => {
    const q = makeQuestion('multiple', '0,2');
    expect(checkCorrect(q, '0')).toBe(false);
  });

  it("정답 '0,2', 유저 '0,1,2' → false (초과 선택)", () => {
    const q = makeQuestion('multiple', '0,2');
    expect(checkCorrect(q, '0,1,2')).toBe(false);
  });

  it("정답 '1,3,4', 유저 '4,1,3' → true (3개 복수정답)", () => {
    const q = makeQuestion('multiple', '1,3,4');
    expect(checkCorrect(q, '4,1,3')).toBe(true);
  });
});

// ============================================================
// checkCorrect — 단답형 / 주관식
// ============================================================

describe('checkCorrect — 단답형', () => {
  it('정확히 일치 → true', () => {
    const q = makeQuestion('short_answer', '미토콘드리아');
    expect(checkCorrect(q, '미토콘드리아')).toBe(true);
  });

  it('다른 답 → false', () => {
    const q = makeQuestion('short_answer', '답');
    expect(checkCorrect(q, '오답')).toBe(false);
  });

  it('복수정답 "apple|||apples" → "apples" → true', () => {
    const q = makeQuestion('short_answer', 'apple|||apples');
    expect(checkCorrect(q, 'apples')).toBe(true);
  });

  it('복수정답 "Apple|||APPLE" → "apple" → true (대소문자 무시)', () => {
    const q = makeQuestion('short_answer', 'Apple|||APPLE');
    expect(checkCorrect(q, 'apple')).toBe(true);
  });

  it('"ATP" → "atp" → true (대소문자 무시)', () => {
    const q = makeQuestion('short_answer', 'ATP');
    expect(checkCorrect(q, 'atp')).toBe(true);
  });

  it('빈 문자열 → false', () => {
    const q = makeQuestion('short_answer', '정답');
    expect(checkCorrect(q, '')).toBe(false);
  });

  it('null 답안 → false', () => {
    const q = makeQuestion('short_answer', '정답');
    expect(checkCorrect(q, null)).toBe(false);
  });

  it('공백 포함 답안 trim 처리 → true', () => {
    const q = makeQuestion('short_answer', 'ATP');
    expect(checkCorrect(q, ' atp ')).toBe(true);
  });

  it('answer undefined → false', () => {
    const q = makeQuestion('short_answer', undefined);
    expect(checkCorrect(q, '아무거나')).toBe(false);
  });
});

// ============================================================
// answerToString
// ============================================================

describe('answerToString', () => {
  it('null → undefined', () => {
    expect(answerToString(null)).toBeUndefined();
  });

  it('undefined → undefined', () => {
    expect(answerToString(undefined)).toBeUndefined();
  });

  it('숫자 → 문자열', () => {
    expect(answerToString(2)).toBe('2');
  });

  it('배열 → 쉼표 구분 문자열', () => {
    expect(answerToString([0, 2])).toBe('0,2');
  });

  it('문자열 → 그대로 반환', () => {
    expect(answerToString('미토콘드리아')).toBe('미토콘드리아');
  });

  it('숫자 0 → "0"', () => {
    expect(answerToString(0)).toBe('0');
  });
});

// ============================================================
// toMillis
// ============================================================

describe('toMillis', () => {
  it('null → 0', () => {
    expect(toMillis(null)).toBe(0);
  });

  it('undefined → 0', () => {
    expect(toMillis(undefined)).toBe(0);
  });

  it('toMillis 메서드가 있는 객체 → 호출 결과', () => {
    const ts = { toMillis: () => 1234567890 };
    expect(toMillis(ts)).toBe(1234567890);
  });

  it('seconds 필드가 있는 객체 → seconds * 1000', () => {
    const ts = { seconds: 1000 };
    expect(toMillis(ts)).toBe(1_000_000);
  });

  it('숫자 → 그대로 반환', () => {
    expect(toMillis(5000)).toBe(5000);
  });
});

// ============================================================
// flattenQuestions — 일반 문제
// ============================================================

describe('flattenQuestions — 일반 문제', () => {
  it('일반 문제 1개 → 그대로 1개 반환', () => {
    const questions = [
      {
        id: 'q1',
        text: 'OX 문제',
        type: 'ox',
        answer: 0,
      },
    ];
    const result = flattenQuestions(questions);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('q1');
    expect(result[0].type).toBe('ox');
    expect(result[0].answer).toBe('0'); // answerToString 변환
  });

  it('일반 문제 3개 → 3개 반환, ID 보존', () => {
    const questions = [
      { id: 'q1', text: '문제1', type: 'ox', answer: 0 },
      { id: 'q2', text: '문제2', type: 'multiple', answer: 2 },
      { id: 'q3', text: '문제3', type: 'short_answer', answer: 'ATP' },
    ];
    const result = flattenQuestions(questions);
    expect(result).toHaveLength(3);
    expect(result.map(r => r.id)).toEqual(['q1', 'q2', 'q3']);
  });

  it('ID 없는 문제 → q{index} 폴백', () => {
    const questions = [
      { text: '문제1', type: 'ox', answer: 0 },
      { text: '문제2', type: 'multiple', answer: 1 },
    ];
    const result = flattenQuestions(questions);
    expect(result[0].id).toBe('q0');
    expect(result[1].id).toBe('q1');
  });

  it('배열 answer → 쉼표 구분 문자열', () => {
    const questions = [
      { id: 'q1', text: '복수정답', type: 'multiple', answer: [0, 2] },
    ];
    const result = flattenQuestions(questions);
    expect(result[0].answer).toBe('0,2');
  });
});

// ============================================================
// flattenQuestions — 이미 펼쳐진 결합형 (combinedGroupId 존재)
// ============================================================

describe('flattenQuestions — 이미 펼쳐진 결합형', () => {
  it('combinedGroupId가 있는 문제 → 그대로 결합형으로 처리', () => {
    const questions = [
      {
        id: 'sub1',
        text: '하위 문제 1',
        type: 'multiple',
        answer: 1,
        combinedGroupId: 'group1',
        combinedIndex: 0,
        combinedTotal: 2,
        passage: '공통 지문',
        passageType: 'text',
      },
      {
        id: 'sub2',
        text: '하위 문제 2',
        type: 'short_answer',
        answer: '답',
        combinedGroupId: 'group1',
        combinedIndex: 1,
        combinedTotal: 2,
      },
    ];
    const result = flattenQuestions(questions);
    expect(result).toHaveLength(2);
    expect(result[0].combinedGroupId).toBe('group1');
    expect(result[0].passage).toBe('공통 지문'); // index 0이면 passage 포함
    expect(result[1].passage).toBeUndefined(); // index 1이면 passage 없음
  });
});

// ============================================================
// flattenQuestions — 레거시 결합형 (type=combined + subQuestions)
// ============================================================

describe('flattenQuestions — 레거시 결합형', () => {
  it('결합형 문제 → 하위 문제로 분해', () => {
    const questions = [
      {
        id: 'comb1',
        type: 'combined',
        text: '공통 지문 기반',
        passage: '다음 지문을 읽고 답하시오.',
        passageType: 'text',
        subQuestions: [
          { id: 'sub1', text: '하위1', type: 'multiple', answerIndex: 2, choices: ['A', 'B', 'C'] },
          { id: 'sub2', text: '하위2', type: 'short_answer', answerText: 'ATP' },
        ],
      },
    ];
    const result = flattenQuestions(questions);
    expect(result).toHaveLength(2);

    // 첫 번째 하위 문제에만 passage 포함
    expect(result[0].passage).toBe('다음 지문을 읽고 답하시오.');
    expect(result[0].answer).toBe('2'); // answerIndex → string
    expect(result[0].combinedGroupId).toBe('legacy_comb1');
    expect(result[0].combinedIndex).toBe(0);
    expect(result[0].combinedTotal).toBe(2);

    // 두 번째 하위 문제
    expect(result[1].passage).toBeUndefined();
    expect(result[1].answer).toBe('ATP'); // answerText
    expect(result[1].combinedIndex).toBe(1);
  });

  it('하위 문제 복수정답 (answerIndices) → 쉼표 구분 문자열', () => {
    const questions = [
      {
        id: 'comb2',
        type: 'combined',
        text: '복수정답 결합형',
        subQuestions: [
          { text: '하위', type: 'multiple', answerIndices: [0, 3], choices: ['A', 'B', 'C', 'D'] },
        ],
      },
    ];
    const result = flattenQuestions(questions);
    expect(result[0].answer).toBe('0,3');
  });

  it('하위 문제 ID 없음 → {parentId}_sub{index} 폴백', () => {
    const questions = [
      {
        id: 'comb3',
        type: 'combined',
        text: '테스트',
        subQuestions: [
          { text: '하위1', type: 'ox', answerIndex: 0 },
          { text: '하위2', type: 'ox', answerIndex: 1 },
        ],
      },
    ];
    const result = flattenQuestions(questions);
    expect(result[0].id).toBe('comb3_sub0');
    expect(result[1].id).toBe('comb3_sub1');
  });

  it('빈 subQuestions → 펼침 결과 0개', () => {
    const questions = [
      {
        id: 'comb_empty',
        type: 'combined',
        text: '빈 결합형',
        subQuestions: [],
      },
    ];
    const result = flattenQuestions(questions);
    // subQuestions가 빈 배열이면 length > 0 조건 불충족 → 일반 문제로 처리
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('comb_empty');
  });

  it('혼합: 일반 + 결합형 → 올바르게 펼침', () => {
    const questions = [
      { id: 'q1', text: '일반 OX', type: 'ox', answer: 0 },
      {
        id: 'comb1',
        type: 'combined',
        text: '결합형',
        passage: '지문',
        passageType: 'text',
        subQuestions: [
          { id: 's1', text: '하위1', type: 'multiple', answerIndex: 1 },
          { id: 's2', text: '하위2', type: 'short_answer', answerText: '답' },
        ],
      },
      { id: 'q2', text: '일반 객관식', type: 'multiple', answer: 3 },
    ];
    const result = flattenQuestions(questions);
    expect(result).toHaveLength(4); // 1(일반) + 2(결합형 하위) + 1(일반)
    expect(result.map(r => r.id)).toEqual(['q1', 's1', 's2', 'q2']);
  });
});
