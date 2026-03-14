'use client';

import { useCallback, useState, useMemo, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { collection, query, where, getDocs, onSnapshot, db } from '@/lib/repositories';
import { useTheme } from '@/styles/themes/useTheme';
import { Skeleton } from '@/components/common';
import { useUser, useCourse } from '@/lib/contexts';
import {
  useMyPosts,
  useDeletePost,
  useMyComments,
  useDeleteComment,
  useMyLikedPosts,
  useAllPostsForCourse,
  type Post,
  type Comment,
  type BoardTag,
  BOARD_TAGS,
} from '@/lib/hooks/useBoard';
import type { CourseId } from '@/lib/types/course';
import { scaleCoord } from '@/lib/hooks/useViewportScale';
import {
  SpiralWordCloud,
  CLASS_COLORS,
  CLOUD_COLORS,
} from './boardManageParts';
import type { ArchiveComment, ArchivePost } from './boardManageParts';


// 서브 컴포넌트 → 별도 파일로 분리
import {
  AcademicArchiveSection,
  ActivitySection,
  MyPostCard,
  MyCommentCard,
  LikedPostCard,
  formatDate,
} from './boardManageSections';

// ============================================================
// 메인 페이지
// ============================================================

export default function ManagePostsPage() {
  const router = useRouter();
  const { theme } = useTheme();
  const { profile } = useUser();
  const isProfessor = profile?.role === 'professor';
  const searchParams = useSearchParams();
  const { userCourseId, courseList } = useCourse();

  // 교수님 — 과목 선택 (URL 파라미터 > 학기별 기본값)
  const courseFromUrl = searchParams.get('course') as CourseId | null;
  const [selectedCourseId, setSelectedCourseId] = useState<CourseId>(
    courseFromUrl || (userCourseId as CourseId) || 'microbiology'
  );
  const courseTouchStartX = useRef(0);
  const courseTouchEndX = useRef(0);

  // 교수님 — 전체 게시글 로드
  const { posts: allPosts, loading: allLoading, error: allError } = useAllPostsForCourse(
    isProfessor ? selectedCourseId : undefined
  );

  // 과목 scope 키워드 로드 (courseScopes/{courseId}/chapters/* 의 keywords)
  // Map<소문자, 원문> 으로 저장 — 매칭은 소문자로, 표시는 원문으로
  const [scopeTerms, setScopeTerms] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!isProfessor || !selectedCourseId) return;
    setScopeTerms(new Map()); // 과목 전환 시 이전 데이터 초기화

    const loadScopeKeywords = async () => {
      try {
        const chaptersRef = collection(db, 'courseScopes', selectedCourseId, 'chapters');
        const snap = await getDocs(chaptersRef);
        const terms = new Map<string, string>();
        snap.docs.forEach(d => {
          const kws = d.data()?.keywords;
          if (Array.isArray(kws)) {
            kws.forEach((kw: string) => {
              if (kw && kw.length >= 2) {
                const lower = kw.toLowerCase();
                // 더 짧은 원문 우선 (중복 시)
                if (!terms.has(lower)) terms.set(lower, kw);
              }
            });
          }
        });
        setScopeTerms(terms);
      } catch (err) {
        console.error('scope 키워드 로드 실패:', err);
      }
    };

    loadScopeKeywords();
  }, [isProfessor, selectedCourseId]);

  // 워드클라우드 데이터 — 게시글에서 과목 scope 키워드만 추출 (indexOf로 빠른 매칭)
  const keywords = useMemo(() => {
    if (!allPosts.length || scopeTerms.size === 0) return [];

    // 게시글 전체 텍스트 (소문자)
    const allText = allPosts.map(p => `${p.title} ${p.content}`).join(' ').toLowerCase();

    // indexOf 기반 카운트 (정규식 대비 10배+ 빠름)
    const freq = new Map<string, number>();
    scopeTerms.forEach((original, lower) => {
      let count = 0;
      let pos = 0;
      while ((pos = allText.indexOf(lower, pos)) !== -1) {
        count++;
        pos += lower.length;
      }
      if (count > 0) freq.set(original, count);
    });

    return Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
      .map(([text, value]) => ({ text, value }));
  }, [allPosts, scopeTerms]);

  // 학생 훅 (교수님은 skip — 불필요한 Firestore 쿼리 방지)
  const { posts, loading: postsLoading, error: postsError, hasMore, loadMore, refresh: refreshPosts } = useMyPosts(isProfessor);
  const { deletePost } = useDeletePost();
  const { comments, loading: commentsLoading, error: commentsError, refresh: refreshComments } = useMyComments(isProfessor);
  const { deleteComment } = useDeleteComment();
  const { posts: likedPosts, loading: likedLoading, error: likedError } = useMyLikedPosts(isProfessor);
  const likesScrollRef = useRef<HTMLDivElement>(null);

  const handlePostClick = useCallback((postId: string) => {
    router.push(`/board/${postId}`);
  }, [router]);

  const handleDeletePost = useCallback(async (postId: string) => {
    if (window.confirm('이 기사를 삭제하시겠습니까?')) {
      const success = await deletePost(postId);
      if (success) refreshPosts();
    }
  }, [deletePost, refreshPosts]);

  const handleDeleteComment = useCallback(async (commentId: string, postId: string) => {
    if (window.confirm('이 댓글을 삭제하시겠습니까?')) {
      const success = await deleteComment(commentId, postId);
      if (success) refreshComments();
    }
  }, [deleteComment, refreshComments]);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  return (
    <div
      className="min-h-screen pb-6 overflow-x-hidden"
      style={{ backgroundColor: theme.colors.background }}
    >
      {/* 헤더 */}
      <header className="mx-4 mt-3 pb-2">
        <button
          onClick={handleBack}
          className="flex items-center py-1 text-[#3A3A3A]"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      </header>

      {isProfessor ? (
        /* ============================================================
         * 교수님 대시보드
         * ============================================================ */
        <div className="px-4 space-y-6 pb-navigation">
          {/* 과목 캐러셀 */}
          <div
            className="border-y-4 border-[#1A1A1A] py-2 flex items-center justify-center gap-2 select-none overflow-hidden"
            onTouchStart={(e) => { courseTouchStartX.current = scaleCoord(e.touches[0].clientX); }}
            onTouchMove={(e) => { courseTouchEndX.current = scaleCoord(e.touches[0].clientX); }}
            onTouchEnd={() => {
              const diff = courseTouchStartX.current - courseTouchEndX.current;
              const idx = courseList.findIndex(c => c.id === selectedCourseId);
              if (diff > 50) {
                const next = idx >= courseList.length - 1 ? 0 : idx + 1;
                setSelectedCourseId(courseList[next].id);
              } else if (diff < -50) {
                const prev = idx <= 0 ? courseList.length - 1 : idx - 1;
                setSelectedCourseId(courseList[prev].id);
              }
            }}
          >
            <button
              type="button"
              onClick={() => {
                const idx = courseList.findIndex(c => c.id === selectedCourseId);
                const prev = idx <= 0 ? courseList.length - 1 : idx - 1;
                setSelectedCourseId(courseList[prev].id);
              }}
              className="p-1 opacity-60 hover:opacity-100 transition-opacity"
            >
              <svg className="w-6 h-6" fill="none" stroke="#1A1A1A" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <AnimatePresence mode="wait">
              <motion.h1
                key={selectedCourseId}
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -30 }}
                transition={{ duration: 0.2 }}
                className="font-serif-display font-black tracking-tight text-[#1A1A1A] text-center whitespace-nowrap"
              >
                {(() => {
                  const name = courseList.find(c => c.id === selectedCourseId)?.nameEn.toUpperCase() || '';
                  const isLong = name.length > 10;
                  return <span className={isLong ? 'text-[1.6rem] md:text-4xl' : 'text-[1.85rem] md:text-5xl'}>{name}</span>;
                })()}
              </motion.h1>
            </AnimatePresence>

            <button
              type="button"
              onClick={() => {
                const idx = courseList.findIndex(c => c.id === selectedCourseId);
                const next = idx >= courseList.length - 1 ? 0 : idx + 1;
                setSelectedCourseId(courseList[next].id);
              }}
              className="p-1 opacity-60 hover:opacity-100 transition-opacity"
            >
              <svg className="w-6 h-6" fill="none" stroke="#1A1A1A" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {allError && (
            <div className="p-3 text-sm text-center border border-[#1A1A1A] text-[#8B1A1A]">
              {allError}
            </div>
          )}

          {allLoading ? (
            <div className="space-y-4">
              <Skeleton className="w-full h-[350px] rounded-none" />
              <Skeleton className="w-full h-[180px] rounded-none" />
              <Skeleton className="w-full h-[200px] rounded-none" />
            </div>
          ) : (
            <>
              {/* ── Q&A ARCHIVE ── */}
              <section>
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex-1 h-px bg-[#1A1A1A]" />
                  <h2 className="font-serif-display text-lg font-bold text-[#1A1A1A]">Q&A ARCHIVE</h2>
                  <div className="flex-1 h-px bg-[#1A1A1A]" />
                </div>

                <AcademicArchiveSection posts={allPosts} courseId={selectedCourseId} />
              </section>

              {/* ── ACTIVITY ── */}
              <section>
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex-1 h-px bg-[#1A1A1A]" />
                  <h2 className="font-serif-display text-lg font-bold text-[#1A1A1A]">ACTIVITY</h2>
                  <div className="flex-1 h-px bg-[#1A1A1A]" />
                </div>

                <ActivitySection posts={allPosts} courseId={selectedCourseId} />
              </section>

              {/* ── KEYWORD CLOUD ── */}
              <section>
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex-1 h-px bg-[#1A1A1A]" />
                  <h2 className="font-serif-display text-lg font-bold text-[#1A1A1A]">KEYWORD CLOUD</h2>
                  <div className="flex-1 h-px bg-[#1A1A1A]" />
                </div>

                <div className="border border-[#1A1A1A] bg-[#FDFBF7] overflow-hidden" style={{ aspectRatio: '1 / 1' }}>
                  {keywords.length === 0 ? (
                    <div className="w-full h-full flex items-center justify-center">
                      <p className="text-sm text-[#5C5C5C]">
                        {scopeTerms.size === 0 ? '과목 범위(scope)가 업로드되지 않았습니다' : '매칭되는 키워드가 없습니다'}
                      </p>
                    </div>
                  ) : (
                    <SpiralWordCloud data={keywords} colors={CLOUD_COLORS} />
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      ) : (
        /* ============================================================
         * 학생 뷰 (기존 그대로)
         * ============================================================ */
        <>
          <div className="mx-4 border-b-2 border-[#1A1A1A] mb-4" />

          <div className="px-4 pb-3">
            <div className="flex items-center justify-center gap-4">
              <div className="flex-1 h-px bg-[#1A1A1A]" />
              <h2 className="font-serif-display text-xl font-bold text-[#1A1A1A]">
                MANAGE
              </h2>
              <div className="flex-1 h-px bg-[#1A1A1A]" />
            </div>
            <p className="text-center text-xs mt-1" style={{ color: theme.colors.textSecondary }}>
              내가 작성한 기사와 댓글, 좋아요한 글 관리
            </p>
          </div>

          <main className="px-4 space-y-4">
            {/* 기사 + 댓글 */}
            <div className="grid grid-cols-2 gap-4">
              {/* 내 기사 */}
              <div
                className="p-3 h-[38vh] flex flex-col"
                style={{ border: '1px solid #1A1A1A', backgroundColor: theme.colors.backgroundCard }}
              >
                <div className="flex items-center gap-2 mb-3 pb-1.5 border-b-2 border-[#1A1A1A] flex-shrink-0">
                  <h3 className="text-xs font-bold text-[#1A1A1A]">MY ARTICLES</h3>
                  <span className="text-xs" style={{ color: theme.colors.textSecondary }}>({posts.length})</span>
                </div>

                {postsError && (
                  <div className="p-3 text-xs text-center border border-[#1A1A1A] mb-3 flex-shrink-0">
                    <span style={{ color: '#8B1A1A' }}>{postsError}</span>
                    <button type="button" onClick={refreshPosts} className="ml-2 underline">다시 시도</button>
                  </div>
                )}

                {postsLoading && posts.length === 0 && (
                  <div className="space-y-3 flex-shrink-0">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="border-b border-[#D4CFC4] pb-3">
                        <Skeleton className="w-3/4 h-5 mb-2 rounded-none" />
                        <Skeleton className="w-full h-8 mb-2 rounded-none" />
                      </div>
                    ))}
                  </div>
                )}

                {!postsLoading && posts.length === 0 && !postsError && (
                  <div className="py-8 text-center flex-1 flex items-center justify-center">
                    <p className="text-sm" style={{ color: theme.colors.textSecondary }}>작성한 기사가 없습니다</p>
                  </div>
                )}

                <div className="flex-1 overflow-y-auto">
                  {posts.map(post => (
                    <MyPostCard key={post.id} post={post} onClick={() => handlePostClick(post.id)} onDelete={() => handleDeletePost(post.id)} />
                  ))}
                  {hasMore && (
                    <div className="text-center pt-3">
                      <button type="button" onClick={loadMore} disabled={postsLoading} className="text-xs text-[#1A1A1A] hover:underline disabled:opacity-50">
                        {postsLoading ? '로딩...' : '더보기 →'}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* 내 댓글 */}
              <div
                className="p-3 h-[38vh] flex flex-col"
                style={{ border: '1px solid #1A1A1A', backgroundColor: theme.colors.backgroundCard }}
              >
                <div className="flex items-center gap-2 mb-3 pb-1.5 border-b-2 border-[#1A1A1A] flex-shrink-0">
                  <h3 className="text-xs font-bold text-[#1A1A1A]">MY COMMENTS</h3>
                  <span className="text-xs" style={{ color: theme.colors.textSecondary }}>({comments.length})</span>
                </div>

                {commentsError && (
                  <div className="p-3 text-xs text-center border border-[#1A1A1A] mb-3 flex-shrink-0">
                    <span style={{ color: '#8B1A1A' }}>{commentsError}</span>
                    <button type="button" onClick={refreshComments} className="ml-2 underline">다시 시도</button>
                  </div>
                )}

                {commentsLoading && comments.length === 0 && (
                  <div className="space-y-3 flex-shrink-0">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="border-b border-[#D4CFC4] pb-3">
                        <Skeleton className="w-1/2 h-3 mb-2 rounded-none" />
                        <Skeleton className="w-full h-8 mb-2 rounded-none" />
                      </div>
                    ))}
                  </div>
                )}

                {!commentsLoading && comments.length === 0 && !commentsError && (
                  <div className="py-8 text-center flex-1 flex items-center justify-center">
                    <p className="text-sm" style={{ color: theme.colors.textSecondary }}>작성한 댓글이 없습니다</p>
                  </div>
                )}

                <div className="flex-1 overflow-y-auto">
                  {comments.map(comment => (
                    <MyCommentCard key={comment.id} comment={comment} onDelete={handleDeleteComment} onGoToPost={handlePostClick} />
                  ))}
                </div>
              </div>
            </div>

            {/* 좋아요한 글 */}
            <div className="p-3" style={{ border: '1px solid #1A1A1A', backgroundColor: theme.colors.backgroundCard }}>
              <div className="flex items-center gap-2 mb-3 pb-1.5 border-b-2 border-[#1A1A1A]">
                <h3 className="text-xs font-bold text-[#1A1A1A]">MY LIKES</h3>
                <span className="text-xs" style={{ color: theme.colors.textSecondary }}>({likedPosts.length})</span>
              </div>

              {likedError && (
                <div className="p-3 text-xs text-center border border-[#1A1A1A] mb-3">
                  <span style={{ color: '#8B1A1A' }}>{likedError}</span>
                </div>
              )}

              {likedLoading && likedPosts.length === 0 && (
                <div className="flex gap-3 overflow-hidden">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="flex-shrink-0 w-40 p-2.5 border border-[#D4CFC4]">
                      <Skeleton className="w-full h-10 mb-2 rounded-none" />
                      <Skeleton className="w-3/4 h-8 mb-2 rounded-none" />
                    </div>
                  ))}
                </div>
              )}

              {!likedLoading && likedPosts.length === 0 && !likedError && (
                <div className="py-6 text-center">
                  <p className="text-sm" style={{ color: theme.colors.textSecondary }}>좋아요한 기사가 없습니다</p>
                </div>
              )}

              {likedPosts.length > 0 && (
                <div ref={likesScrollRef} className="flex gap-3 overflow-x-auto pb-2" style={{ scrollSnapType: 'x mandatory' }}>
                  {likedPosts.map(post => (
                    <div key={post.id} style={{ scrollSnapAlign: 'start' }}>
                      <LikedPostCard post={post} onClick={() => handlePostClick(post.id)} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </main>
        </>
      )}
    </div>
  );
}
