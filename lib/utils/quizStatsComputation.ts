/**
 * 퀴즈 통계 계산 유틸리티 (순수 함수)
 *
 * useProfessorQuiz 훅에서 추출된 통계 계산 로직.
 * React 의존성 없이 순수 데이터 변환만 수행합니다.
 */

import type {
  QuizQuestion,
  QuestionStats,
  QuizStatistics,
  ChoiceStats,
} from '@/lib/hooks/useProfessorQuiz';

// ============================================================
// 타입 정의
// ============================================================

/** quizResults 문서의 평탄화된 데이터 (Firestore 의존성 제거) */
export interface QuizResultData {
  answers: (number | string | null | undefined)[];
  questionScores?: Record<string, { answeredAt?: TimestampLike }>;
  createdAt?: TimestampLike;
}

/** Firestore Timestamp 호환 인터페이스 (toMillis 또는 seconds 지원) */
interface TimestampLike {
  toMillis?: () => number;
  seconds?: number;
}

// ============================================================
// 헬퍼 함수
// ============================================================

/**
 * TimestampLike → 밀리초 변환
 */
function toMillis(ts: TimestampLike | undefined | null): number {
  if (!ts) return 0;
  if (ts.toMillis) return ts.toMillis();
  if (ts.seconds) return ts.seconds * 1000;
  return 0;
}

/**
 * 결합형 문제를 펼쳐서 개별 문제로 변환하는 헬퍼 함수
 *
 * - 이미 펼쳐진 결합형 (combinedGroupId 있음): 그대로 push
 * - 레거시 결합형 (type==='combined' + subQuestions): 하위 문제별로 분리
 * - 일반 문제: 그대로 push
 */
export function flattenQuestionsForStats(questions: any[]): QuizQuestion[] {
  const result: QuizQuestion[] = [];
  let globalIdx = 0;

  questions.forEach((q) => {
    // 이미 펼쳐진 결합형 문제 (combinedGroupId가 있는 경우)
    if (q.combinedGroupId) {
      result.push({
        id: q.id || `q${globalIdx}`,
        text: q.text || '',
        type: q.type,
        choices: q.choices,
        answer: q.answer,
        explanation: q.explanation,
      });
      globalIdx++;
    }
    // 레거시 결합형 문제 (type === 'combined' + subQuestions)
    else if (q.type === 'combined' && q.subQuestions && q.subQuestions.length > 0) {
      const parentId = q.id || `q${globalIdx}`;
      q.subQuestions.forEach((sq: any, idx: number) => {
        // 정답 형식 변환 (0-indexed 유지 — recordAttempt CF와 일치)
        let answer: number | string | number[];
        if (sq.type === 'ox') {
          answer = sq.answerIndex ?? 0;
        } else if (sq.type === 'multiple') {
          if (sq.answerIndices?.length > 0) {
            answer = sq.answerIndices.length === 1 ? sq.answerIndices[0] : sq.answerIndices;
          } else if (sq.answerIndex !== undefined && sq.answerIndex >= 0) {
            answer = sq.answerIndex;
          } else {
            answer = 0;
          }
        } else {
          answer = sq.answerText || '';
        }

        result.push({
          id: sq.id || `${parentId}_sub${idx}`,
          text: sq.text || '',
          type: sq.type || 'short_answer',
          choices: sq.choices,
          answer,
          explanation: sq.explanation,
        });
      });
      globalIdx++;
    }
    // 일반 문제
    else {
      result.push({
        id: q.id || `q${globalIdx}`,
        text: q.text || '',
        type: q.type,
        choices: q.choices,
        answer: q.answer,
        explanation: q.explanation,
      });
      globalIdx++;
    }
  });

  return result;
}

/**
 * 원본 questions 배열에서 문제별 수정 시간(questionUpdatedAt)을 추출
 *
 * @returns questionUpdatedAtMap (인덱스→밀리초), questionModifiedMap (인덱스→수정여부)
 */
export function buildQuestionUpdatedAtMaps(questions: any[]): {
  questionUpdatedAtMap: Map<number, number>;
  questionModifiedMap: Map<number, boolean>;
} {
  const questionUpdatedAtMap = new Map<number, number>();
  const questionModifiedMap = new Map<number, boolean>();

  let flatIdx = 0;
  questions.forEach((q: any) => {
    if (q.type === 'combined' && q.subQuestions && q.subQuestions.length > 0) {
      // 결합형: 각 하위 문제별로 처리
      q.subQuestions.forEach((sq: any) => {
        const updatedAt = sq.questionUpdatedAt || q.questionUpdatedAt;
        const ts = toMillis(updatedAt);
        if (ts > 0) {
          questionUpdatedAtMap.set(flatIdx, ts);
          questionModifiedMap.set(flatIdx, true);
        }
        flatIdx++;
      });
    } else if (q.combinedGroupId) {
      // 이미 펼쳐진 결합형 문제
      const ts = toMillis(q.questionUpdatedAt);
      if (ts > 0) {
        questionUpdatedAtMap.set(flatIdx, ts);
        questionModifiedMap.set(flatIdx, true);
      }
      flatIdx++;
    } else {
      // 일반 문제
      const ts = toMillis(q.questionUpdatedAt);
      if (ts > 0) {
        questionUpdatedAtMap.set(flatIdx, ts);
        questionModifiedMap.set(flatIdx, true);
      }
      flatIdx++;
    }
  });

  return { questionUpdatedAtMap, questionModifiedMap };
}

// ============================================================
// 메인 통계 계산 함수
// ============================================================

/**
 * 퀴즈 통계 계산 (순수 함수)
 *
 * Firestore에서 조회한 quizResults 데이터를 기반으로
 * 문제별 정답률, 선지별 선택 통계, 오답 목록, 오답률 순위를 계산합니다.
 *
 * @param questions - 원본 문제 배열 (결합형 포함, questionUpdatedAt 포함 가능)
 * @param resultDocs - quizResults 문서의 평탄화된 데이터 배열
 * @returns QuizStatistics (문제별 통계 + 오답률 순위)
 */
export function computeQuizStatistics(
  questions: any[],
  resultDocs: QuizResultData[],
): QuizStatistics {
  // 결합형 문제 펼치기 (레거시 호환성)
  const flattenedQuestions = flattenQuestionsForStats(questions);

  // 문제별 수정 시간 추출
  const { questionUpdatedAtMap, questionModifiedMap } = buildQuestionUpdatedAtMaps(questions);

  // 결과가 없으면 빈 통계 반환
  if (resultDocs.length === 0) {
    const emptyStats: QuestionStats[] = flattenedQuestions.map((q, idx) => ({
      questionId: q.id,
      questionIndex: idx,
      totalResponses: 0,
      correctCount: 0,
      wrongCount: 0,
      correctRate: 0,
      wrongRate: 0,
      choiceStats: q.type === 'ox'
        ? [{ choice: 0, count: 0, percentage: 0 }, { choice: 1, count: 0, percentage: 0 }]
        : q.type === 'multiple' && q.choices
          ? q.choices.map((_, i) => ({ choice: i, count: 0, percentage: 0 }))
          : undefined,
      wrongAnswers: (q.type === 'subjective' || q.type === 'short_answer') ? [] : undefined,
      isModified: questionModifiedMap.get(idx) || false,
    }));

    return {
      questionStats: emptyStats,
      wrongRateRanking: [],
    };
  }

  // 문제별 통계 계산
  const questionStats: QuestionStats[] = flattenedQuestions.map((question, idx) => {
    let totalResponses = 0;
    let correctCount = 0;
    const choiceCounts: Record<string, number> = {};
    const wrongAnswerSet = new Set<string>();

    // 이 문제의 수정 시간 (없으면 undefined)
    const questionUpdatedAt = questionUpdatedAtMap.get(idx);
    const isModified = questionModifiedMap.get(idx) || false;

    // 각 결과에서 해당 문제의 답안 분석
    resultDocs.forEach((resultData) => {
      const answers = resultData.answers || [];
      const userAnswer = answers[idx];

      // 문제가 수정된 경우, 수정 이후의 응답만 포함
      if (questionUpdatedAt) {
        // questionScores에서 개별 문제의 응답 시간 확인
        const questionScores = resultData.questionScores || {};
        const questionScore = questionScores[question.id];
        let answeredAt = 0;

        if (questionScore?.answeredAt) {
          answeredAt = toMillis(questionScore.answeredAt);
        } else {
          // questionScores가 없으면 결과 생성 시간 사용
          answeredAt = toMillis(resultData.createdAt);
        }

        // 응답이 문제 수정 이전이면 통계에서 제외
        if (answeredAt > 0 && answeredAt < questionUpdatedAt) {
          return;
        }
      }

      if (userAnswer === undefined || userAnswer === null || userAnswer === '') {
        return; // 미응답 건너뜀
      }

      totalResponses++;

      // 정답 여부 확인
      const correctAnswer = question.answer;
      let isCorrect = false;

      if (question.type === 'ox') {
        // OX: O=0, X=1
        const userOX = String(userAnswer).toUpperCase();
        const correctOX = correctAnswer === 0 ? 'O' : 'X';
        isCorrect = userOX === correctOX || userOX === String(correctAnswer);

        // 선택 카운트
        const choiceKey = userOX === 'O' || userAnswer === 0 || userAnswer === '0' ? '0' : '1';
        choiceCounts[choiceKey] = (choiceCounts[choiceKey] || 0) + 1;
      } else if (question.type === 'multiple') {
        // 객관식 — recordAttempt CF가 0-indexed로 저장
        const rawStr = String(userAnswer);
        const selections = rawStr.includes(',')
          ? rawStr.split(',').map(s => parseInt(s.trim(), 10))
          : [typeof userAnswer === 'string' ? parseInt(userAnswer, 10) : userAnswer as number];

        if (Array.isArray(correctAnswer)) {
          const userSorted = [...selections].sort();
          const correctSorted = [...(correctAnswer as number[])].sort();
          isCorrect = JSON.stringify(userSorted) === JSON.stringify(correctSorted);
        } else {
          isCorrect = selections.length === 1 && selections[0] === correctAnswer;
        }

        // 선택 카운트 (0-indexed 기준)
        selections.forEach(selIdx => {
          const choiceKey = String(selIdx);
          choiceCounts[choiceKey] = (choiceCounts[choiceKey] || 0) + 1;
        });
      } else {
        // 주관식/단답형
        const userStr = String(userAnswer).trim().toLowerCase();
        const correctStr = String(correctAnswer);

        // 복수 정답 지원 (|||로 구분)
        if (correctStr.includes('|||')) {
          const correctAnswers = correctStr.split('|||').map(a => a.trim().toLowerCase());
          isCorrect = correctAnswers.includes(userStr);
        } else {
          isCorrect = userStr === correctStr.trim().toLowerCase();
        }

        // 오답 수집 (소문자 정규화로 중복 제거)
        if (!isCorrect && userStr) {
          wrongAnswerSet.add(userStr);
        }
      }

      if (isCorrect) {
        correctCount++;
      }
    });

    const wrongCount = totalResponses - correctCount;
    const correctRate = totalResponses > 0 ? Math.round((correctCount / totalResponses) * 100) : 0;
    const wrongRate = totalResponses > 0 ? Math.round((wrongCount / totalResponses) * 100) : 0;

    // 선지별 통계 계산
    let choiceStats: ChoiceStats[] | undefined;
    if (question.type === 'ox') {
      choiceStats = [
        { choice: 0, count: choiceCounts['0'] || 0, percentage: totalResponses > 0 ? Math.round(((choiceCounts['0'] || 0) / totalResponses) * 100) : 0 },
        { choice: 1, count: choiceCounts['1'] || 0, percentage: totalResponses > 0 ? Math.round(((choiceCounts['1'] || 0) / totalResponses) * 100) : 0 },
      ];
    } else if (question.type === 'multiple' && question.choices) {
      choiceStats = question.choices.map((_, i) => ({
        choice: i,
        count: choiceCounts[String(i)] || 0,
        percentage: totalResponses > 0 ? Math.round(((choiceCounts[String(i)] || 0) / totalResponses) * 100) : 0,
      }));
    }

    return {
      questionId: question.id,
      questionIndex: idx,
      totalResponses,
      correctCount,
      wrongCount,
      correctRate,
      wrongRate,
      choiceStats,
      wrongAnswers: (question.type === 'subjective' || question.type === 'short_answer')
        ? Array.from(wrongAnswerSet)
        : undefined,
      isModified,
    };
  });

  // 오답률 순위 계산 (높은 순)
  const wrongRateRanking = questionStats
    .filter(s => s.totalResponses > 0)
    .map(s => ({ questionIndex: s.questionIndex, wrongRate: s.wrongRate }))
    .sort((a, b) => b.wrongRate - a.wrongRate);

  return {
    questionStats,
    wrongRateRanking,
  };
}
