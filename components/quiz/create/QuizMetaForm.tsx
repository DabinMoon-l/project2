'use client';

import { useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getCourseIndex } from '@/lib/courseIndex';

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
  /** 과목 ID (챕터 태그용) */
  courseId?: string | null;
  /** 추가 클래스명 */
  className?: string;
}

// ============================================================
// 상수
// ============================================================

/** 제목 최대 글자수 */
const TITLE_MAX_LENGTH = 10;

/** 사용자 직접 입력 태그 최대 글자수 */
const CUSTOM_TAG_MAX_LENGTH = 10;

/**
 * 시험 유형 태그 (필수: 1개 선택)
 */
const EXAM_TYPE_TAGS = ['중간', '기말', '기타'];

/**
 * 난이도 옵션
 */
const DIFFICULTY_OPTIONS: { value: QuizMeta['difficulty']; label: string }[] = [
  { value: 'easy', label: '쉬움' },
  { value: 'normal', label: '보통' },
  { value: 'hard', label: '어려움' },
];

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 퀴즈 메타정보 폼 컴포넌트
 *
 * 퀴즈 제목, 태그, 공개/비공개 설정을 입력합니다.
 */
/**
 * 필수 태그 검증 함수
 */
export function validateRequiredTags(tags: string[], chapterTags: string[]): string | undefined {
  const hasExamType = tags.some(tag => EXAM_TYPE_TAGS.includes(tag));
  const hasChapter = tags.some(tag => chapterTags.includes(tag));

  if (!hasExamType && !hasChapter) {
    return '시험 유형(중간/기말/기타)과 챕터 태그를 각각 1개 이상 선택해주세요.';
  }
  if (!hasExamType) {
    return '시험 유형(중간/기말/기타) 태그를 선택해주세요.';
  }
  if (!hasChapter) {
    return '챕터 태그를 1개 이상 선택해주세요.';
  }
  return undefined;
}

/**
 * 과목 ID로 챕터 태그 목록 가져오기 (형식: "12_신경계")
 */
export function getChapterTags(courseId?: string | null): string[] {
  if (!courseId) return [];
  const courseIndex = getCourseIndex(courseId);
  if (!courseIndex) return [];
  return courseIndex.chapters.map(chapter => {
    // 챕터 번호 추출 (예: "12. 신경계" -> "12")
    const chapterNum = chapter.name.split('.')[0].trim();
    return `${chapterNum}_${chapter.shortName}`;
  });
}

export default function QuizMetaForm({
  meta,
  onChange,
  errors = {},
  courseId,
  className = '',
}: QuizMetaFormProps) {
  // 태그 입력 상태
  const [tagInput, setTagInput] = useState('');

  // 챕터 태그 목록 (과목별)
  const chapterTags = useMemo(() => getChapterTags(courseId), [courseId]);

  /**
   * 제목 변경 (글자수 제한 적용)
   */
  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      if (value.length <= TITLE_MAX_LENGTH) {
        onChange({ ...meta, title: value });
      }
    },
    [meta, onChange]
  );

  /**
   * 태그 추가 (프리셋 태그는 그대로, 사용자 입력 태그만 글자수 제한)
   */
  const handleAddTag = useCallback(
    (tag: string, isPreset: boolean = false) => {
      // 프리셋 태그(시험유형, 챕터, 기타)는 그대로 사용, 사용자 입력은 글자수 제한
      const trimmedTag = isPreset ? tag.trim() : tag.trim().slice(0, CUSTOM_TAG_MAX_LENGTH);

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
        handleAddTag(tagInput, false); // 사용자 직접 입력
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

  return (
    <div className={`space-y-6 ${className}`}>
      {/* 퀴즈 제목 */}
      <div>
        <label className="block text-xs font-bold text-[#1A1A1A] mb-1.5">
          퀴즈 제목 ({meta.title.length}/{TITLE_MAX_LENGTH})
        </label>
        <input
          type="text"
          value={meta.title}
          onChange={handleTitleChange}
          placeholder="예: 1주차 복습 퀴즈"
          maxLength={TITLE_MAX_LENGTH}
          className={`
            w-full px-2 py-1.5 text-xs
            bg-[#F5F0E8] border-2
            outline-none transition-colors duration-200
            placeholder:text-[#999]
            ${errors.title ? 'border-[#8B1A1A]' : 'border-[#1A1A1A]'}
          `}
        />
        {errors.title && (
          <p className="mt-1 text-xs text-[#8B1A1A]">{errors.title}</p>
        )}
      </div>

      {/* 태그 */}
      <div>
        <label className="block text-xs font-bold text-[#1A1A1A] mb-1.5">
          태그
          <span className="ml-1 text-[#5C5C5C] font-normal">(최대 5개)</span>
        </label>

        {/* 태그 입력 영역 */}
        <div
          className={`
            flex flex-wrap items-center gap-1.5
            p-2 border-2 bg-[#F5F0E8]
            transition-colors duration-200
            ${
              errors.tags
                ? 'border-[#8B1A1A]'
                : 'border-[#1A1A1A]'
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
                  px-2 py-0.5
                  bg-[#1A1A1A] text-[#F5F0E8]
                  text-xs font-bold
                "
              >
                #{tag}
                <button
                  type="button"
                  onClick={() => handleRemoveTag(tag)}
                  className="ml-0.5 hover:text-[#EDEAE4]"
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

          {/* 태그 입력 (10자 제한) */}
          {meta.tags.length < 5 && (
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value.slice(0, CUSTOM_TAG_MAX_LENGTH))}
              onKeyDown={handleTagKeyDown}
              placeholder={meta.tags.length === 0 ? '태그 입력 (10자)' : ''}
              maxLength={CUSTOM_TAG_MAX_LENGTH}
              className="flex-1 min-w-[80px] py-0.5 px-1 outline-none text-xs bg-transparent"
            />
          )}
        </div>

        {errors.tags && (
          <p className="mt-1 text-sm text-[#8B1A1A]">{errors.tags}</p>
        )}

        {/* 시험 유형 태그 (필수) */}
        <div className="mt-3">
          <p className="text-xs text-[#5C5C5C] mb-2">
            시험 유형
          </p>
          <div className="flex flex-wrap gap-2">
            {EXAM_TYPE_TAGS.map((tag) => {
              const isSelected = meta.tags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => isSelected ? handleRemoveTag(tag) : handleAddTag(tag, true)}
                  disabled={!isSelected && meta.tags.length >= 5}
                  className={`
                    px-2.5 py-1 text-xs font-bold border transition-colors
                    ${isSelected
                      ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                      : 'bg-[#EDEAE4] text-[#1A1A1A] border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
                    }
                    disabled:opacity-50 disabled:cursor-not-allowed
                  `}
                >
                  {isSelected ? `✓ ${tag}` : `+ ${tag}`}
                </button>
              );
            })}
          </div>
        </div>

        {/* 챕터 태그 (필수) */}
        {chapterTags.length > 0 && (
          <div className="mt-3">
            <p className="text-xs text-[#5C5C5C] mb-2">
              챕터
            </p>
            <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
              {chapterTags.map((tag) => {
                const isSelected = meta.tags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => isSelected ? handleRemoveTag(tag) : handleAddTag(tag, true)}
                    disabled={!isSelected && meta.tags.length >= 5}
                    className={`
                      px-2.5 py-1 text-xs font-bold border transition-colors
                      ${isSelected
                        ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                        : 'bg-[#EDEAE4] text-[#1A1A1A] border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
                      }
                      disabled:opacity-50 disabled:cursor-not-allowed
                    `}
                  >
                    {isSelected ? `✓ ${tag}` : `+ ${tag}`}
                  </button>
                );
              })}
            </div>
          </div>
        )}

      </div>

      {/* 난이도 */}
      <div>
        <label className="block text-xs font-bold text-[#1A1A1A] mb-1.5">
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
                flex-1 py-1.5 px-3
                font-bold text-xs
                border-2 transition-all duration-200
                ${
                  meta.difficulty === option.value
                    ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                    : 'bg-[#EDEAE4] text-[#1A1A1A] border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
                }
              `}
            >
              {option.label}
            </motion.button>
          ))}
        </div>
      </div>

    </div>
  );
}
