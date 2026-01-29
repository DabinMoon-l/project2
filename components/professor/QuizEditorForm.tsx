'use client';

import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Input } from '@/components/common';
import TargetClassSelector from './TargetClassSelector';
import type { TargetClass, Difficulty } from '@/lib/hooks/useProfessorQuiz';

// ============================================================
// 타입 정의
// ============================================================

/** 퀴즈 메타 데이터 */
export interface QuizMetaData {
  title: string;
  description: string;
  targetClass: TargetClass;
  difficulty: Difficulty;
}

interface QuizEditorFormProps {
  /** 현재 메타 데이터 */
  data: QuizMetaData;
  /** 데이터 변경 시 콜백 */
  onChange: (data: QuizMetaData) => void;
  /** 유효성 검사 에러 */
  errors?: {
    title?: string;
    description?: string;
  };
  /** 비활성화 여부 */
  disabled?: boolean;
  /** 추가 클래스명 */
  className?: string;
}

// ============================================================
// 상수
// ============================================================

/** 난이도 옵션 */
const DIFFICULTY_OPTIONS: { value: Difficulty; label: string; color: string; description: string }[] = [
  {
    value: 'easy',
    label: '쉬움',
    color: 'bg-green-500',
    description: '기초적인 개념 확인',
  },
  {
    value: 'normal',
    label: '보통',
    color: 'bg-yellow-500',
    description: '일반적인 난이도',
  },
  {
    value: 'hard',
    label: '어려움',
    color: 'bg-red-500',
    description: '심화 문제',
  },
];

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 퀴즈 메타정보 폼 컴포넌트
 *
 * 퀴즈 제목, 설명, 대상 반, 난이도를 입력할 수 있는 폼입니다.
 *
 * @example
 * ```tsx
 * <QuizEditorForm
 *   data={quizMeta}
 *   onChange={setQuizMeta}
 *   errors={errors}
 * />
 * ```
 */
export default function QuizEditorForm({
  data,
  onChange,
  errors = {},
  disabled = false,
  className = '',
}: QuizEditorFormProps) {
  /**
   * 제목 변경 핸들러
   */
  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange({ ...data, title: e.target.value });
    },
    [data, onChange]
  );

  /**
   * 설명 변경 핸들러
   */
  const handleDescriptionChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange({ ...data, description: e.target.value });
    },
    [data, onChange]
  );

  /**
   * 대상 반 변경 핸들러
   */
  const handleTargetClassChange = useCallback(
    (targetClass: TargetClass) => {
      onChange({ ...data, targetClass });
    },
    [data, onChange]
  );

  /**
   * 난이도 변경 핸들러
   */
  const handleDifficultyChange = useCallback(
    (difficulty: Difficulty) => {
      onChange({ ...data, difficulty });
    },
    [data, onChange]
  );

  return (
    <div className={`space-y-6 ${className}`}>
      {/* 퀴즈 제목 */}
      <div>
        <Input
          label="퀴즈 제목"
          value={data.title}
          onChange={handleTitleChange}
          placeholder="예: 중간고사 대비 퀴즈"
          error={errors.title}
          disabled={disabled}
          helperText="학생들이 퀴즈를 찾을 때 도움이 되는 제목을 입력하세요."
        />
      </div>

      {/* 퀴즈 설명 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          설명 <span className="text-gray-400">(선택)</span>
        </label>
        <textarea
          value={data.description}
          onChange={handleDescriptionChange}
          placeholder="퀴즈에 대한 간단한 설명을 입력하세요 (선택사항)"
          rows={3}
          disabled={disabled}
          className={`
            w-full px-4 py-3 rounded-xl border
            resize-none
            transition-colors duration-200
            focus:outline-none focus:ring-2 focus:ring-indigo-500/20
            disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed
            ${
              errors.description
                ? 'border-red-300 focus:border-red-500'
                : 'border-gray-200 focus:border-indigo-500'
            }
          `}
        />
        {errors.description && (
          <p className="mt-1 text-sm text-red-500">{errors.description}</p>
        )}
      </div>

      {/* 대상 반 선택 */}
      <TargetClassSelector
        value={data.targetClass}
        onChange={handleTargetClassChange}
        disabled={disabled}
      />

      {/* 난이도 선택 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          난이도
        </label>
        <div className="grid grid-cols-3 gap-3">
          {DIFFICULTY_OPTIONS.map((option) => {
            const isSelected = data.difficulty === option.value;

            return (
              <motion.button
                key={option.value}
                type="button"
                whileHover={!disabled ? { scale: 1.02 } : undefined}
                whileTap={!disabled ? { scale: 0.98 } : undefined}
                onClick={() => !disabled && handleDifficultyChange(option.value)}
                disabled={disabled}
                className={`
                  relative p-3 rounded-xl border-2
                  transition-all duration-200
                  disabled:opacity-50 disabled:cursor-not-allowed
                  ${
                    isSelected
                      ? 'border-indigo-500 bg-indigo-50'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }
                `}
              >
                {/* 난이도 인디케이터 */}
                <div className="flex justify-center mb-2">
                  <div className="flex gap-1">
                    {[1, 2, 3].map((level) => (
                      <div
                        key={level}
                        className={`
                          w-2 h-2 rounded-full
                          ${
                            level <= (option.value === 'easy' ? 1 : option.value === 'normal' ? 2 : 3)
                              ? option.color
                              : 'bg-gray-200'
                          }
                        `}
                      />
                    ))}
                  </div>
                </div>

                {/* 라벨 */}
                <p
                  className={`
                    text-sm font-medium text-center
                    ${isSelected ? 'text-indigo-700' : 'text-gray-700'}
                  `}
                >
                  {option.label}
                </p>

                {/* 설명 */}
                <p className="text-xs text-gray-500 text-center mt-0.5">
                  {option.description}
                </p>

                {/* 선택 체크 표시 */}
                {isSelected && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-indigo-500 rounded-full flex items-center justify-center"
                  >
                    <svg
                      className="w-3 h-3 text-white"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </motion.div>
                )}
              </motion.button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
