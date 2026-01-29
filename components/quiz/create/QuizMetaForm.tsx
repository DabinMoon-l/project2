'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Input } from '@/components/common';

// ============================================================
// 타입 정의
// ============================================================

/**
 * 퀴즈 메타 데이터 타입
 */
export interface QuizMeta {
  /** 퀴즈 제목 */
  title: string;
  /** 태그 목록 */
  tags: string[];
  /** 공개 여부 */
  isPublic: boolean;
  /** 난이도 */
  difficulty: 'easy' | 'normal' | 'hard';
}

interface QuizMetaFormProps {
  /** 현재 메타 데이터 */
  meta: QuizMeta;
  /** 메타 데이터 변경 시 콜백 */
  onChange: (meta: QuizMeta) => void;
  /** 유효성 검사 에러 */
  errors?: {
    title?: string;
    tags?: string;
  };
  /** 추가 클래스명 */
  className?: string;
}

// ============================================================
// 상수
// ============================================================

/**
 * 추천 태그 목록
 */
const SUGGESTED_TAGS = [
  '1주차',
  '2주차',
  '3주차',
  '중간고사',
  '기말고사',
  '복습',
  '심화',
  '기초',
  '핵심정리',
  '오답노트',
];

/**
 * 난이도 옵션
 */
const DIFFICULTY_OPTIONS: { value: QuizMeta['difficulty']; label: string; color: string }[] = [
  { value: 'easy', label: '쉬움', color: 'bg-green-100 text-green-700 border-green-200' },
  { value: 'normal', label: '보통', color: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  { value: 'hard', label: '어려움', color: 'bg-red-100 text-red-700 border-red-200' },
];

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 퀴즈 메타정보 폼 컴포넌트
 *
 * 퀴즈 제목, 태그, 공개/비공개 설정을 입력합니다.
 */
export default function QuizMetaForm({
  meta,
  onChange,
  errors = {},
  className = '',
}: QuizMetaFormProps) {
  // 태그 입력 상태
  const [tagInput, setTagInput] = useState('');

  /**
   * 제목 변경
   */
  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange({ ...meta, title: e.target.value });
    },
    [meta, onChange]
  );

  /**
   * 태그 추가
   */
  const handleAddTag = useCallback(
    (tag: string) => {
      const trimmedTag = tag.trim();

      // 빈 태그, 중복 태그, 최대 5개 제한 확인
      if (!trimmedTag || meta.tags.includes(trimmedTag) || meta.tags.length >= 5) {
        return;
      }

      onChange({ ...meta, tags: [...meta.tags, trimmedTag] });
      setTagInput('');
    },
    [meta, onChange]
  );

  /**
   * 태그 입력 키 핸들러
   */
  const handleTagKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddTag(tagInput);
      } else if (e.key === 'Backspace' && !tagInput && meta.tags.length > 0) {
        // 입력이 비어있을 때 백스페이스 누르면 마지막 태그 삭제
        onChange({ ...meta, tags: meta.tags.slice(0, -1) });
      }
    },
    [tagInput, meta, onChange, handleAddTag]
  );

  /**
   * 태그 삭제
   */
  const handleRemoveTag = useCallback(
    (tagToRemove: string) => {
      onChange({ ...meta, tags: meta.tags.filter((tag) => tag !== tagToRemove) });
    },
    [meta, onChange]
  );

  /**
   * 난이도 변경
   */
  const handleDifficultyChange = useCallback(
    (difficulty: QuizMeta['difficulty']) => {
      onChange({ ...meta, difficulty });
    },
    [meta, onChange]
  );

  /**
   * 공개 설정 변경
   */
  const handlePublicChange = useCallback(
    (isPublic: boolean) => {
      onChange({ ...meta, isPublic });
    },
    [meta, onChange]
  );

  return (
    <div className={`space-y-6 ${className}`}>
      {/* 퀴즈 제목 */}
      <div>
        <Input
          label="퀴즈 제목"
          value={meta.title}
          onChange={handleTitleChange}
          placeholder="예: 1주차 복습 퀴즈"
          error={errors.title}
          helperText="다른 학생들이 퀴즈를 찾을 때 도움이 되는 제목을 입력하세요."
        />
      </div>

      {/* 태그 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          태그
          <span className="ml-1 text-gray-400">(최대 5개)</span>
        </label>

        {/* 태그 입력 영역 */}
        <div
          className={`
            flex flex-wrap items-center gap-2
            p-3 rounded-xl border
            transition-colors duration-200
            focus-within:ring-2 focus-within:ring-indigo-500/20
            ${
              errors.tags
                ? 'border-red-300 focus-within:border-red-500'
                : 'border-gray-200 focus-within:border-indigo-500'
            }
          `}
        >
          {/* 추가된 태그 */}
          <AnimatePresence mode="popLayout">
            {meta.tags.map((tag) => (
              <motion.span
                key={tag}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                layout
                className="
                  inline-flex items-center gap-1
                  px-2.5 py-1
                  bg-indigo-100 text-indigo-700
                  rounded-lg text-sm font-medium
                "
              >
                #{tag}
                <button
                  type="button"
                  onClick={() => handleRemoveTag(tag)}
                  className="ml-0.5 hover:text-indigo-900"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              </motion.span>
            ))}
          </AnimatePresence>

          {/* 태그 입력 */}
          {meta.tags.length < 5 && (
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              placeholder={meta.tags.length === 0 ? '태그 입력 후 Enter' : ''}
              className="flex-1 min-w-[100px] py-1 px-1 outline-none text-sm"
            />
          )}
        </div>

        {errors.tags && (
          <p className="mt-1 text-sm text-red-500">{errors.tags}</p>
        )}

        {/* 추천 태그 */}
        <div className="mt-3">
          <p className="text-xs text-gray-500 mb-2">추천 태그</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTED_TAGS.filter((tag) => !meta.tags.includes(tag)).map((tag) => (
              <motion.button
                key={tag}
                type="button"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => handleAddTag(tag)}
                disabled={meta.tags.length >= 5}
                className="
                  px-2.5 py-1
                  bg-gray-100 text-gray-600
                  rounded-lg text-xs font-medium
                  hover:bg-gray-200
                  disabled:opacity-50 disabled:cursor-not-allowed
                  transition-colors
                "
              >
                +{tag}
              </motion.button>
            ))}
          </div>
        </div>
      </div>

      {/* 난이도 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          난이도
        </label>
        <div className="flex gap-2">
          {DIFFICULTY_OPTIONS.map((option) => (
            <motion.button
              key={option.value}
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => handleDifficultyChange(option.value)}
              className={`
                flex-1 py-2.5 px-4 rounded-xl
                font-medium text-sm
                border-2 transition-all duration-200
                ${
                  meta.difficulty === option.value
                    ? option.color + ' border-current'
                    : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                }
              `}
            >
              {option.label}
            </motion.button>
          ))}
        </div>
      </div>

      {/* 공개 설정 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          공개 설정
        </label>
        <div className="flex gap-3">
          {/* 공개 옵션 */}
          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => handlePublicChange(true)}
            className={`
              flex-1 p-4 rounded-2xl border-2
              transition-all duration-200
              ${
                meta.isPublic
                  ? 'bg-indigo-50 border-indigo-500'
                  : 'bg-white border-gray-200 hover:border-gray-300'
              }
            `}
          >
            <div className="flex items-center gap-3">
              <div
                className={`
                  w-10 h-10 rounded-full flex items-center justify-center
                  ${meta.isPublic ? 'bg-indigo-500 text-white' : 'bg-gray-100 text-gray-400'}
                `}
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
                    d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <div className="text-left">
                <p
                  className={`font-medium ${meta.isPublic ? 'text-indigo-700' : 'text-gray-700'}`}
                >
                  공개
                </p>
                <p className="text-xs text-gray-500">
                  모든 학생이 볼 수 있음
                </p>
              </div>
            </div>
          </motion.button>

          {/* 비공개 옵션 */}
          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => handlePublicChange(false)}
            className={`
              flex-1 p-4 rounded-2xl border-2
              transition-all duration-200
              ${
                !meta.isPublic
                  ? 'bg-gray-100 border-gray-500'
                  : 'bg-white border-gray-200 hover:border-gray-300'
              }
            `}
          >
            <div className="flex items-center gap-3">
              <div
                className={`
                  w-10 h-10 rounded-full flex items-center justify-center
                  ${!meta.isPublic ? 'bg-gray-500 text-white' : 'bg-gray-100 text-gray-400'}
                `}
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
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                  />
                </svg>
              </div>
              <div className="text-left">
                <p
                  className={`font-medium ${!meta.isPublic ? 'text-gray-700' : 'text-gray-700'}`}
                >
                  비공개
                </p>
                <p className="text-xs text-gray-500">
                  나만 볼 수 있음
                </p>
              </div>
            </div>
          </motion.button>
        </div>

        {/* 공개 시 보상 안내 */}
        {meta.isPublic && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-3 p-3 bg-amber-50 rounded-xl"
          >
            <div className="flex items-start gap-2">
              <span className="text-lg">🎁</span>
              <div className="text-xs text-amber-700">
                <p className="font-medium mb-0.5">자체제작 보상 시스템</p>
                <p>
                  다른 학생이 내 퀴즈를 풀면 <strong>골드 +2</strong>를 받아요!
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
