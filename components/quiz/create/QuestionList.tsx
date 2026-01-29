'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import type { QuestionData } from './QuestionEditor';

// ============================================================
// 타입 정의
// ============================================================

interface QuestionListProps {
  /** 문제 목록 */
  questions: QuestionData[];
  /** 문제 목록 변경 시 콜백 */
  onQuestionsChange: (questions: QuestionData[]) => void;
  /** 문제 편집 시 콜백 */
  onEditQuestion: (index: number) => void;
  /** 추가 클래스명 */
  className?: string;
}

// ============================================================
// 유틸리티
// ============================================================

/**
 * 문제 유형 라벨
 */
const typeLabels = {
  ox: 'OX',
  multiple: '객관식',
  subjective: '주관식',
};

/**
 * 문제 유형 색상
 */
const typeColors = {
  ox: 'bg-blue-100 text-blue-700',
  multiple: 'bg-purple-100 text-purple-700',
  subjective: 'bg-green-100 text-green-700',
};

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 문제 목록 컴포넌트
 *
 * 추가된 문제들을 리스트로 표시하고,
 * 드래그로 순서 변경, 편집, 삭제 기능을 제공합니다.
 */
export default function QuestionList({
  questions,
  onQuestionsChange,
  onEditQuestion,
  className = '',
}: QuestionListProps) {
  // 삭제 확인 모달 상태
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);

  /**
   * 문제 삭제
   */
  const handleDelete = useCallback(
    (index: number) => {
      const newQuestions = questions.filter((_, i) => i !== index);
      onQuestionsChange(newQuestions);
      setDeleteIndex(null);
    },
    [questions, onQuestionsChange]
  );

  /**
   * 문제 순서 변경 (드래그 앤 드롭)
   */
  const handleReorder = useCallback(
    (newOrder: QuestionData[]) => {
      onQuestionsChange(newOrder);
    },
    [onQuestionsChange]
  );

  // 문제가 없는 경우
  if (questions.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className={`
          flex flex-col items-center justify-center
          py-12 px-6
          bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200
          ${className}
        `}
      >
        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
          <svg
            className="w-8 h-8 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
            />
          </svg>
        </div>
        <p className="text-gray-500 text-center">
          아직 추가된 문제가 없습니다.
          <br />
          <span className="text-sm">
            OCR로 추출하거나 직접 문제를 추가해주세요.
          </span>
        </p>
      </motion.div>
    );
  }

  return (
    <div className={className}>
      {/* 목록 헤더 */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-gray-800">
          문제 목록
          <span className="ml-2 text-sm font-normal text-gray-500">
            ({questions.length}개)
          </span>
        </h3>
        <p className="text-xs text-gray-400">드래그하여 순서 변경</p>
      </div>

      {/* 문제 목록 (드래그 가능) */}
      <Reorder.Group
        axis="y"
        values={questions}
        onReorder={handleReorder}
        className="space-y-3"
      >
        <AnimatePresence>
          {questions.map((question, index) => (
            <Reorder.Item
              key={question.id}
              value={question}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -100 }}
              whileDrag={{ scale: 1.02, boxShadow: '0 10px 30px rgba(0,0,0,0.15)' }}
              className="relative"
            >
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 cursor-grab active:cursor-grabbing">
                {/* 드래그 핸들 */}
                <div className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-300">
                  <svg
                    className="w-5 h-5"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
                  </svg>
                </div>

                {/* 문제 내용 */}
                <div className="ml-6">
                  {/* 상단: 번호, 유형, 액션 버튼 */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {/* 문제 번호 */}
                      <span className="w-7 h-7 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-sm font-bold">
                        {index + 1}
                      </span>

                      {/* 문제 유형 뱃지 */}
                      <span
                        className={`
                          px-2 py-0.5 rounded-full text-xs font-medium
                          ${typeColors[question.type]}
                        `}
                      >
                        {typeLabels[question.type]}
                      </span>
                    </div>

                    {/* 액션 버튼 */}
                    <div className="flex items-center gap-1">
                      {/* 편집 버튼 */}
                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditQuestion(index);
                        }}
                        className="p-2 text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 rounded-lg transition-colors"
                        aria-label="문제 편집"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                          />
                        </svg>
                      </motion.button>

                      {/* 삭제 버튼 */}
                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteIndex(index);
                        }}
                        className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        aria-label="문제 삭제"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </motion.button>
                    </div>
                  </div>

                  {/* 문제 텍스트 */}
                  <p className="text-gray-700 text-sm line-clamp-2 mb-2">
                    {question.text}
                  </p>

                  {/* 정답 미리보기 */}
                  <div className="text-xs text-gray-500">
                    정답:{' '}
                    <span className="text-green-600 font-medium">
                      {question.type === 'ox'
                        ? question.answerIndex === 0
                          ? 'O'
                          : 'X'
                        : question.type === 'multiple'
                          ? question.answerIndex >= 0
                            ? `${question.answerIndex + 1}번`
                            : '미선택'
                          : question.answerText || '미입력'}
                    </span>
                    {question.explanation && (
                      <span className="ml-2 text-gray-400">| 해설 있음</span>
                    )}
                  </div>
                </div>
              </div>
            </Reorder.Item>
          ))}
        </AnimatePresence>
      </Reorder.Group>

      {/* 삭제 확인 모달 */}
      <AnimatePresence>
        {deleteIndex !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            {/* 백드롭 */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDeleteIndex(null)}
              className="absolute inset-0 bg-black/50"
            />

            {/* 모달 */}
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl"
            >
              <div className="text-center">
                {/* 아이콘 */}
                <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg
                    className="w-6 h-6 text-red-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                </div>

                {/* 제목 */}
                <h3 className="text-lg font-bold text-gray-800 mb-2">
                  문제를 삭제할까요?
                </h3>

                {/* 설명 */}
                <p className="text-sm text-gray-500 mb-6">
                  문제 {deleteIndex + 1}번이 삭제됩니다.
                  <br />이 작업은 되돌릴 수 없습니다.
                </p>

                {/* 버튼 */}
                <div className="flex gap-3">
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setDeleteIndex(null)}
                    className="flex-1 py-2.5 px-4 rounded-xl bg-gray-100 text-gray-600 font-medium hover:bg-gray-200 transition-colors"
                  >
                    취소
                  </motion.button>
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleDelete(deleteIndex)}
                    className="flex-1 py-2.5 px-4 rounded-xl bg-red-500 text-white font-medium hover:bg-red-600 transition-colors"
                  >
                    삭제
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 최소 문제 수 안내 */}
      {questions.length < 3 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 p-3 bg-amber-50 rounded-xl flex items-center gap-2"
        >
          <svg
            className="w-5 h-5 text-amber-500 flex-shrink-0"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          <span className="text-sm text-amber-700">
            최소 3문제 이상 필요합니다. (현재 {questions.length}개)
          </span>
        </motion.div>
      )}
    </div>
  );
}
