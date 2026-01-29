'use client';

import { useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import PostCard from './PostCard';
import type { Post } from '@/lib/hooks/useBoard';

interface PostListProps {
  /** 게시글 목록 */
  posts: Post[];
  /** 로딩 상태 */
  loading: boolean;
  /** 더 불러올 글이 있는지 */
  hasMore: boolean;
  /** 추가 로드 함수 */
  onLoadMore: () => void;
  /** 게시글 클릭 핸들러 */
  onPostClick: (postId: string) => void;
  /** 빈 상태 메시지 */
  emptyMessage?: string;
}

/**
 * 게시글 목록 컴포넌트
 *
 * 무한 스크롤을 지원하는 게시글 목록입니다.
 * Intersection Observer를 사용하여 스크롤 감지를 처리합니다.
 */
export default function PostList({
  posts,
  loading,
  hasMore,
  onLoadMore,
  onPostClick,
  emptyMessage = '게시글이 없습니다.',
}: PostListProps) {
  // 무한 스크롤을 위한 observer ref
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  // 무한 스크롤 콜백
  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [entry] = entries;
      if (entry.isIntersecting && hasMore && !loading) {
        onLoadMore();
      }
    },
    [hasMore, loading, onLoadMore]
  );

  // Intersection Observer 설정
  useEffect(() => {
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    observerRef.current = new IntersectionObserver(handleObserver, {
      root: null,
      rootMargin: '100px',
      threshold: 0.1,
    });

    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current);
    }

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [handleObserver]);

  // 빈 상태
  if (!loading && posts.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex flex-col items-center justify-center py-16 text-gray-400"
      >
        {/* 빈 아이콘 */}
        <svg
          className="w-16 h-16 mb-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
        <p className="text-sm">{emptyMessage}</p>
      </motion.div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 게시글 목록 */}
      {posts.map((post, index) => (
        <motion.div
          key={post.id}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.05 }}
        >
          <PostCard post={post} onClick={() => onPostClick(post.id)} />
        </motion.div>
      ))}

      {/* 로딩 인디케이터 */}
      {loading && (
        <div className="flex justify-center py-4">
          <motion.div
            className="w-8 h-8 border-3 border-theme-accent border-t-transparent rounded-full"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          />
        </div>
      )}

      {/* 무한 스크롤 트리거 */}
      {hasMore && <div ref={loadMoreRef} className="h-4" />}

      {/* 더 이상 글이 없음 */}
      {!loading && !hasMore && posts.length > 0 && (
        <p className="text-center text-sm text-gray-400 py-4">
          모든 게시글을 불러왔습니다.
        </p>
      )}
    </div>
  );
}
