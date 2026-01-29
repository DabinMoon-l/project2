'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import {
  doc,
  getDoc,
  collection,
  addDoc,
  updateDoc,
  arrayUnion,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks/useAuth';
import { Header, Button } from '@/components/common';
import ResultHeader from '@/components/quiz/ResultHeader';
import ScoreCard from '@/components/quiz/ScoreCard';
import QuestionResultList, {
  QuestionResult,
} from '@/components/quiz/QuestionResultList';
import FeedbackButton from '@/components/quiz/FeedbackButton';

/**
 * 퀴즈 결과 데이터 타입
 */
interface QuizResultData {
  quizId: string;
  quizTitle: string;
  correctCount: number;
  totalCount: number;
  earnedGold: number;
  earnedExp: number;
  timeSpentSeconds: number;
  questionResults: QuestionResult[];
  hasSubmittedFeedback: boolean;
}

/**
 * 퀴즈 결과 페이지
 *
 * 퀴즈 완료 후 점수, 획득 보상, 문제별 결과를 표시합니다.
 * 오답은 자동으로 복습창(reviews 컬렉션)에 저장됩니다.
 *
 * URL 예시: /quiz/abc123/result
 * Query params:
 * - answers: JSON 인코딩된 사용자 답변 배열
 * - time: 소요 시간 (초)
 */
export default function QuizResultPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const { user } = useAuth();

  const quizId = params.id as string;

  // 결과 데이터 상태
  const [resultData, setResultData] = useState<QuizResultData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * 퀴즈 결과 계산 및 저장
   */
  const calculateAndSaveResults = useCallback(async () => {
    if (!user || !quizId) return;

    try {
      setIsLoading(true);

      // URL에서 답변 데이터 추출
      const answersParam = searchParams.get('answers');
      const timeParam = searchParams.get('time');

      if (!answersParam) {
        // 답변 데이터가 없으면 로컬 스토리지에서 시도
        const storedAnswers = localStorage.getItem(`quiz_answers_${quizId}`);
        if (!storedAnswers) {
          setError('퀴즈 답변 데이터를 찾을 수 없습니다.');
          return;
        }
      }

      // 답변 파싱
      const userAnswers: string[] = answersParam
        ? JSON.parse(decodeURIComponent(answersParam))
        : JSON.parse(localStorage.getItem(`quiz_answers_${quizId}`) || '[]');

      const timeSpentSeconds = timeParam
        ? parseInt(timeParam, 10)
        : parseInt(localStorage.getItem(`quiz_time_${quizId}`) || '0', 10);

      // 퀴즈 데이터 가져오기
      const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
      if (!quizDoc.exists()) {
        setError('퀴즈를 찾을 수 없습니다.');
        return;
      }

      const quizData = quizDoc.data();
      const questions = quizData.questions || [];

      // 문제별 결과 계산
      let correctCount = 0;
      const questionResults: QuestionResult[] = questions.map(
        (q: any, index: number) => {
          const userAnswer = userAnswers[index] || '';
          const isCorrect =
            userAnswer.toString().toLowerCase() ===
            q.correctAnswer.toString().toLowerCase();

          if (isCorrect) correctCount++;

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

      // 골드/경험치 계산 (문제당 10골드, 정답당 7골드 추가)
      const baseGold = questions.length * 5;
      const bonusGold = correctCount * 7;
      const earnedGold = baseGold + bonusGold;
      const earnedExp = correctCount * 10;

      // 만점 여부
      const isPerfectScore = correctCount === questions.length;

      // 결과 데이터 설정
      const result: QuizResultData = {
        quizId,
        quizTitle: quizData.title || '퀴즈',
        correctCount,
        totalCount: questions.length,
        earnedGold,
        earnedExp,
        timeSpentSeconds,
        questionResults,
        hasSubmittedFeedback: false,
      };

      setResultData(result);

      // 피드백 제출 여부 확인
      const userResultDoc = await getDoc(
        doc(db, 'quizResults', `${user.uid}_${quizId}`)
      );
      if (userResultDoc.exists() && userResultDoc.data().hasFeedback) {
        setResultData((prev) =>
          prev ? { ...prev, hasSubmittedFeedback: true } : prev
        );
      }

      // Firestore에 결과 저장 (최초 한번만)
      if (!userResultDoc.exists()) {
        // 퀴즈 결과 저장
        await updateDoc(doc(db, 'quizzes', quizId), {
          completedUsers: arrayUnion(user.uid),
          participantCount: (quizData.participantCount || 0) + 1,
        });

        // 사용자 결과 문서 생성
        await addDoc(collection(db, 'quizResults'), {
          id: `${user.uid}_${quizId}`,
          oderId: user.uid,
          quizId,
          correctCount,
          totalCount: questions.length,
          earnedGold,
          earnedExp,
          timeSpentSeconds,
          hasFeedback: false,
          createdAt: serverTimestamp(),
        });

        // 오답 자동 저장 (복습창)
        const wrongAnswers = questionResults.filter((r) => !r.isCorrect);
        for (const wrongAnswer of wrongAnswers) {
          await addDoc(collection(db, 'reviews'), {
            userId: user.uid,
            quizId,
            questionId: wrongAnswer.id,
            question: wrongAnswer.question,
            type: wrongAnswer.type,
            options: wrongAnswer.options,
            correctAnswer: wrongAnswer.correctAnswer,
            userAnswer: wrongAnswer.userAnswer,
            explanation: wrongAnswer.explanation,
            reviewType: 'wrong', // 오답
            isBookmarked: false,
            reviewCount: 0,
            lastReviewedAt: null,
            createdAt: serverTimestamp(),
          });
        }

        // 로컬 스토리지 정리
        localStorage.removeItem(`quiz_answers_${quizId}`);
        localStorage.removeItem(`quiz_time_${quizId}`);
      }
    } catch (err) {
      console.error('결과 계산 오류:', err);
      setError('결과를 불러오는 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, [user, quizId, searchParams]);

  // 결과 계산 및 로드
  useEffect(() => {
    calculateAndSaveResults();
  }, [calculateAndSaveResults]);

  /**
   * 찜하기 토글 핸들러
   */
  const handleToggleBookmark = async (questionId: string) => {
    if (!user || !resultData) return;

    // UI 즉시 업데이트
    setResultData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        questionResults: prev.questionResults.map((r) =>
          r.id === questionId ? { ...r, isBookmarked: !r.isBookmarked } : r
        ),
      };
    });

    // Firestore 업데이트
    try {
      const question = resultData.questionResults.find(
        (r) => r.id === questionId
      );
      if (!question) return;

      const newBookmarked = !question.isBookmarked;

      if (newBookmarked) {
        // 찜하기 추가
        await addDoc(collection(db, 'reviews'), {
          userId: user.uid,
          quizId: resultData.quizId,
          questionId: question.id,
          question: question.question,
          type: question.type,
          options: question.options,
          correctAnswer: question.correctAnswer,
          userAnswer: question.userAnswer,
          explanation: question.explanation,
          reviewType: 'bookmark', // 찜한 문제
          isBookmarked: true,
          reviewCount: 0,
          lastReviewedAt: null,
          createdAt: serverTimestamp(),
        });
      }
      // 찜 해제는 reviews 컬렉션에서 해당 문서 삭제 (간소화를 위해 생략)
    } catch (err) {
      console.error('찜하기 오류:', err);
    }
  };

  /**
   * 피드백 페이지로 이동
   */
  const handleFeedbackClick = () => {
    router.push(`/quiz/${quizId}/feedback`);
  };

  /**
   * 홈으로 이동
   */
  const handleGoHome = () => {
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
          <p className="text-gray-500">결과 계산 중...</p>
        </motion.div>
      </div>
    );
  }

  // 에러 UI
  if (error || !resultData) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <div className="text-6xl mb-4">😢</div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">오류 발생</h2>
        <p className="text-gray-500 text-center mb-6">{error || '알 수 없는 오류가 발생했습니다.'}</p>
        <Button onClick={handleGoHome}>홈으로</Button>
      </div>
    );
  }

  // 만점 여부
  const isPerfectScore =
    resultData.correctCount === resultData.totalCount;

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      {/* 헤더 */}
      <Header title="퀴즈 결과" showBack onBack={handleGoHome} />

      <motion.main
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="px-4 pt-4 space-y-6"
      >
        {/* 결과 헤더 (축하 메시지 + 보상) */}
        <ResultHeader
          title={resultData.quizTitle}
          earnedGold={resultData.earnedGold}
          earnedExp={resultData.earnedExp}
          isPerfectScore={isPerfectScore}
        />

        {/* 점수 카드 */}
        <ScoreCard
          correctCount={resultData.correctCount}
          totalCount={resultData.totalCount}
          earnedGold={resultData.earnedGold}
          timeSpentSeconds={resultData.timeSpentSeconds}
        />

        {/* 문제별 결과 리스트 */}
        <QuestionResultList
          results={resultData.questionResults}
          onToggleBookmark={handleToggleBookmark}
        />

        {/* 피드백 버튼 */}
        <FeedbackButton
          onClick={handleFeedbackClick}
          hasSubmittedFeedback={resultData.hasSubmittedFeedback}
          rewardGold={15}
        />

        {/* 홈으로 버튼 */}
        <Button
          variant="secondary"
          fullWidth
          onClick={handleGoHome}
          className="!rounded-2xl"
        >
          홈으로
        </Button>
      </motion.main>
    </div>
  );
}
