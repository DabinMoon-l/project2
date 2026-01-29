'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button, Skeleton } from '@/components/common';
import CommentItem from './CommentItem';
import {
  useComments,
  useCreateComment,
  useDeleteComment,
  type Comment,
} from '@/lib/hooks/useBoard';
import { useAuth } from '@/lib/hooks/useAuth';

interface CommentSectionProps {
  /** 게시글 ID */
  postId: string;
}

/**
 * 댓글 섹션 컴포넌트
 *
 * 댓글 목록 표시와 댓글 작성 기능을 제공합니다.
 */
export default function CommentSection({ postId }: CommentSectionProps) {
  const { user } = useAuth();
  const { comments, loading, refresh } = useComments(postId);
  const { createComment, loading: creating, error: createError } = useCreateComment();
  const { deleteComment, loading: deleting } = useDeleteComment();

  // 입력 상태
  const [content, setContent] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  /**
   * 댓글 작성
   */
  const handleSubmit = useCallback(async () => {
    if (!content.trim() || !user) return;

    const result = await createComment({
      postId,
      content: content.trim(),
      isAnonymous,
    });

    if (result) {
      setContent('');
      refresh();
    }
  }, [content, user, postId, isAnonymous, createComment, refresh]);

  /**
   * 댓글 삭제
   */
  const handleDelete = useCallback(async (commentId: string) => {
    setDeletingId(commentId);
    const success = await deleteComment(commentId, postId);
    if (success) {
      refresh();
    }
    setDeletingId(null);
  }, [deleteComment, postId, refresh]);

  return (
    <div className="bg-white rounded-2xl shadow-sm">
      {/* 헤더 */}
      <div className="px-4 py-3 border-b border-gray-100">
        <h3 className="font-medium text-gray-800">
          댓글 {comments.length > 0 && <span className="text-theme-accent">{comments.length}</span>}
        </h3>
      </div>

      {/* 댓글 작성 폼 */}
      {user ? (
        <div className="p-4 border-b border-gray-100">
          <div className="flex gap-2 mb-3">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="댓글을 입력하세요..."
              rows={2}
              maxLength={500}
              className="
                flex-1 px-3 py-2
                border border-gray-200 rounded-xl
                text-sm text-gray-800 placeholder-gray-400
                resize-none
                focus:outline-none focus:ring-2 focus:ring-theme-accent/30 focus:border-theme-accent
              "
            />
          </div>

          <div className="flex items-center justify-between">
            {/* 익명 체크박스 */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isAnonymous}
                onChange={(e) => setIsAnonymous(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-theme-accent focus:ring-theme-accent"
              />
              <span className="text-sm text-gray-600">익명</span>
            </label>

            {/* 작성 버튼 */}
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!content.trim() || creating}
              loading={creating}
            >
              등록
            </Button>
          </div>

          {/* 에러 메시지 */}
          {createError && (
            <p className="mt-2 text-sm text-red-500">{createError}</p>
          )}
        </div>
      ) : (
        <div className="p-4 border-b border-gray-100 text-center text-sm text-gray-500">
          댓글을 작성하려면 로그인이 필요합니다.
        </div>
      )}

      {/* 댓글 목록 */}
      <div className="px-4">
        {/* 로딩 */}
        {loading && (
          <div className="py-4 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex gap-2">
                <Skeleton className="w-7 h-7 rounded-full" />
                <div className="flex-1">
                  <Skeleton className="w-24 h-4 mb-2" />
                  <Skeleton className="w-full h-12" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 빈 상태 */}
        {!loading && comments.length === 0 && (
          <div className="py-8 text-center text-sm text-gray-400">
            첫 댓글을 남겨보세요! 💬
          </div>
        )}

        {/* 댓글 리스트 */}
        {!loading && comments.length > 0 && (
          <AnimatePresence>
            {comments.map((comment) => (
              <CommentItem
                key={comment.id}
                comment={comment}
                currentUserId={user?.uid}
                onDelete={handleDelete}
                isDeleting={deletingId === comment.id}
              />
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
