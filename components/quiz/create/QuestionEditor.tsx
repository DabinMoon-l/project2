'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Input } from '@/components/common';
import type { QuestionType, ParsedQuestion } from '@/lib/ocr';

// ============================================================
// 타입 정의
// ============================================================

/**
 * 문제 데이터 타입
 */
export interface QuestionData {
  /** 고유 ID */
  id: string;
  /** 문제 텍스트 */
  text: string;
  /** 문제 유형 */
  type: QuestionType;
  /** 선지 (객관식) */
  choices: string[];
  /** 정답 인덱스 (OX: 0=O, 1=X / 객관식: 0~3 / 주관식: -1) */
  answerIndex: number;
  /** 정답 텍스트 (주관식) */
  answerText: string;
  /** 해설 */
  explanation: string;
}

interface QuestionEditorProps {
  /** 편집할 기존 문제 (새 문제 추가 시 undefined) */
  initialQuestion?: QuestionData | ParsedQuestion;
  /** 저장 시 콜백 */
  onSave: (question: QuestionData) => void;
  /** 취소 시 콜백 */
  onCancel: () => void;
  /** 문제 번호 (새 문제 추가용) */
  questionNumber: number;
  /** 추가 클래스명 */
  className?: string;
}

// ============================================================
// 유틸리티
// ============================================================

/**
 * 고유 ID 생성
 */
const generateId = (): string => {
  return `q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * 문제 유형 라벨
 */
const typeLabels: Record<QuestionType, string> = {
  ox: 'OX',
  multiple: '객관식',
  subjective: '주관식',
};

/**
 * ParsedQuestion을 QuestionData로 변환
 */
const convertParsedToData = (
  parsed: ParsedQuestion,
  questionNumber: number
): QuestionData => {
  let answerIndex = -1;
  let answerText = '';

  // 정답 처리
  if (parsed.answer !== undefined) {
    if (typeof parsed.answer === 'number') {
      answerIndex = parsed.answer;
    } else {
      const answerStr = String(parsed.answer).toLowerCase();
      if (parsed.type === 'ox') {
        answerIndex = answerStr === 'o' || answerStr === '참' || answerStr === 'true' ? 0 : 1;
      } else if (parsed.type === 'multiple') {
        // 선지 번호 매핑 (①②③④ 또는 1234 또는 abcd)
        const numMatch = answerStr.match(/[1-4①②③④]/);
        if (numMatch) {
          const charMap: Record<string, number> = {
            '1': 0, '2': 1, '3': 2, '4': 3,
            '①': 0, '②': 1, '③': 2, '④': 3,
          };
          answerIndex = charMap[numMatch[0]] ?? -1;
        }
      } else {
        answerText = parsed.answer;
      }
    }
  }

  return {
    id: generateId(),
    text: parsed.text,
    type: parsed.type,
    choices: parsed.choices || ['', '', '', ''],
    answerIndex,
    answerText,
    explanation: parsed.explanation || '',
  };
};

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 문제 편집기 컴포넌트
 *
 * 문제 텍스트, 유형, 선지, 정답, 해설을 입력/수정할 수 있습니다.
 */
export default function QuestionEditor({
  initialQuestion,
  onSave,
  onCancel,
  questionNumber,
  className = '',
}: QuestionEditorProps) {
  // 초기 상태 설정
  const getInitialData = (): QuestionData => {
    if (!initialQuestion) {
      // 새 문제
      return {
        id: generateId(),
        text: '',
        type: 'multiple',
        choices: ['', '', '', ''],
        answerIndex: -1,
        answerText: '',
        explanation: '',
      };
    }

    // 기존 QuestionData인 경우
    if ('id' in initialQuestion && 'answerIndex' in initialQuestion) {
      return initialQuestion as QuestionData;
    }

    // ParsedQuestion인 경우 변환
    return convertParsedToData(initialQuestion as ParsedQuestion, questionNumber);
  };

  // 상태
  const [question, setQuestion] = useState<QuestionData>(getInitialData);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // 초기 문제가 변경되면 상태 업데이트
  useEffect(() => {
    setQuestion(getInitialData());
    setErrors({});
  }, [initialQuestion]);

  /**
   * 문제 유형 변경
   */
  const handleTypeChange = useCallback((type: QuestionType) => {
    setQuestion((prev) => ({
      ...prev,
      type,
      // 유형 변경 시 정답 초기화
      answerIndex: -1,
      answerText: '',
      // 객관식이 아니면 선지 초기화
      choices: type === 'multiple' ? prev.choices : ['', '', '', ''],
    }));
    setErrors({});
  }, []);

  /**
   * 텍스트 필드 변경
   */
  const handleTextChange = useCallback((field: keyof QuestionData, value: string) => {
    setQuestion((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: '' }));
  }, []);

  /**
   * 선지 변경
   */
  const handleChoiceChange = useCallback((index: number, value: string) => {
    setQuestion((prev) => {
      const newChoices = [...prev.choices];
      newChoices[index] = value;
      return { ...prev, choices: newChoices };
    });
    setErrors((prev) => ({ ...prev, choices: '' }));
  }, []);

  /**
   * 정답 선택 (OX/객관식)
   */
  const handleAnswerSelect = useCallback((index: number) => {
    setQuestion((prev) => ({ ...prev, answerIndex: index }));
    setErrors((prev) => ({ ...prev, answer: '' }));
  }, []);

  /**
   * 유효성 검사
   */
  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    // 문제 텍스트 검사
    if (!question.text.trim()) {
      newErrors.text = '문제를 입력해주세요.';
    }

    // 정답 검사
    if (question.type === 'ox' || question.type === 'multiple') {
      if (question.answerIndex < 0) {
        newErrors.answer = '정답을 선택해주세요.';
      }
    } else if (question.type === 'subjective') {
      if (!question.answerText.trim()) {
        newErrors.answer = '정답을 입력해주세요.';
      }
    }

    // 객관식 선지 검사
    if (question.type === 'multiple') {
      const filledChoices = question.choices.filter((c) => c.trim()).length;
      if (filledChoices < 2) {
        newErrors.choices = '최소 2개 이상의 선지를 입력해주세요.';
      }
      if (question.answerIndex >= 0 && !question.choices[question.answerIndex]?.trim()) {
        newErrors.answer = '선택된 정답에 내용이 없습니다.';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  /**
   * 저장
   */
  const handleSave = () => {
    if (validate()) {
      onSave(question);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className={`bg-white rounded-2xl p-6 shadow-sm border border-gray-100 ${className}`}
    >
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-bold text-gray-800">
          문제 {questionNumber}
        </h3>
        <button
          type="button"
          onClick={onCancel}
          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      <div className="space-y-6">
        {/* 문제 유형 선택 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            문제 유형
          </label>
          <div className="flex gap-2">
            {(['ox', 'multiple', 'subjective'] as QuestionType[]).map((type) => (
              <motion.button
                key={type}
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => handleTypeChange(type)}
                className={`
                  flex-1 py-2.5 px-4 rounded-xl font-medium text-sm
                  transition-colors duration-200
                  ${
                    question.type === type
                      ? 'bg-indigo-500 text-white shadow-md'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }
                `}
              >
                {typeLabels[type]}
              </motion.button>
            ))}
          </div>
        </div>

        {/* 문제 텍스트 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            문제
          </label>
          <textarea
            value={question.text}
            onChange={(e) => handleTextChange('text', e.target.value)}
            placeholder="문제를 입력하세요"
            rows={3}
            className={`
              w-full px-4 py-3 rounded-xl border
              resize-none
              transition-colors duration-200
              focus:outline-none focus:ring-2 focus:ring-indigo-500/20
              ${
                errors.text
                  ? 'border-red-300 focus:border-red-500'
                  : 'border-gray-200 focus:border-indigo-500'
              }
            `}
          />
          {errors.text && (
            <p className="mt-1 text-sm text-red-500">{errors.text}</p>
          )}
        </div>

        {/* OX 선택지 */}
        <AnimatePresence mode="wait">
          {question.type === 'ox' && (
            <motion.div
              key="ox"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <label className="block text-sm font-medium text-gray-700 mb-2">
                정답 선택
              </label>
              <div className="flex gap-4">
                {['O', 'X'].map((option, index) => (
                  <motion.button
                    key={option}
                    type="button"
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => handleAnswerSelect(index)}
                    className={`
                      flex-1 py-4 rounded-2xl font-bold text-3xl
                      transition-all duration-200
                      ${
                        question.answerIndex === index
                          ? option === 'O'
                            ? 'bg-green-500 text-white shadow-lg'
                            : 'bg-red-500 text-white shadow-lg'
                          : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                      }
                    `}
                  >
                    {option}
                  </motion.button>
                ))}
              </div>
              {errors.answer && (
                <p className="mt-2 text-sm text-red-500">{errors.answer}</p>
              )}
            </motion.div>
          )}

          {/* 객관식 선지 */}
          {question.type === 'multiple' && (
            <motion.div
              key="multiple"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <label className="block text-sm font-medium text-gray-700 mb-2">
                선지 (정답 클릭)
              </label>
              <div className="space-y-2">
                {question.choices.map((choice, index) => (
                  <div key={index} className="flex items-center gap-2">
                    {/* 정답 체크 버튼 */}
                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => handleAnswerSelect(index)}
                      className={`
                        w-8 h-8 rounded-full flex items-center justify-center
                        text-sm font-bold
                        transition-all duration-200
                        ${
                          question.answerIndex === index
                            ? 'bg-green-500 text-white shadow-md'
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }
                      `}
                    >
                      {index + 1}
                    </motion.button>

                    {/* 선지 입력 */}
                    <input
                      type="text"
                      value={choice}
                      onChange={(e) => handleChoiceChange(index, e.target.value)}
                      placeholder={`선지 ${index + 1}`}
                      className={`
                        flex-1 px-4 py-2.5 rounded-xl border
                        transition-colors duration-200
                        focus:outline-none focus:ring-2 focus:ring-indigo-500/20
                        ${
                          question.answerIndex === index
                            ? 'border-green-300 bg-green-50 focus:border-green-500'
                            : 'border-gray-200 focus:border-indigo-500'
                        }
                      `}
                    />
                  </div>
                ))}
              </div>
              {errors.choices && (
                <p className="mt-2 text-sm text-red-500">{errors.choices}</p>
              )}
              {errors.answer && (
                <p className="mt-2 text-sm text-red-500">{errors.answer}</p>
              )}
            </motion.div>
          )}

          {/* 주관식 정답 */}
          {question.type === 'subjective' && (
            <motion.div
              key="subjective"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <Input
                label="정답"
                value={question.answerText}
                onChange={(e) => handleTextChange('answerText', e.target.value)}
                placeholder="정답을 입력하세요"
                error={errors.answer}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* 해설 (선택) */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            해설 <span className="text-gray-400">(선택)</span>
          </label>
          <textarea
            value={question.explanation}
            onChange={(e) => handleTextChange('explanation', e.target.value)}
            placeholder="해설을 입력하세요 (선택)"
            rows={2}
            className="
              w-full px-4 py-3 rounded-xl border border-gray-200
              resize-none
              transition-colors duration-200
              focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500
            "
          />
        </div>

        {/* 액션 버튼 */}
        <div className="flex gap-3 pt-2">
          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onCancel}
            className="
              flex-1 py-3 px-4 rounded-xl
              bg-gray-100 text-gray-600 font-medium
              hover:bg-gray-200
              transition-colors
            "
          >
            취소
          </motion.button>
          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleSave}
            className="
              flex-1 py-3 px-4 rounded-xl
              bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-medium
              shadow-md hover:shadow-lg
              transition-shadow
            "
          >
            저장
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}
