'use client';

import { useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';
import { Header, Skeleton, Button } from '@/components/common';
import NoticeTag from '@/components/board/NoticeTag';
import LikeButton from '@/components/board/LikeButton';
import CommentSection from '@/components/board/CommentSection';
import { usePost, useDeletePost, useLike } from '@/lib/hooks/useBoard';
import { useAuth } from '@/lib/hooks/useAuth';

/**
 * 게시글 상세 페이지
 */
export default function PostDetailPage() {
  const params = useParams();
  const router = useRouter();
  const postId = params.id as string;

  const { user } = useAuth();
  const { post, loading, error, refresh } = usePost(postId);
  const { deletePost, loading: deleting } = useDeletePost();
  const { toggleLike, isLiked } = useLike();

  // 본인 글인지 확인
  const isOwner = user?.uid === post?.authorId;

  /**
   * 삭제 핸들러
   */
  const handleDelete = useCallback(async () => {
    if (!window.confirm('정말 삭제하시겠습니까?')) return;

    const success = await deletePost(postId);
    if (success) {
      router.back();
    }
  }, [deletePost, postId, router]);

  /**
   * 좋아요 핸들러
   */
  const handleLike = useCallback(async () => {
    await toggleLike(postId);
    refresh();
  }, [toggleLike, postId, refresh]);

  // 로딩 상태
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header title="게시글" showBack />
        <div className="p-4 space-y-4">
          <Skeleton className="w-3/4 h-8" />
          <div className="flex gap-2">
            <Skeleton className="w-20 h-4" />
            <Skeleton className="w-20 h-4" />
          </div>
          <Skeleton className="w-full h-48" />
        </div>
      </div>
    );
  }

  // 에러 상태
  if (error || !post) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header title="게시글" showBack />
        <div className="flex flex-col items-center justify-center py-16 px-4">
          <div className="text-6xl mb-4">😢</div>
          <h3 className="text-lg font-bold text-gray-800 mb-2">
            {error || '게시글을 찾을 수 없습니다'}
          </h3>
          <Button variant="secondary" onClick={() => router.back()}>
            돌아가기
          </Button>
        </div>
      </div>
    );
  }

  // 시간 포맷
  const timeAgo = formatDistanceToNow(post.createdAt, {
    addSuffix: true,
    locale: ko,
  });

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* 헤더 */}
      <Header
        title={post.category === 'toProfessor' ? 'To 교수님' : '우리들끼리'}
        showBack
      />

      {/* 메인 컨텐츠 */}
      <main className="px-4 py-4 space-y-4">
        {/* 게시글 카드 */}
        <motion.article
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl shadow-sm overflow-hidden"
        >
          {/* 헤더 영역 */}
          <div className="p-4 border-b border-gray-100">
            {/* 공지 태그 */}
            {post.isNotice && (
              <div className="mb-2">
                <NoticeTag />
              </div>
            )}

            {/* 제목 */}
            <h1 className="text-xl font-bold text-gray-800 mb-3">
              {post.title}
            </h1>

            {/* 작성자 정보 */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {/* 프로필 */}
                <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
                  <span className="text-lg">
                    {post.isAnonymous ? '🎭' : '🐰'}
                  </span>
                </div>
                <div>
                  <p className={`font-medium ${post.isAnonymous ? 'text-gray-500' : 'text-gray-800'}`}>
                    {post.authorNickname}
                  </p>
                  <p className="text-xs text-gray-400">{timeAgo}</p>
                </div>
              </div>

              {/* 수정/삭제 버튼 */}
              {isOwner && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={deleting}
                    className="px-3 py-1 text-sm text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {deleting ? '삭제 중...' : '삭제'}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 본문 */}
          <div className="p-4">
            <p className="text-gray-700 whitespace-pre-wrap leading-relaxed">
              {post.content}
            </p>

            {/* 이미지 */}
            {post.imageUrl && (
              <div className="mt-4">
                <img
                  src={post.imageUrl}
                  alt="첨부 이미지"
                  className="w-full rounded-xl"
                />
              </div>
            )}
          </div>

          {/* 좋아요/댓글 영역 */}
          <div className="px-4 py-3 border-t border-gray-100 flex items-center gap-4">
            <LikeButton
              likes={post.likes}
              isLiked={isLiked(postId)}
              onToggle={handleLike}
            />
            <div className="flex items-center gap-1 text-gray-500">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
              <span className="text-sm">{post.commentCount}</span>
            </div>
          </div>
        </motion.article>

        {/* 댓글 섹션 */}
        <CommentSection postId={postId} />
      </main>
    </div>
  );
}
