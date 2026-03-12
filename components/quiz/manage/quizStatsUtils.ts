/**
 * QuizStatsModal 유틸리티 함수
 *
 * 문제 펼치기, 답변 변환, 정답 체크, 타임스탬프 변환 등 순수 함수
 */

import type { FlattenedQuestion, MixedExampleItem } from './quizStatsTypes';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyValue = any;

/**
 * 퀴즈 answer를 문자열로 변환 (인덱스 변환 없이 원본 보존)
 * Firestore 저장값: OX→0/1, 객관식→0-indexed number/number[], 주관식→string
 */
export function answerToString(answer: AnyValue): string | undefined {
  if (answer === null || answer === undefined) return undefined;
  if (Array.isArray(answer)) return answer.join(',');
  return answer.toString();
}

/**
 * questionUpdatedAt 타임스탬프를 밀리초로 변환
 */
export function toMillis(ts: AnyValue): number {
  if (!ts) return 0;
  if (ts.toMillis) return ts.toMillis();
  if (ts.seconds) return ts.seconds * 1000;
  if (typeof ts === 'number') return ts;
  return 0;
}

/**
 * questions 배열을 펼쳐서 결합형 하위 문제들을 개별 문제로 변환
 *
 * 중요: ID 생성 시 result 페이지와 동일한 로직 사용 (q.id || `q${index}`)
 */
export function flattenQuestions(questions: AnyValue[]): FlattenedQuestion[] {
  const result: FlattenedQuestion[] = [];

  questions.forEach((q, index) => {
    // 결과 페이지와 동일한 ID fallback 로직 사용
    const questionId = q.id || `q${index}`;

    // 이미 펼쳐진 결합형 문제 (combinedGroupId가 있는 경우)
    if (q.combinedGroupId) {
      result.push({
        id: questionId,
        text: q.text || '',
        type: q.type,
        choices: q.choices,
        answer: answerToString(q.answer),
        chapterId: q.chapterId,
        chapterDetailId: q.chapterDetailId,
        imageUrl: q.imageUrl,
        mixedExamples: q.mixedExamples,
        passagePrompt: q.passagePrompt,
        bogi: q.bogi,
        combinedGroupId: q.combinedGroupId,
        combinedIndex: q.combinedIndex,
        combinedTotal: q.combinedTotal,
        passage: q.combinedIndex === 0 ? q.passage : undefined,
        passageType: q.combinedIndex === 0 ? q.passageType : undefined,
        passageImage: q.combinedIndex === 0 ? q.passageImage : undefined,
        koreanAbcItems: q.combinedIndex === 0 ? q.koreanAbcItems : undefined,
        explanation: q.explanation,
        choiceExplanations: q.choiceExplanations,
        questionUpdatedAt: toMillis(q.questionUpdatedAt) || undefined,
      });
    }
    // 레거시 결합형 문제 (type === 'combined' + subQuestions)
    else if (q.type === 'combined' && q.subQuestions && q.subQuestions.length > 0) {
      const groupId = `legacy_${questionId}`;
      q.subQuestions.forEach((sq: AnyValue, idx: number) => {
        const updatedAt = toMillis(sq.questionUpdatedAt || q.questionUpdatedAt);
        result.push({
          id: sq.id || `${questionId}_sub${idx}`,
          text: sq.text || '',
          type: sq.type || 'short_answer',
          choices: sq.choices,
          answer: sq.answerIndices?.length > 0
            ? sq.answerIndices.join(',')
            : sq.answerIndex !== undefined
              ? sq.answerIndex.toString()
              : sq.answerText,
          chapterId: q.chapterId,
          imageUrl: sq.imageUrl,
          mixedExamples: sq.mixedExamples,
          passagePrompt: sq.passagePrompt,
          bogi: sq.bogi,
          combinedGroupId: groupId,
          combinedIndex: idx,
          combinedTotal: q.subQuestions.length,
          passage: idx === 0 ? q.passage : undefined,
          passageType: idx === 0 ? q.passageType : undefined,
          passageImage: idx === 0 ? q.passageImage : undefined,
          koreanAbcItems: idx === 0 ? q.koreanAbcItems : undefined,
          explanation: sq.explanation,
          choiceExplanations: sq.choiceExplanations,
          questionUpdatedAt: updatedAt || undefined,
        });
      });
    }
    // 일반 문제
    else {
      result.push({
        id: questionId,
        text: q.text || '',
        type: q.type,
        choices: q.choices,
        answer: answerToString(q.answer),
        chapterId: q.chapterId,
        chapterDetailId: q.chapterDetailId,
        imageUrl: q.imageUrl,
        mixedExamples: q.mixedExamples,
        passagePrompt: q.passagePrompt,
        bogi: q.bogi,
        explanation: q.explanation,
        choiceExplanations: q.choiceExplanations,
        questionUpdatedAt: toMillis(q.questionUpdatedAt) || undefined,
      });
    }
  });

  return result;
}

/**
 * 혼합 보기 항목이 유효한지 확인
 */
export function isValidMixedItem(item: MixedExampleItem): boolean {
  switch (item.type) {
    case 'text':
      return Boolean(item.content?.trim());
    case 'labeled':
    case 'gana':
    case 'bullet':
      return Boolean(item.content?.trim()) ||
             Boolean(item.items?.some(i => i.content.trim()));
    case 'image':
      return Boolean(item.imageUrl);
    case 'grouped':
      return Boolean(item.children?.length && item.children.some(child => isValidMixedItem(child)));
    default:
      return false;
  }
}

/**
 * 현재 정답 기준으로 isCorrect 재판정 (문제 수정 후 통계 모순 방지)
 * question.answer: 0-indexed (객관식 "0","1,2" / OX 0,1,"0","1" / 주관식 원본)
 * userAnswer: (객관식 "0","1,2" / OX "O","X",0,1 / 주관식 원본)
 */
export function checkCorrect(question: FlattenedQuestion, rawUserAnswer: unknown): boolean {
  const userAnswer = rawUserAnswer != null ? String(rawUserAnswer) : '';
  if (!userAnswer && userAnswer !== '0') return false;
  const answer = question.answer != null ? String(question.answer) : '';
  if (!answer && answer !== '0') return false;

  if (question.type === 'ox') {
    const correctIsO = answer === '0' || answer.toUpperCase() === 'O';
    const userIsO = userAnswer.toUpperCase() === 'O' || userAnswer === '0';
    return correctIsO === userIsO;
  }
  if (question.type === 'multiple') {
    // answer, userAnswer 모두 0-indexed ("0","1,2") → 직접 비교
    const correctParts = answer.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n)).sort();
    const userParts = userAnswer.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n)).sort();
    return JSON.stringify(correctParts) === JSON.stringify(userParts);
  }
  // 주관식: ||| 구분자 복수정답
  const accepted = answer.split('|||').map(s => s.trim().toLowerCase());
  return accepted.includes(userAnswer.trim().toLowerCase());
}

/**
 * 문제 유형 라벨 변환
 */
export function getTypeLabel(type: string): string {
  switch (type) {
    case 'ox': return 'OX';
    case 'multiple': return '객관식';
    case 'short_answer': return '주관식';
    case 'short': return '주관식';
    case 'essay': return '서술형';
    default: return type;
  }
}
