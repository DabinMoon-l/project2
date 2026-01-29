'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ReviewItem } from '@/lib/hooks/useReview';

interface ReviewQuestionCardProps {
  /** 복습 문제 데이터 */
  item: ReviewItem;
  /** 삭제 핸들러 */
  onDelete?: (id: string) => void;
  /** 연습 시작 핸들러 */
  onPractice?: (item: ReviewItem) => void;
  /** 추가 클래스명 */
  className?: string;
}

// 문제 유형별 라벨
const typeLabels: Record<'ox' | 'multiple' | 'short', string> = {
  ox: 'OX',
  multiple: '객관식',
  short: '주관식',
};

/**
 * 복습 문제 카드 컴포넌트
 *
 * 복습 화면에서 개별 문제를 표시하는 카드입니다.
 * 퀴즈명, 문제 내용, 정답, 내 답, 해설을 확장하여 볼 수 있습니다.
 *
 * @example
 * ```tsx
 * <ReviewQuestionCard
 *   item={reviewItem}
 *   onDelete={handleDelete}
 *   onPractice={handlePractice}
 * />
 * ```
 */
export default function ReviewQuestionCard({
  item,
  onDelete,
  onPractice,
  className = '',
}: ReviewQuestionCardProps) {
  // 확장 상태
  const [isExpanded, setIsExpanded] = useState(false);
  // 삭제 확인 상태
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // 복습 횟수에 따른 배지 색상
  const getReviewBadgeStyle = () => {
    if (item.reviewCount === 0) return 'bg-red-100 text-red-700';
    if (item.reviewCount < 3) return 'bg-yellow-100 text-yellow-700';
    return 'bg-green-100 text-green-700';
  };

  // 삭제 처리
  const handleDelete = () => {
    onDelete?.(item.id);
    setShowDeleteConfirm(false);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10, height: 0 }}
      transition={{ duration: 0.2 }}
      className={`bg-white rounded-2xl shadow-sm overflow-hidden ${className}`}
    >
      {/* 카드 헤더 (클릭으로 확장/축소) */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-4 text-left"
      >
        <div className="flex items-start gap-3">
          {/* 문제 유형 배지 */}
          <span className="flex-shrink-0 px-2 py-1 bg-gray-100 text-gray-600 text-xs font-medium rounded-lg">
            {typeLabels[item.type]}
          </span>

          {/* 문제 내용 미리보기 */}
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-800 font-medium line-clamp-2">
              {item.question}
            </p>

            {/* 복습 정보 */}
            <div className="flex items-center gap-2 mt-2">
              <span className={`text-xs px-2 py-0.5 rounded-full ${getReviewBadgeStyle()}`}>
                복습 {item.reviewCount}회
              </span>
              {item.reviewType === 'wrong' && (
                <span className="text-xs text-gray-500">
                  오답
                </span>
              )}
              {item.reviewType === 'bookmark' && (
                <span className="text-xs text-gray-500">
                  찜
                </span>
              )}
            </div>
          </div>

          {/* 확장 아이콘 */}
          <motion.div
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            className="flex-shrink-0 text-gray-400"
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

      {/* 확장 영역 */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-4">
              {/* 구분선 */}
              <div className="border-t border-gray-100" />

              {/* 문제 전체 내용 */}
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-1">문제</p>
                <p className="text-sm text-gray-800 bg-gray-50 p-3 rounded-xl whitespace-pre-wrap">
                  {item.question}
                </p>
              </div>

              {/* 객관식 선지 */}
              {item.type === 'multiple' && item.options && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1">선택지</p>
                  <div className="space-y-1">
                    {item.options.map((option, index) => {
                      const optionNumber = (index + 1).toString();
                      const isCorrectOption = item.correctAnswer === optionNumber;
                      const isUserChoice = item.userAnswer === optionNumber;

                      return (
                        <div
                          key={index}
                          className={`
                            text-sm p-2 rounded-lg flex items-center gap-2
                            ${isCorrectOption ? 'bg-green-50 text-green-800 border border-green-200' : ''}
                            ${isUserChoice && !isCorrectOption ? 'bg-red-50 text-red-800 border border-red-200' : ''}
                            ${!isCorrectOption && !isUserChoice ? 'bg-gray-50 text-gray-700' : ''}
                          `}
                        >
                          <span className="font-medium w-5">{index + 1}.</span>
                          <span className="flex-1">{option}</span>
                          {isCorrectOption && (
                            <span className="text-green-600 text-xs font-semibold">정답</span>
                          )}
                          {isUserChoice && !isCorrectOption && (
                            <span className="text-red-600 text-xs font-semibold">내 선택</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* OX/주관식 정답 비교 */}
              {(item.type === 'ox' || item.type === 'short') && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs font-semibold text-gray-500 mb-1">정답</p>
                    <p className="text-sm bg-green-50 text-green-800 p-3 rounded-xl border border-green-200">
                      {item.correctAnswer}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-500 mb-1">내 답변</p>
                    <p className="text-sm bg-red-50 text-red-800 p-3 rounded-xl border border-red-200">
                      {item.userAnswer || '(미입력)'}
                    </p>
                  </div>
                </div>
              )}

              {/* 해설 */}
              {item.explanation && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1">해설</p>
                  <p className="text-sm text-gray-700 bg-yellow-50 p-3 rounded-xl border border-yellow-100 whitespace-pre-wrap">
                    {item.explanation}
                  </p>
                </div>
              )}

              {/* 액션 버튼 */}
              <div className="flex gap-2 pt-2">
                {/* 연습하기 버튼 */}
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => onPractice?.(item)}
                  className="flex-1 py-2.5 bg-theme-accent text-white text-sm font-medium rounded-xl"
                >
                  풀어보기
                </motion.button>

                {/* 삭제 버튼 */}
                {!showDeleteConfirm ? (
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setShowDeleteConfirm(true)}
                    className="px-4 py-2.5 bg-gray-100 text-gray-600 text-sm font-medium rounded-xl"
                  >
                    삭제
                  </motion.button>
                ) : (
                  <div className="flex gap-1">
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      onClick={handleDelete}
                      className="px-3 py-2.5 bg-red-500 text-white text-sm font-medium rounded-xl"
                    >
                      확인
                    </motion.button>
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      onClick={() => setShowDeleteConfirm(false)}
                      className="px-3 py-2.5 bg-gray-200 text-gray-700 text-sm font-medium rounded-xl"
                    >
                      취소
                    </motion.button>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
