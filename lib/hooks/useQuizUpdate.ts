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
  // 이미지
  image?: string;
  imageUrl?: string;
  // 제시문
  passage?: string;
  passageType?: 'text' | 'korean_abc' | 'mixed';
  passageImage?: string;
  koreanAbcItems?: string[];
  passageMixedExamples?: any[];
  commonQuestion?: string;
  // 보기
  mixedExamples?: any[];
  bogi?: { questionText?: string; items: Array<{ label: string; content: string }> } | null;
  subQuestionOptions?: string[];
  subQuestionOptionsType?: 'text' | 'labeled' | 'mixed';
  subQuestionImage?: string;
  // 발문
  passagePrompt?: string;
  bogiQuestionText?: string;
  // 결합형
  combinedGroupId?: string;
  combinedIndex?: number;
  combinedTotal?: number;
  // 기타
  hasMultipleAnswers?: boolean;
  choiceExplanations?: string[];
  quizCreatorId?: string;
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

          // 공통 필드 추출 헬퍼
          const extractFields = (): UpdatedQuestion => ({
            questionId: q.id,
            questionText: q.text || q.question || '',
            questionType: q.type,
            choices: q.choices || q.options,
            correctAnswer: q.answer?.toString() || q.correctAnswer?.toString() || '',
            explanation: q.explanation,
            questionUpdatedAt,
            // 이미지
            image: q.image || undefined,
            imageUrl: q.imageUrl || undefined,
            // 제시문
            passage: q.passage || undefined,
            passageType: q.passageType || undefined,
            passageImage: q.passageImage || undefined,
            koreanAbcItems: q.koreanAbcItems || undefined,
            passageMixedExamples: q.passageMixedExamples || undefined,
            commonQuestion: q.commonQuestion || undefined,
            // 보기
            mixedExamples: q.mixedExamples || undefined,
            bogi: q.bogi || undefined,
            subQuestionOptions: q.subQuestionOptions || undefined,
            subQuestionOptionsType: q.subQuestionOptionsType || undefined,
            subQuestionImage: q.subQuestionImage || undefined,
            // 발문
            passagePrompt: q.passagePrompt || undefined,
            bogiQuestionText: q.bogiQuestionText || undefined,
            // 결합형
            combinedGroupId: q.combinedGroupId || undefined,
            combinedIndex: q.combinedIndex,
            combinedTotal: q.combinedTotal,
            // 기타
            hasMultipleAnswers: q.hasMultipleAnswers || undefined,
            choiceExplanations: q.choiceExplanations || undefined,
            quizCreatorId: quizData.creatorId || undefined,
          });

          if (!userScore) {
            // 새로 추가된 문제
            updatedQuestions.push(extractFields());
          } else {
            const answeredTime = userScore.answeredAt?.toMillis ? userScore.answeredAt.toMillis() : 0;

            if (updatedTime > answeredTime) {
              // 수정된 문제
              updatedQuestions.push(extractFields());
            }
          }
        }
      }

      // 결합형 그룹: 첫 번째 하위문제(combinedIndex===0)의 공통 지문을 같은 그룹 후속 문제에 전파
      const passageByGroup = new Map<string, {
        passage?: string; passageType?: 'text' | 'korean_abc' | 'mixed';
        passageImage?: string; koreanAbcItems?: string[];
        passageMixedExamples?: any[]; commonQuestion?: string;
      }>();
      for (const q of updatedQuestions) {
        if (q.combinedGroupId && q.combinedIndex === 0) {
          passageByGroup.set(q.combinedGroupId, {
            passage: q.passage, passageType: q.passageType,
            passageImage: q.passageImage, koreanAbcItems: q.koreanAbcItems,
            passageMixedExamples: q.passageMixedExamples, commonQuestion: q.commonQuestion,
          });
        }
      }
      // combinedIndex===0이 updatedQuestions에 없을 수 있음 → 원본 questions에서 보충
      for (const q of updatedQuestions) {
        if (q.combinedGroupId && !passageByGroup.has(q.combinedGroupId)) {
          const firstInGroup = questions.find(
            (orig: any) => orig.combinedGroupId === q.combinedGroupId && orig.combinedIndex === 0
          );
          if (firstInGroup) {
            passageByGroup.set(q.combinedGroupId, {
              passage: firstInGroup.passage || undefined,
              passageType: firstInGroup.passageType || undefined,
              passageImage: firstInGroup.passageImage || undefined,
              koreanAbcItems: firstInGroup.koreanAbcItems || undefined,
              passageMixedExamples: firstInGroup.passageMixedExamples || undefined,
              commonQuestion: firstInGroup.commonQuestion || undefined,
            });
          }
        }
      }
      // 후속 문제에 공통 지문 전파
      for (const q of updatedQuestions) {
        if (q.combinedGroupId && (q.combinedIndex ?? 0) > 0) {
          const groupPassage = passageByGroup.get(q.combinedGroupId);
          if (groupPassage) {
            if (!q.passage && groupPassage.passage) q.passage = groupPassage.passage;
            if (!q.passageType && groupPassage.passageType) q.passageType = groupPassage.passageType;
            if (!q.passageImage && groupPassage.passageImage) q.passageImage = groupPassage.passageImage;
            if (!q.koreanAbcItems && groupPassage.koreanAbcItems) q.koreanAbcItems = groupPassage.koreanAbcItems;
            if (!q.passageMixedExamples && groupPassage.passageMixedExamples) q.passageMixedExamples = groupPassage.passageMixedExamples;
            if (!q.commonQuestion && groupPassage.commonQuestion) q.commonQuestion = groupPassage.commonQuestion;
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
   * 최적화: quizResults 1회 조회 후 결과를 퀴즈별로 그룹핑 → 퀴즈 문서만 배치 조회
   */
  const checkAllUpdates = useCallback(async () => {
    if (!user) return;

    try {
      setLoading(true);
      setError(null);

      // 1. 사용자의 모든 퀴즈 결과 1회 조회
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

      // quizId별로 그룹핑 (isUpdate가 아닌 첫 번째 결과만)
      const resultsByQuiz = new Map<string, { docId: string; data: any }>();
      resultsSnapshot.forEach((docSnapshot) => {
        const data = docSnapshot.data();
        if (!data.isUpdate && !resultsByQuiz.has(data.quizId)) {
          resultsByQuiz.set(data.quizId, { docId: docSnapshot.id, data });
        }
      });

      if (resultsByQuiz.size === 0) {
        setUpdatedQuizzes(new Map());
        return;
      }

      // 2. 퀴즈 문서만 배치 조회 (quizResults 재조회 없음)
      const quizIds = Array.from(resultsByQuiz.keys());
      const quizDocPromises = quizIds.map(qid => getDoc(doc(db, 'quizzes', qid)));
      const quizDocs = await Promise.all(quizDocPromises);

      // 3. 클라이언트에서 업데이트 판별
      const newUpdatedQuizzes = new Map<string, QuizUpdateInfo>();

      for (let i = 0; i < quizIds.length; i++) {
        const quizId = quizIds[i];
        const quizDoc = quizDocs[i];
        if (!quizDoc.exists()) continue;

        const result = resultsByQuiz.get(quizId)!;
        const quizData = quizDoc.data();
        const questions = quizData.questions || [];
        const questionScores = result.data.questionScores || {};

        const updatedQuestions: UpdatedQuestion[] = [];

        for (const q of questions) {
          const questionUpdatedAt = q.questionUpdatedAt;
          if (!questionUpdatedAt) continue;

          const updatedTime = questionUpdatedAt.toMillis ? questionUpdatedAt.toMillis() : 0;
          const userScore = questionScores[q.id];

          const shouldAdd = !userScore || (
            userScore.answeredAt?.toMillis
              ? updatedTime > userScore.answeredAt.toMillis()
              : true
          );

          if (shouldAdd) {
            updatedQuestions.push({
              questionId: q.id,
              questionText: q.text || q.question || '',
              questionType: q.type,
              choices: q.choices || q.options,
              correctAnswer: q.answer?.toString() || q.correctAnswer?.toString() || '',
              explanation: q.explanation,
              questionUpdatedAt,
              image: q.image || undefined,
              imageUrl: q.imageUrl || undefined,
              passage: q.passage || undefined,
              passageType: q.passageType || undefined,
              passageImage: q.passageImage || undefined,
              koreanAbcItems: q.koreanAbcItems || undefined,
              passageMixedExamples: q.passageMixedExamples || undefined,
              commonQuestion: q.commonQuestion || undefined,
              mixedExamples: q.mixedExamples || undefined,
              bogi: q.bogi || undefined,
              subQuestionOptions: q.subQuestionOptions || undefined,
              subQuestionOptionsType: q.subQuestionOptionsType || undefined,
              subQuestionImage: q.subQuestionImage || undefined,
              passagePrompt: q.passagePrompt || undefined,
              bogiQuestionText: q.bogiQuestionText || undefined,
              combinedGroupId: q.combinedGroupId || undefined,
              combinedIndex: q.combinedIndex,
              combinedTotal: q.combinedTotal,
              hasMultipleAnswers: q.hasMultipleAnswers || undefined,
              choiceExplanations: q.choiceExplanations || undefined,
              quizCreatorId: quizData.creatorId || undefined,
            });
          }
        }

        if (updatedQuestions.length > 0) {
          newUpdatedQuizzes.set(quizId, {
            quizId,
            quizTitle: quizData.title || '퀴즈',
            quizCreatorId: quizData.creatorId || null,
            hasUpdate: true,
            updatedQuestionCount: updatedQuestions.length,
            updatedQuestions,
            originalResultId: result.docId,
            originalQuestionScores: questionScores,
          });
        }
      }

      setUpdatedQuizzes(newUpdatedQuizzes);
    } catch (err) {
      console.error('퀴즈 업데이트 확인 실패:', err);
      setError('업데이트 확인에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [user, userCourseId]);

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
