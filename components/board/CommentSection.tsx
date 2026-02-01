'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '@/styles/themes/useTheme';
import { Skeleton, useExpToast } from '@/components/common';
import CommentItem from './CommentItem';
import {
  useComments,
  useCreateComment,
  useUpdateComment,
  useDeleteComment,
  useCommentLike,
  type Comment,
} from '@/lib/hooks/useBoard';
import { useAuth } from '@/lib/hooks/useAuth';
import { useUser } from '@/lib/contexts';

interface CommentSectionProps {
  postId: string;
}

/**
 * 댓글 입력 폼
 */
function CommentForm({
  postId,
  parentId,
  onSuccess,
  onCancel,
  placeholder = '의견을 남겨주세요...',
}: {
  postId: string;
  parentId?: string;
  onSuccess: () => void;
  onCancel?: () => void;
  placeholder?: string;
}) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const { profile } = useUser();
  const { showExpToast } = useExpToast();
  const { createComment, loading: creating, error: createError } = useCreateComment();
  const [content, setContent] = useState('');

  const handleSubmit = useCallback(async () => {
    if (!content.trim() || !user) return;

    const result = await createComment({
      postId,
      content: content.trim(),
      isAnonymous: false,
      parentId,
    });

    if (result) {
      setContent('');
      // EXP 토스트 표시 (댓글 작성 2 XP)
      // Cloud Functions에서 자동으로 EXP가 지급되므로 약간 지연 후 최신 profile을 사용
      setTimeout(() => {
        const earnedExp = 2;
        showExpToast(earnedExp, '댓글 작성');
      }, 500);
      onSuccess();
    }
  }, [content, user, postId, parentId, createComment, onSuccess, profile, showExpToast]);

  if (!user) {
    return (
      <div className="p-3 text-center text-sm italic text-[#3A3A3A]">
        댓글을 작성하려면 로그인이 필요합니다.
      </div>
    );
  }

  return (
    <div className={parentId ? 'pl-6 pt-2' : 'p-4 border-b border-[#D4CFC4]'}>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={placeholder}
        rows={parentId ? 2 : 3}
        maxLength={500}
        className="w-full px-3 py-2 outline-none resize-none leading-relaxed text-sm"
        style={{
          border: '1px solid #1A1A1A',
          backgroundColor: theme.colors.background,
          color: theme.colors.text,
        }}
      />

      <div className="flex items-center justify-end mt-2">
        <div className="flex gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1 text-xs text-[#3A3A3A]"
            >
              취소
            </button>
          )}
          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleSubmit}
            disabled={!content.trim() || creating}
            className="px-3 py-1 text-xs disabled:opacity-50"
            style={{
              backgroundColor: '#1A1A1A',
              color: '#F5F0E8',
            }}
          >
            {creating ? '작성 중...' : parentId ? '답글 작성' : '댓글 작성'}
          </motion.button>
        </div>
      </div>

      {createError && (
        <p className="mt-1 text-xs" style={{ color: '#8B1A1A' }}>{createError}</p>
      )}
    </div>
  );
}

/**
 * 댓글 섹션 컴포넌트 (대댓글 지원)
 */
export default function CommentSection({ postId }: CommentSectionProps) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const { comments, loading, refresh } = useComments(postId);
  const { updateComment, loading: updating } = useUpdateComment();
  const { deleteComment } = useDeleteComment();
  const { toggleCommentLike, isCommentLiked } = useCommentLike();

  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // 댓글을 계층 구조로 구성하고 좋아요순 > 최신순으로 정렬
  // 대댓글 좋아요가 높으면 모댓글도 함께 위로 올라감
  const organizeComments = (flatComments: Comment[]): Comment[] => {
    const commentMap = new Map<string, Comment>();
    const rootComments: Comment[] = [];

    // 먼저 모든 댓글을 맵에 저장
    flatComments.forEach(comment => {
      commentMap.set(comment.id, { ...comment, replies: [] });
    });

    // 계층 구조 구성
    flatComments.forEach(comment => {
      const commentWithReplies = commentMap.get(comment.id)!;
      if (comment.parentId) {
        const parent = commentMap.get(comment.parentId);
        if (parent) {
          parent.replies = parent.replies || [];
          parent.replies.push(commentWithReplies);
        } else {
          // 부모가 없으면 루트로 처리
          rootComments.push(commentWithReplies);
        }
      } else {
        rootComments.push(commentWithReplies);
      }
    });

    // 대댓글 정렬: 좋아요순 > 오래된순
    rootComments.forEach(comment => {
      if (comment.replies && comment.replies.length > 0) {
        comment.replies.sort((a, b) => {
          const likeDiff = (b.likes || 0) - (a.likes || 0);
          if (likeDiff !== 0) return likeDiff;
          return a.createdAt.getTime() - b.createdAt.getTime();
        });
      }
    });

    // 모댓글 정렬: max(모댓글 좋아요, 대댓글 중 최대 좋아요)순 > 오래된순
    rootComments.sort((a, b) => {
      // 각 댓글의 점수 = max(본인 좋아요, 대댓글들의 최대 좋아요)
      const getMaxLikes = (comment: Comment): number => {
        const ownLikes = comment.likes || 0;
        const replyMaxLikes = comment.replies && comment.replies.length > 0
          ? Math.max(...comment.replies.map(r => r.likes || 0))
          : 0;
        return Math.max(ownLikes, replyMaxLikes);
      };

      const aMaxLikes = getMaxLikes(a);
      const bMaxLikes = getMaxLikes(b);

      // 좋아요순 (내림차순)
      if (bMaxLikes !== aMaxLikes) return bMaxLikes - aMaxLikes;

      // 오래된순 (오름차순)
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    return rootComments;
  };

  const organizedComments = organizeComments(comments);

  const handleDelete = useCallback(async (commentId: string) => {
    setDeletingId(commentId);
    const success = await deleteComment(commentId, postId);
    if (success) {
      refresh();
    }
    setDeletingId(null);
  }, [deleteComment, postId, refresh]);

  const handleEdit = useCallback(async (commentId: string, content: string) => {
    setEditingId(commentId);
    const success = await updateComment(commentId, content);
    if (success) {
      refresh();
    }
    setEditingId(null);
  }, [updateComment, refresh]);

  const handleReplySuccess = useCallback(() => {
    setReplyingTo(null);
    refresh();
  }, [refresh]);

  // 댓글 좋아요 토글
  const handleLike = useCallback(async (commentId: string) => {
    const success = await toggleCommentLike(commentId);
    if (success) {
      refresh();
    }
  }, [toggleCommentLike, refresh]);

  // 사용자가 좋아요한 댓글인지 확인 (댓글 데이터 기반)
  const checkIsLiked = useCallback((commentId: string) => {
    const comment = comments.find(c => c.id === commentId);
    return comment?.likedBy?.includes(user?.uid || '') || false;
  }, [comments, user?.uid]);

  return (
    <div
      className="border border-[#1A1A1A]"
      style={{ backgroundColor: theme.colors.backgroundCard }}
    >
      {/* 댓글 작성 폼 */}
      <CommentForm
        postId={postId}
        onSuccess={refresh}
      />

      {/* 댓글 목록 */}
      <div className="p-4">
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="border-b border-[#D4CFC4] pb-3">
                <Skeleton className="w-24 h-4 mb-2 rounded-none" />
                <Skeleton className="w-full h-12 rounded-none" />
              </div>
            ))}
          </div>
        )}

        {!loading && comments.length === 0 && (
          <div className="py-6 text-center text-base italic text-[#3A3A3A]">
            첫 번째 의견을 남겨주세요
          </div>
        )}

        {!loading && organizedComments.length > 0 && (
          <AnimatePresence>
            {organizedComments.map((comment) => (
              <div key={comment.id}>
                <CommentItem
                  comment={comment}
                  currentUserId={user?.uid}
                  onDelete={handleDelete}
                  onEdit={handleEdit}
                  onReply={() => setReplyingTo(comment.id)}
                  onLike={handleLike}
                  isLiked={checkIsLiked(comment.id)}
                  isDeleting={deletingId === comment.id}
                  isEditing={editingId === comment.id}
                />

                {/* 대댓글 목록 */}
                {comment.replies && comment.replies.length > 0 && (
                  <div className="pl-6 border-l-2 border-[#D4CFC4] ml-2">
                    {comment.replies.map((reply) => (
                      <CommentItem
                        key={reply.id}
                        comment={reply}
                        currentUserId={user?.uid}
                        onDelete={handleDelete}
                        onEdit={handleEdit}
                        onLike={handleLike}
                        isLiked={checkIsLiked(reply.id)}
                        isDeleting={deletingId === reply.id}
                        isEditing={editingId === reply.id}
                        isReply
                      />
                    ))}
                  </div>
                )}

                {/* 대댓글 작성 폼 */}
                {replyingTo === comment.id && (
                  <CommentForm
                    postId={postId}
                    parentId={comment.id}
                    onSuccess={handleReplySuccess}
                    onCancel={() => setReplyingTo(null)}
                    placeholder={`${comment.authorNickname}님에게 답글...`}
                  />
                )}
              </div>
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
