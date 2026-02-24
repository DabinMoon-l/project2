'use client';

/**
 * QuestionPreview 컴포넌트
 *
 * 단일 문제의 미리보기를 표시하는 컴포넌트입니다.
 */

import { motion } from 'framer-motion';
import type { QuestionData } from './QuestionEditor';

// ============================================================
// 타입 정의
// ============================================================

interface QuestionPreviewProps {
  /** 문제 데이터 */
  question: QuestionData;
  /** 문제 번호 */
  index: number;
  /** 편집 버튼 클릭 시 콜백 */
  onEdit?: () => void;
  /** 삭제 버튼 클릭 시 콜백 */
  onDelete?: () => void;
  /** 간략 모드 (최소 정보만 표시) */
  compact?: boolean;
  /** 추가 클래스명 */
  className?: string;
}

// ============================================================
// 유틸리티
// ============================================================

/**
 * 문제 유형 라벨
 */
const typeLabels: Record<string, string> = {
  ox: 'OX',
  multiple: '객관식',
  subjective: '주관식',
  short_answer: '주관식',
  essay: '서술형',
  combined: '결합형',
};

/**
 * 문제 유형 색상
 */
const typeColors: Record<string, string> = {
  ox: 'bg-blue-100 text-blue-700',
  multiple: 'bg-purple-100 text-purple-700',
  subjective: 'bg-green-100 text-green-700',
  short_answer: 'bg-green-100 text-green-700',
  essay: 'bg-orange-100 text-orange-700',
  combined: 'bg-red-100 text-red-700',
};

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 문제 미리보기 컴포넌트
 */
export default function QuestionPreview({
  question,
  index,
  onEdit,
  onDelete,
  compact = false,
  className = '',
}: QuestionPreviewProps) {
  /**
   * 정답 텍스트 생성
   */
  const getAnswerText = () => {
    switch (question.type) {
      case 'ox':
        return question.answerIndex === 0 ? 'O' : question.answerIndex === 1 ? 'X' : '미선택';
      case 'multiple':
        if (question.answerIndex >= 0 && question.answerIndex < question.choices.length) {
          return `${question.answerIndex + 1}번: ${question.choices[question.answerIndex]}`;
        }
        return '미선택';
      case 'subjective':
        return question.answerText || '미입력';
      default:
        return '미설정';
    }
  };

  // 간략 모드
  if (compact) {
    return (
      <div
        className={`
          flex items-start gap-2 p-2 bg-gray-50 rounded-lg
          ${className}
        `}
      >
        <span className="w-6 h-6 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">
          {index + 1}
        </span>
        <p className="text-sm text-gray-700 line-clamp-1 flex-1">
          {question.text}
        </p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`
        bg-white rounded-2xl p-4 shadow-sm border border-gray-100
        ${className}
      `}
    >
      {/* 상단: 번호, 유형, 액션 버튼 */}
      <div className="flex items-center justify-between mb-3">
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
        {(onEdit || onDelete) && (
          <div className="flex items-center gap-1">
            {onEdit && (
              <motion.button
                type="button"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={onEdit}
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
            )}

            {onDelete && (
              <motion.button
                type="button"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={onDelete}
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
            )}
          </div>
        )}
      </div>

      {/* 문제 텍스트 */}
      <p className="text-gray-800 mb-3">{question.text}</p>

      {/* 객관식 선지 */}
      {question.type === 'multiple' && question.choices.filter(c => c.trim()).length > 0 && (
        <div className="space-y-1 mb-3">
          {question.choices.map((choice, i) => {
            if (!choice.trim()) return null;
            const isAnswer = i === question.answerIndex;
            return (
              <div
                key={i}
                className={`
                  flex items-center gap-2 p-2 rounded-lg text-sm
                  ${isAnswer ? 'bg-green-50 text-green-700 font-medium' : 'bg-gray-50 text-gray-600'}
                `}
              >
                <span
                  className={`
                    w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold
                    ${isAnswer ? 'bg-green-500 text-white' : 'bg-gray-300 text-white'}
                  `}
                >
                  {i + 1}
                </span>
                <span>{choice}</span>
                {isAnswer && (
                  <svg
                    className="w-4 h-4 ml-auto"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 정답 표시 (OX/주관식) */}
      {question.type !== 'multiple' && (
        <div className="mb-3">
          <span className="text-xs text-gray-500">정답: </span>
          <span className="text-sm text-green-600 font-medium">{getAnswerText()}</span>
        </div>
      )}

      {/* 해설 */}
      {question.explanation && (
        <div className="p-3 bg-blue-50 rounded-xl">
          <span className="text-xs text-blue-600 font-medium mb-1 block">해설</span>
          <p className="text-sm text-blue-700">{question.explanation}</p>
        </div>
      )}
    </motion.div>
  );
}
