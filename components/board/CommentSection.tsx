'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
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
 * 댓글 섹션 컴포넌트 — 하단 고정 입력바
 */
export default function CommentSection({ postId }: CommentSectionProps) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const { profile } = useUser();
  const { showExpToast } = useExpToast();
  const { comments, loading, refresh } = useComments(postId);
  const { createComment, loading: creating } = useCreateComment();
  const { updateComment } = useUpdateComment();
  const { deleteComment } = useDeleteComment();
  const { toggleCommentLike } = useCommentLike();

  const [replyingTo, setReplyingTo] = useState<{ id: string; nickname: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputBarRef = useRef<HTMLDivElement>(null);

  // textarea 높이 자동 조절
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  }, [content]);

  // 답글 시 포커스
  useEffect(() => {
    if (replyingTo) {
      textareaRef.current?.focus();
    }
  }, [replyingTo]);

  // 댓글을 계층 구조로 구성하고 좋아요순 > 최신순으로 정렬
  const organizeComments = (flatComments: Comment[]): Comment[] => {
    const commentMap = new Map<string, Comment>();
    const rootComments: Comment[] = [];

    flatComments.forEach(comment => {
      commentMap.set(comment.id, { ...comment, replies: [] });
    });

    flatComments.forEach(comment => {
      const commentWithReplies = commentMap.get(comment.id)!;
      if (comment.parentId) {
        const parent = commentMap.get(comment.parentId);
        if (parent) {
          parent.replies = parent.replies || [];
          parent.replies.push(commentWithReplies);
        } else {
          rootComments.push(commentWithReplies);
        }
      } else {
        rootComments.push(commentWithReplies);
      }
    });

    rootComments.forEach(comment => {
      if (comment.replies && comment.replies.length > 0) {
        comment.replies.sort((a, b) => {
          const likeDiff = (b.likes || 0) - (a.likes || 0);
          if (likeDiff !== 0) return likeDiff;
          return a.createdAt.getTime() - b.createdAt.getTime();
        });
      }
    });

    rootComments.sort((a, b) => {
      const getMaxLikes = (comment: Comment): number => {
        const ownLikes = comment.likes || 0;
        const replyMaxLikes = comment.replies && comment.replies.length > 0
          ? Math.max(...comment.replies.map(r => r.likes || 0))
          : 0;
        return Math.max(ownLikes, replyMaxLikes);
      };

      const aMaxLikes = getMaxLikes(a);
      const bMaxLikes = getMaxLikes(b);
      if (bMaxLikes !== aMaxLikes) return bMaxLikes - aMaxLikes;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    return rootComments;
  };

  const organizedComments = organizeComments(comments);

  // 댓글 제출
  const handleSubmit = useCallback(async () => {
    if (!content.trim() || !user) return;

    const result = await createComment({
      postId,
      content: content.trim(),
      isAnonymous: false,
      parentId: replyingTo?.id,
    });

    if (result) {
      setContent('');
      setReplyingTo(null);
      setTimeout(() => {
        showExpToast(2, '댓글 작성');
      }, 500);
      refresh();
    }
  }, [content, user, postId, replyingTo, createComment, refresh, showExpToast]);

  const handleDelete = useCallback(async (commentId: string) => {
    setDeletingId(commentId);
    const success = await deleteComment(commentId, postId);
    if (success) refresh();
    setDeletingId(null);
  }, [deleteComment, postId, refresh]);

  const handleEdit = useCallback(async (commentId: string, newContent: string) => {
    setEditingId(commentId);
    const success = await updateComment(commentId, newContent);
    if (success) refresh();
    setEditingId(null);
  }, [updateComment, refresh]);

  const handleLike = useCallback(async (commentId: string) => {
    const success = await toggleCommentLike(commentId);
    if (success) refresh();
  }, [toggleCommentLike, refresh]);

  const checkIsLiked = useCallback((commentId: string) => {
    const comment = comments.find(c => c.id === commentId);
    return comment?.likedBy?.includes(user?.uid || '') || false;
  }, [comments, user?.uid]);

  const handleReply = useCallback((commentId: string, nickname: string) => {
    setReplyingTo({ id: commentId, nickname });
  }, []);

  return (
    <>
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
                  onReply={() => handleReply(comment.id, comment.authorNickname)}
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
              </div>
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* 하단 고정 입력바 */}
      {user && (
        <div
          ref={inputBarRef}
          className="fixed bottom-0 left-0 right-0 z-40 border-t border-[#1A1A1A]"
          style={{ backgroundColor: '#F5F0E8' }}
        >
          {/* 답글 대상 표시 */}
          <AnimatePresence>
            {replyingTo && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="flex items-center justify-between px-4 py-1.5 bg-[#EDEAE4] border-b border-[#D4CFC4]">
                  <span className="text-xs text-[#3A3A3A]">
                    {replyingTo.nickname}님에게 답글
                  </span>
                  <button
                    type="button"
                    onClick={() => setReplyingTo(null)}
                    className="text-[#3A3A3A] p-0.5"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 입력 영역 */}
          <div className="flex items-end gap-2 px-4 py-2.5" style={{ paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom))' }}>
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder={replyingTo ? `${replyingTo.nickname}님에게 답글...` : '의견을 남겨주세요...'}
              rows={1}
              maxLength={500}
              className="flex-1 px-3 py-2 outline-none resize-none leading-relaxed text-sm"
              style={{
                border: '1px solid #1A1A1A',
                backgroundColor: theme.colors.background,
                color: theme.colors.text,
                maxHeight: '120px',
              }}
            />
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!content.trim() || creating}
              className="flex-shrink-0 w-9 h-9 flex items-center justify-center disabled:opacity-30 transition-opacity"
              style={{ backgroundColor: '#1A1A1A' }}
            >
              <svg className="w-4 h-4 text-[#F5F0E8]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
