'use client';

import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { Header, Skeleton } from '@/components/common';
import BoardTabs from '@/components/board/BoardTabs';
import PostCard from '@/components/board/PostCard';
import PostList from '@/components/board/PostList';
import { usePosts, useLike, type BoardCategory } from '@/lib/hooks/useBoard';

/**
 * 게시판 메인 페이지
 *
 * To 교수님 / 우리들끼리 탭으로 구분된 게시판입니다.
 */
export default function BoardPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<BoardCategory>('toProfessor');

  // 게시글 목록
  const { posts, loading, error, hasMore, loadMore, refresh } = usePosts(activeTab);

  // 좋아요 기능
  const { toggleLike, isLiked } = useLike();

  /**
   * 글 클릭 핸들러
   */
  const handlePostClick = useCallback((postId: string) => {
    router.push(`/board/${postId}`);
  }, [router]);

  /**
   * 글 작성 버튼 클릭
   */
  const handleWriteClick = useCallback(() => {
    router.push(`/board/write?category=${activeTab}`);
  }, [router, activeTab]);

  /**
   * 탭 변경
   */
  const handleTabChange = useCallback((tab: BoardCategory) => {
    setActiveTab(tab);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* 헤더 */}
      <Header title="게시판" />

      {/* 메인 컨텐츠 */}
      <main className="px-4 py-4 space-y-4">
        {/* 탭 */}
        <BoardTabs activeTab={activeTab} onTabChange={handleTabChange} />

        {/* 에러 상태 */}
        {error && (
          <div className="p-4 bg-red-50 text-red-600 rounded-xl text-sm text-center">
            {error}
            <button
              type="button"
              onClick={refresh}
              className="ml-2 underline"
            >
              다시 시도
            </button>
          </div>
        )}

        {/* 로딩 상태 */}
        {loading && posts.length === 0 && (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-white rounded-2xl p-4 shadow-sm">
                <Skeleton className="w-3/4 h-5 mb-2" />
                <Skeleton className="w-full h-12 mb-3" />
                <div className="flex gap-4">
                  <Skeleton className="w-16 h-4" />
                  <Skeleton className="w-16 h-4" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 빈 상태 */}
        {!loading && posts.length === 0 && !error && (
          <div className="py-16 text-center">
            <div className="text-6xl mb-4">📝</div>
            <h3 className="text-lg font-bold text-gray-800 mb-2">
              아직 글이 없어요
            </h3>
            <p className="text-sm text-gray-500 mb-6">
              첫 번째 글을 작성해보세요!
            </p>
            <motion.button
              type="button"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleWriteClick}
              className="px-6 py-2 bg-theme-accent text-white font-medium rounded-xl"
            >
              글 작성하기
            </motion.button>
          </div>
        )}

        {/* 게시글 목록 */}
        {posts.length > 0 && (
          <PostList
            posts={posts}
            onPostClick={handlePostClick}
            hasMore={hasMore}
            onLoadMore={loadMore}
            loading={loading}
          />
        )}
      </main>

      {/* 글 작성 FAB */}
      {posts.length > 0 && (
        <motion.button
          type="button"
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={handleWriteClick}
          className="
            fixed right-4 bottom-24
            w-14 h-14
            flex items-center justify-center
            bg-theme-accent text-white
            rounded-full shadow-lg
            z-40
          "
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </motion.button>
      )}
    </div>
  );
}
