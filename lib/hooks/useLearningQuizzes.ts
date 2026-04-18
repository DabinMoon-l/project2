'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  deleteDoc,
  updateDoc,
  getDoc,
  getDocs,
  writeBatch,
  serverTimestamp,
  db,
  type DocumentData,
} from '@/lib/repositories';
import { useAuth } from './useAuth';
import { useCourse } from '@/lib/contexts/CourseContext';
import { callFunction } from '@/lib/api';

/**
 * 학습 퀴즈 (서재) 아이템 인터페이스
 */
export interface LearningQuiz {
  id: string;
  title: string;
  questionCount: number;
  score: number;
  totalQuestions: number;
  createdAt: Date;
  completedAt: Date;
  isPublic: boolean;
  tags: string[];
  difficulty: 'easy' | 'medium' | 'hard';
  /** 첫 번째 퀴즈 점수 (정답 개수) */
  myScore?: number;
  /** 첫 번째 복습 점수 (정답 개수) */
  myFirstReviewScore?: number;
  /** OX 문제 수 */
  oxCount?: number;
  /** 객관식 문제 수 */
  multipleChoiceCount?: number;
  /** 주관식 문제 수 */
  subjectiveCount?: number;
  /** 퀴즈 생성자 ID */
  creatorId?: string;
  /** 퀴즈 타입 (professor, ai-generated, custom 등) */
  quizType?: string;
}

/**
 * AI 학습 퀴즈 (서재) 데이터 훅
 */
export function useLearningQuizzes() {
  const { user } = useAuth();
  const { userCourseId, userClassId } = useCourse();
  const [quizzes, setQuizzes] = useState<LearningQuiz[]>([]);
  const [loading, setLoading] = useState(true);

  /** snapshot docs → LearningQuiz[] 변환 헬퍼 */
  const toItems = useCallback((docs: { id: string; data: () => DocumentData }[], userId: string): LearningQuiz[] => {
    return docs.map((docSnap) => {
      const data = docSnap.data();
      const myScore = data.userScores?.[userId] ?? data.score ?? 0;
      const myFirstReviewScore = data.userFirstReviewScores?.[userId];

      const questions = data.questions || [];
      let oxCount = 0;
      let multipleChoiceCount = 0;
      let subjectiveCount = 0;
      questions.forEach((q: DocumentData) => {
        if (q.type === 'ox') oxCount++;
        else if (q.type === 'multiple') multipleChoiceCount++;
        else if (q.type === 'short' || q.type === 'short_answer') subjectiveCount++;
      });

      return {
        id: docSnap.id,
        title: data.title || '제목 없음',
        questionCount: data.questions?.length || data.totalQuestions || 0,
        score: data.score || 0,
        totalQuestions: data.totalQuestions || data.questions?.length || 0,
        createdAt: data.createdAt?.toDate() || new Date(),
        completedAt: data.completedAt?.toDate() || new Date(),
        isPublic: data.isPublic || false,
        tags: data.tags || [],
        difficulty: data.difficulty || 'medium',
        myScore,
        myFirstReviewScore,
        oxCount,
        multipleChoiceCount,
        subjectiveCount,
        creatorId: data.creatorId || undefined,
        quizType: data.type || undefined,
      };
    });
  }, []);

  // 실시간 구독: creatorId == 본인인 퀴즈 전체 (1쿼리) → 클라이언트에서 타입 필터
  // 필터 조건: type === 'ai-generated' || (type === 'custom' && isPublic === false)
  // 비공개 'custom' + AI 서재가 서재 탭 대상. 공개 'custom'은 다른 학생에게 공유된 것이므로 제외.
  useEffect(() => {
    if (!user?.uid) {
      setQuizzes([]);
      setLoading(false);
      return;
    }

    const userId = user.uid;

    const q = query(
      collection(db, 'quizzes'),
      where('creatorId', '==', userId)
    );

    const unsub = onSnapshot(q, (snap) => {
      const filteredDocs = snap.docs.filter((d) => {
        const data = d.data();
        if (data.type === 'ai-generated') return true;
        if (data.type === 'custom' && data.isPublic === false) return true;
        return false;
      });
      const all = toItems(filteredDocs, userId);
      all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      setQuizzes(all);
      setLoading(false);
    }, (error) => {
      console.error('서재 퀴즈 로드 오류:', error);
      setQuizzes([]);
      setLoading(false);
    });

    return () => unsub();
  }, [user?.uid, toItems]);

  // 서재 퀴즈 삭제
  const deleteQuiz = useCallback(async (quizId: string) => {
    try {
      await deleteDoc(doc(db, 'quizzes', quizId));
    } catch (error) {
      console.error('서재 퀴즈 삭제 오류:', error);
      throw error;
    }
  }, []);

  /**
   * 공개로 업로드
   * - 서재에서 삭제 (type: learning → custom)
   * - 완료된 퀴즈로 처리 (completedUsers에 추가)
   * - 점수 정보 저장 (userScores)
   * - reviews 컬렉션에 문제 저장 (복습 탭에 표시)
   */
  const uploadToPublic = useCallback(async (quizId: string, tags?: string[]) => {
    if (!user?.uid) {
      throw new Error('로그인이 필요합니다.');
    }

    try {
      // 1. 퀴즈 문서 가져오기
      const quizRef = doc(db, 'quizzes', quizId);
      const quizDoc = await getDoc(quizRef);

      if (!quizDoc.exists()) {
        throw new Error('퀴즈를 찾을 수 없습니다.');
      }

      const quizData = quizDoc.data();
      const questions = quizData.questions || [];
      const score = quizData.score || 0;
      const quizTitle = quizData.title || '퀴즈';

      // 1-1. 퀴즈 문서의 questions에 choiceExplanations가 빠진 경우 본인 reviews에서 동기화
      const missingExps = questions.some((q: DocumentData) => !q.choiceExplanations && q.type === 'multiple');
      if (missingExps) {
        try {
          const reviewDocs = await getDocs(query(
            collection(db, 'reviews'),
            where('userId', '==', user.uid),
            where('quizId', '==', quizId)
          ));
          const reviewExpsMap: Record<string, string[]> = {};
          reviewDocs.docs.forEach(d => {
            const data = d.data();
            if (data.choiceExplanations?.length > 0) {
              reviewExpsMap[data.questionId] = data.choiceExplanations;
            }
          });
          let questionsChanged = false;
          questions.forEach((q: DocumentData, idx: number) => {
            if (!q.choiceExplanations && q.type === 'multiple') {
              const exps = reviewExpsMap[q.id || `q${idx}`]
                || reviewExpsMap[(idx + 1).toString()];
              if (exps) {
                q.choiceExplanations = exps;
                questionsChanged = true;
              }
            }
          });
          if (questionsChanged) {
            await updateDoc(quizRef, { questions });
          }
        } catch (e) {
          console.error('choiceExplanations 동기화 오류:', e);
        }
      }

      // 2. 퀴즈 문서 업데이트 (기존 태그와 난이도 유지)
      // 출제자 본인 풀이를 참여자 수 / 평균 점수에 반영
      const isAiType = quizData.type === 'ai-generated';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateData: Record<string, any> = {
        type: 'custom',
        isPublic: true,
        tags: tags || quizData.tags || [],
        difficulty: quizData.difficulty || 'medium',
        [`userScores.${user.uid}`]: score,
        participantCount: 1,
        averageScore: score,
        uploadedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (isAiType) updateData.isAiGenerated = true;
      await updateDoc(quizRef, updateData);

      // 분산 카운터 + quiz_completions 초기화 (출제자 점수 반영)
      // CF에서 quiz_agg 샤드 + quiz_completions 생성 → recordAttempt와 정합성 유지
      callFunction('initCreatorStats', { quizId }).catch((e) =>
        console.warn('출제자 통계 초기화 실패 (무시 가능):', e)
      );

      // 3. reviews 컬렉션에 각 문제 일괄 저장 (writeBatch)
      const batch = writeBatch(db);

      for (let i = 0; i < questions.length; i++) {
        const question = questions[i];

        // 문제 타입 정규화
        let normalizedType = question.type || 'multiple';
        if (normalizedType === 'short') normalizedType = 'short_answer';

        // 정답 처리 (0-indexed 그대로 문자열 변환)
        let correctAnswer = '';
        if (question.type === 'multiple') {
          if (Array.isArray(question.answer)) {
            correctAnswer = question.answer.map((a: number) => String(a)).join(',');
          } else {
            correctAnswer = String(question.answer ?? 0);
          }
        } else if (question.type === 'ox') {
          correctAnswer = question.answer === 0 ? 'O' : 'X';
        } else {
          correctAnswer = String(question.answer ?? '');
        }

        // 사용자 답변 처리 (0-indexed 그대로 문자열 변환)
        let userAnswer = '';
        if (question.userAnswer !== undefined && question.userAnswer !== null) {
          if (question.type === 'multiple') {
            if (Array.isArray(question.userAnswer)) {
              userAnswer = question.userAnswer.map((a: number) => String(a)).join(',');
            } else if (typeof question.userAnswer === 'number') {
              userAnswer = String(question.userAnswer);
            } else {
              userAnswer = String(question.userAnswer);
            }
          } else if (question.type === 'ox' && typeof question.userAnswer === 'number') {
            userAnswer = question.userAnswer === 0 ? 'O' : 'X';
          } else {
            userAnswer = String(question.userAnswer);
          }
        } else {
          userAnswer = correctAnswer; // 없으면 정답으로 폴백
        }
        const isCorrect = question.isCorrect !== undefined ? question.isCorrect : true;

        const reviewData = {
          userId: user.uid,
          quizId,
          quizTitle,
          questionId: question.id || `q${i}`,
          question: question.text || '',
          type: normalizedType,
          options: question.choices || [],
          correctAnswer,
          userAnswer,
          explanation: question.explanation || '',
          isCorrect,
          reviewType: 'solved' as const,
          isBookmarked: false,
          reviewCount: 0,
          lastReviewedAt: null,
          courseId: userCourseId || null,
          quizUpdatedAt: quizData.updatedAt || quizData.createdAt || null,
          quizCreatorId: quizData.creatorId || null,
          image: question.image || null,
          chapterId: question.chapterId || null,
          chapterDetailId: question.chapterDetailId || null,
          choiceExplanations: question.choiceExplanations || null,
          imageUrl: question.imageUrl || null,
          createdAt: serverTimestamp(),
        };

        // solved 타입으로 저장
        batch.set(doc(collection(db, 'reviews')), reviewData);

        // 오답인 경우 wrong 타입으로도 저장
        if (!isCorrect) {
          batch.set(doc(collection(db, 'reviews')), {
            ...reviewData,
            isCorrect: false,
            reviewType: 'wrong' as const,
          });
        }
      }

      await batch.commit();

      console.log(`퀴즈 "${quizTitle}" 공개 업로드 완료 (${questions.length}문제)`);
    } catch (error) {
      console.error('공개 업로드 오류:', error);
      throw error;
    }
  }, [user?.uid, userCourseId]);

  return {
    quizzes,
    loading,
    deleteQuiz,
    uploadToPublic,
  };
}
