'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  doc,
  getDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useUser } from '@/lib/contexts';
import { useTheme } from '@/styles/themes/useTheme';

/**
 * 복습 문제 타입
 */
interface ReviewQuestion {
  id: string;
  questionId: string;
  questionText: string;
  questionType: string;
  choices?: string[];
  correctAnswer: string;
  userAnswer?: string;
  explanation?: string;
}

/**
 * 랜덤 복습 페이지
 * - 세션 스토리지에서 선택된 문제 ID 로드
 * - 기존 복습 UI/UX 활용
 */
export default function RandomReviewPage() {
  const router = useRouter();
  const { profile } = useUser();
  const { theme } = useTheme();

  const [questions, setQuestions] = useState<ReviewQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userAnswers, setUserAnswers] = useState<Record<number, string>>({});
  const [showResult, setShowResult] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);
  const [loading, setLoading] = useState(true);

  // 네비게이션 숨김
  useEffect(() => {
    document.body.setAttribute('data-hide-nav', 'true');
    return () => {
      document.body.removeAttribute('data-hide-nav');
    };
  }, []);

  // 문제 로드
  useEffect(() => {
    const loadQuestions = async () => {
      const storedIds = sessionStorage.getItem('randomReviewQuestions');
      if (!storedIds) {
        router.replace('/review');
        return;
      }

      try {
        const ids = JSON.parse(storedIds) as string[];
        const loadedQuestions: ReviewQuestion[] = [];

        for (const id of ids) {
          const docRef = doc(db, 'reviews', id);
          const docSnap = await getDoc(docRef);

          if (docSnap.exists()) {
            const data = docSnap.data();
            loadedQuestions.push({
              id: docSnap.id,
              questionId: data.questionId,
              questionText: data.questionText || data.question || '',
              questionType: data.questionType || data.type || 'multiple',
              choices: data.choices || data.options || [],
              correctAnswer: data.correctAnswer || '',
              explanation: data.explanation || '',
            });
          }
        }

        setQuestions(loadedQuestions);
        setLoading(false);

        // 세션 스토리지 정리
        sessionStorage.removeItem('randomReviewQuestions');
      } catch (error) {
        console.error('문제 로드 실패:', error);
        router.replace('/review');
      }
    };

    loadQuestions();
  }, [router]);

  // 현재 문제
  const currentQuestion = questions[currentIndex];

  // 답변 선택
  const handleAnswer = (answer: string) => {
    setUserAnswers({ ...userAnswers, [currentIndex]: answer });
  };

  // 정답 확인
  const handleCheckAnswer = () => {
    setShowAnswer(true);
  };

  // 다음 문제
  const handleNext = () => {
    setShowAnswer(false);
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      setShowResult(true);
    }
  };

  // 정답 여부 확인
  const isCorrect = (index: number) => {
    const question = questions[index];
    const userAnswer = userAnswers[index];
    if (!question || !userAnswer) return false;

    if (question.questionType === 'ox') {
      const normalizedUser = userAnswer.toUpperCase() === 'O' || userAnswer === '0' ? 'O' : 'X';
      const normalizedCorrect = question.correctAnswer.toString().toUpperCase() === 'O' ||
        question.correctAnswer === '0' ? 'O' : 'X';
      return normalizedUser === normalizedCorrect;
    }

    return userAnswer.toString() === question.correctAnswer.toString();
  };

  // 결과 계산
  const correctCount = Object.keys(userAnswers).filter((_, idx) => isCorrect(idx)).length;

  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: theme.colors.background }}
      >
        <div className="w-8 h-8 border-2 border-[#1A1A1A] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center p-4"
        style={{ backgroundColor: theme.colors.background }}
      >
        <p className="text-lg mb-4">문제를 불러올 수 없습니다.</p>
        <button
          onClick={() => router.replace('/review')}
          className="px-6 py-2 bg-[#1A1A1A] text-white"
        >
          복습 페이지로
        </button>
      </div>
    );
  }

  // 결과 화면
  if (showResult) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center p-4"
        style={{ backgroundColor: theme.colors.background }}
      >
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-center"
        >
          <div className="text-6xl mb-4">
            {correctCount === questions.length ? '🎉' : correctCount >= questions.length / 2 ? '👍' : '💪'}
          </div>
          <h2 className="text-2xl font-bold mb-2">복습 완료!</h2>
          <p className="text-lg text-[#5C5C5C] mb-6">
            {questions.length}문제 중 <span className="text-[#1A6B1A] font-bold">{correctCount}개</span> 정답
          </p>

          <div className="flex gap-3">
            <button
              onClick={() => router.replace('/')}
              className="px-6 py-3 border-2 border-[#1A1A1A] font-bold"
            >
              홈으로
            </button>
            <button
              onClick={() => router.replace('/review')}
              className="px-6 py-3 bg-[#1A1A1A] text-white font-bold"
            >
              복습 더하기
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ backgroundColor: theme.colors.background }}
    >
      {/* 헤더 */}
      <header className="flex items-center justify-between px-4 py-3 border-b-2 border-[#1A1A1A]">
        <button
          onClick={() => {
            if (confirm('복습을 종료하시겠습니까?')) {
              router.replace('/');
            }
          }}
          className="p-1"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <h1 className="text-lg font-bold">랜덤 복습</h1>
        <span className="text-sm text-[#5C5C5C]">
          {currentIndex + 1} / {questions.length}
        </span>
      </header>

      {/* 진행률 바 */}
      <div className="h-1 bg-[#D4CFC4]">
        <motion.div
          className="h-full bg-[#1A1A1A]"
          initial={{ width: 0 }}
          animate={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }}
        />
      </div>

      {/* 문제 영역 */}
      <div className="flex-1 p-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentIndex}
            initial={{ x: 50, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -50, opacity: 0 }}
          >
            {/* 문제 텍스트 */}
            <div className="mb-6">
              <span className="text-sm text-[#5C5C5C] mb-2 block">
                Q{currentIndex + 1}.
              </span>
              <p className="text-lg font-bold">{currentQuestion.questionText}</p>
            </div>

            {/* 선지 */}
            {currentQuestion.questionType === 'ox' ? (
              <div className="flex gap-4 justify-center">
                {['O', 'X'].map((opt) => {
                  const isSelected = userAnswers[currentIndex] === opt;
                  const isCorrectAnswer = showAnswer && (
                    (currentQuestion.correctAnswer.toString().toUpperCase() === 'O' ||
                      currentQuestion.correctAnswer === '0') ? opt === 'O' : opt === 'X'
                  );
                  const isWrongSelected = showAnswer && isSelected && !isCorrectAnswer;

                  return (
                    <button
                      key={opt}
                      onClick={() => !showAnswer && handleAnswer(opt)}
                      disabled={showAnswer}
                      className={`w-24 h-24 text-4xl font-bold border-2 transition-all ${
                        isCorrectAnswer
                          ? 'border-[#1A6B1A] bg-[#E8F5E9] text-[#1A6B1A]'
                          : isWrongSelected
                            ? 'border-[#8B1A1A] bg-[#FDEAEA] text-[#8B1A1A]'
                            : isSelected
                              ? 'border-[#1A1A1A] bg-[#1A1A1A] text-white'
                              : 'border-[#D4CFC4] hover:border-[#1A1A1A]'
                      }`}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            ) : currentQuestion.questionType === 'multiple' && currentQuestion.choices ? (
              <div className="space-y-3">
                {currentQuestion.choices.map((choice, idx) => {
                  const optionNum = (idx + 1).toString();
                  const isSelected = userAnswers[currentIndex] === optionNum;
                  const isCorrectAnswer = showAnswer && currentQuestion.correctAnswer.toString() === optionNum;
                  const isWrongSelected = showAnswer && isSelected && !isCorrectAnswer;

                  return (
                    <button
                      key={idx}
                      onClick={() => !showAnswer && handleAnswer(optionNum)}
                      disabled={showAnswer}
                      className={`w-full p-4 text-left border-2 transition-all ${
                        isCorrectAnswer
                          ? 'border-[#1A6B1A] bg-[#E8F5E9]'
                          : isWrongSelected
                            ? 'border-[#8B1A1A] bg-[#FDEAEA]'
                            : isSelected
                              ? 'border-[#1A1A1A] bg-[#EDEAE4]'
                              : 'border-[#D4CFC4] hover:border-[#1A1A1A]'
                      }`}
                    >
                      <span className="font-bold mr-2">{idx + 1}.</span>
                      {choice}
                    </button>
                  );
                })}
              </div>
            ) : (
              // 주관식
              <div>
                <input
                  type="text"
                  value={userAnswers[currentIndex] || ''}
                  onChange={(e) => handleAnswer(e.target.value)}
                  disabled={showAnswer}
                  placeholder="답을 입력하세요"
                  className="w-full p-4 border-2 border-[#1A1A1A] text-lg"
                />
                {showAnswer && (
                  <div className={`mt-2 p-3 ${
                    isCorrect(currentIndex) ? 'bg-[#E8F5E9] text-[#1A6B1A]' : 'bg-[#FDEAEA] text-[#8B1A1A]'
                  }`}>
                    정답: {currentQuestion.correctAnswer}
                  </div>
                )}
              </div>
            )}

            {/* 해설 */}
            {showAnswer && currentQuestion.explanation && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-6 p-4 bg-[#EDEAE4] border border-[#D4CFC4]"
              >
                <p className="text-sm font-bold mb-1">해설</p>
                <p className="text-sm text-[#5C5C5C]">{currentQuestion.explanation}</p>
              </motion.div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* 하단 버튼 */}
      <div className="p-4 border-t border-[#D4CFC4]">
        {!showAnswer ? (
          <button
            onClick={handleCheckAnswer}
            disabled={!userAnswers[currentIndex]}
            className="w-full py-4 bg-[#1A1A1A] text-white font-bold disabled:opacity-50"
          >
            정답 확인
          </button>
        ) : (
          <button
            onClick={handleNext}
            className="w-full py-4 bg-[#1A1A1A] text-white font-bold"
          >
            {currentIndex < questions.length - 1 ? '다음 문제' : '결과 보기'}
          </button>
        )}
      </div>
    </div>
  );
}
