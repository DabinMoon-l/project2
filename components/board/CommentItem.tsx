'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';
import type { Comment } from '@/lib/hooks/useBoard';

interface CommentItemProps {
  /** 댓글 데이터 */
  comment: Comment;
  /** 현재 사용자 ID */
  currentUserId?: string;
  /** 삭제 핸들러 */
  onDelete?: (commentId: string) => void;
  /** 삭제 중 여부 */
  isDeleting?: boolean;
}

/**
 * 댓글 아이템 컴포넌트
 *
 * 개별 댓글을 표시하고 삭제 기능을 제공합니다.
 */
export default function CommentItem({
  comment,
  currentUserId,
  onDelete,
  isDeleting = false,
}: CommentItemProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // 본인 댓글인지 확인
  const isOwner = currentUserId === comment.authorId;

  // 시간 포맷
  const timeAgo = formatDistanceToNow(comment.createdAt, {
    addSuffix: true,
    locale: ko,
  });

  /**
   * 삭제 버튼 클릭
   */
  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  /**
   * 삭제 확인
   */
  const handleConfirmDelete = () => {
    onDelete?.(comment.id);
    setShowDeleteConfirm(false);
  };

  /**
   * 삭제 취소
   */
  const handleCancelDelete = () => {
    setShowDeleteConfirm(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="py-3 border-b border-gray-100 last:border-b-0"
    >
      {/* 댓글 헤더 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {/* 프로필 아이콘 */}
          <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center">
            <span className="text-sm">
              {comment.isAnonymous ? '🎭' : '🐰'}
            </span>
          </div>

          {/* 작성자 이름 */}
          <span className={`text-sm font-medium ${comment.isAnonymous ? 'text-gray-500' : 'text-gray-800'}`}>
            {comment.authorNickname}
          </span>

          {/* 시간 */}
          <span className="text-xs text-gray-400">{timeAgo}</span>
        </div>

        {/* 삭제 버튼 (본인 댓글만) */}
        {isOwner && onDelete && (
          <button
            type="button"
            onClick={handleDeleteClick}
            disabled={isDeleting}
            className="text-xs text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
          >
            {isDeleting ? '삭제 중...' : '삭제'}
          </button>
        )}
      </div>

      {/* 댓글 내용 */}
      <p className="text-sm text-gray-700 whitespace-pre-wrap pl-9">
        {comment.content}
      </p>

      {/* 삭제 확인 모달 */}
      {showDeleteConfirm && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-2 ml-9 p-3 bg-red-50 rounded-lg"
        >
          <p className="text-sm text-red-600 mb-2">댓글을 삭제하시겠습니까?</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleConfirmDelete}
              className="px-3 py-1 text-xs bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
            >
              삭제
            </button>
            <button
              type="button"
              onClick={handleCancelDelete}
              className="px-3 py-1 text-xs bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
            >
              취소
            </button>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
