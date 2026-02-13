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
  setDoc,
  getDoc,
  getDocs,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from './useAuth';
import { useCourse } from '@/lib/contexts/CourseContext';

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
}

/**
 * AI 학습 퀴즈 (서재) 데이터 훅
 */
export function useLearningQuizzes() {
  const { user } = useAuth();
  const { userCourseId, userClassId } = useCourse();
  const [quizzes, setQuizzes] = useState<LearningQuiz[]>([]);
  const [loading, setLoading] = useState(true);

  // 실시간 구독
  useEffect(() => {
    if (!user?.uid) {
      setQuizzes([]);
      setLoading(false);
      return;
    }

    // 복합 인덱스 없이 쿼리 (클라이언트에서 정렬)
    const q = query(
      collection(db, 'quizzes'),
      where('type', '==', 'ai-generated'),
      where('creatorId', '==', user.uid)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const userId = user.uid;
        const items: LearningQuiz[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          // 점수 계산: userScores에 있으면 사용, 없으면 score 사용
          const myScore = data.userScores?.[userId] ?? data.score ?? 0;
          const myFirstReviewScore = data.userFirstReviewScores?.[userId];

          // 문제 유형별 개수 계산
          const questions = data.questions || [];
          let oxCount = 0;
          let multipleChoiceCount = 0;
          let subjectiveCount = 0;
          questions.forEach((q: any) => {
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
          };
        });
        // 클라이언트에서 최신순 정렬
        items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        setQuizzes(items);
        setLoading(false);
      },
      (error) => {
        console.error('서재 퀴즈 로드 오류:', error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user?.uid]);

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
      const totalQuestions = quizData.totalQuestions || questions.length;
      const quizTitle = quizData.title || '퀴즈';

      // 1-1. 퀴즈 문서의 questions에 choiceExplanations가 빠진 경우 본인 reviews에서 동기화
      const missingExps = questions.some((q: any) => !q.choiceExplanations && q.type === 'multiple');
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
          questions.forEach((q: any, idx: number) => {
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
      // 참여자 수는 이미 AI 퀴즈 완료 시 1로 설정되어 있으므로 증가하지 않음
      await updateDoc(quizRef, {
        type: 'custom',
        isAiGenerated: true,
        isPublic: true,
        tags: tags || quizData.tags || [],
        difficulty: quizData.difficulty || 'medium',
        [`userScores.${user.uid}`]: score,
        uploadedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // quiz_completions에 완료 기록 생성
      const completionDocId = `${quizRef.id}_${user.uid}`;
      await setDoc(doc(db, 'quiz_completions', completionDocId), {
        quizId: quizRef.id,
        userId: user.uid,
        score,
        attemptNo: 1,
        completedAt: serverTimestamp(),
      }, { merge: true });

      // 2-1. quizResults 컬렉션에 결과 저장 (교수님 통계에 표시)
      // 문제별 답변 배열 생성
      const userAnswers: string[] = questions.map((q: any) => {
        if (q.userAnswer !== undefined && q.userAnswer !== null) {
          return String(q.userAnswer);
        }
        // 답변이 없으면 정답으로 폴백 (AI 퀴즈에서 userAnswer 저장되지 않은 경우)
        return String(q.answer);
      });

      // 문제별 점수 객체 생성 (userAnswer를 1-indexed로 변환)
      const questionScores: Record<string, { isCorrect: boolean; userAnswer: string; answeredAt: any }> = {};
      questions.forEach((q: any, idx: number) => {
        const isCorrect = q.isCorrect !== undefined ? q.isCorrect : true;
        let convertedAnswer = userAnswers[idx];

        // 객관식: 0-indexed → 1-indexed 변환 (통계 모달에서 1-indexed 기대)
        if (q.type === 'multiple') {
          const raw = q.userAnswer ?? q.answer;
          if (Array.isArray(raw)) {
            convertedAnswer = raw.map((a: number) => String(a + 1)).join(',');
          } else if (raw !== undefined && raw !== null && !isNaN(Number(raw))) {
            convertedAnswer = String(Number(raw) + 1);
          }
        } else if (q.type === 'ox') {
          const raw = q.userAnswer ?? q.answer;
          if (typeof raw === 'number') {
            convertedAnswer = raw === 0 ? 'O' : 'X';
          }
        }

        questionScores[q.id || `q${idx}`] = {
          isCorrect,
          userAnswer: convertedAnswer,
          answeredAt: serverTimestamp(),
        };
      });

      await addDoc(collection(db, 'quizResults'), {
        userId: user.uid,
        quizId,
        quizTitle,
        quizCreatorId: user.uid, // 업로더가 생성자이므로 본인 ID
        score,
        correctCount: questions.filter((q: any) => q.isCorrect !== false).length,
        totalCount: totalQuestions,
        earnedExp: 0, // 서재 업로드는 이미 EXP를 받았으므로 0
        answers: userAnswers,
        questionScores,
        isUpdate: false,
        courseId: userCourseId || null,
        classId: userClassId || null,
        createdAt: serverTimestamp(),
      });

      // 3. reviews 컬렉션에 각 문제 저장 (복습 탭에 표시)

      for (let i = 0; i < questions.length; i++) {
        const question = questions[i];

        // 문제 타입 정규화
        let normalizedType = question.type || 'multiple';
        if (normalizedType === 'short') normalizedType = 'short_answer';

        // 정답 처리 (1-indexed 번호로 변환)
        let correctAnswer = '';
        if (question.type === 'multiple') {
          // 복수정답 지원: answer가 배열인 경우
          if (Array.isArray(question.answer)) {
            correctAnswer = question.answer.map((a: number) => String(a + 1)).join(',');
          } else {
            correctAnswer = String((question.answer ?? 0) + 1);
          }
        } else if (question.type === 'ox') {
          correctAnswer = question.answer === 0 ? 'O' : 'X';
        } else {
          correctAnswer = String(question.answer ?? '');
        }

        // 사용자 답변 처리 (1-indexed 번호로 변환)
        let userAnswer = '';
        if (question.userAnswer !== undefined && question.userAnswer !== null) {
          if (question.type === 'multiple') {
            if (Array.isArray(question.userAnswer)) {
              userAnswer = question.userAnswer.map((a: number) => String(a + 1)).join(',');
            } else if (typeof question.userAnswer === 'number') {
              userAnswer = String(question.userAnswer + 1);
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

        // solved 타입으로 저장
        await addDoc(collection(db, 'reviews'), {
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
          reviewType: 'solved',
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
        });

        // 오답인 경우 wrong 타입으로도 저장
        if (!isCorrect) {
          await addDoc(collection(db, 'reviews'), {
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
            isCorrect: false,
            reviewType: 'wrong',
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
          });
        }
      }

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
