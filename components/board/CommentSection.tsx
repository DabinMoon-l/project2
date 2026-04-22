'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useSessionState } from '@/lib/hooks/useSessionState';
import { motion, AnimatePresence } from 'framer-motion';
import { userRepo } from '@/lib/repositories';
import { useTheme } from '@/styles/themes/useTheme';
import { Skeleton, useExpToast } from '@/components/common';
import { EXP_REWARDS } from '@/lib/utils/expRewards';
import CommentItem from './CommentItem';
import {
  useComments,
  useCreateComment,
  useUpdateComment,
  useDeleteComment,
  useCommentLike,
  useAcceptComment,
  type Comment,
} from '@/lib/hooks/useBoard';
import { useAuth } from '@/lib/hooks/useAuth';
import { useUser } from '@/lib/contexts';
import { useUpload } from '@/lib/hooks/useStorage';
import { useKeyboardAware, useKeyboardScrollAdjust } from '@/lib/hooks/useKeyboardAware';
import { useWideMode } from '@/lib/hooks/useViewportScale';
import { callFunction } from '@/lib/api';

interface CommentSectionProps {
  postId: string;
  /** 게시글 작성자 uid (글쓴이 표시용) */
  postAuthorId?: string;
  /** 이미 채택된 댓글 ID */
  acceptedCommentId?: string;
  /** 비공개 글 여부 (EXP 미지급) */
  isPrivatePost?: boolean;
  /** 3쪽 패널 모드 여부 (입력바 sticky 전환) */
  isPanelMode?: boolean;
}

/**
 * 댓글 섹션 컴포넌트 — 하단 고정 입력바 + 이미지 첨부
 */
export default function CommentSection({ postId, postAuthorId, acceptedCommentId, isPrivatePost, isPanelMode }: CommentSectionProps) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const { profile } = useUser();
  const { showExpToast } = useExpToast();
  const { comments, loading, error: commentsError, refresh } = useComments(postId);
  const { createComment, loading: creating } = useCreateComment();
  const { updateComment } = useUpdateComment();
  const { deleteComment } = useDeleteComment();
  const { toggleCommentLike } = useCommentLike();
  const { acceptComment, loading: accepting } = useAcceptComment();
  const { uploadMultipleImages, loading: uploading } = useUpload();
  const { bottomOffset } = useKeyboardAware();
  useKeyboardScrollAdjust(bottomOffset);
  const isWide = useWideMode();

  const isProfessor = profile?.role === 'professor';

  // 교수님일 때 댓글 작성자 실명 맵 구축
  const authorNameCacheRef = useRef<Map<string, string>>(new Map());
  const [authorNameMap, setAuthorNameMap] = useState<Map<string, string>>(new Map());

  // 교수가 아닌 작성자(교수 본인 포함)의 최신 닉네임 캐시
  const authorNicknameCacheRef = useRef<Map<string, string>>(new Map());
  const [authorNicknameMap, setAuthorNicknameMap] = useState<Map<string, string>>(new Map());

  // 작성자 role 캐시 — 과거 댓글(authorRole 필드 없음) 도 정확히 판정하기 위해 users 컬렉션에서 조회
  const authorRoleCacheRef = useRef<Map<string, 'professor' | 'student'>>(new Map());
  const [authorRoleMap, setAuthorRoleMap] = useState<Map<string, 'professor' | 'student'>>(new Map());

  // 댓글 작성자 uid 목록 (교수 댓글 = authorClassType이 null)
  const commentAuthorIds = useMemo(() => {
    if (!isProfessor) return [];
    return [...new Set(comments.map(c => c.authorId))];
  }, [isProfessor, comments]);

  // 교수 계정 댓글 작성자 uid (닉네임 변경 반영 대상)
  const professorAuthorIds = useMemo(() => {
    return [...new Set(comments.filter(c => !c.authorClassType && c.authorId !== 'gemini-ai').map(c => c.authorId))];
  }, [comments]);

  // role 조회 대상 — authorRole / authorClassType 둘 다 없는 과거 댓글 작성자만 (AI 제외)
  const roleAuthorIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of comments) {
      if (c.authorId === 'gemini-ai') continue;
      if (c.authorRole) continue; // 이미 명시됨
      if (c.authorClassType) continue; // classType 으로 학생 확정
      ids.add(c.authorId);
    }
    return [...ids];
  }, [comments]);

  // 과거 댓글 작성자의 role 일괄 조회
  useEffect(() => {
    if (roleAuthorIds.length === 0) return;
    const cache = authorRoleCacheRef.current;
    const missing = roleAuthorIds.filter(uid => !cache.has(uid));
    if (missing.length === 0) {
      setAuthorRoleMap(new Map(cache));
      return;
    }
    Promise.all(
      missing.map((uid) =>
        userRepo
          .getRole(uid)
          .then((role) => {
            if (role) cache.set(uid, role);
          })
          .catch(() => {}),
      ),
    ).then(() => {
      setAuthorRoleMap(new Map(cache));
    });
  }, [roleAuthorIds]);

  // 교수님일 때 작성자 실명 일괄 조회
  useEffect(() => {
    if (!isProfessor || commentAuthorIds.length === 0) return;
    const cache = authorNameCacheRef.current;
    const missing = commentAuthorIds.filter(uid => !cache.has(uid));
    if (missing.length === 0) {
      setAuthorNameMap(new Map(cache));
      return;
    }
    Promise.all(
      missing.map((uid) =>
        userRepo
          .getName(uid)
          .then((name) => {
            if (name) cache.set(uid, name);
          })
          .catch(() => {}),
      ),
    ).then(() => {
      setAuthorNameMap(new Map(cache));
    });
  }, [isProfessor, commentAuthorIds]);

  // 교수 계정 댓글의 최신 닉네임 조회 (닉네임 변경 반영)
  useEffect(() => {
    if (professorAuthorIds.length === 0) return;
    const cache = authorNicknameCacheRef.current;
    const missing = professorAuthorIds.filter(uid => !cache.has(uid));
    if (missing.length === 0) {
      setAuthorNicknameMap(new Map(cache));
      return;
    }
    Promise.all(
      missing.map((uid) =>
        userRepo
          .getProfile(uid)
          .then((data) => {
            const nickname = data?.nickname as string | undefined;
            if (nickname) cache.set(uid, nickname);
          })
          .catch(() => {}),
      ),
    ).then(() => {
      setAuthorNicknameMap(new Map(cache));
    });
  }, [professorAuthorIds]);

  // 입력 중 내용은 cold reload에도 유지 (게시글별로 구분, 제출 시 clear)
  const [replyingTo, setReplyingTo] = useSessionState<{ id: string; nickname: string } | null>(
    `cmt:${postId}:replyTo`,
    null,
  );
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useSessionState<string | null>(`cmt:${postId}:editId`, null);
  const [content, setContent] = useSessionState<string>(`cmt:${postId}:content`, '');
  // File 객체는 직렬화 불가 → 기존 useState 유지 (이미지는 PWA cold reload 시 다시 첨부 필요)
  const [pendingImages, setPendingImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [linkedImageUrls, setLinkedImageUrls] = useSessionState<string[]>(`cmt:${postId}:linkedImgs`, []);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlInputValue, setUrlInputValue] = useState('');
  const urlInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputBarRef = useRef<HTMLDivElement>(null);

  // 하단 고정 입력바 높이 측정 → 댓글 목록 paddingBottom 로 반영 (가림 방지)
  const [inputBarHeight, setInputBarHeight] = useState(72);
  useEffect(() => {
    const el = inputBarRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setInputBarHeight(entry.contentRect.height);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [user]);

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

  // 링크 이미지 제거
  const removeLinkedImage = useCallback((index: number) => {
    setLinkedImageUrls(prev => prev.filter((_, i) => i !== index));
  }, []);

  // 이미지 URL 감지 패턴
  const IMAGE_URL_PATTERN = /^https?:\/\/\S+\.(?:jpg|jpeg|png|gif|webp|bmp|svg|tiff|ico|avif)(?:[?#]\S*)?$/i;
  const KNOWN_IMAGE_HOST_PATTERN = /^https?:\/\/(?:i\.imgur\.com|pbs\.twimg\.com|images\.unsplash\.com|lh[0-9]*\.googleusercontent\.com|firebasestorage\.googleapis\.com|encrypted-tbn[0-9]*\.gstatic\.com|blogfiles\.naver\.net|postfiles\.naver\.net|[a-z0-9-]+\.googleusercontent\.com|cdn\.discordapp\.com|media\.discordapp\.net|i\.namu\.wiki|upload\.wikimedia\.org|img\.icons8\.com)\//i;

  // 붙여넣기 시 이미지 URL 감지
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData('text').trim();
    if (!text) return;

    // 이미지 URL인지 확인
    if (IMAGE_URL_PATTERN.test(text) || KNOWN_IMAGE_HOST_PATTERN.test(text)) {
      const totalImages = pendingImages.length + linkedImageUrls.length;
      if (totalImages >= 5) return;
      if (linkedImageUrls.includes(text)) return;
      e.preventDefault();
      setLinkedImageUrls(prev => [...prev, text]);
    }
  }, [pendingImages.length, linkedImageUrls]);

  // URL 입력으로 이미지 추가
  const handleAddImageUrl = useCallback(() => {
    const url = urlInputValue.trim();
    if (!url) return;
    if (pendingImages.length + linkedImageUrls.length >= 5) return;
    if (linkedImageUrls.includes(url)) return;
    // 이미지 URL인지 검증 (확장자 또는 알려진 이미지 호스트)
    if (!IMAGE_URL_PATTERN.test(url) && !KNOWN_IMAGE_HOST_PATTERN.test(url)) {
      alert('이미지 URL만 추가할 수 있습니다.\n(jpg, png, gif, webp 등)');
      return;
    }
    setLinkedImageUrls(prev => [...prev, url]);
    setUrlInputValue('');
    // 입력칸에 포커스 유지
    setTimeout(() => urlInputRef.current?.focus(), 50);
  }, [urlInputValue, pendingImages.length, linkedImageUrls]);

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
      // 1) 채택된 댓글을 최상단으로 고정
      const aAccepted = a.isAccepted ? 1 : 0;
      const bAccepted = b.isAccepted ? 1 : 0;
      if (aAccepted !== bAccepted) return bAccepted - aAccepted;

      // 2) 좋아요 수 (본인 or 대댓글 중 최대값)
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

      // 3) 최신순
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    return rootComments;
  };

  const organizedComments = organizeComments(comments);

  // 댓글 제출
  const handleSubmit = useCallback(async () => {
    if ((!content.trim() && pendingImages.length === 0 && linkedImageUrls.length === 0) || !user) return;

    // 파일 이미지 업로드
    let uploadedUrls: string[] = [];
    if (pendingImages.length > 0) {
      uploadedUrls = await uploadMultipleImages(pendingImages);
    }

    // 업로드 URL + 링크 URL 합치기
    const allImageUrls = [...uploadedUrls, ...linkedImageUrls];

    const result = await createComment({
      postId,
      content: content.trim(),
      isAnonymous: false,
      parentId: replyingTo?.id,
      imageUrls: allImageUrls.length > 0 ? allImageUrls : undefined,
    });

    if (result) {
      setContent('');
      setPendingImages([]);
      imagePreviews.forEach(u => URL.revokeObjectURL(u));
      setImagePreviews([]);
      setLinkedImageUrls([]);
      setShowUrlInput(false);
      setUrlInputValue('');
      // 비공개 글(나만의 콩콩이): 스레드 대화 유지를 위해 답글 대상 보존
      // — 매번 답글 버튼을 누르지 않고도 같은 스레드에 계속 이어 댓글 가능
      if (!isPrivatePost) {
        setReplyingTo(null);
      }
      if (profile?.role !== 'professor') {
        setTimeout(() => {
          showExpToast(EXP_REWARDS.COMMENT_CREATE, '댓글 작성');
        }, 500);
      }
      refresh();
    }
  }, [content, pendingImages, linkedImageUrls, user, postId, replyingTo, createComment, uploadMultipleImages, refresh, showExpToast, imagePreviews, profile?.role, isPrivatePost]);

  const handleDelete = useCallback(async (commentId: string) => {
    setDeletingId(commentId);

    // 비공개 글(나만의 콩콩이) 의 루트 댓글: 대댓글(AI 답변) 포함 branch 전체 삭제
    const target = comments.find((c) => c.id === commentId);
    const isRoot = !!target && !target.parentId;
    if (isPrivatePost && isRoot) {
      try {
        await callFunction('deleteThread', { rootCommentId: commentId, postId });
        refresh();
      } catch (err) {
        console.error('branch 삭제 실패:', err);
        // fallback: 단일 댓글만이라도 삭제
        const success = await deleteComment(commentId, postId);
        if (success) refresh();
      }
      setDeletingId(null);
      return;
    }

    const success = await deleteComment(commentId, postId);
    if (success) refresh();
    setDeletingId(null);
  }, [deleteComment, postId, refresh, comments, isPrivatePost]);

  const handleEdit = useCallback(async (commentId: string, newContent: string, imageUrls?: string[]) => {
    setEditingId(commentId);
    const success = await updateComment(commentId, newContent, imageUrls);
    if (success) refresh();
    setEditingId(null);
  }, [updateComment, refresh]);

  // 댓글 수정 시 새 이미지 업로드
  const handleUploadEditImages = useCallback(async (files: File[]) => {
    return await uploadMultipleImages(files);
  }, [uploadMultipleImages]);

  const handleLike = useCallback(async (commentId: string) => {
    const success = await toggleCommentLike(commentId);
    if (success) refresh();
  }, [toggleCommentLike, refresh]);

  const checkIsLiked = useCallback((commentId: string) => {
    const comment = comments.find(c => c.id === commentId);
    return comment?.likedBy?.includes(user?.uid || '') || false;
  }, [comments, user?.uid]);

  const handleAccept = useCallback(async (commentId: string) => {
    const success = await acceptComment(postId, commentId);
    if (success && profile?.role !== 'professor') {
      setTimeout(() => {
        showExpToast(EXP_REWARDS.COMMENT_ACCEPTED, '댓글 채택');
      }, 500);
    }
  }, [acceptComment, postId, showExpToast, profile?.role]);

  const handleReply = useCallback((commentId: string, nickname: string) => {
    setReplyingTo({ id: commentId, nickname });
  }, []);

  const isSending = creating || uploading;

  // 채택 관련
  const isPostOwner = !!(user?.uid && postAuthorId && user.uid === postAuthorId);
  const hasAccepted = !!acceptedCommentId;

  // 채택 가능 여부: 글 작성자 + 아직 채택 안 함 + 루트 댓글 + 본인 댓글 아님 + AI 아님
  const canAcceptComment = useCallback((comment: Comment) => {
    return isPostOwner && !hasAccepted && !comment.parentId
      && comment.authorId !== user?.uid && comment.authorId !== 'gemini-ai';
  }, [isPostOwner, hasAccepted, user?.uid]);

  // 채택된 댓글 찾기
  const acceptedComment = useMemo(() => {
    if (!acceptedCommentId) return null;
    return comments.find(c => c.id === acceptedCommentId) || null;
  }, [acceptedCommentId, comments]);

  return (
    <>
      {/* 댓글 목록 — 하단 고정 입력바 높이만큼 paddingBottom 확보 (가림 방지) */}
      <div
        className="pt-4"
        style={{
          paddingBottom: user
            ? `calc(${inputBarHeight + 16}px + env(safe-area-inset-bottom, 0px))`
            : '1rem',
        }}
      >
        {/* 채택된 댓글은 CommentItem 자체가 초록 테두리로 강조 + 정렬 최상단 → 별도 박스 불필요 */}

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
              <div key={comment.id} id={`comment-${comment.id}`}>
                <CommentItem
                  comment={comment}
                  currentUserId={user?.uid}
                  onDelete={handleDelete}
                  onEdit={handleEdit}
                  onReply={() => handleReply(comment.id, comment.authorNickname)}
                  onLike={handleLike}
                  onAccept={handleAccept}
                  isLiked={checkIsLiked(comment.id)}
                  isDeleting={deletingId === comment.id}
                  isEditing={editingId === comment.id}
                  isPrivatePost={isPrivatePost}
                  canAccept={canAcceptComment(comment)}
                  isAccepting={accepting}
                  isProfessor={isProfessor}
                  authorNameMap={authorNameMap}
                  authorNicknameMap={authorNicknameMap}
                      authorRoleMap={authorRoleMap}
                  postAuthorId={postAuthorId}
                  onUploadImages={handleUploadEditImages}
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
                      onReply={() => handleReply(comment.id, comment.authorNickname)}
                      onLike={handleLike}
                      isLiked={checkIsLiked(reply.id)}
                      isDeleting={deletingId === reply.id}
                      isEditing={editingId === reply.id}
                      isReply
                      isPrivatePost={isPrivatePost}
                      isProfessor={isProfessor}
                      authorNameMap={authorNameMap}
                      authorNicknameMap={authorNicknameMap}
                      authorRoleMap={authorRoleMap}
                      postAuthorId={postAuthorId}
                      onUploadImages={handleUploadEditImages}
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
          ref={inputBarRef}
          data-kb-fixed
          className="fixed z-40 rounded-2xl bg-[#F5F0E8]/80 backdrop-blur-xl shadow-[0_4px_24px_rgba(0,0,0,0.12)] border border-[#D4CFC4]/60 overflow-hidden will-change-[bottom]"
          style={{
            left: isWide
              ? isPanelMode ? 'calc(50% + 120px + 0.75rem)' : 'calc(var(--detail-panel-left, 0px) + 0.75rem)'
              : '0.75rem',
            right: isWide
              ? isPanelMode ? '0.75rem' : 'calc(var(--detail-panel-right, 0px) + 0.75rem)'
              : '0.75rem',
            bottom: 'var(--kb-offset, 0px)',
          }}
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

          {/* URL 입력 패널 */}
          <AnimatePresence>
            {showUrlInput && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="flex items-center gap-2 px-4 py-2 border-b border-[#D4CFC4]/40">
                  <input
                    ref={urlInputRef}
                    type="url"
                    value={urlInputValue}
                    onChange={(e) => setUrlInputValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddImageUrl(); } }}
                    placeholder="이미지 URL 붙여넣기"
                    className="flex-1 px-2.5 py-1.5 text-xs outline-none rounded-lg"
                    style={{
                      border: '1px solid rgba(180, 175, 165, 0.6)',
                      backgroundColor: 'rgba(245, 240, 232, 0.5)',
                      color: theme.colors.text,
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleAddImageUrl}
                    disabled={!urlInputValue.trim() || pendingImages.length + linkedImageUrls.length >= 5}
                    className="flex-shrink-0 px-2.5 py-1.5 text-xs font-bold disabled:opacity-30 rounded-lg"
                    style={{ backgroundColor: '#1A1A1A', color: '#F5F0E8' }}
                  >
                    추가
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowUrlInput(false); setUrlInputValue(''); }}
                    className="flex-shrink-0 text-[#999] p-0.5"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 이미지 프리뷰 (파일 + 링크) */}
          {(imagePreviews.length > 0 || linkedImageUrls.length > 0) && (
            <div className="flex gap-2 px-4 pt-2 overflow-x-auto">
              {imagePreviews.map((preview, index) => (
                <div key={`file-${index}`} className="relative flex-shrink-0 w-16 h-16">
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
              {linkedImageUrls.map((url, index) => (
                <div key={`link-${index}`} className="relative flex-shrink-0 h-16">
                  <img src={url} alt="" className="h-full w-auto object-contain rounded-sm border border-dashed border-[#1A1A1A]" />
                  <button
                    type="button"
                    onClick={() => removeLinkedImage(index)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-[#1A1A1A] text-[#F5F0E8] rounded-full flex items-center justify-center text-xs"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 입력 영역 */}
          <div className="flex items-center gap-2 px-4 py-2.5">
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
            {/* URL로 이미지 추가 버튼 */}
            <button
              type="button"
              onClick={() => { setShowUrlInput(v => !v); setTimeout(() => urlInputRef.current?.focus(), 100); }}
              disabled={isSending}
              className={`flex-shrink-0 transition-colors disabled:opacity-30 ${showUrlInput ? 'text-[#1A1A1A]' : 'text-[#3A3A3A] hover:text-[#1A1A1A]'}`}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              tabIndex={-1}
              className="hidden"
              onChange={handleImageSelect}
            />

            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder={replyingTo ? `${replyingTo.nickname}님에게 답글...` : '의견을 남겨주세요...'}
              rows={1}
              maxLength={500}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
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
              disabled={(!content.trim() && pendingImages.length === 0 && linkedImageUrls.length === 0) || isSending}
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
