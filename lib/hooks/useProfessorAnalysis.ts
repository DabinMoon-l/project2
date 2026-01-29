'use client';

import { useState, useCallback } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

// ============================================================
// 타입 정의
// ============================================================

/** 문제 유형 */
export type QuestionType = 'ox' | 'multiple' | 'subjective';

/** 문제 분석 데이터 */
export interface QuestionAnalysis {
  questionId: string;
  quizId: string;
  quizTitle: string;
  questionText: string;
  type: QuestionType;

  // 통계
  totalAttempts: number;    // 총 시도 수
  correctCount: number;     // 정답 수
  incorrectCount: number;   // 오답 수
  correctRate: number;      // 정답률 (0-100)

  // 난이도 분석
  estimatedDifficulty: 'easy' | 'normal' | 'hard';
  averageTime?: number;     // 평균 풀이 시간 (초)

  // 오답 패턴 (객관식인 경우)
  answerDistribution?: {
    choice: number;
    count: number;
    isCorrect: boolean;
  }[];

  // 피드백 수
  feedbackCount: number;

  // 생성일
  createdAt: Date;
}

/** 퀴즈별 분석 요약 */
export interface QuizAnalysisSummary {
  quizId: string;
  quizTitle: string;
  totalQuestions: number;
  averageCorrectRate: number;
  hardestQuestion?: {
    questionId: string;
    text: string;
    correctRate: number;
  };
  easiestQuestion?: {
    questionId: string;
    text: string;
    correctRate: number;
  };
  participantCount: number;
}

/** 전체 분석 요약 */
export interface OverallAnalysisSummary {
  totalQuizzes: number;
  totalQuestions: number;
  totalAttempts: number;
  averageCorrectRate: number;
  difficultyDistribution: {
    easy: number;
    normal: number;
    hard: number;
  };
  typeDistribution: {
    ox: number;
    multiple: number;
    subjective: number;
  };
}

/** 필터 옵션 */
export interface AnalysisFilterOptions {
  quizId?: string;
  type?: QuestionType | 'all';
  difficulty?: 'easy' | 'normal' | 'hard' | 'all';
  sortBy?: 'correctRate' | 'attempts' | 'feedbacks';
  sortOrder?: 'asc' | 'desc';
}

/** 훅 반환 타입 */
interface UseProfessorAnalysisReturn {
  questions: QuestionAnalysis[];
  quizSummaries: QuizAnalysisSummary[];
  overallSummary: OverallAnalysisSummary | null;
  loading: boolean;
  error: string | null;

  fetchAnalysis: (professorUid: string, options?: AnalysisFilterOptions) => Promise<void>;
  getQuestionById: (questionId: string) => QuestionAnalysis | undefined;
  clearError: () => void;
}

// ============================================================
// 유틸리티
// ============================================================

/**
 * 정답률로 추정 난이도 계산
 */
const estimateDifficulty = (correctRate: number): 'easy' | 'normal' | 'hard' => {
  if (correctRate >= 70) return 'easy';
  if (correctRate >= 40) return 'normal';
  return 'hard';
};

// ============================================================
// 훅 구현
// ============================================================

/**
 * 교수님 문제 분석 훅
 */
export function useProfessorAnalysis(): UseProfessorAnalysisReturn {
  const [questions, setQuestions] = useState<QuestionAnalysis[]>([]);
  const [quizSummaries, setQuizSummaries] = useState<QuizAnalysisSummary[]>([]);
  const [overallSummary, setOverallSummary] = useState<OverallAnalysisSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * 분석 데이터 조회
   */
  const fetchAnalysis = useCallback(
    async (professorUid: string, options: AnalysisFilterOptions = {}) => {
      try {
        setLoading(true);
        setError(null);

        // 1. 교수님이 출제한 퀴즈 목록 조회
        const quizzesRef = collection(db, 'quizzes');
        const quizzesQuery = query(
          quizzesRef,
          where('creatorUid', '==', professorUid),
          where('type', '==', 'professor'),
          orderBy('createdAt', 'desc')
        );
        const quizzesSnap = await getDocs(quizzesQuery);

        const allQuestions: QuestionAnalysis[] = [];
        const summaries: QuizAnalysisSummary[] = [];

        let totalQuizzes = 0;
        let totalQuestions = 0;
        let totalAttempts = 0;
        let totalCorrectRate = 0;
        const difficultyCount = { easy: 0, normal: 0, hard: 0 };
        const typeCount = { ox: 0, multiple: 0, subjective: 0 };

        // 2. 각 퀴즈의 문제별 분석 데이터 수집
        for (const quizDoc of quizzesSnap.docs) {
          const quizData = quizDoc.data();
          const quizId = quizDoc.id;

          // 특정 퀴즈 필터
          if (options.quizId && options.quizId !== quizId) continue;

          totalQuizzes++;

          const quizQuestions: Array<{
            id: string;
            text: string;
            type: QuestionType;
            choices?: string[];
            answer: number | string;
          }> = quizData.questions || [];
          let quizCorrectRateSum = 0;
          let hardest: QuestionAnalysis | null = null;
          let easiest: QuestionAnalysis | null = null;

          // 퀴즈 결과 조회
          const resultsRef = collection(db, 'quizResults');
          const resultsQuery = query(
            resultsRef,
            where('quizId', '==', quizId)
          );
          const resultsSnap = await getDocs(resultsQuery);

          // 문제별 통계 계산
          const questionStats = new Map<string, {
            correct: number;
            incorrect: number;
            answerCounts: Map<number, number>;
            feedbacks: number;
          }>();

          // 초기화
          quizQuestions.forEach((q: { id: string }) => {
            questionStats.set(q.id, {
              correct: 0,
              incorrect: 0,
              answerCounts: new Map(),
              feedbacks: 0,
            });
          });

          // 결과 집계
          resultsSnap.docs.forEach((resultDoc) => {
            const resultData = resultDoc.data();
            const answers = resultData.answers || [];

            answers.forEach((answer: {
              questionId: string;
              isCorrect: boolean;
              selectedAnswer?: number;
            }) => {
              const stats = questionStats.get(answer.questionId);
              if (stats) {
                if (answer.isCorrect) {
                  stats.correct++;
                } else {
                  stats.incorrect++;
                }

                if (answer.selectedAnswer !== undefined) {
                  const count = stats.answerCounts.get(answer.selectedAnswer) || 0;
                  stats.answerCounts.set(answer.selectedAnswer, count + 1);
                }
              }
            });
          });

          // 피드백 수 조회
          const feedbacksRef = collection(db, 'feedbacks');
          const feedbacksQuery = query(
            feedbacksRef,
            where('quizId', '==', quizId)
          );
          const feedbacksSnap = await getDocs(feedbacksQuery);

          feedbacksSnap.docs.forEach((feedbackDoc) => {
            const feedbackData = feedbackDoc.data();
            const questionId = feedbackData.questionId;
            if (questionId) {
              const stats = questionStats.get(questionId);
              if (stats) {
                stats.feedbacks++;
              }
            }
          });

          // QuestionAnalysis 객체 생성
          quizQuestions.forEach((q: {
            id: string;
            text: string;
            type: QuestionType;
            choices?: string[];
            answer: number | string;
          }) => {
            const stats = questionStats.get(q.id);
            if (!stats) return;

            const totalAttempt = stats.correct + stats.incorrect;
            const correctRate = totalAttempt > 0
              ? Math.round((stats.correct / totalAttempt) * 100)
              : 0;

            const difficulty = estimateDifficulty(correctRate);

            // 타입/난이도 필터
            if (options.type && options.type !== 'all' && q.type !== options.type) return;
            if (options.difficulty && options.difficulty !== 'all' && difficulty !== options.difficulty) return;

            const answerDistribution = q.type === 'multiple' && q.choices
              ? q.choices.map((_, i) => ({
                  choice: i,
                  count: stats.answerCounts.get(i) || 0,
                  isCorrect: i === q.answer,
                }))
              : undefined;

            const analysis: QuestionAnalysis = {
              questionId: q.id,
              quizId,
              quizTitle: quizData.title || '퀴즈',
              questionText: q.text,
              type: q.type,
              totalAttempts: totalAttempt,
              correctCount: stats.correct,
              incorrectCount: stats.incorrect,
              correctRate,
              estimatedDifficulty: difficulty,
              answerDistribution,
              feedbackCount: stats.feedbacks,
              createdAt: quizData.createdAt?.toDate?.() || new Date(),
            };

            allQuestions.push(analysis);

            // 통계 업데이트
            totalQuestions++;
            totalAttempts += totalAttempt;
            totalCorrectRate += correctRate;
            difficultyCount[difficulty]++;
            typeCount[q.type]++;
            quizCorrectRateSum += correctRate;

            // 가장 어려운/쉬운 문제 찾기
            if (!hardest || correctRate < hardest.correctRate) {
              hardest = analysis;
            }
            if (!easiest || correctRate > easiest.correctRate) {
              easiest = analysis;
            }
          });

          // 퀴즈 요약
          if (quizQuestions.length > 0) {
            const hardestQ = hardest as QuestionAnalysis | null;
            const easiestQ = easiest as QuestionAnalysis | null;
            summaries.push({
              quizId,
              quizTitle: quizData.title || '퀴즈',
              totalQuestions: quizQuestions.length,
              averageCorrectRate: Math.round(quizCorrectRateSum / quizQuestions.length),
              hardestQuestion: hardestQ ? {
                questionId: hardestQ.questionId,
                text: hardestQ.questionText,
                correctRate: hardestQ.correctRate,
              } : undefined,
              easiestQuestion: easiestQ ? {
                questionId: easiestQ.questionId,
                text: easiestQ.questionText,
                correctRate: easiestQ.correctRate,
              } : undefined,
              participantCount: resultsSnap.size,
            });
          }
        }

        // 정렬
        if (options.sortBy) {
          allQuestions.sort((a, b) => {
            let comparison = 0;
            switch (options.sortBy) {
              case 'correctRate':
                comparison = a.correctRate - b.correctRate;
                break;
              case 'attempts':
                comparison = a.totalAttempts - b.totalAttempts;
                break;
              case 'feedbacks':
                comparison = a.feedbackCount - b.feedbackCount;
                break;
            }
            return options.sortOrder === 'asc' ? comparison : -comparison;
          });
        }

        setQuestions(allQuestions);
        setQuizSummaries(summaries);
        setOverallSummary({
          totalQuizzes,
          totalQuestions,
          totalAttempts,
          averageCorrectRate: totalQuestions > 0
            ? Math.round(totalCorrectRate / totalQuestions)
            : 0,
          difficultyDistribution: difficultyCount,
          typeDistribution: typeCount,
        });
      } catch (err) {
        console.error('분석 데이터 조회 실패:', err);
        setError('분석 데이터를 불러오는데 실패했습니다.');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /**
   * 문제 ID로 분석 데이터 찾기
   */
  const getQuestionById = useCallback(
    (questionId: string): QuestionAnalysis | undefined => {
      return questions.find((q) => q.questionId === questionId);
    },
    [questions]
  );

  /**
   * 에러 초기화
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    questions,
    quizSummaries,
    overallSummary,
    loading,
    error,
    fetchAnalysis,
    getQuestionById,
    clearError,
  };
}
