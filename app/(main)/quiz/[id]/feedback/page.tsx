'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence, PanInfo } from 'framer-motion';
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

/**
 * 문제 결과 타입
 */
interface QuestionResult {
  id: string;
  number: number;
  question: string;
  type: 'ox' | 'multiple' | 'short';
  options?: string[];
  correctAnswer: string;
  userAnswer: string;
  isCorrect: boolean;
  explanation?: string;
}

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
 * 스와이프 방향 감지 임계값
 */
const SWIPE_THRESHOLD = 50;

/**
 * 피드백 페이지
 *
 * 퀴즈의 각 문제에 대해 스와이프로 넘기며 피드백을 입력합니다.
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
  const [currentIndex, setCurrentIndex] = useState(0);
  const [feedbacks, setFeedbacks] = useState<Record<string, string>>({});
  const [direction, setDirection] = useState(0);

  // 터치 참조
  const containerRef = useRef<HTMLDivElement>(null);

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
      }

      // 로컬 스토리지에서 답변 가져오기 (우선순위)
      const storedAnswers = localStorage.getItem(`quiz_answers_${quizId}`);
      if (storedAnswers) {
        userAnswers = JSON.parse(storedAnswers);
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
            options: q.options || [],
            correctAnswer: q.correctAnswer,
            userAnswer,
            isCorrect,
            explanation: q.explanation || '',
          };
        }
      );

      // 피드백 초기화
      const initialFeedbacks: Record<string, string> = {};
      questionResults.forEach((q) => {
        initialFeedbacks[q.id] = '';
      });
      setFeedbacks(initialFeedbacks);

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
   * 다음 문제로 이동
   */
  const goToNext = useCallback(() => {
    if (pageData && currentIndex < pageData.questionResults.length - 1) {
      setDirection(1);
      setCurrentIndex((prev) => prev + 1);
    }
  }, [currentIndex, pageData]);

  /**
   * 이전 문제로 이동
   */
  const goToPrev = useCallback(() => {
    if (currentIndex > 0) {
      setDirection(-1);
      setCurrentIndex((prev) => prev - 1);
    }
  }, [currentIndex]);

  /**
   * 스와이프 핸들러
   */
  const handleDragEnd = (event: any, info: PanInfo) => {
    if (info.offset.x > SWIPE_THRESHOLD) {
      goToPrev();
    } else if (info.offset.x < -SWIPE_THRESHOLD) {
      goToNext();
    }
  };

  /**
   * 피드백 변경 핸들러
   */
  const handleFeedbackChange = (questionId: string, value: string) => {
    setFeedbacks((prev) => ({
      ...prev,
      [questionId]: value,
    }));
  };

  /**
   * 피드백 제출 핸들러
   */
  const handleSubmit = async () => {
    if (!user || !pageData) return;

    try {
      setIsSubmitting(true);

      // 피드백 저장
      for (const [questionId, feedback] of Object.entries(feedbacks)) {
        if (feedback.trim()) {
          await addDoc(collection(db, 'feedbacks'), {
            userId: user.uid,
            quizId: pageData.quizId,
            questionId,
            feedback: feedback.trim(),
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

      // Cloud Function 호출하여 경험치 지급
      try {
        const grantFeedbackReward = httpsCallable(functions, 'grantFeedbackReward');
        await grantFeedbackReward({
          userId: user.uid,
          quizId: pageData.quizId,
          feedbackCount: Object.values(feedbacks).filter((f) => f.trim()).length,
        });
      } catch (functionError) {
        console.error('Cloud Function 호출 오류:', functionError);
      }

      // 로컬 스토리지 정리
      localStorage.removeItem(`quiz_answers_${quizId}`);
      localStorage.removeItem(`quiz_result_${quizId}`);

      // 퀴즈 목록으로 이동
      router.push('/quiz');
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
    // 로컬 스토리지 정리
    localStorage.removeItem(`quiz_answers_${quizId}`);
    localStorage.removeItem(`quiz_result_${quizId}`);
    router.push('/quiz');
  };

  // 로딩 UI
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F5F0E8' }}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-[#1A1A1A] border-t-transparent animate-spin" />
          <p className="text-[#5C5C5C] text-sm">로딩 중...</p>
        </div>
      </div>
    );
  }

  // 에러 UI
  if (error || !pageData) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4" style={{ backgroundColor: '#F5F0E8' }}>
        <h2 className="text-xl font-bold text-[#1A1A1A] mb-2">오류 발생</h2>
        <p className="text-[#5C5C5C] text-center mb-6">{error || '알 수 없는 오류가 발생했습니다.'}</p>
        <button
          onClick={() => router.push('/quiz')}
          className="px-6 py-2 bg-[#1A1A1A] text-[#F5F0E8] font-bold"
        >
          퀴즈 목록으로
        </button>
      </div>
    );
  }

  // 이미 피드백을 제출한 경우
  if (pageData.hasSubmittedFeedback) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4" style={{ backgroundColor: '#F5F0E8' }}>
        <h2 className="text-xl font-bold text-[#1A1A1A] mb-2">
          이미 피드백을 제출했습니다
        </h2>
        <p className="text-[#5C5C5C] text-center mb-6">
          소중한 의견 감사합니다!
        </p>
        <button
          onClick={() => router.push('/quiz')}
          className="px-6 py-3 bg-[#1A1A1A] text-[#F5F0E8] font-bold"
        >
          퀴즈 목록으로
        </button>
      </div>
    );
  }

  const currentQuestion = pageData.questionResults[currentIndex];
  const totalQuestions = pageData.questionResults.length;

  // 슬라이드 애니메이션 variants
  const slideVariants = {
    enter: (direction: number) => ({
      x: direction > 0 ? 300 : -300,
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (direction: number) => ({
      x: direction < 0 ? 300 : -300,
      opacity: 0,
    }),
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#F5F0E8' }}>
      {/* 헤더 */}
      <header className="px-4 py-4 border-b-2 border-[#1A1A1A] bg-[#F5F0E8]">
        <h1 className="text-lg font-bold text-[#1A1A1A] text-center">
          피드백
        </h1>
        <p className="text-xs text-[#5C5C5C] text-center mt-1">
          문제에 대한 의견을 남겨주세요
        </p>
      </header>

      {/* 진행 상태 표시 */}
      <div className="px-4 py-3 border-b border-[#EDEAE4]">
        <div className="flex justify-between items-center mb-2">
          <span className="text-xs font-bold text-[#1A1A1A]">
            {currentIndex + 1} / {totalQuestions}
          </span>
          <span className="text-xs text-[#5C5C5C]">
            좌우로 스와이프하여 이동
          </span>
        </div>
        {/* 진행 바 */}
        <div className="h-1 bg-[#EDEAE4]">
          <motion.div
            className="h-full bg-[#1A1A1A]"
            initial={{ width: 0 }}
            animate={{ width: `${((currentIndex + 1) / totalQuestions) * 100}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
        {/* 문제 인디케이터 */}
        <div className="flex justify-center gap-1 mt-3">
          {pageData.questionResults.map((_, idx) => (
            <button
              key={idx}
              onClick={() => {
                setDirection(idx > currentIndex ? 1 : -1);
                setCurrentIndex(idx);
              }}
              className={`w-2 h-2 transition-colors ${
                idx === currentIndex ? 'bg-[#1A1A1A]' : 'bg-[#EDEAE4]'
              }`}
            />
          ))}
        </div>
      </div>

      {/* 문제 카드 영역 */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden relative"
      >
        <AnimatePresence initial={false} custom={direction} mode="wait">
          <motion.div
            key={currentIndex}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.3 }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.2}
            onDragEnd={handleDragEnd}
            className="absolute inset-0 p-4 overflow-y-auto"
          >
            <div className="bg-[#F5F0E8] border-2 border-[#1A1A1A] p-4">
              {/* 정답/오답 표시 */}
              <div className={`inline-block px-3 py-1 text-xs font-bold mb-3 ${
                currentQuestion.isCorrect
                  ? 'bg-[#E8F5E9] text-[#1A6B1A] border border-[#1A6B1A]'
                  : 'bg-[#FFEBEE] text-[#8B1A1A] border border-[#8B1A1A]'
              }`}>
                {currentQuestion.isCorrect ? '정답' : '오답'}
              </div>

              {/* 문제 */}
              <div className="mb-4">
                <p className="text-xs text-[#5C5C5C] mb-1">Q{currentQuestion.number}</p>
                <p className="text-sm font-bold text-[#1A1A1A] leading-relaxed">
                  {currentQuestion.question}
                </p>
              </div>

              {/* 선지 (객관식) */}
              {currentQuestion.type === 'multiple' && currentQuestion.options && currentQuestion.options.length > 0 && (
                <div className="mb-4 space-y-2">
                  <p className="text-xs font-bold text-[#5C5C5C]">선지</p>
                  {currentQuestion.options.map((option, idx) => {
                    const optionNum = (idx + 1).toString();
                    const isCorrect = currentQuestion.correctAnswer === optionNum;
                    const isUserAnswer = currentQuestion.userAnswer === optionNum;

                    return (
                      <div
                        key={idx}
                        className={`p-2 text-xs border ${
                          isCorrect
                            ? 'bg-[#E8F5E9] border-[#1A6B1A] text-[#1A6B1A]'
                            : isUserAnswer
                            ? 'bg-[#FFEBEE] border-[#8B1A1A] text-[#8B1A1A]'
                            : 'bg-[#EDEAE4] border-[#EDEAE4] text-[#5C5C5C]'
                        }`}
                      >
                        <span className="font-bold mr-2">{idx + 1}.</span>
                        {option}
                        {isCorrect && <span className="ml-2 font-bold">(정답)</span>}
                        {isUserAnswer && !isCorrect && <span className="ml-2 font-bold">(내 선택)</span>}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* OX 또는 주관식 답변 */}
              {(currentQuestion.type === 'ox' || currentQuestion.type === 'short') && (
                <div className="mb-4 space-y-2">
                  <div className="flex gap-4 text-xs">
                    <div className="flex-1 p-2 bg-[#E8F5E9] border border-[#1A6B1A]">
                      <span className="text-[#5C5C5C]">정답: </span>
                      <span className="font-bold text-[#1A6B1A]">{currentQuestion.correctAnswer}</span>
                    </div>
                    <div className={`flex-1 p-2 ${
                      currentQuestion.isCorrect
                        ? 'bg-[#E8F5E9] border border-[#1A6B1A]'
                        : 'bg-[#FFEBEE] border border-[#8B1A1A]'
                    }`}>
                      <span className="text-[#5C5C5C]">내 답: </span>
                      <span className={`font-bold ${
                        currentQuestion.isCorrect ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'
                      }`}>
                        {currentQuestion.userAnswer || '(미입력)'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* 해설 */}
              {currentQuestion.explanation && (
                <div className="mb-4 p-3 bg-[#EDEAE4] border border-[#1A1A1A]">
                  <p className="text-xs font-bold text-[#1A1A1A] mb-1">해설</p>
                  <p className="text-xs text-[#5C5C5C] leading-relaxed">
                    {currentQuestion.explanation}
                  </p>
                </div>
              )}

              {/* 피드백 입력 */}
              <div className="mt-4">
                <label className="text-xs font-bold text-[#1A1A1A] mb-2 block">
                  이 문제에 대한 피드백 (선택)
                </label>
                <textarea
                  value={feedbacks[currentQuestion.id] || ''}
                  onChange={(e) => handleFeedbackChange(currentQuestion.id, e.target.value)}
                  placeholder="문제에 오류가 있거나 개선점이 있다면 알려주세요..."
                  className="w-full px-3 py-2 text-sm bg-white border-2 border-[#1A1A1A] placeholder:text-[#AAAAAA] focus:outline-none resize-none"
                  rows={3}
                />
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* 이전/다음 버튼 */}
      <div className="px-4 py-2 flex justify-between">
        <button
          onClick={goToPrev}
          disabled={currentIndex === 0}
          className={`px-4 py-2 text-sm font-bold border-2 border-[#1A1A1A] ${
            currentIndex === 0
              ? 'opacity-30 cursor-not-allowed text-[#1A1A1A]'
              : 'text-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
          } transition-colors`}
        >
          이전
        </button>
        <button
          onClick={goToNext}
          disabled={currentIndex === totalQuestions - 1}
          className={`px-4 py-2 text-sm font-bold border-2 border-[#1A1A1A] ${
            currentIndex === totalQuestions - 1
              ? 'opacity-30 cursor-not-allowed text-[#1A1A1A]'
              : 'text-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
          } transition-colors`}
        >
          다음
        </button>
      </div>

      {/* 하단 버튼 영역 */}
      <div className="px-4 py-4 border-t-2 border-[#1A1A1A] bg-[#EDEAE4]">
        <div className="flex gap-3">
          {/* Skip 버튼 */}
          <button
            onClick={handleSkip}
            disabled={isSubmitting}
            className="flex-1 py-3 text-sm font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors disabled:opacity-50"
          >
            Skip
          </button>

          {/* 완료 버튼 */}
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="flex-[2] py-3 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#3A3A3A] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <div className="w-4 h-4 border-2 border-[#F5F0E8] border-t-transparent animate-spin" />
                제출 중...
              </>
            ) : (
              <>
                완료
                <span className="bg-[#F5F0E8] text-[#1A1A1A] px-2 py-0.5 text-xs">
                  +exp
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
