'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks/useAuth';
import { useThemeColors } from '@/styles/themes/useTheme';
import { Skeleton } from '@/components/common';

// 퀴즈 풀이 관련 컴포넌트
import QuizHeader from '@/components/quiz/QuizHeader';
import QuestionCard, { Question, QuestionType } from '@/components/quiz/QuestionCard';
import OXChoice, { OXAnswer } from '@/components/quiz/OXChoice';
import MultipleChoice from '@/components/quiz/MultipleChoice';
import ShortAnswer from '@/components/quiz/ShortAnswer';
import QuizNavigation from '@/components/quiz/QuizNavigation';
import InstantFeedbackButton, { QuestionFeedback } from '@/components/quiz/InstantFeedbackButton';
import ExitConfirmModal from '@/components/quiz/ExitConfirmModal';

/**
 * 퀴즈 데이터 타입
 */
interface QuizData {
  id: string;
  title: string;
  questions: Question[];
}

/**
 * 답안 타입 (문제 유형별 다른 타입)
 */
type Answer = OXAnswer | number | string | null;

/**
 * 퀴즈 풀이 페이지
 *
 * 퀴즈 문제를 순차적으로 풀고 제출하는 페이지입니다.
 * - 문제 유형에 따라 OX, 객관식, 주관식 선지를 표시
 * - 선택한 답을 로컬 상태로 유지
 * - 페이지 새로고침/이탈 방지
 * - 제출 시 서버에서 채점 후 결과 페이지로 이동
 */
export default function QuizPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const colors = useThemeColors();
  const quizId = params.id as string;

  // 퀴즈 데이터 상태
  const [quiz, setQuiz] = useState<QuizData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 퀴즈 풀이 상태
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 모달 상태
  const [showExitModal, setShowExitModal] = useState(false);

  // 현재 문제
  const currentQuestion = useMemo(
    () => quiz?.questions[currentQuestionIndex] || null,
    [quiz, currentQuestionIndex]
  );

  // 답변한 문제 수
  const answeredCount = useMemo(() => {
    return Object.values(answers).filter((answer) => answer !== null && answer !== '').length;
  }, [answers]);

  /**
   * 퀴즈 데이터 로드
   */
  const fetchQuiz = useCallback(async () => {
    if (!quizId || !user) return;

    try {
      setIsLoading(true);
      setError(null);

      // 퀴즈 기본 정보 조회
      const quizRef = doc(db, 'quizzes', quizId);
      const quizDoc = await getDoc(quizRef);

      if (!quizDoc.exists()) {
        setError('퀴즈를 찾을 수 없습니다.');
        return;
      }

      const quizData = quizDoc.data();

      // 문제 목록 조회
      const questionsRef = collection(db, 'quizzes', quizId, 'questions');
      const questionsQuery = query(questionsRef);
      const questionsSnapshot = await getDocs(questionsQuery);

      const questions: Question[] = [];
      questionsSnapshot.forEach((doc) => {
        const data = doc.data();
        questions.push({
          id: doc.id,
          number: data.number || questions.length + 1,
          type: data.type as QuestionType,
          text: data.text || '',
          imageUrl: data.imageUrl,
          choices: data.choices,
        });
      });

      // 문제 번호순 정렬
      questions.sort((a, b) => a.number - b.number);

      // 문제가 없으면 더미 데이터 사용 (개발용)
      if (questions.length === 0) {
        questions.push(
          {
            id: 'q1',
            number: 1,
            type: 'ox',
            text: '대한민국의 수도는 서울이다.',
          },
          {
            id: 'q2',
            number: 2,
            type: 'multiple',
            text: '다음 중 프로그래밍 언어가 아닌 것은?',
            choices: ['JavaScript', 'Python', 'HTML', 'Java'],
          },
          {
            id: 'q3',
            number: 3,
            type: 'short',
            text: 'HTTP의 약자를 영어로 적으시오.',
          }
        );
      }

      setQuiz({
        id: quizId,
        title: quizData.title || '퀴즈',
        questions,
      });

      // 초기 답안 상태 설정
      const initialAnswers: Record<string, Answer> = {};
      questions.forEach((q) => {
        initialAnswers[q.id] = null;
      });
      setAnswers(initialAnswers);
    } catch (err) {
      console.error('퀴즈 로드 실패:', err);
      setError('퀴즈를 불러오는데 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, [quizId, user]);

  // 퀴즈 데이터 로드
  useEffect(() => {
    fetchQuiz();
  }, [fetchQuiz]);

  // 페이지 이탈 방지
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (answeredCount > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [answeredCount]);

  /**
   * 답안 변경 핸들러
   */
  const handleAnswerChange = useCallback((questionId: string, answer: Answer) => {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: answer,
    }));
  }, []);

  /**
   * 이전 문제로 이동
   */
  const handlePrev = useCallback(() => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex((prev) => prev - 1);
    }
  }, [currentQuestionIndex]);

  /**
   * 다음 문제로 이동
   */
  const handleNext = useCallback(() => {
    if (quiz && currentQuestionIndex < quiz.questions.length - 1) {
      setCurrentQuestionIndex((prev) => prev + 1);
    }
  }, [quiz, currentQuestionIndex]);

  /**
   * 퀴즈 제출
   */
  const handleSubmit = useCallback(async () => {
    if (!quiz || !user || isSubmitting) return;

    try {
      setIsSubmitting(true);

      // 답안 데이터 준비
      const submissionData = {
        quizId: quiz.id,
        userId: user.uid,
        answers: Object.entries(answers).map(([questionId, answer]) => ({
          questionId,
          answer,
        })),
        submittedAt: serverTimestamp(),
      };

      // Firestore에 답안 제출
      // 실제로는 Cloud Functions에서 채점
      const submissionsRef = collection(db, 'submissions');
      const submissionDoc = await addDoc(submissionsRef, submissionData);

      // 결과 페이지로 이동
      router.push(`/quiz/${quizId}/result?submissionId=${submissionDoc.id}`);
    } catch (err) {
      console.error('퀴즈 제출 실패:', err);
      alert('제출에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setIsSubmitting(false);
    }
  }, [quiz, user, answers, isSubmitting, quizId, router]);

  /**
   * 피드백 제출 핸들러
   */
  const handleFeedbackSubmit = useCallback(
    async (feedback: QuestionFeedback) => {
      if (!user) return;

      try {
        const feedbackRef = collection(db, 'questionFeedbacks');
        await addDoc(feedbackRef, {
          ...feedback,
          quizId,
          userId: user.uid,
          createdAt: serverTimestamp(),
        });
      } catch (err) {
        console.error('피드백 제출 실패:', err);
      }
    },
    [quizId, user]
  );

  /**
   * 나가기 확인
   */
  const handleExitConfirm = useCallback(() => {
    router.back();
  }, [router]);

  // 로딩 상태
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        {/* 헤더 스켈레톤 */}
        <div className="sticky top-0 z-50 bg-white">
          <div className="flex items-center justify-between h-14 px-4">
            <Skeleton className="w-10 h-10 rounded-full" />
            <Skeleton className="w-32 h-6 rounded" />
            <Skeleton className="w-12 h-6 rounded" />
          </div>
          <Skeleton className="h-1 w-full" />
        </div>

        <div className="px-4 py-6 space-y-4">
          <Skeleton className="w-full h-40 rounded-2xl" />
          <Skeleton className="w-full h-16 rounded-xl" />
          <Skeleton className="w-full h-16 rounded-xl" />
          <Skeleton className="w-full h-16 rounded-xl" />
          <Skeleton className="w-full h-16 rounded-xl" />
        </div>
      </div>
    );
  }

  // 에러 상태
  if (error || !quiz) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
            <svg
              className="w-10 h-10 text-red-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-gray-900 mb-2">
            {error || '퀴즈를 불러올 수 없습니다'}
          </h2>
          <p className="text-sm text-gray-600 mb-4">
            잠시 후 다시 시도해주세요.
          </p>
          <button
            onClick={() => router.back()}
            style={{ backgroundColor: colors.accent }}
            className="px-6 py-3 rounded-xl text-white font-semibold"
          >
            돌아가기
          </button>
        </div>
      </div>
    );
  }

  // 현재 답안 가져오기
  const currentAnswer = currentQuestion ? answers[currentQuestion.id] : null;

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* 퀴즈 헤더 */}
      <QuizHeader
        title={quiz.title}
        currentQuestion={currentQuestionIndex + 1}
        totalQuestions={quiz.questions.length}
        onBack={() => setShowExitModal(true)}
      />

      {/* 문제 영역 */}
      <main className="px-4 py-6">
        <AnimatePresence mode="wait">
          {currentQuestion && (
            <motion.div
              key={currentQuestion.id}
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
              transition={{ duration: 0.3 }}
            >
              {/* 문제 카드 */}
              <QuestionCard question={currentQuestion} />

              {/* 선지 영역 */}
              <div className="mt-4 relative">
                {/* OX 선지 */}
                {currentQuestion.type === 'ox' && (
                  <OXChoice
                    selected={currentAnswer as OXAnswer}
                    onSelect={(answer) =>
                      handleAnswerChange(currentQuestion.id, answer)
                    }
                  />
                )}

                {/* 객관식 선지 */}
                {currentQuestion.type === 'multiple' &&
                  currentQuestion.choices && (
                    <MultipleChoice
                      choices={currentQuestion.choices}
                      selected={currentAnswer as number | null}
                      onSelect={(index) =>
                        handleAnswerChange(currentQuestion.id, index)
                      }
                    />
                  )}

                {/* 주관식 입력 */}
                {currentQuestion.type === 'short' && (
                  <ShortAnswer
                    value={(currentAnswer as string) || ''}
                    onChange={(value) =>
                      handleAnswerChange(currentQuestion.id, value)
                    }
                  />
                )}

                {/* 즉시 피드백 버튼 */}
                <div className="absolute top-4 right-0">
                  <InstantFeedbackButton
                    questionId={currentQuestion.id}
                    onSubmit={handleFeedbackSubmit}
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* 네비게이션 */}
      <QuizNavigation
        currentQuestion={currentQuestionIndex + 1}
        totalQuestions={quiz.questions.length}
        onPrev={handlePrev}
        onNext={handleNext}
        onSubmit={handleSubmit}
        hasAnswered={currentAnswer !== null && currentAnswer !== ''}
        isSubmitting={isSubmitting}
      />

      {/* 나가기 확인 모달 */}
      <ExitConfirmModal
        isOpen={showExitModal}
        onClose={() => setShowExitModal(false)}
        onConfirm={handleExitConfirm}
        answeredCount={answeredCount}
        totalQuestions={quiz.questions.length}
      />
    </div>
  );
}
