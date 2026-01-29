'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useRouter, useParams } from 'next/navigation';
import {
  doc,
  getDoc,
  updateDoc,
  collection,
  addDoc,
  query,
  where,
  getDocs,
  serverTimestamp,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks/useAuth';
import { Header } from '@/components/common';
import FeedbackForm, { QuestionFeedback } from '@/components/quiz/FeedbackForm';
import type { QuestionResult } from '@/components/quiz/QuestionResultList';

/**
 * 피드백 페이지 데이터 타입
 */
interface FeedbackPageData {
  quizId: string;
  quizTitle: string;
  questionResults: QuestionResult[];
  hasSubmittedFeedback: boolean;
}

/**
 * 피드백 페이지
 *
 * 퀴즈의 각 문제에 대한 피드백을 입력받습니다.
 * 피드백 완료 시 Cloud Function을 통해 골드가 지급됩니다.
 * 이미 피드백을 남긴 퀴즈는 Skip만 표시됩니다.
 *
 * URL 예시: /quiz/abc123/feedback
 */
export default function FeedbackPage() {
  const router = useRouter();
  const params = useParams();
  const { user } = useAuth();

  const quizId = params.id as string;

  // 상태
  const [pageData, setPageData] = useState<FeedbackPageData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * 퀴즈 데이터 및 사용자 답변 로드
   */
  const loadQuizData = useCallback(async () => {
    if (!user || !quizId) return;

    try {
      setIsLoading(true);

      // 퀴즈 데이터 가져오기
      const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
      if (!quizDoc.exists()) {
        setError('퀴즈를 찾을 수 없습니다.');
        return;
      }

      const quizData = quizDoc.data();
      const questions = quizData.questions || [];

      // 사용자 결과 문서 확인
      const resultsQuery = query(
        collection(db, 'quizResults'),
        where('userId', '==', user.uid),
        where('quizId', '==', quizId)
      );
      const resultsSnapshot = await getDocs(resultsQuery);

      let hasSubmittedFeedback = false;
      let userAnswers: string[] = [];

      if (!resultsSnapshot.empty) {
        const resultData = resultsSnapshot.docs[0].data();
        hasSubmittedFeedback = resultData.hasFeedback || false;
        userAnswers = resultData.answers || [];
      } else {
        // 로컬 스토리지에서 답변 가져오기
        const storedAnswers = localStorage.getItem(`quiz_answers_${quizId}`);
        if (storedAnswers) {
          userAnswers = JSON.parse(storedAnswers);
        }
      }

      // 문제별 결과 생성
      const questionResults: QuestionResult[] = questions.map(
        (q: any, index: number) => {
          const userAnswer = userAnswers[index] || '';
          const isCorrect =
            userAnswer.toString().toLowerCase() ===
            q.correctAnswer.toString().toLowerCase();

          return {
            id: q.id || `q${index}`,
            number: index + 1,
            question: q.question,
            type: q.type,
            options: q.options,
            correctAnswer: q.correctAnswer,
            userAnswer,
            isCorrect,
            explanation: q.explanation,
            isBookmarked: false,
          };
        }
      );

      setPageData({
        quizId,
        quizTitle: quizData.title || '퀴즈',
        questionResults,
        hasSubmittedFeedback,
      });
    } catch (err) {
      console.error('피드백 페이지 로드 오류:', err);
      setError('데이터를 불러오는 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, [user, quizId]);

  // 데이터 로드
  useEffect(() => {
    loadQuizData();
  }, [loadQuizData]);

  /**
   * 피드백 제출 핸들러
   */
  const handleSubmit = async (feedbacks: QuestionFeedback[]) => {
    if (!user || !pageData) return;

    try {
      setIsSubmitting(true);

      // 피드백 저장
      for (const feedback of feedbacks) {
        if (feedback.feedback.trim()) {
          await addDoc(collection(db, 'feedbacks'), {
            userId: user.uid,
            quizId: pageData.quizId,
            questionId: feedback.questionId,
            feedback: feedback.feedback.trim(),
            createdAt: serverTimestamp(),
          });
        }
      }

      // 사용자 결과 문서 업데이트 (피드백 완료 표시)
      const resultsQuery = query(
        collection(db, 'quizResults'),
        where('userId', '==', user.uid),
        where('quizId', '==', pageData.quizId)
      );
      const resultsSnapshot = await getDocs(resultsQuery);

      if (!resultsSnapshot.empty) {
        const resultDocRef = resultsSnapshot.docs[0].ref;
        await updateDoc(resultDocRef, {
          hasFeedback: true,
          feedbackAt: serverTimestamp(),
        });
      }

      // Cloud Function 호출하여 골드 지급
      try {
        const grantFeedbackReward = httpsCallable(functions, 'grantFeedbackReward');
        await grantFeedbackReward({
          userId: user.uid,
          quizId: pageData.quizId,
          feedbackCount: feedbacks.length,
        });
      } catch (functionError) {
        console.error('Cloud Function 호출 오류:', functionError);
        // 골드 지급 실패해도 피드백 제출은 완료된 것으로 처리
      }

      // 홈으로 이동
      router.push('/');
    } catch (err) {
      console.error('피드백 제출 오류:', err);
      setError('피드백 제출 중 오류가 발생했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * 건너뛰기 핸들러
   */
  const handleSkip = () => {
    router.push('/');
  };

  // 로딩 UI
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <motion.div
          className="flex flex-col items-center gap-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <motion.div
            className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          />
          <p className="text-gray-500">로딩 중...</p>
        </motion.div>
      </div>
    );
  }

  // 에러 UI
  if (error || !pageData) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <div className="text-6xl mb-4">😢</div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">오류 발생</h2>
        <p className="text-gray-500 text-center mb-6">{error || '알 수 없는 오류가 발생했습니다.'}</p>
        <button
          onClick={() => router.push('/')}
          className="px-6 py-2 bg-indigo-500 text-white rounded-xl font-medium"
        >
          홈으로
        </button>
      </div>
    );
  }

  // 이미 피드백을 제출한 경우
  if (pageData.hasSubmittedFeedback) {
    return (
      <div className="min-h-screen bg-gray-50 pb-8">
        <Header title="피드백" showBack onBack={() => router.back()} />

        <div className="flex flex-col items-center justify-center min-h-[60vh] p-4">
          <div className="text-6xl mb-4">✅</div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            이미 피드백을 제출했습니다
          </h2>
          <p className="text-gray-500 text-center mb-6">
            소중한 의견 감사합니다!
          </p>
          <button
            onClick={() => router.push('/')}
            className="px-6 py-3 bg-indigo-500 text-white rounded-2xl font-medium"
          >
            홈으로
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      {/* 헤더 */}
      <Header
        title={`${pageData.quizTitle} 피드백`}
        showBack
        onBack={() => router.back()}
      />

      <motion.main
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="px-4 pt-6"
      >
        {/* 피드백 폼 */}
        <FeedbackForm
          results={pageData.questionResults}
          onSubmit={handleSubmit}
          onSkip={handleSkip}
          isSubmitting={isSubmitting}
          rewardGold={15}
        />
      </motion.main>
    </div>
  );
}
