'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  doc,
  getDoc,
  updateDoc,
  increment,
  serverTimestamp,
  db,
} from '@/lib/repositories';
import { useUser } from '@/lib/contexts';
import { useTheme } from '@/styles/themes/useTheme';
import { useHideNav } from '@/lib/hooks/useHideNav';

/**
 * 복습 문제 타입 — Firestore reviews 컬렉션 필드명 기준
 */
interface ReviewQuestion {
  id: string; // Firestore 문서 ID
  questionId: string;
  question: string; // data.question
  type: string; // data.type (ox, multiple, short_answer, short)
  options?: string[]; // data.options
  correctAnswer: string;
  explanation?: string;
}

/**
 * 랜덤 복습 페이지
 * - 세션 스토리지에서 선택된 문제 ID 로드
 * - 복수정답 객관식/주관식 ||| 지원
 * - 완료 시 markAsReviewed 호출
 */
export default function RandomReviewPage() {
  const router = useRouter();
  const { profile } = useUser();
  const { theme } = useTheme();

  const [questions, setQuestions] = useState<ReviewQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  // 객관식 복수정답용: 선택된 번호 Set
  const [userAnswers, setUserAnswers] = useState<Record<number, string>>({});
  const [multiSelections, setMultiSelections] = useState<Record<number, Set<string>>>({});
  const [showResult, setShowResult] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);
  const [loading, setLoading] = useState(true);

  // 네비게이션 숨김
  useHideNav(true);

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
              question: data.question || data.questionText || '',
              type: data.type || data.questionType || 'multiple',
              options: data.options || data.choices || [],
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

  // 복수정답 여부 확인
  const isMultiAnswer = useCallback((q: ReviewQuestion) => {
    return q.type === 'multiple' && q.correctAnswer.includes(',');
  }, []);

  // 단일 선택 답변
  const handleAnswer = (answer: string) => {
    setUserAnswers({ ...userAnswers, [currentIndex]: answer });
  };

  // 복수 선택 토글
  const handleToggleMulti = (optionNum: string) => {
    setMultiSelections(prev => {
      const currentSet = new Set(prev[currentIndex] || []);
      if (currentSet.has(optionNum)) {
        currentSet.delete(optionNum);
      } else {
        currentSet.add(optionNum);
      }
      // userAnswers에도 정렬된 값 동기화
      const sorted = Array.from(currentSet).sort((a, b) => Number(a) - Number(b));
      setUserAnswers(ua => ({ ...ua, [currentIndex]: sorted.join(',') }));
      return { ...prev, [currentIndex]: currentSet };
    });
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
      // 결과 화면 진입 전 markAsReviewed 호출
      markAllAsReviewed();
      setShowResult(true);
    }
  };

  // 모든 문제 복습 완료 처리
  const markAllAsReviewed = async () => {
    for (const q of questions) {
      try {
        await updateDoc(doc(db, 'reviews', q.id), {
          reviewCount: increment(1),
          lastReviewedAt: serverTimestamp(),
        });
      } catch (err) {
        console.error('markAsReviewed 실패:', q.id, err);
      }
    }
  };

  // 정답 여부 확인 — 복수정답/||| 지원
  const checkCorrect = (index: number) => {
    const question = questions[index];
    const userAnswer = userAnswers[index];
    if (!question || !userAnswer) return false;

    // OX
    if (question.type === 'ox') {
      const normalizedUser = (userAnswer.toUpperCase() === 'O' || userAnswer === '0') ? 'O' : 'X';
      const normalizedCorrect = (question.correctAnswer.toString().toUpperCase() === 'O' ||
        question.correctAnswer.toString() === '0') ? 'O' : 'X';
      return normalizedUser === normalizedCorrect;
    }

    // 객관식 복수정답
    if (question.type === 'multiple' && question.correctAnswer.includes(',')) {
      const correctSet = new Set(question.correctAnswer.split(',').map(s => s.trim()));
      const userSet = new Set(userAnswer.split(',').map(s => s.trim()));
      if (correctSet.size !== userSet.size) return false;
      for (const v of correctSet) {
        if (!userSet.has(v)) return false;
      }
      return true;
    }

    // 주관식 ||| 복수정답
    if ((question.type === 'short_answer' || question.type === 'short') &&
      question.correctAnswer.includes('|||')) {
      const accepted = question.correctAnswer.split('|||').map(s => s.trim().toLowerCase());
      return accepted.includes(userAnswer.trim().toLowerCase());
    }

    return userAnswer.toString() === question.correctAnswer.toString();
  };

  // 결과 계산
  const correctCount = Object.keys(userAnswers).filter((key) => checkCorrect(Number(key))).length;

  // 현재 답변 존재 여부
  const hasCurrentAnswer = userAnswers[currentIndex] !== undefined && userAnswers[currentIndex] !== '';

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
              <p className="text-lg font-bold">{currentQuestion.question}</p>
            </div>

            {/* OX */}
            {currentQuestion.type === 'ox' ? (
              <div className="flex gap-4 justify-center">
                {['O', 'X'].map((opt) => {
                  const isSelected = userAnswers[currentIndex] === opt;
                  const isCorrectAnswer = showAnswer && (
                    (currentQuestion.correctAnswer.toString().toUpperCase() === 'O' ||
                      currentQuestion.correctAnswer.toString() === '0') ? opt === 'O' : opt === 'X'
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
            ) : currentQuestion.type === 'multiple' && currentQuestion.options ? (
              // 객관식 — 복수정답이면 토글, 단일이면 라디오
              <div className="space-y-3">
                {isMultiAnswer(currentQuestion) && (
                  <p className="text-xs text-[#5C5C5C] mb-1">복수 정답 — 해당하는 것을 모두 선택하세요</p>
                )}
                {currentQuestion.options.map((choice, idx) => {
                  const optionNum = idx.toString();
                  const multi = isMultiAnswer(currentQuestion);
                  const isSelected = multi
                    ? (multiSelections[currentIndex] || new Set()).has(optionNum)
                    : userAnswers[currentIndex] === optionNum;

                  // 정답 하이라이트
                  const correctNums = currentQuestion.correctAnswer.split(',').map(s => s.trim());
                  const isCorrectAnswer = showAnswer && correctNums.includes(optionNum);
                  const isWrongSelected = showAnswer && isSelected && !isCorrectAnswer;

                  return (
                    <button
                      key={idx}
                      onClick={() => {
                        if (showAnswer) return;
                        if (multi) {
                          handleToggleMulti(optionNum);
                        } else {
                          handleAnswer(optionNum);
                        }
                      }}
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
                    checkCorrect(currentIndex) ? 'bg-[#E8F5E9] text-[#1A6B1A]' : 'bg-[#FDEAEA] text-[#8B1A1A]'
                  }`}>
                    정답: {currentQuestion.correctAnswer.includes('|||')
                      ? currentQuestion.correctAnswer.split('|||').join(' 또는 ')
                      : currentQuestion.correctAnswer}
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
            disabled={!hasCurrentAnswer}
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
