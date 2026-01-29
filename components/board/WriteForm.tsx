'use client';

import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Button, Input } from '@/components/common';
import type { BoardCategory, CreatePostData } from '@/lib/hooks/useBoard';

interface WriteFormProps {
  /** 카테고리 */
  category: BoardCategory;
  /** 제출 핸들러 */
  onSubmit: (data: CreatePostData) => Promise<void>;
  /** 제출 중 여부 */
  isSubmitting?: boolean;
  /** 에러 메시지 */
  error?: string | null;
}

/**
 * 글 작성 폼 컴포넌트
 *
 * 게시글 작성을 위한 폼 UI를 제공합니다.
 */
export default function WriteForm({
  category,
  onSubmit,
  isSubmitting = false,
  error,
}: WriteFormProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);

  // 유효성 검사
  const isValid = title.trim().length >= 2 && content.trim().length >= 10;

  /**
   * 폼 제출
   */
  const handleSubmit = useCallback(async () => {
    if (!isValid || isSubmitting) return;

    await onSubmit({
      title: title.trim(),
      content: content.trim(),
      isAnonymous,
      category,
    });
  }, [isValid, isSubmitting, title, content, isAnonymous, category, onSubmit]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {/* 카테고리 표시 */}
      <div className="flex items-center gap-2">
        <span className="px-3 py-1 bg-theme-accent/10 text-theme-accent text-sm font-medium rounded-full">
          {category === 'toProfessor' ? 'To 교수님' : '우리들끼리'}
        </span>
      </div>

      {/* 제목 입력 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          제목 <span className="text-red-500">*</span>
        </label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="제목을 입력하세요 (2자 이상)"
          maxLength={100}
        />
        <div className="mt-1 text-xs text-gray-400 text-right">
          {title.length}/100
        </div>
      </div>

      {/* 내용 입력 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          내용 <span className="text-red-500">*</span>
        </label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="내용을 입력하세요 (10자 이상)"
          rows={8}
          maxLength={2000}
          className="
            w-full px-4 py-3
            border border-gray-200 rounded-xl
            text-gray-800 placeholder-gray-400
            resize-none
            focus:outline-none focus:ring-2 focus:ring-theme-accent/30 focus:border-theme-accent
            transition-colors
          "
        />
        <div className="mt-1 text-xs text-gray-400 text-right">
          {content.length}/2000
        </div>
      </div>

      {/* 옵션 */}
      <div className="flex items-center justify-between py-3 border-t border-gray-100">
        {/* 익명 옵션 */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isAnonymous}
            onChange={(e) => setIsAnonymous(e.target.checked)}
            className="w-5 h-5 rounded border-gray-300 text-theme-accent focus:ring-theme-accent"
          />
          <span className="text-sm text-gray-700">익명으로 작성</span>
        </label>

        {/* 글자 수 안내 */}
        <span className="text-xs text-gray-400">
          {!title.trim() && '제목을 입력해주세요'}
          {title.trim() && title.trim().length < 2 && '제목은 2자 이상'}
          {title.trim().length >= 2 && content.trim().length < 10 && '내용은 10자 이상'}
          {isValid && '작성 완료!'}
        </span>
      </div>

      {/* 에러 메시지 */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3 bg-red-50 text-red-600 rounded-xl text-sm"
        >
          {error}
        </motion.div>
      )}

      {/* 작성 버튼 */}
      <Button
        fullWidth
        size="lg"
        onClick={handleSubmit}
        disabled={!isValid || isSubmitting}
        loading={isSubmitting}
      >
        글 작성하기
      </Button>
    </motion.div>
  );
}
