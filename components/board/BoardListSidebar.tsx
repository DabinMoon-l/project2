'use client';

/**
 * 게시판 리스트 사이드바 (가로모드 전용)
 *
 * 가로모드에서 게시판 상세(/board/[id]) 진입 시
 * 좌측에 게시글 목록을 표시하는 간소화된 사이드바.
 */

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { collection, query, where, orderBy, getDocs, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useCourse } from '@/lib/contexts';

interface SidebarPost {
  id: string;
  title: string;
  authorNickname: string;
  createdAt: number;
  isPinned: boolean;
  commentCount: number;
}

export default function BoardListSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { userCourseId } = useCourse();
  const [posts, setPosts] = useState<SidebarPost[]>([]);
  const [loading, setLoading] = useState(true);

  // URL에서 현재 게시글 ID 추출
  const currentPostId = pathname?.match(/^\/board\/([^/]+)/)?.[1] || null;

  // 게시글 목록 로드
  useEffect(() => {
    if (!userCourseId) return;

    const loadPosts = async () => {
      try {
        const q = query(
          collection(db, 'posts'),
          where('courseId', '==', userCourseId),
          orderBy('createdAt', 'desc'),
          limit(50)
        );
        const snap = await getDocs(q);
        const items: SidebarPost[] = snap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id,
            title: data.title || '제목 없음',
            authorNickname: data.authorNickname || '익명',
            createdAt: data.createdAt?.toMillis?.() || 0,
            isPinned: data.isPinned || false,
            commentCount: data.commentCount || 0,
          };
        });

        // 고정글 우선 → 최신순
        items.sort((a, b) => {
          if (a.isPinned && !b.isPinned) return -1;
          if (!a.isPinned && b.isPinned) return 1;
          return b.createdAt - a.createdAt;
        });

        setPosts(items);
      } catch (err) {
        console.error('사이드바 게시글 로드 오류:', err);
      } finally {
        setLoading(false);
      }
    };

    loadPosts();
  }, [userCourseId]);

  return (
    <div className="h-screen overflow-y-auto scrollbar-hide" style={{ backgroundColor: '#F5F0E8' }}>
      {/* 헤더 */}
      <div
        className="sticky top-0 z-10 px-4 py-3 flex items-center gap-2"
        style={{
          backgroundColor: '#F5F0E8',
          borderBottom: '1px solid #D4CFC4',
          paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))',
        }}
      >
        <button
          onClick={() => router.push('/board')}
          className="flex items-center gap-1.5 text-sm font-bold text-[#1A1A1A] hover:text-[#5C5C5C] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          게시판
        </button>
      </div>

      {/* 게시글 리스트 */}
      {loading ? (
        <div className="p-4 space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-16 bg-[#EBE5D9] animate-pulse rounded-lg" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="p-8 text-center text-sm text-[#5C5C5C]">게시글이 없습니다</div>
      ) : (
        <div className="px-3 py-3">
          {posts.map(post => {
            const isActive = currentPostId === post.id;
            return (
              <button
                key={post.id}
                onClick={() => router.push(`/board/${post.id}`)}
                className={`w-full text-left px-3 py-2.5 rounded-lg mb-0.5 transition-all duration-200 ${
                  isActive
                    ? 'bg-[#1A1A1A] text-[#F5F0E8]'
                    : 'hover:bg-[#EBE5D9] text-[#1A1A1A]'
                }`}
              >
                <div className="flex items-center gap-2">
                  {post.isPinned && (
                    <svg
                      className="w-3 h-3 flex-shrink-0"
                      fill={isActive ? '#F5F0E8' : '#B8860B'}
                      viewBox="0 0 20 20"
                    >
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                  )}
                  <span className={`text-sm font-medium truncate ${isActive ? '' : ''}`}>
                    {post.title}
                  </span>
                </div>
                <div className={`flex items-center gap-2 text-xs mt-0.5 ${post.isPinned ? 'pl-5' : ''} ${
                  isActive ? 'text-[#F5F0E8]/60' : 'text-[#5C5C5C]'
                }`}>
                  <span>{post.authorNickname}</span>
                  {post.commentCount > 0 && (
                    <span>· 댓글 {post.commentCount}</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
