'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * 문제 결과 데이터 타입
 */
export interface QuestionResult {
  /** 문제 ID */
  id: string;
  /** 문제 번호 (1부터 시작) */
  number: number;
  /** 문제 내용 */
  question: string;
  /** 문제 유형 */
  type: 'ox' | 'multiple' | 'short';
  /** 선택지 (객관식인 경우) */
  options?: string[];
  /** 정답 */
  correctAnswer: string;
  /** 사용자 답변 */
  userAnswer: string;
  /** 정답 여부 */
  isCorrect: boolean;
  /** 해설 */
  explanation?: string;
  /** 찜 여부 */
  isBookmarked?: boolean;
}

/**
 * QuestionResultList Props 타입
 */
interface QuestionResultListProps {
  /** 문제 결과 목록 */
  results: QuestionResult[];
  /** 찜하기 토글 핸들러 */
  onToggleBookmark?: (questionId: string) => void;
  /** 추가 클래스명 */
  className?: string;
}

/**
 * 개별 문제 결과 아이템 컴포넌트
 */
function QuestionResultItem({
  result,
  onToggleBookmark,
}: {
  result: QuestionResult;
  onToggleBookmark?: (questionId: string) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  // 정답/오답 스타일
  const statusStyles = result.isCorrect
    ? {
        bg: 'bg-green-50',
        border: 'border-green-200',
        icon: '✅',
        iconBg: 'bg-green-500',
      }
    : {
        bg: 'bg-red-50',
        border: 'border-red-200',
        icon: '❌',
        iconBg: 'bg-red-500',
      };

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      className={`
        rounded-2xl border overflow-hidden
        ${statusStyles.bg} ${statusStyles.border}
      `}
    >
      {/* 문제 헤더 (클릭 가능) */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 text-left"
      >
        <div className="flex items-center gap-3">
          {/* 정답/오답 아이콘 */}
          <div className="flex-shrink-0 text-xl">
            {statusStyles.icon}
          </div>

          {/* 문제 번호 및 내용 미리보기 */}
          <div className="min-w-0">
            <span className="text-sm font-bold text-gray-700">
              Q{result.number}
            </span>
            <p className="text-sm text-gray-600 truncate max-w-[200px]">
              {result.question}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* 찜하기 버튼 */}
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={(e) => {
              e.stopPropagation();
              onToggleBookmark?.(result.id);
            }}
            className="p-2 rounded-full hover:bg-white/50 transition-colors"
            aria-label={result.isBookmarked ? '찜 해제' : '찜하기'}
          >
            <span className="text-lg">
              {result.isBookmarked ? '📚' : '📖'}
            </span>
          </motion.button>

          {/* 확장 아이콘 */}
          <motion.div
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            className="text-gray-400"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </motion.div>
        </div>
      </button>

      {/* 확장 영역 (해설) */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-3">
              {/* 구분선 */}
              <div className="border-t border-gray-200/50" />

              {/* 문제 전체 내용 */}
              <div>
                <p className="text-sm font-medium text-gray-700 mb-1">문제</p>
                <p className="text-sm text-gray-800 bg-white/50 p-3 rounded-xl">
                  {result.question}
                </p>
              </div>

              {/* 객관식 선택지 */}
              {result.type === 'multiple' && result.options && (
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-1">선택지</p>
                  <div className="space-y-1">
                    {result.options.map((option, index) => {
                      const optionNumber = (index + 1).toString();
                      const isCorrectOption = result.correctAnswer === optionNumber;
                      const isUserChoice = result.userAnswer === optionNumber;

                      return (
                        <div
                          key={index}
                          className={`
                            text-sm p-2 rounded-lg flex items-center gap-2
                            ${isCorrectOption ? 'bg-green-100 text-green-800' : ''}
                            ${isUserChoice && !isCorrectOption ? 'bg-red-100 text-red-800' : ''}
                            ${!isCorrectOption && !isUserChoice ? 'bg-white/50 text-gray-700' : ''}
                          `}
                        >
                          <span className="font-medium">{index + 1}.</span>
                          <span>{option}</span>
                          {isCorrectOption && (
                            <span className="ml-auto text-green-600 font-medium">정답</span>
                          )}
                          {isUserChoice && !isCorrectOption && (
                            <span className="ml-auto text-red-600 font-medium">내 선택</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* OX 문제 답변 */}
              {result.type === 'ox' && (
                <div className="flex gap-4">
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-1">정답</p>
                    <span className={`
                      inline-block px-3 py-1 rounded-full text-sm font-medium
                      ${result.correctAnswer === 'O' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'}
                    `}>
                      {result.correctAnswer}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-1">내 답변</p>
                    <span className={`
                      inline-block px-3 py-1 rounded-full text-sm font-medium
                      ${result.isCorrect ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}
                    `}>
                      {result.userAnswer}
                    </span>
                  </div>
                </div>
              )}

              {/* 주관식 답변 */}
              {result.type === 'short' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-1">정답</p>
                    <p className="text-sm bg-green-100 text-green-800 p-2 rounded-lg">
                      {result.correctAnswer}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-1">내 답변</p>
                    <p className={`
                      text-sm p-2 rounded-lg
                      ${result.isCorrect ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}
                    `}>
                      {result.userAnswer || '(미입력)'}
                    </p>
                  </div>
                </div>
              )}

              {/* 해설 */}
              {result.explanation && (
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-1">해설</p>
                  <p className="text-sm text-gray-700 bg-yellow-50 p-3 rounded-xl border border-yellow-100">
                    {result.explanation}
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/**
 * 문제별 결과 리스트 컴포넌트
 *
 * 퀴즈 결과에서 각 문제의 정답/오답 여부를 보여줍니다.
 * 문제를 클릭하면 해설이 펼쳐집니다.
 *
 * @example
 * ```tsx
 * <QuestionResultList
 *   results={questionResults}
 *   onToggleBookmark={handleBookmark}
 * />
 * ```
 */
export default function QuestionResultList({
  results,
  onToggleBookmark,
  className = '',
}: QuestionResultListProps) {
  // 정답/오답 통계
  const correctCount = results.filter((r) => r.isCorrect).length;
  const incorrectCount = results.length - correctCount;

  return (
    <div className={className}>
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <span className="text-xl">📋</span>
          문제별 결과
        </h2>

        {/* 정답/오답 카운트 */}
        <div className="flex items-center gap-2 text-sm">
          <span className="text-green-600 font-medium">
            ✅ {correctCount}
          </span>
          <span className="text-gray-400">|</span>
          <span className="text-red-600 font-medium">
            ❌ {incorrectCount}
          </span>
        </div>
      </div>

      {/* 결과 리스트 */}
      <div className="space-y-3">
        {results.map((result, index) => (
          <QuestionResultItem
            key={result.id}
            result={{ ...result, number: index + 1 }}
            onToggleBookmark={onToggleBookmark}
          />
        ))}
      </div>
    </div>
  );
}
