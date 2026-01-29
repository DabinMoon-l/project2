'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import type { QuestionResult } from './QuestionResultList';

/**
 * 문제 피드백 데이터 타입
 */
export interface QuestionFeedback {
  /** 문제 ID */
  questionId: string;
  /** 피드백 내용 */
  feedback: string;
}

/**
 * FeedbackForm Props 타입
 */
interface FeedbackFormProps {
  /** 퀴즈 결과 (문제 + 사용자 답변) */
  results: QuestionResult[];
  /** 제출 핸들러 */
  onSubmit: (feedbacks: QuestionFeedback[]) => void;
  /** 건너뛰기 핸들러 */
  onSkip: () => void;
  /** 제출 중 여부 */
  isSubmitting?: boolean;
  /** 피드백 보상 골드 */
  rewardGold?: number;
  /** 추가 클래스명 */
  className?: string;
}

/**
 * 개별 문제 피드백 입력 컴포넌트
 */
function QuestionFeedbackItem({
  result,
  feedback,
  onFeedbackChange,
}: {
  result: QuestionResult;
  feedback: string;
  onFeedbackChange: (value: string) => void;
}) {
  // 정답/오답 스타일
  const statusIcon = result.isCorrect ? '✅' : '❌';
  const statusBg = result.isCorrect ? 'bg-green-50' : 'bg-red-50';
  const statusBorder = result.isCorrect ? 'border-green-200' : 'border-red-200';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-2xl border ${statusBorder} ${statusBg} p-4`}
    >
      {/* 문제 헤더 */}
      <div className="flex items-start gap-3 mb-3">
        <span className="text-xl flex-shrink-0">{statusIcon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-700 mb-1">
            Q{result.number}
          </p>
          <p className="text-sm text-gray-800 leading-relaxed">
            {result.question}
          </p>
        </div>
      </div>

      {/* 선택지 (객관식인 경우) */}
      {result.type === 'multiple' && result.options && (
        <div className="mb-3 pl-8">
          <div className="space-y-1">
            {result.options.map((option, index) => {
              const optionNumber = (index + 1).toString();
              const isCorrectOption = result.correctAnswer === optionNumber;
              const isUserChoice = result.userAnswer === optionNumber;

              return (
                <div
                  key={index}
                  className={`
                    text-xs p-2 rounded-lg flex items-center gap-2
                    ${isCorrectOption ? 'bg-green-100/50 text-green-800 font-medium' : ''}
                    ${isUserChoice && !isCorrectOption ? 'bg-red-100/50 text-red-800' : ''}
                    ${!isCorrectOption && !isUserChoice ? 'text-gray-600' : ''}
                  `}
                >
                  <span>{index + 1}.</span>
                  <span>{option}</span>
                  {isCorrectOption && <span className="ml-auto">정답</span>}
                  {isUserChoice && !isCorrectOption && <span className="ml-auto">내 선택</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* OX 또는 주관식 답변 표시 */}
      {(result.type === 'ox' || result.type === 'short') && (
        <div className="mb-3 pl-8 flex gap-4 text-xs">
          <div>
            <span className="text-gray-500">정답: </span>
            <span className="font-medium text-green-700">{result.correctAnswer}</span>
          </div>
          <div>
            <span className="text-gray-500">내 답변: </span>
            <span className={`font-medium ${result.isCorrect ? 'text-green-700' : 'text-red-700'}`}>
              {result.userAnswer || '(미입력)'}
            </span>
          </div>
        </div>
      )}

      {/* 해설 */}
      {result.explanation && (
        <div className="mb-3 pl-8">
          <div className="text-xs bg-yellow-50 border border-yellow-100 rounded-lg p-2">
            <span className="text-gray-500 mr-1">해설:</span>
            <span className="text-gray-700">{result.explanation}</span>
          </div>
        </div>
      )}

      {/* 피드백 입력 */}
      <div className="pl-8">
        <label className="text-xs font-medium text-gray-600 mb-1 block">
          이 문제에 대한 피드백 (선택)
        </label>
        <textarea
          value={feedback}
          onChange={(e) => onFeedbackChange(e.target.value)}
          placeholder="문제에 오류가 있거나 개선점이 있다면 알려주세요..."
          className="
            w-full px-3 py-2 text-sm
            bg-white/80 border border-gray-200 rounded-xl
            placeholder:text-gray-400
            focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300
            resize-none transition-all
          "
          rows={2}
        />
      </div>
    </motion.div>
  );
}

/**
 * 피드백 폼 컴포넌트
 *
 * 퀴즈의 각 문제에 대한 피드백을 입력받습니다.
 * 모든 필드는 선택사항이며, 빈 칸으로도 제출할 수 있습니다.
 *
 * @example
 * ```tsx
 * <FeedbackForm
 *   results={questionResults}
 *   onSubmit={handleFeedbackSubmit}
 *   onSkip={() => router.push('/')}
 *   rewardGold={15}
 * />
 * ```
 */
export default function FeedbackForm({
  results,
  onSubmit,
  onSkip,
  isSubmitting = false,
  rewardGold = 15,
  className = '',
}: FeedbackFormProps) {
  // 각 문제별 피드백 상태
  const [feedbacks, setFeedbacks] = useState<Record<string, string>>(
    results.reduce((acc, r) => ({ ...acc, [r.id]: '' }), {})
  );

  // 피드백 변경 핸들러
  const handleFeedbackChange = (questionId: string, value: string) => {
    setFeedbacks((prev) => ({
      ...prev,
      [questionId]: value,
    }));
  };

  // 제출 핸들러
  const handleSubmit = () => {
    const feedbackList: QuestionFeedback[] = Object.entries(feedbacks)
      .filter(([_, feedback]) => feedback.trim() !== '')
      .map(([questionId, feedback]) => ({
        questionId,
        feedback: feedback.trim(),
      }));

    onSubmit(feedbackList);
  };

  // 피드백이 하나라도 입력되었는지 확인
  const hasFeedback = Object.values(feedbacks).some((f) => f.trim() !== '');

  return (
    <div className={className}>
      {/* 안내 문구 */}
      <div className="mb-6 text-center">
        <h2 className="text-lg font-bold text-gray-900 mb-2">
          문제에 대한 의견을 남겨주세요
        </h2>
        <p className="text-sm text-gray-500">
          오류나 개선점을 알려주시면 더 좋은 퀴즈를 만들 수 있어요.
          <br />
          모든 항목은 선택사항입니다.
        </p>
      </div>

      {/* 문제별 피드백 입력 */}
      <div className="space-y-4 mb-6">
        {results.map((result, index) => (
          <QuestionFeedbackItem
            key={result.id}
            result={{ ...result, number: index + 1 }}
            feedback={feedbacks[result.id] || ''}
            onFeedbackChange={(value) => handleFeedbackChange(result.id, value)}
          />
        ))}
      </div>

      {/* 버튼 영역 */}
      <div className="flex gap-3">
        {/* Skip 버튼 */}
        <motion.button
          onClick={onSkip}
          disabled={isSubmitting}
          whileHover={{ scale: isSubmitting ? 1 : 1.02 }}
          whileTap={{ scale: isSubmitting ? 1 : 0.98 }}
          className="
            flex-1 py-3.5 px-6 rounded-2xl
            bg-gray-100 text-gray-700 font-medium
            transition-colors
            hover:bg-gray-200
            disabled:opacity-50 disabled:cursor-not-allowed
          "
        >
          Skip
        </motion.button>

        {/* 완료 버튼 */}
        <motion.button
          onClick={handleSubmit}
          disabled={isSubmitting}
          whileHover={{ scale: isSubmitting ? 1 : 1.02 }}
          whileTap={{ scale: isSubmitting ? 1 : 0.98 }}
          className="
            relative overflow-hidden
            flex-[2] flex items-center justify-center gap-2
            py-3.5 px-6 rounded-2xl
            bg-gradient-to-r from-indigo-500 to-purple-600
            text-white font-bold
            shadow-lg shadow-indigo-500/30
            disabled:opacity-50 disabled:cursor-not-allowed
          "
        >
          {/* 로딩 스피너 */}
          {isSubmitting ? (
            <motion.div
              className="w-5 h-5 border-2 border-white border-t-transparent rounded-full"
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            />
          ) : (
            <>
              <span>완료</span>
              <span className="flex items-center gap-1 bg-white/20 px-2 py-0.5 rounded-full text-sm">
                <span>💰</span>
                <span>+{rewardGold}</span>
              </span>
            </>
          )}
        </motion.button>
      </div>

      {/* 안내 문구 */}
      {!hasFeedback && (
        <p className="text-center text-xs text-gray-400 mt-3">
          피드백 없이도 완료 버튼을 누르면 보상을 받을 수 있어요!
        </p>
      )}
    </div>
  );
}
