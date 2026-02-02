/**
 * 퀴즈 업데이트 감지 훅
 *
 * 완료된 퀴즈에서 수정된 문제를 감지합니다.
 * 각 문제의 questionUpdatedAt과 사용자의 answeredAt을 비교하여
 * 새로 풀어야 할 문제를 식별합니다.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './useAuth';
import { useCourse } from '../contexts/CourseContext';

// ============================================================
// 타입 정의
// ============================================================

/**
 * 수정된 문제 정보
 */
export interface UpdatedQuestion {
  questionId: string;
  questionText: string;
  questionType: string;
  choices?: string[];
  correctAnswer: string;
  explanation?: string;
  questionUpdatedAt: Timestamp;
}

/**
 * 퀴즈 업데이트 정보
 */
export interface QuizUpdateInfo {
  quizId: string;
  quizTitle: string;
  quizCreatorId: string | null;
  hasUpdate: boolean;
  updatedQuestionCount: number;
  updatedQuestions: UpdatedQuestion[];
  originalResultId: string;
  originalQuestionScores: Record<string, {
    isCorrect: boolean;
    userAnswer: string;
    answeredAt: Timestamp;
  }>;
}

/**
 * 훅 반환 타입
 */
interface UseQuizUpdateReturn {
  /** 업데이트가 있는 퀴즈 맵 (quizId -> QuizUpdateInfo) */
  updatedQuizzes: Map<string, QuizUpdateInfo>;
  /** 로딩 상태 */
  loading: boolean;
  /** 에러 메시지 */
  error: string | null;
  /** 특정 퀴즈의 업데이트 확인 */
  checkQuizUpdate: (quizId: string) => Promise<QuizUpdateInfo | null>;
  /** 데이터 새로고침 */
  refresh: () => void;
}

// ============================================================
// 훅
// ============================================================

/**
 * 퀴즈 업데이트 감지 훅
 *
 * @example
 * ```tsx
 * const { updatedQuizzes, loading, checkQuizUpdate } = useQuizUpdate();
 *
 * // 특정 퀴즈의 업데이트 확인
 * const updateInfo = await checkQuizUpdate(quizId);
 * if (updateInfo?.hasUpdate) {
 *   // 업데이트 모달 표시
 * }
 * ```
 */
export const useQuizUpdate = (): UseQuizUpdateReturn => {
  const { user } = useAuth();
  const { userCourseId } = useCourse();
  const [updatedQuizzes, setUpdatedQuizzes] = useState<Map<string, QuizUpdateInfo>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  /**
   * 특정 퀴즈의 업데이트 확인
   */
  const checkQuizUpdate = useCallback(async (quizId: string): Promise<QuizUpdateInfo | null> => {
    if (!user) return null;

    try {
      // 1. 사용자의 퀴즈 결과 가져오기
      const resultsQuery = query(
        collection(db, 'quizResults'),
        where('userId', '==', user.uid),
        where('quizId', '==', quizId)
      );
      const resultsSnapshot = await getDocs(resultsQuery);

      // 첫 번째 결과만 필터링 (isUpdate가 아닌 것)
      const firstResults = resultsSnapshot.docs.filter(
        (doc) => !doc.data().isUpdate
      );

      if (firstResults.length === 0) {
        // 결과가 없으면 (아직 안 푼 퀴즈) null 반환
        return null;
      }

      // 가장 최근 결과 사용
      const resultDoc = firstResults[0];
      const resultData = resultDoc.data();
      const questionScores = resultData.questionScores || {};

      // 2. 퀴즈 데이터 가져오기
      const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
      if (!quizDoc.exists()) {
        return null;
      }

      const quizData = quizDoc.data();
      const questions = quizData.questions || [];

      // 3. 수정된 문제 찾기
      const updatedQuestions: UpdatedQuestion[] = [];

      for (const q of questions) {
        const questionId = q.id;
        const questionUpdatedAt = q.questionUpdatedAt;
        const userScore = questionScores[questionId];

        // questionUpdatedAt이 있고, 사용자 answeredAt보다 이후인 경우
        if (questionUpdatedAt) {
          const updatedTime = questionUpdatedAt.toMillis ? questionUpdatedAt.toMillis() : 0;

          if (!userScore) {
            // 새로 추가된 문제
            updatedQuestions.push({
              questionId: q.id,
              questionText: q.text || q.question || '',
              questionType: q.type,
              choices: q.choices || q.options,
              correctAnswer: q.answer?.toString() || q.correctAnswer?.toString() || '',
              explanation: q.explanation,
              questionUpdatedAt,
            });
          } else {
            const answeredTime = userScore.answeredAt?.toMillis ? userScore.answeredAt.toMillis() : 0;

            if (updatedTime > answeredTime) {
              // 수정된 문제
              updatedQuestions.push({
                questionId: q.id,
                questionText: q.text || q.question || '',
                questionType: q.type,
                choices: q.choices || q.options,
                correctAnswer: q.answer?.toString() || q.correctAnswer?.toString() || '',
                explanation: q.explanation,
                questionUpdatedAt,
              });
            }
          }
        }
      }

      const updateInfo: QuizUpdateInfo = {
        quizId,
        quizTitle: quizData.title || '퀴즈',
        quizCreatorId: quizData.creatorId || null,
        hasUpdate: updatedQuestions.length > 0,
        updatedQuestionCount: updatedQuestions.length,
        updatedQuestions,
        originalResultId: resultDoc.id,
        originalQuestionScores: questionScores,
      };

      return updateInfo;
    } catch (err) {
      console.error('퀴즈 업데이트 확인 실패:', err);
      return null;
    }
  }, [user]);

  /**
   * 완료된 모든 퀴즈의 업데이트 확인
   */
  const checkAllUpdates = useCallback(async () => {
    if (!user) return;

    try {
      setLoading(true);
      setError(null);

      // 사용자의 모든 퀴즈 결과 가져오기
      const resultsQuery = userCourseId
        ? query(
            collection(db, 'quizResults'),
            where('userId', '==', user.uid),
            where('courseId', '==', userCourseId)
          )
        : query(
            collection(db, 'quizResults'),
            where('userId', '==', user.uid)
          );

      const resultsSnapshot = await getDocs(resultsQuery);
      const quizIds = new Set<string>();

      resultsSnapshot.forEach((docSnapshot) => {
        const data = docSnapshot.data();
        // 업데이트 결과가 아닌 것만
        if (!data.isUpdate) {
          quizIds.add(data.quizId);
        }
      });

      // 각 퀴즈의 업데이트 확인
      const newUpdatedQuizzes = new Map<string, QuizUpdateInfo>();

      for (const quizId of quizIds) {
        const updateInfo = await checkQuizUpdate(quizId);
        if (updateInfo?.hasUpdate) {
          newUpdatedQuizzes.set(quizId, updateInfo);
        }
      }

      setUpdatedQuizzes(newUpdatedQuizzes);
    } catch (err) {
      console.error('퀴즈 업데이트 확인 실패:', err);
      setError('업데이트 확인에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [user, userCourseId, checkQuizUpdate]);

  // 초기 로드
  useEffect(() => {
    if (user) {
      checkAllUpdates();
    }
  }, [user, userCourseId, refreshKey]);

  /**
   * 새로고침
   */
  const refresh = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  return {
    updatedQuizzes,
    loading,
    error,
    checkQuizUpdate,
    refresh,
  };
};

export default useQuizUpdate;
