import { describe, it, expect } from 'vitest';
import { shuffleChoicesForItem, shuffleReviewChoices } from './shuffleReviewChoices';
import { gradeAnswer } from '@/lib/utils/gradeAnswer';
import type { ReviewItem } from '@/lib/hooks/useReview';

// ─── 헬퍼: 최소 ReviewItem 모킹 ───
function makeItem(partial: Partial<ReviewItem> & Pick<ReviewItem, 'type' | 'correctAnswer'>): ReviewItem {
  return {
    id: 'rev1',
    userId: 'u1',
    quizId: 'quiz1',
    questionId: 'q1',
    question: '테스트 문제',
    userAnswer: '',
    reviewType: 'wrong',
    isBookmarked: false,
    reviewCount: 0,
    lastReviewedAt: null,
    createdAt: { seconds: 0, nanoseconds: 0 } as never,
    ...partial,
  };
}

/** correctAnswer 문자열 → 인덱스 배열 */
function parseIdx(s: string): number[] {
  return s
    .split(',')
    .map((x) => parseInt(x.trim(), 10))
    .filter((n) => !isNaN(n));
}

// 다양한 seed 로 반복 검증 (랜덤성에 의존하지 않도록)
const SEEDS = [0, 1, 7, 42, 123, 9999, 0xdeadbeef, 2147483647];

// ============================================================
// 핵심 불변식: 정답으로 채점되는 "선지 텍스트"는 셔플 후에도 동일하게 정답
// ============================================================

describe('shuffleChoicesForItem — 채점 불변식 (단일 정답)', () => {
  const options = ['선지A', '선지B', '선지C', '선지D'];

  for (const seed of SEEDS) {
    it(`seed=${seed}: 정답 선지 텍스트는 셔플 후에도 정답`, () => {
      const original = makeItem({ type: 'multiple', correctAnswer: '2', options });
      const shuffled = shuffleChoicesForItem(original, seed);

      // 1) 선지 집합은 보존 (순열)
      expect([...shuffled.options!].sort()).toEqual([...options].sort());

      // 2) 원래 정답 텍스트 = options[2]
      const correctText = options[2];
      // 3) 셔플 후 정답 인덱스가 가리키는 텍스트가 동일해야 함
      const newCorrectIdx = parseIdx(shuffled.correctAnswer.toString());
      expect(newCorrectIdx.map((i) => shuffled.options![i])).toEqual([correctText]);

      // 4) gradeAnswer 로 end-to-end: 정답 텍스트의 새 위치를 고르면 정답
      const userPick = shuffled.options!.indexOf(correctText);
      expect(gradeAnswer('multiple', shuffled.correctAnswer, userPick)).toBe(true);

      // 5) 오답 선지를 고르면 오답
      const wrongPick = shuffled.options!.indexOf('선지A');
      expect(gradeAnswer('multiple', shuffled.correctAnswer, wrongPick)).toBe(false);
    });
  }
});

describe('shuffleChoicesForItem — 채점 불변식 (복수정답, 특히 주의)', () => {
  const options = ['가', '나', '다', '라', '마'];

  for (const seed of SEEDS) {
    it(`seed=${seed}: 복수정답 텍스트 집합이 셔플 후에도 정확히 정답`, () => {
      // 원래 정답 = 인덱스 0,2,4 = ['가','다','마']
      const original = makeItem({ type: 'multiple', correctAnswer: '0,2,4', options });
      const shuffled = shuffleChoicesForItem(original, seed);

      const correctTexts = ['가', '다', '마'];
      const newCorrectIdx = parseIdx(shuffled.correctAnswer.toString());

      // 1) 셔플된 정답 인덱스가 가리키는 텍스트 = 원래 정답 텍스트 집합
      expect(newCorrectIdx.map((i) => shuffled.options![i]).sort()).toEqual([...correctTexts].sort());

      // 2) 정답 개수 보존
      expect(newCorrectIdx.length).toBe(3);

      // 3) 정답 텍스트들의 새 위치를 모두 고르면 정답 (순서 무관)
      const userPick = correctTexts.map((t) => shuffled.options!.indexOf(t));
      expect(gradeAnswer('multiple', shuffled.correctAnswer, userPick)).toBe(true);
      expect(gradeAnswer('multiple', shuffled.correctAnswer, [...userPick].reverse())).toBe(true);

      // 4) 정답 일부만 고르면 오답
      expect(gradeAnswer('multiple', shuffled.correctAnswer, [userPick[0]])).toBe(false);

      // 5) 오답 텍스트('나')를 끼워 고르면 오답
      const wrongIdx = shuffled.options!.indexOf('나');
      expect(gradeAnswer('multiple', shuffled.correctAnswer, [...userPick, wrongIdx])).toBe(false);
    });
  }

  it('정답 인덱스는 항상 오름차순 정규화', () => {
    const options = ['가', '나', '다', '라'];
    const original = makeItem({ type: 'multiple', correctAnswer: '3,1', options });
    const shuffled = shuffleChoicesForItem(original, 42);
    const idx = parseIdx(shuffled.correctAnswer.toString());
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
  });
});

// ============================================================
// choiceExplanations 는 선지를 따라간다
// ============================================================

describe('shuffleChoicesForItem — 선지별 해설 정합성', () => {
  const options = ['옵션0', '옵션1', '옵션2', '옵션3'];
  const choiceExplanations = ['해설0', '해설1', '해설2', '해설3'];

  for (const seed of SEEDS) {
    it(`seed=${seed}: 각 선지의 해설이 그대로 따라붙음`, () => {
      const original = makeItem({ type: 'multiple', correctAnswer: '1', options, choiceExplanations });
      const shuffled = shuffleChoicesForItem(original, seed);

      shuffled.options!.forEach((optText, newIdx) => {
        const origIdx = options.indexOf(optText);
        expect(shuffled.choiceExplanations![newIdx]).toBe(choiceExplanations[origIdx]);
      });
    });
  }
});

// ============================================================
// 셔플 대상이 아닌 경우 — 원본 그대로 (안전)
// ============================================================

describe('shuffleChoicesForItem — 셔플 제외 케이스 (원본 유지)', () => {
  it('OX 문제는 손대지 않음', () => {
    const item = makeItem({ type: 'ox', correctAnswer: 'O', options: ['O', 'X'] });
    expect(shuffleChoicesForItem(item, 42)).toBe(item);
  });

  it('단답형은 손대지 않음', () => {
    const item = makeItem({ type: 'short_answer', correctAnswer: 'ATP' });
    expect(shuffleChoicesForItem(item, 42)).toBe(item);
  });

  it('서술형은 손대지 않음', () => {
    const item = makeItem({ type: 'essay', correctAnswer: '' });
    expect(shuffleChoicesForItem(item, 42)).toBe(item);
  });

  it('선지가 1개면 셔플 안 함', () => {
    const item = makeItem({ type: 'multiple', correctAnswer: '0', options: ['하나'] });
    expect(shuffleChoicesForItem(item, 42)).toBe(item);
  });

  it('options 가 없으면 셔플 안 함', () => {
    const item = makeItem({ type: 'multiple', correctAnswer: '0' });
    expect(shuffleChoicesForItem(item, 42)).toBe(item);
  });

  it('정답이 비어있으면 셔플 안 함 (안전)', () => {
    const item = makeItem({ type: 'multiple', correctAnswer: '', options: ['a', 'b', 'c'] });
    expect(shuffleChoicesForItem(item, 42)).toBe(item);
  });

  it('정답 인덱스가 선지 범위를 벗어나면 셔플 안 함 (안전)', () => {
    const item = makeItem({ type: 'multiple', correctAnswer: '5', options: ['a', 'b', 'c'] });
    expect(shuffleChoicesForItem(item, 42)).toBe(item);
  });

  it('복수정답 중 하나라도 범위 밖이면 셔플 안 함', () => {
    const item = makeItem({ type: 'multiple', correctAnswer: '0,9', options: ['a', 'b', 'c'] });
    expect(shuffleChoicesForItem(item, 42)).toBe(item);
  });
});

// ============================================================
// 결정성 & "원본과 다른 순서" 보장
// ============================================================

describe('shuffleChoicesForItem — 결정성 / 순서 변경', () => {
  const options = ['1', '2', '3', '4', '5'];

  it('같은 seed → 같은 결과 (새로고침 일관성)', () => {
    const item = makeItem({ type: 'multiple', correctAnswer: '0,3', options });
    const a = shuffleChoicesForItem(item, 12345);
    const b = shuffleChoicesForItem(item, 12345);
    expect(a.options).toEqual(b.options);
    expect(a.correctAnswer).toBe(b.correctAnswer);
  });

  it('원본 배열을 변형하지 않음 (불변)', () => {
    const item = makeItem({ type: 'multiple', correctAnswer: '2', options: [...options] });
    const before = [...item.options!];
    shuffleChoicesForItem(item, 42);
    expect(item.options).toEqual(before);
    expect(item.correctAnswer).toBe('2');
  });

  it('대부분의 seed 에서 원본과 다른 순서 (위치 외우기 방지)', () => {
    const item = makeItem({ type: 'multiple', correctAnswer: '0', options });
    let changed = 0;
    for (const seed of SEEDS) {
      const s = shuffleChoicesForItem(item, seed);
      if (JSON.stringify(s.options) !== JSON.stringify(options)) changed++;
    }
    // identity 가드가 있으므로 모든 seed 에서 달라야 함
    expect(changed).toBe(SEEDS.length);
  });

  it('2지선다도 항상 뒤집혀 원본과 다름', () => {
    const item = makeItem({ type: 'multiple', correctAnswer: '0', options: ['예', '아니오'] });
    for (const seed of SEEDS) {
      const s = shuffleChoicesForItem(item, seed);
      expect(s.options).not.toEqual(['예', '아니오']);
      // 정답 텍스트 '예'가 가리키는 위치로 채점하면 정답
      const pick = s.options!.indexOf('예');
      expect(gradeAnswer('multiple', s.correctAnswer, pick)).toBe(true);
    }
  });
});

// ============================================================
// 목록 단위 + 결합형(서로 다른 문제 다른 순서)
// ============================================================

describe('shuffleReviewChoices — 목록 적용', () => {
  it('객관식만 바뀌고 나머지 타입은 그대로', () => {
    const items: ReviewItem[] = [
      makeItem({ id: 'a', type: 'multiple', correctAnswer: '1', options: ['a', 'b', 'c'] }),
      makeItem({ id: 'b', type: 'ox', correctAnswer: 'O', options: ['O', 'X'] }),
      makeItem({ id: 'c', type: 'short_answer', correctAnswer: '답' }),
    ];
    const out = shuffleReviewChoices(items, 42);
    // ox / 단답형은 동일 참조
    expect(out[1]).toBe(items[1]);
    expect(out[2]).toBe(items[2]);
    // 객관식은 새 객체, 선지 집합 보존
    expect(out[0]).not.toBe(items[0]);
    expect([...out[0].options!].sort()).toEqual(['a', 'b', 'c']);
  });

  it('id 가 다르면 서로 다른 순서가 나올 수 있다 (문제별 독립)', () => {
    const mk = (id: string) =>
      makeItem({ id, type: 'multiple', correctAnswer: '0', options: ['1', '2', '3', '4', '5', '6'] });
    const a = shuffleChoicesForItem(mk('alpha'), 42);
    const b = shuffleChoicesForItem(mk('beta'), 42);
    // 같은 seed 라도 id 해시가 달라 순서가 갈린다 (항상은 아니지만 통상 다름)
    expect(a.options).not.toEqual(b.options);
  });
});

// ============================================================
// 결합형(combined) 하위문제 — 객관식 하위문제도 셔플, 메타데이터 보존
// ============================================================

describe('shuffleReviewChoices — 결합형 하위문제', () => {
  // 결합형: 같은 combinedGroupId 의 하위문제들이 평탄한 items 배열에 들어있음
  const buildCombined = (): ReviewItem[] => [
    makeItem({
      id: 'sub0',
      type: 'multiple',
      correctAnswer: '1',
      options: ['하위A', '하위B', '하위C', '하위D'],
      choiceExplanations: ['eA', 'eB', 'eC', 'eD'],
      combinedGroupId: 'g1',
      combinedIndex: 0,
    }),
    makeItem({
      id: 'sub1',
      type: 'multiple',
      correctAnswer: '0,2',
      options: ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ'],
      combinedGroupId: 'g1',
      combinedIndex: 1,
    }),
    makeItem({
      id: 'sub2',
      type: 'ox',
      correctAnswer: 'O',
      options: ['O', 'X'],
      combinedGroupId: 'g1',
      combinedIndex: 2,
    }),
  ];

  for (const seed of SEEDS) {
    it(`seed=${seed}: 객관식 하위문제 단일정답 채점 불변`, () => {
      const out = shuffleReviewChoices(buildCombined(), seed);
      const sub = out[0];
      // 정답 텍스트 '하위B'(원래 인덱스 1) 가 셔플 후에도 정답
      const pick = sub.options!.indexOf('하위B');
      expect(gradeAnswer('multiple', sub.correctAnswer, pick)).toBe(true);
      // 해설도 선지를 따라감
      sub.options!.forEach((t, i) => {
        const origIdx = ['하위A', '하위B', '하위C', '하위D'].indexOf(t);
        expect(sub.choiceExplanations![i]).toBe(['eA', 'eB', 'eC', 'eD'][origIdx]);
      });
    });

    it(`seed=${seed}: 객관식 하위문제 복수정답 채점 불변`, () => {
      const out = shuffleReviewChoices(buildCombined(), seed);
      const sub = out[1];
      // 원래 정답 = 'ㄱ','ㄷ'
      const picks = ['ㄱ', 'ㄷ'].map((t) => sub.options!.indexOf(t));
      expect(gradeAnswer('multiple', sub.correctAnswer, picks)).toBe(true);
      // 오답 'ㄴ' 끼면 오답
      expect(gradeAnswer('multiple', sub.correctAnswer, [...picks, sub.options!.indexOf('ㄴ')])).toBe(false);
    });

    it(`seed=${seed}: 결합형 메타데이터(combinedGroupId/Index)와 OX 하위문제는 보존`, () => {
      const items = buildCombined();
      const out = shuffleReviewChoices(items, seed);
      // 객관식 하위문제도 결합형 메타 유지
      expect(out[0].combinedGroupId).toBe('g1');
      expect(out[0].combinedIndex).toBe(0);
      expect(out[1].combinedGroupId).toBe('g1');
      expect(out[1].combinedIndex).toBe(1);
      // OX 하위문제는 손대지 않음 (동일 참조)
      expect(out[2]).toBe(items[2]);
    });
  }
});
