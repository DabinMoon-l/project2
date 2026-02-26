'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
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
import { useUpload } from '@/lib/hooks/useStorage';
import { useKeyboardAware } from '@/lib/hooks/useKeyboardAware';

interface CommentSectionProps {
  postId: string;
  /** 게시글 작성자 uid (글쓴이 표시용) */
  postAuthorId?: string;
}

/**
 * 댓글 섹션 컴포넌트 — 하단 고정 입력바 + 이미지 첨부
 */
export default function CommentSection({ postId, postAuthorId }: CommentSectionProps) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const { profile } = useUser();
  const { showExpToast } = useExpToast();
  const { comments, loading, error: commentsError, refresh } = useComments(postId);
  const { createComment, loading: creating } = useCreateComment();
  const { updateComment } = useUpdateComment();
  const { deleteComment } = useDeleteComment();
  const { toggleCommentLike } = useCommentLike();
  const { uploadMultipleImages, loading: uploading } = useUpload();
  const { bottomOffset } = useKeyboardAware();

  const isProfessor = profile?.role === 'professor';

  // 교수님일 때 댓글 작성자 실명 맵 구축
  const authorNameCacheRef = useRef<Map<string, string>>(new Map());
  const [authorNameMap, setAuthorNameMap] = useState<Map<string, string>>(new Map());

  // 댓글 작성자 uid 목록
  const commentAuthorIds = useMemo(() => {
    if (!isProfessor) return [];
    return [...new Set(comments.map(c => c.authorId))];
  }, [isProfessor, comments]);

  // 교수님일 때 작성자 실명 일괄 조회
  useEffect(() => {
    if (!isProfessor || commentAuthorIds.length === 0) return;
    const cache = authorNameCacheRef.current;
    const missing = commentAuthorIds.filter(uid => !cache.has(uid));
    if (missing.length === 0) {
      // 캐시에 모두 있으면 바로 설정
      setAuthorNameMap(new Map(cache));
      return;
    }
    Promise.all(
      missing.map(uid =>
        getDoc(doc(db, 'users', uid))
          .then(snap => {
            if (snap.exists()) {
              const name = snap.data().name;
              if (name) cache.set(uid, name);
            }
          })
          .catch(() => {})
      )
    ).then(() => {
      setAuthorNameMap(new Map(cache));
    });
  }, [isProfessor, commentAuthorIds]);

  const [replyingTo, setReplyingTo] = useState<{ id: string; nickname: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [pendingImages, setPendingImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // 이미지 프리뷰 URL 정리
  useEffect(() => {
    return () => { imagePreviews.forEach(u => URL.revokeObjectURL(u)); };
  }, [imagePreviews]);

  // 이미지 선택
  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const newFiles = [...pendingImages, ...files].slice(0, 5); // 최대 5장
    setPendingImages(newFiles);

    // 프리뷰 생성
    imagePreviews.forEach(u => URL.revokeObjectURL(u));
    setImagePreviews(newFiles.map(f => URL.createObjectURL(f)));

    // input 초기화
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [pendingImages, imagePreviews]);

  // 이미지 제거
  const removeImage = useCallback((index: number) => {
    URL.revokeObjectURL(imagePreviews[index]);
    setPendingImages(prev => prev.filter((_, i) => i !== index));
    setImagePreviews(prev => prev.filter((_, i) => i !== index));
  }, [imagePreviews]);

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
    if ((!content.trim() && pendingImages.length === 0) || !user) return;

    // 이미지 업로드
    let imageUrls: string[] = [];
    if (pendingImages.length > 0) {
      imageUrls = await uploadMultipleImages(pendingImages);
    }

    const result = await createComment({
      postId,
      content: content.trim(),
      isAnonymous: false,
      parentId: replyingTo?.id,
      imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
    });

    if (result) {
      setContent('');
      setPendingImages([]);
      imagePreviews.forEach(u => URL.revokeObjectURL(u));
      setImagePreviews([]);
      setReplyingTo(null);
      if (profile?.role !== 'professor') {
        setTimeout(() => {
          showExpToast(2, '댓글 작성');
        }, 500);
      }
      refresh();
    }
  }, [content, pendingImages, user, postId, replyingTo, createComment, uploadMultipleImages, refresh, showExpToast, imagePreviews, profile?.role]);

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

  const isSending = creating || uploading;

  return (
    <>
      {/* 댓글 목록 */}
      <div className="py-4">
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

        {!loading && commentsError && (
          <div className="py-6 text-center text-sm text-[#8B1A1A]">
            댓글을 불러오지 못했습니다.
            <button onClick={refresh} className="ml-2 underline font-bold">다시 시도</button>
          </div>
        )}

        {!loading && !commentsError && comments.length === 0 && (
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
                  isProfessor={isProfessor}
                  authorNameMap={authorNameMap}
                  postAuthorId={postAuthorId}
                />

                {/* 대댓글 목록 */}
                {comment.replies && comment.replies.length > 0 &&
                  comment.replies.map((reply) => (
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
                      isProfessor={isProfessor}
                      authorNameMap={authorNameMap}
                      postAuthorId={postAuthorId}
                    />
                  ))
                }
              </div>
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* 하단 고정 입력바 */}
      {user && (
        <div
          className="fixed left-3 right-3 z-40 rounded-2xl bg-[#F5F0E8]/80 backdrop-blur-xl shadow-[0_4px_24px_rgba(0,0,0,0.12)] border border-[#D4CFC4]/60 overflow-hidden transition-[bottom] duration-100"
          style={{ bottom: bottomOffset ? bottomOffset : 'max(0.75rem, env(safe-area-inset-bottom))' }}
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
                <div className="flex items-center justify-between px-4 py-1.5 bg-[#EDEAE4]/60 border-b border-[#D4CFC4]/40">
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

          {/* 이미지 프리뷰 */}
          {imagePreviews.length > 0 && (
            <div className="flex gap-2 px-4 pt-2 overflow-x-auto">
              {imagePreviews.map((preview, index) => (
                <div key={index} className="relative flex-shrink-0 w-16 h-16">
                  <img src={preview} alt="" className="w-full h-full object-cover border border-[#1A1A1A]" />
                  <button
                    type="button"
                    onClick={() => removeImage(index)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-[#1A1A1A] text-[#F5F0E8] rounded-full flex items-center justify-center text-xs"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 입력 영역 */}
          <div className="flex items-center gap-2 px-4 py-2.5" style={{ paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom))' }}>
            {/* 이미지 첨부 버튼 */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isSending}
              className="flex-shrink-0 text-[#3A3A3A] hover:text-[#1A1A1A] disabled:opacity-30 transition-colors"
            >
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleImageSelect}
            />

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
              className="flex-1 px-3 py-2 outline-none resize-none leading-relaxed text-sm rounded-xl"
              style={{
                border: '1px solid rgba(180, 175, 165, 0.6)',
                backgroundColor: 'rgba(245, 240, 232, 0.5)',
                color: theme.colors.text,
                maxHeight: '120px',
              }}
            />
            <button
              type="button"
              onClick={handleSubmit}
              disabled={(!content.trim() && pendingImages.length === 0) || isSending}
              className="flex-shrink-0 text-[#5C5C5C] hover:text-[#1A1A1A] disabled:text-[#D4CFC4] transition-colors"
            >
              {isSending ? (
                <div className="w-5 h-5 border-2 border-[#D4CFC4] border-t-[#5C5C5C] rounded-full animate-spin" />
              ) : (
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
              )}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
