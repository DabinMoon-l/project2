'use client';

import { useCallback, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useTheme } from '@/styles/themes/useTheme';
import { Skeleton } from '@/components/common';
import {
  useMyPosts,
  useDeletePost,
  useMyComments,
  useDeleteComment,
  useMyLikedPosts,
  type Post,
  type Comment,
} from '@/lib/hooks/useBoard';

/**
 * 날짜 포맷 (신문 스타일)
 */
function formatDate(date: Date) {
  return date.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * 내 글 카드 컴포넌트 - 신문 스타일
 */
function MyPostCard({
  post,
  onClick,
  onDelete,
}: {
  post: Post;
  onClick: () => void;
  onDelete: () => void;
}) {
  const { theme } = useTheme();

  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="border-b border-[#D4CFC4] pb-3 mb-3"
    >
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left group"
      >
        <h3
          className="text-base font-bold leading-tight mb-1 group-hover:underline line-clamp-1"
          style={{ color: theme.colors.text }}
        >
          {post.title}
        </h3>
        <p
          className="text-xs leading-relaxed line-clamp-2 mb-2"
          style={{ color: theme.colors.textSecondary }}
        >
          {post.content}
        </p>
      </button>

      <div className="flex items-center justify-between">
        <div
          className="flex items-center gap-3 text-xs"
          style={{ color: theme.colors.textSecondary }}
        >
          <span>{formatDate(post.createdAt)}</span>
          <span>♥ {post.likes}</span>
          <span>댓글 {post.commentCount}</span>
        </div>

        <motion.button
          type="button"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="px-2 py-1 text-xs transition-colors"
          style={{
            border: '1px solid #8B1A1A',
            color: '#8B1A1A',
          }}
        >
          삭제
        </motion.button>
      </div>
    </motion.article>
  );
}

/**
 * 내 댓글 카드 컴포넌트
 * - 클릭 시 해당 게시물로 이동 (수정은 게시물 상세에서)
 */
function MyCommentCard({
  comment,
  onDelete,
  onGoToPost,
}: {
  comment: Comment & { postTitle?: string };
  onDelete: (commentId: string, postId: string) => void;
  onGoToPost: (postId: string) => void;
}) {
  const { theme } = useTheme();

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="border-b border-[#D4CFC4] pb-3 mb-3"
    >
      {/* 게시글 제목 - 클릭 시 이동 */}
      <button
        type="button"
        onClick={() => onGoToPost(comment.postId)}
        className="text-xs mb-1 hover:underline truncate block w-full text-left"
        style={{ color: theme.colors.accent }}
      >
        {comment.postTitle || '삭제된 게시글'}
      </button>

      {/* 댓글 내용 - 클릭 시 게시물로 이동 */}
      <button
        type="button"
        onClick={() => onGoToPost(comment.postId)}
        className="w-full text-left"
      >
        <p
          className="text-sm leading-relaxed line-clamp-2 break-all mb-2 hover:bg-[#EDEAE4] p-1 -ml-1 transition-colors"
          style={{ color: theme.colors.text }}
        >
          {comment.content}
        </p>
      </button>

      {/* 날짜 및 삭제 버튼 */}
      <div className="flex items-center justify-between">
        <span
          className="text-xs"
          style={{ color: theme.colors.textSecondary }}
        >
          {formatDate(comment.createdAt)}
        </span>

        <motion.button
          type="button"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => onDelete(comment.id, comment.postId)}
          className="px-2 py-1 text-xs transition-colors"
          style={{
            border: '1px solid #8B1A1A',
            color: '#8B1A1A',
          }}
        >
          삭제
        </motion.button>
      </div>
    </motion.div>
  );
}

/**
 * 좋아요한 글 카드 컴포넌트 (가로 스크롤용)
 */
function LikedPostCard({
  post,
  onClick,
}: {
  post: Post;
  onClick: () => void;
}) {
  const { theme } = useTheme();

  return (
    <motion.article
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="flex-shrink-0 w-48 p-3 cursor-pointer"
      style={{
        border: '1px solid #1A1A1A',
        backgroundColor: theme.colors.backgroundCard,
      }}
    >
      <h3
        className="text-sm font-bold leading-tight mb-1 line-clamp-2"
        style={{ color: theme.colors.text }}
      >
        {post.title}
      </h3>
      <p
        className="text-xs leading-relaxed line-clamp-2 mb-2"
        style={{ color: theme.colors.textSecondary }}
      >
        {post.content}
      </p>
      <div
        className="flex items-center gap-2 text-xs"
        style={{ color: theme.colors.textSecondary }}
      >
        <span>♥ {post.likes}</span>
        <span>댓글 {post.commentCount}</span>
      </div>
    </motion.article>
  );
}

/**
 * 관리 페이지 - 신문 스타일 (기사 + 댓글 1:1 + 좋아요)
 */
export default function ManagePostsPage() {
  const router = useRouter();
  const { theme } = useTheme();
  const likesScrollRef = useRef<HTMLDivElement>(null);

  // 내 글 관련
  const { posts, loading: postsLoading, error: postsError, hasMore, loadMore, refresh: refreshPosts } = useMyPosts();
  const { deletePost, loading: deleting } = useDeletePost();

  // 내 댓글 관련
  const { comments, loading: commentsLoading, error: commentsError, refresh: refreshComments } = useMyComments();
  const { deleteComment } = useDeleteComment();

  // 내가 좋아요한 글 관련
  const { posts: likedPosts, loading: likedLoading, error: likedError, refresh: refreshLiked } = useMyLikedPosts();

  /**
   * 글 클릭 핸들러
   */
  const handlePostClick = useCallback((postId: string) => {
    router.push(`/board/${postId}`);
  }, [router]);

  /**
   * 글 삭제 핸들러
   */
  const handleDeletePost = useCallback(async (postId: string) => {
    if (window.confirm('이 기사를 삭제하시겠습니까?')) {
      const success = await deletePost(postId);
      if (success) {
        refreshPosts();
      }
    }
  }, [deletePost, refreshPosts]);

  /**
   * 댓글 삭제 핸들러
   */
  const handleDeleteComment = useCallback(async (commentId: string, postId: string) => {
    if (window.confirm('이 댓글을 삭제하시겠습니까?')) {
      const success = await deleteComment(commentId, postId);
      if (success) {
        refreshComments();
      }
    }
  }, [deleteComment, refreshComments]);

  /**
   * 뒤로가기
   */
  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  return (
    <div
      className="min-h-screen pb-28"
      style={{ backgroundColor: theme.colors.background }}
    >
      {/* 신문 헤더 */}
      <header className="border-b-4 border-double border-[#1A1A1A] mx-4 mt-4 pb-4">
        {/* 뒤로가기 */}
        <button
          onClick={handleBack}
          className="flex items-center gap-2 text-sm py-2 mb-4"
          style={{ color: theme.colors.textSecondary }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          <span>Back to Headlines</span>
        </button>

        {/* 신문 제목 */}
        <div className="text-center">
          <h1 className="font-serif-display text-3xl font-black tracking-tight text-[#1A1A1A]">
            JIBDAN JISUNG
          </h1>
          <p className="text-sm text-[#3A3A3A] mt-1  italic">
            "My Content Management"
          </p>
        </div>
      </header>

      {/* 페이지 제목 */}
      <div className="px-4 pt-6 pb-4">
        <div className="flex items-center justify-center gap-4">
          <div className="flex-1 h-px bg-[#1A1A1A]" />
          <h2 className="font-serif-display text-xl font-bold text-[#1A1A1A]">
            MANAGE
          </h2>
          <div className="flex-1 h-px bg-[#1A1A1A]" />
        </div>
        <p className="text-center text-sm  italic mt-2" style={{ color: theme.colors.textSecondary }}>
          내가 작성한 기사와 댓글, 좋아요한 글 관리
        </p>
      </div>

      {/* 메인 컨텐츠 */}
      <main className="px-4 space-y-4">
        {/* 상단: 기사 + 댓글 1:1 레이아웃 */}
        <div className="grid grid-cols-2 gap-4">
          {/* 좌측: 내 기사 */}
          <div
            className="p-4 h-[45vh] flex flex-col"
            style={{
              border: '1px solid #1A1A1A',
              backgroundColor: theme.colors.backgroundCard,
            }}
          >
            {/* 섹션 제목 */}
            <div className="flex items-center gap-2 mb-4 pb-2 border-b-2 border-[#1A1A1A] flex-shrink-0">
              <h3 className="text-sm font-bold text-[#1A1A1A]">
                MY ARTICLES
              </h3>
              <span className="text-xs" style={{ color: theme.colors.textSecondary }}>
                ({posts.length})
              </span>
            </div>

            {/* 에러 상태 */}
            {postsError && (
              <div className="p-3 text-xs text-center border border-[#1A1A1A] mb-3 flex-shrink-0">
                <span style={{ color: '#8B1A1A' }}>{postsError}</span>
                <button
                  type="button"
                  onClick={refreshPosts}
                  className="ml-2 underline"
                >
                  다시 시도
                </button>
              </div>
            )}

            {/* 로딩 상태 */}
            {postsLoading && posts.length === 0 && (
              <div className="space-y-3 flex-shrink-0">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="border-b border-[#D4CFC4] pb-3">
                    <Skeleton className="w-3/4 h-5 mb-2 rounded-none" />
                    <Skeleton className="w-full h-8 mb-2 rounded-none" />
                    <div className="flex gap-3">
                      <Skeleton className="w-20 h-3 rounded-none" />
                      <Skeleton className="w-12 h-3 rounded-none" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 빈 상태 */}
            {!postsLoading && posts.length === 0 && !postsError && (
              <div className="py-8 text-center flex-1 flex items-center justify-center">
                <p className="text-sm " style={{ color: theme.colors.textSecondary }}>
                  작성한 기사가 없습니다
                </p>
              </div>
            )}

            {/* 기사 목록 (스크롤 가능) */}
            <div className="flex-1 overflow-y-auto">
              {posts.map((post) => (
                <MyPostCard
                  key={post.id}
                  post={post}
                  onClick={() => handlePostClick(post.id)}
                  onDelete={() => handleDeletePost(post.id)}
                />
              ))}

              {/* 더 보기 버튼 */}
              {hasMore && (
                <div className="text-center pt-3">
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={loadMore}
                    disabled={postsLoading}
                    className="text-xs text-[#1A1A1A] hover:underline disabled:opacity-50"
                  >
                    {postsLoading ? 'Loading...' : 'More →'}
                  </motion.button>
                </div>
              )}
            </div>
          </div>

          {/* 우측: 내 댓글 */}
          <div
            className="p-4 h-[45vh] flex flex-col"
            style={{
              border: '1px solid #1A1A1A',
              backgroundColor: theme.colors.backgroundCard,
            }}
          >
            {/* 섹션 제목 */}
            <div className="flex items-center gap-2 mb-4 pb-2 border-b-2 border-[#1A1A1A] flex-shrink-0">
              <h3 className="text-sm font-bold text-[#1A1A1A]">
                MY COMMENTS
              </h3>
              <span className="text-xs" style={{ color: theme.colors.textSecondary }}>
                ({comments.length})
              </span>
            </div>

            {/* 에러 상태 */}
            {commentsError && (
              <div className="p-3 text-xs text-center border border-[#1A1A1A] mb-3 flex-shrink-0">
                <span style={{ color: '#8B1A1A' }}>{commentsError}</span>
                <button
                  type="button"
                  onClick={refreshComments}
                  className="ml-2 underline"
                >
                  다시 시도
                </button>
              </div>
            )}

            {/* 로딩 상태 */}
            {commentsLoading && comments.length === 0 && (
              <div className="space-y-3 flex-shrink-0">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="border-b border-[#D4CFC4] pb-3">
                    <Skeleton className="w-1/2 h-3 mb-2 rounded-none" />
                    <Skeleton className="w-full h-8 mb-2 rounded-none" />
                    <div className="flex gap-3">
                      <Skeleton className="w-20 h-3 rounded-none" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 빈 상태 */}
            {!commentsLoading && comments.length === 0 && !commentsError && (
              <div className="py-8 text-center flex-1 flex items-center justify-center">
                <p className="text-sm " style={{ color: theme.colors.textSecondary }}>
                  작성한 댓글이 없습니다
                </p>
              </div>
            )}

            {/* 댓글 목록 (스크롤 가능) */}
            <div className="flex-1 overflow-y-auto">
              {comments.map((comment) => (
                <MyCommentCard
                  key={comment.id}
                  comment={comment}
                  onDelete={handleDeleteComment}
                  onGoToPost={handlePostClick}
                />
              ))}
            </div>
          </div>
        </div>

        {/* 하단: 좋아요한 글 (가로 슬라이드) */}
        <div
          className="p-4"
          style={{
            border: '1px solid #1A1A1A',
            backgroundColor: theme.colors.backgroundCard,
          }}
        >
          {/* 섹션 제목 */}
          <div className="flex items-center gap-2 mb-4 pb-2 border-b-2 border-[#1A1A1A]">
            <h3 className="text-sm font-bold text-[#1A1A1A]">
              MY LIKES
            </h3>
            <span className="text-xs" style={{ color: theme.colors.textSecondary }}>
              ({likedPosts.length})
            </span>
          </div>

          {/* 에러 상태 */}
          {likedError && (
            <div className="p-3 text-xs text-center border border-[#1A1A1A] mb-3">
              <span style={{ color: '#8B1A1A' }}>{likedError}</span>
              <button
                type="button"
                onClick={refreshLiked}
                className="ml-2 underline"
              >
                다시 시도
              </button>
            </div>
          )}

          {/* 로딩 상태 */}
          {likedLoading && likedPosts.length === 0 && (
            <div className="flex gap-3 overflow-hidden">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex-shrink-0 w-48 p-3 border border-[#D4CFC4]">
                  <Skeleton className="w-full h-10 mb-2 rounded-none" />
                  <Skeleton className="w-3/4 h-8 mb-2 rounded-none" />
                  <Skeleton className="w-1/2 h-3 rounded-none" />
                </div>
              ))}
            </div>
          )}

          {/* 빈 상태 */}
          {!likedLoading && likedPosts.length === 0 && !likedError && (
            <div className="py-6 text-center">
              <p className="text-sm " style={{ color: theme.colors.textSecondary }}>
                좋아요한 기사가 없습니다
              </p>
            </div>
          )}

          {/* 좋아요한 글 목록 (가로 스크롤) */}
          {likedPosts.length > 0 && (
            <div
              ref={likesScrollRef}
              className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-[#1A1A1A] scrollbar-track-transparent"
              style={{
                scrollSnapType: 'x mandatory',
              }}
            >
              {likedPosts.map((post) => (
                <div key={post.id} style={{ scrollSnapAlign: 'start' }}>
                  <LikedPostCard
                    post={post}
                    onClick={() => handlePostClick(post.id)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* 하단 장식 */}
      <div className="mt-8 mx-4">
        <div className="border-t-4 border-double border-[#1A1A1A] pt-2">
          <p className="text-center text-sm text-[#3A3A3A]  italic">
            © {new Date().getFullYear()} Jibdan Jisung. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}
