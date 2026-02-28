'use client';

import { useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';

interface Question {
  text: string;
  choices: string[];
  answer: number | number[]; // 복수정답 지원
  explanation: string;
}

/**
 * 사용자 답변 정보
 */
export interface UserAnswer {
  questionIndex: number;
  userAnswer: number | number[]; // 복수정답 지원
  isCorrect: boolean;
}

interface AIQuizPlayerProps {
  isOpen: boolean;
  questions: Question[];
  folderName: string;
  onComplete: (score: number, total: number, answers: UserAnswer[]) => void;
  onClose: () => void;
}

/**
 * AI 퀴즈 풀이 화면 (즉시 피드백, 복수정답 지원)
 */
export default function AIQuizPlayer({
  isOpen,
  questions,
  folderName,
  onComplete,
  onClose,
}: AIQuizPlayerProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<number[]>([]); // 복수 선택 지원
  const [isAnswered, setIsAnswered] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [showResult, setShowResult] = useState(false);
  const [userAnswers, setUserAnswers] = useState<UserAnswer[]>([]);

  const currentQuestion = questions[currentIndex];
  const isLastQuestion = currentIndex === questions.length - 1;

  // 복수정답 여부
  const isMultipleAnswer = useMemo(() => {
    return Array.isArray(currentQuestion?.answer);
  }, [currentQuestion]);

  // 정답 배열 (단일 정답도 배열로 변환)
  const correctAnswers = useMemo(() => {
    if (!currentQuestion) return [];
    return Array.isArray(currentQuestion.answer)
      ? currentQuestion.answer
      : [currentQuestion.answer];
  }, [currentQuestion]);

  // 정답 체크
  const checkAnswer = useCallback((selected: number[]): boolean => {
    if (selected.length !== correctAnswers.length) return false;
    const sortedSelected = [...selected].sort((a, b) => a - b);
    const sortedCorrect = [...correctAnswers].sort((a, b) => a - b);
    return sortedSelected.every((val, idx) => val === sortedCorrect[idx]);
  }, [correctAnswers]);

  // 선지 선택/토글
  const handleSelectAnswer = useCallback((answerIdx: number) => {
    if (isAnswered) return;

    if (isMultipleAnswer) {
      // 복수정답: 토글
      setSelectedAnswers(prev => {
        if (prev.includes(answerIdx)) {
          return prev.filter(a => a !== answerIdx);
        } else {
          return [...prev, answerIdx];
        }
      });
    } else {
      // 단일정답: 즉시 채점
      const isCorrectAnswer = answerIdx === correctAnswers[0];
      setSelectedAnswers([answerIdx]);
      setIsAnswered(true);

      setUserAnswers(prev => [...prev, {
        questionIndex: currentIndex,
        userAnswer: answerIdx,
        isCorrect: isCorrectAnswer,
      }]);

      if (isCorrectAnswer) {
        setCorrectCount(prev => prev + 1);
      }
    }
  }, [isAnswered, isMultipleAnswer, correctAnswers, currentIndex]);

  // 복수정답 제출
  const handleSubmitMultiple = useCallback(() => {
    if (selectedAnswers.length === 0) return;

    const isCorrectAnswer = checkAnswer(selectedAnswers);
    setIsAnswered(true);

    setUserAnswers(prev => [...prev, {
      questionIndex: currentIndex,
      userAnswer: selectedAnswers,
      isCorrect: isCorrectAnswer,
    }]);

    if (isCorrectAnswer) {
      setCorrectCount(prev => prev + 1);
    }
  }, [selectedAnswers, checkAnswer, currentIndex]);

  // 다음 문제
  const handleNext = useCallback(() => {
    if (isLastQuestion) {
      setShowResult(true);
    } else {
      setCurrentIndex(prev => prev + 1);
      setSelectedAnswers([]);
      setIsAnswered(false);
    }
  }, [isLastQuestion]);

  // 결과 확인 후 완료
  const handleFinish = useCallback(() => {
    onComplete(correctCount, questions.length, userAnswers);
    // 상태 초기화
    setCurrentIndex(0);
    setSelectedAnswers([]);
    setIsAnswered(false);
    setCorrectCount(0);
    setShowResult(false);
    setUserAnswers([]);
  }, [correctCount, questions.length, userAnswers, onComplete]);

  if (typeof window === 'undefined' || !isOpen || questions.length === 0) return null;

  // 결과 화면
  if (showResult) {
    const percentage = Math.round((correctCount / questions.length) * 100);
    const grade = percentage >= 80 ? 'A' : percentage >= 60 ? 'B' : percentage >= 40 ? 'C' : 'D';

    return createPortal(
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#F5F0E8]">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md p-5 text-center"
        >
          {/* 결과 아이콘 */}
          <div className="mb-3">
            <div className={`inline-flex items-center justify-center w-16 h-16 border-3 rounded-full ${
              percentage >= 60 ? 'border-[#1A6B1A] text-[#1A6B1A]' : 'border-[#D97706] text-[#D97706]'
            }`}>
              <span className="text-2xl font-bold">{grade}</span>
            </div>
          </div>

          {/* 폴더명 */}
          <div className="text-xs text-[#5C5C5C] mb-1">{folderName}</div>

          {/* 점수 */}
          <h2 className="text-xl font-bold text-[#1A1A1A] mb-1">
            {correctCount} / {questions.length}
          </h2>
          <p className="text-sm text-[#5C5C5C] mb-5">
            정답률 {percentage}%
          </p>

          {/* 메시지 */}
          <p className="text-sm text-[#1A1A1A] mb-5">
            {percentage >= 80
              ? '훌륭해요! 이 주제를 잘 이해하고 있네요.'
              : percentage >= 60
              ? '좋아요! 조금만 더 복습하면 완벽해질 거예요.'
              : percentage >= 40
              ? '괜찮아요! 틀린 문제를 다시 살펴보세요.'
              : '화이팅! 자료를 다시 한 번 읽어보세요.'}
          </p>

          {/* 완료 버튼 */}
          <button
            onClick={handleFinish}
            className="w-full py-2.5 font-bold text-xs border-2 border-[#1A1A1A] bg-[#1A1A1A] text-white shadow-[3px_3px_0px_#1A1A1A] active:shadow-none active:translate-x-[3px] active:translate-y-[3px] transition-all"
          >
            학습 완료
          </button>
        </motion.div>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-[#F5F0E8]">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 border-b-2 border-[#1A1A1A] bg-white">
        <button
          onClick={onClose}
          className="p-2 text-[#5C5C5C] hover:text-[#1A1A1A]"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <div className="text-center">
          <div className="text-sm font-semibold text-[#1A1A1A]">{folderName}</div>
          <div className="text-xs text-[#5C5C5C]">
            {currentIndex + 1} / {questions.length}
          </div>
        </div>
        <div className="w-10" /> {/* 균형을 위한 빈 공간 */}
      </div>

      {/* 진행률 바 */}
      <div className="h-1 bg-[#E5E5E5]">
        <motion.div
          className="h-full bg-[#1A1A1A]"
          initial={{ width: 0 }}
          animate={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }}
        />
      </div>

      {/* 문제 영역 */}
      <div className="flex-1 overflow-y-auto p-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentIndex}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-4"
          >
            {/* 문제 */}
            <div className="p-3 border-2 border-[#1A1A1A] bg-white">
              <div className="flex items-start gap-2">
                <span className="flex-shrink-0 w-7 h-7 flex items-center justify-center border-2 border-[#1A1A1A] bg-[#1A1A1A] text-white font-bold text-xs">
                  Q
                </span>
                <div className="flex-1">
                  <p className="text-[#1A1A1A] font-medium leading-relaxed pt-1">
                    {currentQuestion.text}
                  </p>
                  {/* 복수정답 표시 */}
                  {isMultipleAnswer && (
                    <span className="inline-block mt-2 px-2 py-0.5 text-xs font-bold text-[#8B6914] bg-[#FEF3C7] border border-[#8B6914]">
                      복수정답 ({correctAnswers.length}개)
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* 선지 */}
            <div className="space-y-2">
              {currentQuestion.choices.map((choice, idx) => {
                const isSelected = selectedAnswers.includes(idx);
                const isCorrectAnswer = correctAnswers.includes(idx);

                let buttonStyle = 'border-[#1A1A1A] bg-white text-[#1A1A1A] hover:bg-[#EDEAE4]';

                if (isAnswered) {
                  if (isCorrectAnswer) {
                    buttonStyle = 'border-[#1A6B1A] bg-[#D1FAE5] text-[#1A6B1A]';
                  } else if (isSelected && !isCorrectAnswer) {
                    buttonStyle = 'border-[#8B1A1A] bg-[#FEE2E2] text-[#8B1A1A]';
                  } else {
                    buttonStyle = 'border-[#E5E5E5] bg-[#F5F5F5] text-[#9A9A9A]';
                  }
                } else if (isSelected) {
                  buttonStyle = 'border-[#1A1A1A] bg-[#1A1A1A] text-white';
                }

                return (
                  <button
                    key={idx}
                    onClick={() => handleSelectAnswer(idx)}
                    disabled={isAnswered}
                    className={`w-full p-3 border-2 text-left transition-all ${buttonStyle}`}
                  >
                    <div className="flex items-start gap-2">
                      <span className={`flex-shrink-0 w-6 h-6 flex items-center justify-center border-2 text-sm font-semibold ${
                        isAnswered && isCorrectAnswer
                          ? 'border-[#1A6B1A] bg-[#1A6B1A] text-white'
                          : isAnswered && isSelected && !isCorrectAnswer
                          ? 'border-[#8B1A1A] bg-[#8B1A1A] text-white'
                          : isSelected
                          ? 'border-white bg-white text-[#1A1A1A]'
                          : 'border-current'
                      }`}>
                        {idx + 1}
                      </span>
                      <span className="flex-1">{choice}</span>
                      {isAnswered && isCorrectAnswer && (
                        <svg className="w-6 h-6 text-[#1A6B1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                      {isAnswered && isSelected && !isCorrectAnswer && (
                        <svg className="w-6 h-6 text-[#8B1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* 복수정답 제출 버튼 */}
            {isMultipleAnswer && !isAnswered && (
              <button
                onClick={handleSubmitMultiple}
                disabled={selectedAnswers.length === 0}
                className={`w-full py-2.5 font-bold border-2 transition-all ${
                  selectedAnswers.length > 0
                    ? 'border-[#1A1A1A] bg-[#1A1A1A] text-white hover:bg-[#333]'
                    : 'border-[#D4CFC4] bg-[#EDEAE4] text-[#9A9A9A] cursor-not-allowed'
                }`}
              >
                정답 제출 ({selectedAnswers.length}개 선택)
              </button>
            )}

            {/* 해설 (답을 선택한 경우) */}
            <AnimatePresence>
              {isAnswered && currentQuestion.explanation && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="p-3 border-2 border-[#1A1A1A] bg-[#EDEAE4]"
                >
                  <div className="flex items-start gap-2">
                    <svg className="w-5 h-5 text-[#5C5C5C] flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                      <span className="text-sm font-semibold text-[#1A1A1A]">해설</span>
                      <p className="text-sm text-[#5C5C5C] mt-1">{currentQuestion.explanation}</p>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* 다음 버튼 */}
      <AnimatePresence>
        {isAnswered && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="p-4 border-t-2 border-[#1A1A1A] bg-white"
          >
            <button
              onClick={handleNext}
              className="w-full py-3 font-bold text-sm border-2 border-[#1A1A1A] bg-[#1A1A1A] text-white shadow-[3px_3px_0px_#1A1A1A] active:shadow-none active:translate-x-[3px] active:translate-y-[3px] transition-all"
            >
              {isLastQuestion ? '결과 보기' : '다음 문제'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>,
    document.body
  );
}
