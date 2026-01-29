'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ReviewItem } from '@/lib/hooks/useReview';
import { Header, Button } from '@/components/common';
import OXChoice, { OXAnswer } from '@/components/quiz/OXChoice';
import MultipleChoice from '@/components/quiz/MultipleChoice';
import ShortAnswer from '@/components/quiz/ShortAnswer';

interface ReviewPracticeProps {
  /** 복습할 문제 목록 */
  items: ReviewItem[];
  /** 완료 핸들러 */
  onComplete: (results: PracticeResult[]) => void;
  /** 닫기 핸들러 */
  onClose: () => void;
}

/**
 * 연습 결과 타입
 */
export interface PracticeResult {
  /** 복습 문제 ID */
  reviewId: string;
  /** 사용자 답변 */
  userAnswer: string;
  /** 정답 여부 */
  isCorrect: boolean;
}

/**
 * 복습 연습 모드 컴포넌트
 *
 * 선택한 복습 문제들을 연습 모드로 풀어볼 수 있습니다.
 * 제출 즉시 정답/오답을 확인할 수 있습니다.
 *
 * @example
 * ```tsx
 * <ReviewPractice
 *   items={selectedItems}
 *   onComplete={handleComplete}
 *   onClose={handleClose}
 * />
 * ```
 */
export default function ReviewPractice({
  items,
  onComplete,
  onClose,
}: ReviewPracticeProps) {
  // 현재 문제 인덱스
  const [currentIndex, setCurrentIndex] = useState(0);
  // 사용자 답변
  const [answer, setAnswer] = useState<string | number | null>(null);
  // 제출 여부
  const [isSubmitted, setIsSubmitted] = useState(false);
  // 결과 저장
  const [results, setResults] = useState<PracticeResult[]>([]);

  // 현재 문제
  const currentItem = items[currentIndex];
  const totalCount = items.length;
  const isLastQuestion = currentIndex === totalCount - 1;

  // 정답 체크
  const checkAnswer = useCallback(() => {
    if (!currentItem || answer === null) return false;

    const userAnswerStr = answer.toString();
    const correctAnswerStr = currentItem.correctAnswer.toString().toLowerCase();

    // 객관식의 경우 1부터 시작하는 인덱스로 비교
    if (currentItem.type === 'multiple' && typeof answer === 'number') {
      return (answer + 1).toString() === correctAnswerStr;
    }

    return userAnswerStr.toLowerCase() === correctAnswerStr;
  }, [currentItem, answer]);

  // 답변 제출
  const handleSubmit = () => {
    if (answer === null) return;

    const isCorrect = checkAnswer();

    // 결과 저장
    const newResult: PracticeResult = {
      reviewId: currentItem.id,
      userAnswer: answer.toString(),
      isCorrect,
    };
    setResults((prev) => [...prev, newResult]);
    setIsSubmitted(true);
  };

  // 다음 문제로 이동
  const handleNext = () => {
    if (isLastQuestion) {
      // 마지막 문제면 완료 처리
      onComplete([...results]);
    } else {
      // 다음 문제로
      setCurrentIndex((prev) => prev + 1);
      setAnswer(null);
      setIsSubmitted(false);
    }
  };

  // 정답 여부
  const isCorrect = isSubmitted && checkAnswer();

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-gray-50"
    >
      {/* 헤더 */}
      <Header
        title={`복습 연습 (${currentIndex + 1}/${totalCount})`}
        showBack
        onBack={onClose}
      />

      {/* 진행률 바 */}
      <div className="h-1 bg-gray-200">
        <motion.div
          className="h-full bg-theme-accent"
          initial={{ width: 0 }}
          animate={{ width: `${((currentIndex + 1) / totalCount) * 100}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>

      {/* 문제 영역 */}
      <main className="px-4 py-6 pb-32">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentItem.id}
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -50 }}
            transition={{ duration: 0.3 }}
          >
            {/* 문제 카드 */}
            <div className="bg-white rounded-2xl p-5 shadow-sm mb-4">
              {/* 문제 유형 */}
              <span className="inline-block px-2 py-0.5 bg-gray-100 text-gray-600 text-xs font-medium rounded-full mb-3">
                {currentItem.type === 'ox' && 'OX'}
                {currentItem.type === 'multiple' && '객관식'}
                {currentItem.type === 'short' && '주관식'}
              </span>

              {/* 문제 내용 */}
              <p className="text-gray-800 text-base leading-relaxed whitespace-pre-wrap">
                {currentItem.question}
              </p>
            </div>

            {/* 답변 영역 */}
            <div className="space-y-4">
              {/* OX 문제 */}
              {currentItem.type === 'ox' && (
                <OXChoice
                  selected={answer as OXAnswer}
                  onSelect={(value) => !isSubmitted && setAnswer(value)}
                  disabled={isSubmitted}
                />
              )}

              {/* 객관식 문제 */}
              {currentItem.type === 'multiple' && currentItem.options && (
                <MultipleChoice
                  choices={currentItem.options}
                  selected={answer as number | null}
                  onSelect={(index) => !isSubmitted && setAnswer(index)}
                  disabled={isSubmitted}
                  correctIndex={
                    isSubmitted
                      ? parseInt(currentItem.correctAnswer, 10) - 1
                      : undefined
                  }
                />
              )}

              {/* 주관식 문제 */}
              {currentItem.type === 'short' && (
                <ShortAnswer
                  value={(answer as string) || ''}
                  onChange={(value) => !isSubmitted && setAnswer(value)}
                  disabled={isSubmitted}
                />
              )}
            </div>

            {/* 제출 후 결과 표시 */}
            <AnimatePresence>
              {isSubmitted && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="mt-6"
                >
                  {/* 정답/오답 표시 */}
                  <div
                    className={`
                      p-4 rounded-2xl text-center
                      ${isCorrect
                        ? 'bg-green-50 border-2 border-green-200'
                        : 'bg-red-50 border-2 border-red-200'
                      }
                    `}
                  >
                    <div className="text-4xl mb-2">
                      {isCorrect ? '🎉' : '😢'}
                    </div>
                    <p className={`text-lg font-bold ${isCorrect ? 'text-green-700' : 'text-red-700'}`}>
                      {isCorrect ? '정답입니다!' : '오답입니다'}
                    </p>

                    {/* 정답 표시 (오답인 경우) */}
                    {!isCorrect && (
                      <p className="mt-2 text-sm text-gray-600">
                        정답: <span className="font-semibold text-green-700">
                          {currentItem.type === 'multiple' && currentItem.options
                            ? currentItem.options[parseInt(currentItem.correctAnswer, 10) - 1]
                            : currentItem.correctAnswer
                          }
                        </span>
                      </p>
                    )}
                  </div>

                  {/* 해설 */}
                  {currentItem.explanation && (
                    <div className="mt-4 p-4 bg-yellow-50 rounded-2xl border border-yellow-100">
                      <p className="text-xs font-semibold text-gray-500 mb-1">해설</p>
                      <p className="text-sm text-gray-700 whitespace-pre-wrap">
                        {currentItem.explanation}
                      </p>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </AnimatePresence>
      </main>

      {/* 하단 버튼 */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-100 safe-area-bottom">
        {!isSubmitted ? (
          <Button
            fullWidth
            size="lg"
            onClick={handleSubmit}
            disabled={answer === null}
          >
            제출하기
          </Button>
        ) : (
          <Button
            fullWidth
            size="lg"
            onClick={handleNext}
          >
            {isLastQuestion ? '결과 보기' : '다음 문제'}
          </Button>
        )}
      </div>
    </motion.div>
  );
}
