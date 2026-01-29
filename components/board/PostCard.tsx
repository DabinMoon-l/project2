'use client';

import { motion } from 'framer-motion';
import type { Post } from '@/lib/hooks/useBoard';
import NoticeTag from './NoticeTag';

interface PostCardProps {
  /** 게시글 데이터 */
  post: Post;
  /** 클릭 핸들러 */
  onClick: () => void;
}

/**
 * 게시글 카드 컴포넌트
 *
 * 게시글 목록에서 각 게시글을 표시하는 카드입니다.
 * 제목, 작성자, 좋아요 수, 댓글 수를 표시합니다.
 */
export default function PostCard({ post, onClick }: PostCardProps) {
  // 날짜 포맷팅
  const formatDate = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diff / (1000 * 60));
    const diffHours = Math.floor(diff / (1000 * 60 * 60));
    const diffDays = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (diffMinutes < 1) return '방금 전';
    if (diffMinutes < 60) return `${diffMinutes}분 전`;
    if (diffHours < 24) return `${diffHours}시간 전`;
    if (diffDays < 7) return `${diffDays}일 전`;

    return date.toLocaleDateString('ko-KR', {
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <motion.article
      onClick={onClick}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.99 }}
      className="
        p-4 bg-white rounded-2xl shadow-sm
        border border-gray-100
        cursor-pointer
        transition-shadow duration-200
        hover:shadow-md
      "
    >
      {/* 헤더: 공지 태그 + 작성 시간 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {post.isNotice && <NoticeTag />}
          <span className="text-xs text-gray-400">
            {formatDate(post.createdAt)}
          </span>
        </div>
      </div>

      {/* 제목 */}
      <h3 className="text-base font-semibold text-gray-900 mb-1 line-clamp-1">
        {post.title}
      </h3>

      {/* 내용 미리보기 */}
      <p className="text-sm text-gray-500 mb-3 line-clamp-2">{post.content}</p>

      {/* 푸터: 작성자, 좋아요, 댓글 */}
      <div className="flex items-center justify-between">
        {/* 작성자 */}
        <span className="text-xs text-gray-500">
          {post.isAnonymous ? '익명' : post.authorNickname}
        </span>

        {/* 좋아요, 댓글 수 */}
        <div className="flex items-center gap-3">
          {/* 좋아요 */}
          <div className="flex items-center gap-1 text-gray-400">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
              />
            </svg>
            <span className="text-xs">{post.likes}</span>
          </div>

          {/* 댓글 */}
          <div className="flex items-center gap-1 text-gray-400">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
            <span className="text-xs">{post.commentCount}</span>
          </div>
        </div>
      </div>
    </motion.article>
  );
}
