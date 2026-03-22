'use client';

import { useCallback, useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { doc, updateDoc, increment, getDoc, db } from '@/lib/repositories';
import { Skeleton, ImageViewer } from '@/components/common';
import LikeButton from '@/components/board/LikeButton';
import CommentSection from '@/components/board/CommentSection';
import LinkifiedText from '@/components/board/LinkifiedText';
import { usePost, useDeletePost, useLike } from '@/lib/hooks/useBoard';
import { useAuth } from '@/lib/hooks/useAuth';
import { useUser } from '@/lib/contexts';
import { getScrollLockCount } from '@/lib/utils/scrollLock';

/**
 * 날짜 포맷
 */
function formatDate(date: Date) {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${m}. ${d}. ${h}:${min}`;
}

/**
 * 이미지 갤러리 컴포넌트 (2장씩, 슬라이드, 클릭 시 전체화면 뷰어)
 */
/**
 * 스마트 페이지 분할: 세로 이미지 단독, 가로/정방 2장씩
 */
function buildImagePages(images: string[], tallFlags: Record<number, boolean>) {
  const pages: { urls: string[]; indices: number[] }[] = [];
  let i = 0;
  while (i < images.length) {
    if (tallFlags[i]) {
      pages.push({ urls: [images[i]], indices: [i] });
      i++;
    } else if (i + 1 < images.length && !tallFlags[i + 1]) {
      pages.push({ urls: [images[i], images[i + 1]], indices: [i, i + 1] });
      i += 2;
    } else {
      pages.push({ urls: [images[i]], indices: [i] });
      i++;
    }
  }
  return pages;
}

function ImageGallery({ images }: { images: string[] }) {
  const [currentPage, setCurrentPage] = useState(0);
  const [viewerInfo, setViewerInfo] = useState<{ index: number } | null>(null);
  const [tallFlags, setTallFlags] = useState<Record<number, boolean>>({});

  // img onLoad로 비율 감지 (별도 프리로드 없이 렌더와 동시에)
  const handleImgLoad = (index: number, e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const isTall = img.naturalHeight > img.naturalWidth * 1.3;
    setTallFlags(prev => {
      if (prev[index] === isTall) return prev;
      return { ...prev, [index]: isTall };
    });
  };

  const allDetected = Object.keys(tallFlags).length === images.length;
  const pages = allDetected
    ? buildImagePages(images, tallFlags)
    : images.map((url, i) => ({ urls: [url], indices: [i] }));

  const totalPages = pages.length;
  const safePage = Math.min(currentPage, totalPages - 1);

  // 페이지 수 줄어들 때 보정
  useEffect(() => {
    if (currentPage >= totalPages && totalPages > 0) {
      setCurrentPage(totalPages - 1);
    }
  }, [totalPages, currentPage]);

  if (images.length === 0) return null;

  const currentPageData = pages[safePage] || pages[0];
  const isSingle = currentPageData?.urls.length === 1;

  return (
    <div className="mt-4">
      <div className={isSingle ? '' : 'grid grid-cols-2 gap-2'}>
        {currentPageData?.urls.map((url, index) => {
          const globalIndex = currentPageData.indices[index];
          return (
            <div
              key={`img-${globalIndex}`}
              className="relative bg-[#EBE5D9] cursor-pointer overflow-hidden rounded-sm"
              onClick={() => setViewerInfo({ index: globalIndex })}
            >
              <img
                src={url}
                alt={`이미지 ${globalIndex + 1}`}
                className={`w-full h-auto object-contain ${isSingle ? 'max-h-[420px]' : 'max-h-[280px]'}`}
                draggable={false}
                onLoad={(e) => handleImgLoad(globalIndex, e)}
              />
            </div>
          );
        })}
      </div>

      {/* 아직 렌더되지 않은 이미지 프리로드 + 비율 감지 */}
      <div className="hidden">
        {images.map((url, i) =>
          tallFlags[i] === undefined ? (
            <img key={`preload-${i}`} src={url} alt="" onLoad={(e) => handleImgLoad(i, e)} />
          ) : null
        )}
      </div>

      {/* 슬라이드 컨트롤 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-3">
          <button
            onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
            disabled={safePage === 0}
            className="px-3 py-1 text-sm disabled:opacity-30"
            style={{ border: '1px solid #1A1A1A' }}
          >
            ←
          </button>
          <span className="text-sm text-[#3A3A3A]">
            {safePage + 1} / {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={safePage === totalPages - 1}
            className="px-3 py-1 text-sm disabled:opacity-30"
            style={{ border: '1px solid #1A1A1A' }}
          >
            →
          </button>
        </div>
      )}

      {/* 전체화면 이미지 뷰어 */}
      {viewerInfo && (
        <ImageViewer
          urls={images}
          initialIndex={viewerInfo.index}
          onClose={() => setViewerInfo(null)}
        />
      )}
    </div>
  );
}

/**
 * 게시글 상세 페이지
 */
export default function PostDetailPage() {
  const params = useParams();
  const router = useRouter();
  const postId = params.id as string;

  // 최초 진입 시에만 슬라이드 애니메이션 (뒤로가기 시 재발동 방지)
  const [slideIn] = useState(() => {
    if (typeof window === 'undefined') return false;
    const key = `visited_board_${params.id}`;
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, '1');
    return true;
  });

  const { user } = useAuth();
  const { profile } = useUser();
  const isProfessor = profile?.role === 'professor';
  const { post, loading, error, refresh } = usePost(postId);
  const { deletePost, loading: deleting } = useDeletePost();
  const { toggleLike } = useLike();

  // ── 양방향 스와이프 → 이전/다음 게시글 네비게이션 ──
  const swipeRef = useRef<HTMLDivElement>(null);
  const swipeNav = useRef({ startX: 0, startY: 0, lastX: 0, active: false, locked: false, startTime: 0, navigating: false });

  // 이전/다음 게시글 ID + 인디케이터
  const { prevPostId, nextPostId, currentIndex, totalPosts } = useMemo(() => {
    const empty = { prevPostId: null as string | null, nextPostId: null as string | null, currentIndex: -1, totalPosts: 0 };
    if (typeof window === 'undefined') return empty;
    try {
      const ids: string[] = JSON.parse(sessionStorage.getItem('board_post_ids') || '[]');
      const idx = ids.indexOf(postId);
      if (idx < 0 || ids.length < 2) return { ...empty, currentIndex: idx, totalPosts: ids.length };
      return {
        prevPostId: idx > 0 ? ids[idx - 1] : null,
        nextPostId: idx < ids.length - 1 ? ids[idx + 1] : null,
        currentIndex: idx,
        totalPosts: ids.length,
      };
    } catch { return empty; }
  }, [postId]);

  // 스와이프로 이동하는 헬퍼
  const navigateToPost = useCallback((targetId: string, direction: 'left' | 'right') => {
    const el = swipeRef.current;
    if (!el) return;
    const s = swipeNav.current;
    s.navigating = true;

    const translateX = direction === 'left' ? -window.innerWidth : window.innerWidth;
    el.style.transition = 'transform 0.2s ease-out, opacity 0.2s ease-out';
    el.style.transform = `translateX(${translateX}px)`;
    el.style.opacity = '0.3';

    setTimeout(() => {
      el.style.transition = '';
      el.style.transform = '';
      el.style.opacity = '';
      sessionStorage.removeItem(`visited_board_${targetId}`);
      router.replace(`/board/${targetId}`);
      setTimeout(() => { s.navigating = false; }, 300);
    }, 180);
  }, [router]);

  // 터치 + 마우스 스와이프 핸들러
  useEffect(() => {
    const el = swipeRef.current;
    if (!el) return;

    const DIR_LOCK_DIST = 12;
    const ANGLE_THRESHOLD = 55;
    const SWIPE_THRESHOLD = 0.30;
    const VELOCITY_THRESHOLD = 400;

    const onPointerDown = (x: number, y: number) => {
      const s = swipeNav.current;
      if (s.navigating) return;
      if (getScrollLockCount() > 0) return;
      if (document.body.hasAttribute('data-hide-nav')) return;

      s.startX = x;
      s.startY = y;
      s.lastX = x;
      s.active = true;
      s.locked = false;
      s.startTime = Date.now();
    };

    const onPointerMove = (x: number, y: number, e?: Event) => {
      const s = swipeNav.current;
      if (!s.active || s.navigating) return;

      const dx = x - s.startX;
      const dy = y - s.startY;
      s.lastX = x;

      if (!s.locked) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > DIR_LOCK_DIST) {
          const angle = Math.atan2(Math.abs(dy), Math.abs(dx)) * (180 / Math.PI);
          if (angle > ANGLE_THRESHOLD) { s.active = false; return; }
          // 이동 가능한 방향인지 확인
          const canMove = (dx < 0 && nextPostId) || (dx > 0 && prevPostId);
          if (!canMove) { s.active = false; return; }
          s.locked = true;
        } else {
          return;
        }
      }

      e?.preventDefault();
      const resistance = 1 - Math.min(Math.abs(dx) / window.innerWidth, 0.6) * 0.4;
      el.style.transform = `translateX(${dx * resistance}px)`;
      el.style.transition = 'none';
    };

    const onPointerEnd = () => {
      const s = swipeNav.current;
      if (!s.active || !s.locked || s.navigating) { s.active = false; return; }
      s.active = false;

      const dx = s.lastX - s.startX;
      const elapsed = Date.now() - s.startTime;
      const velocity = Math.abs(dx) / (elapsed / 1000);
      const screenW = window.innerWidth;
      const triggered = Math.abs(dx) > screenW * SWIPE_THRESHOLD || velocity > VELOCITY_THRESHOLD;

      if (triggered && dx < 0 && nextPostId) {
        navigateToPost(nextPostId, 'left');
      } else if (triggered && dx > 0 && prevPostId) {
        navigateToPost(prevPostId, 'right');
      } else {
        el.style.transition = 'transform 0.25s cubic-bezier(0.2, 0, 0, 1)';
        el.style.transform = '';
      }
    };

    // 터치
    const onTouchStart = (e: TouchEvent) => onPointerDown(e.touches[0].clientX, e.touches[0].clientY);
    const onTouchMove = (e: TouchEvent) => onPointerMove(e.touches[0].clientX, e.touches[0].clientY, e);
    const onTouchEnd = () => onPointerEnd();

    // 마우스 (PC 드래그)
    let mouseDown = false;
    const onMouseDown = (e: MouseEvent) => {
      // 링크, 버튼, 입력 요소 위에서는 드래그 시작 안 함
      const target = e.target as HTMLElement;
      if (target.closest('a, button, input, textarea, [contenteditable]')) return;
      mouseDown = true;
      el.style.cursor = 'grabbing';
      el.style.userSelect = 'none';
      e.preventDefault();
      onPointerDown(e.clientX, e.clientY);
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!mouseDown) return;
      onPointerMove(e.clientX, e.clientY, e);
    };
    const onMouseUp = () => {
      if (!mouseDown) return;
      mouseDown = false;
      el.style.cursor = '';
      el.style.userSelect = '';
      onPointerEnd();
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [prevPostId, nextPostId, navigateToPost]);

  const isOwner = user?.uid === post?.authorId;

  // 교수님일 때 작성자 실명 조회
  const [authorName, setAuthorName] = useState<string | null>(null);
  useEffect(() => {
    if (!isProfessor || !post?.authorId) return;
    getDoc(doc(db, 'users', post.authorId)).then(snap => {
      if (snap.exists()) setAuthorName(snap.data().name || null);
    }).catch(() => {});
  }, [isProfessor, post?.authorId]);

  // 안전한 뒤로가기 — SPA 내부 히스토리가 있으면 back, 없으면 게시판 목록으로
  const goBack = useCallback(() => {
    // sessionStorage에 내부 네비게이션 기록이 있는지 확인
    const hasInternalHistory = window.history.length > 1 &&
      (document.referrer.includes(window.location.host) || sessionStorage.getItem('board_nav'));
    if (hasInternalHistory) {
      router.back();
    } else {
      router.push('/board');
    }
  }, [router]);

  // 조회수 기록 (상세 페이지 진입 시마다)
  useEffect(() => {
    if (!postId) return;
    updateDoc(doc(db, 'posts', postId), { viewCount: increment(1) }).catch((err) => {
      console.error('조회수 업데이트 실패:', err);
    });
  }, [postId]);

  const handleDelete = useCallback(async () => {
    if (!window.confirm('정말 삭제하시겠습니까?')) return;
    const success = await deletePost(postId);
    if (success) {
      goBack();
    }
  }, [deletePost, postId, goBack]);

  const handleLike = useCallback(async () => {
    await toggleLike(postId);
    // onSnapshot이 자동 반영하므로 refresh() 불필요
  }, [toggleLike, postId]);

  const handleShare = useCallback(async () => {
    if (!post) return;
    const url = `${window.location.origin}/share/board/${postId}`;
    if (navigator.share) {
      try { await navigator.share({ url }); } catch { /* 취소 */ }
    } else {
      await navigator.clipboard.writeText(url);
      alert('클립보드에 복사되었습니다.');
    }
  }, [post, postId]);

  // 로딩
  if (loading) {
    return (
      <div className="min-h-screen pb-6" style={{ backgroundColor: '#F5F0E8' }}>
        <header className="mx-4 mt-3 pb-2 border-b-2 border-[#1A1A1A]">
          <button onClick={() => goBack()} className="flex items-center py-1 text-[#3A3A3A]">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        </header>
        <div className="px-4 pt-6 space-y-4">
          <Skeleton className="w-3/4 h-10 rounded-none" />
          <Skeleton className="w-1/3 h-4 rounded-none" />
          <Skeleton className="w-full h-48 rounded-none" />
        </div>
      </div>
    );
  }

  // 에러
  if (error || !post) {
    return (
      <div className="min-h-screen pb-6" style={{ backgroundColor: '#F5F0E8' }}>
        <header className="mx-4 mt-3 pb-2 border-b-2 border-[#1A1A1A]">
          <button onClick={() => goBack()} className="flex items-center py-1 text-[#3A3A3A]">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        </header>
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
          <h3 className="text-xl font-bold mb-2 text-[#1A1A1A]">글을 찾을 수 없습니다</h3>
          <p className="text-sm mb-4 text-[#3A3A3A]">{error || '삭제되었거나 존재하지 않는 글입니다.'}</p>
          <button onClick={() => goBack()} className="px-6 py-2" style={{ border: '1px solid #1A1A1A' }}>
            돌아가기
          </button>
        </div>
      </div>
    );
  }

  // 모든 이미지 합치기
  const allImages: string[] = [];
  if (post.imageUrl) allImages.push(post.imageUrl);
  if (post.imageUrls) {
    post.imageUrls.forEach((url) => {
      if (!allImages.includes(url)) allImages.push(url);
    });
  }

  return (
    <div ref={swipeRef} style={{ cursor: (prevPostId || nextPostId) ? 'grab' : undefined }}>
    <motion.div
      className="min-h-screen pb-24 overflow-x-hidden" data-board-detail style={{ backgroundColor: '#F5F0E8' }}
      initial={slideIn ? { opacity: 0, x: 60 } : false}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 35 }}
    >
      {/* 헤더 */}
      <header className="mx-4 mt-3 pb-2">
        <div className="flex items-center justify-between">
          <button
            onClick={() => goBack()}
            className="flex items-center py-1 text-[#3A3A3A]"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          {/* 게시글 위치 인디케이터 */}
          {totalPosts > 0 && (
            <span className="text-[11px] text-[#999] font-medium tracking-wide">
              {currentIndex + 1} / {totalPosts}
            </span>
          )}
        </div>
      </header>

      <div className="mx-4 border-b-2 border-[#1A1A1A] mb-4" />

      {/* 본문 */}
      <main className="px-4">
        <motion.article initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="pb-1">
          {/* 공지 */}
          {post.isNotice && (
            <span
              className="inline-block px-2.5 py-0.5 text-xs font-bold mb-3"
              style={{ backgroundColor: '#1A1A1A', color: '#F5F0E8' }}
            >
              NOTICE
            </span>
          )}

          {/* 태그 + 수정/삭제 */}
          <div className="flex items-center justify-between mb-2">
            <div>
              {post.tag && (
                <span
                  className="inline-block px-2 py-0.5 text-xs font-bold"
                  style={{ border: '1px solid #1A1A1A', color: '#1A1A1A' }}
                >
                  #{post.tag}
                </span>
              )}
            </div>
            {isOwner && (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => router.push(`/board/${postId}/edit`)}
                  className="text-[13px] text-[#999999] hover:text-[#1A1A1A] transition-colors"
                >
                  수정
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="text-[13px] transition-colors disabled:opacity-50"
                  style={{ color: '#8B1A1A' }}
                >
                  {deleting ? '삭제중...' : '삭제'}
                </button>
              </div>
            )}
          </div>

          {/* 제목 */}
          <h2 className="font-serif-display text-2xl md:text-3xl font-black leading-tight mb-3 text-[#1A1A1A]">
            {post.title}
          </h2>

          {/* 메타 정보: 좌=글쓴이, 우=월일시 */}
          <div className="flex items-center justify-between text-xs text-[#3A3A3A] mb-4 pb-4 border-b border-dashed border-[#1A1A1A]">
            <span>
              {post.authorClassType
                ? <>{isProfessor && authorName ? `${authorName} ` : ''}{post.authorNickname}·{post.authorClassType}반</>
                : <>{post.authorNickname.includes('교수') ? post.authorNickname : `${post.authorNickname} 교수님`}</>
              }
            </span>
            <span>{formatDate(post.createdAt)}</span>
          </div>

          {/* 본문 */}
          <div className="text-base leading-relaxed whitespace-pre-wrap text-[#1A1A1A] mb-4">
            <LinkifiedText text={post.content} />
          </div>

          {/* 이미지 갤러리 */}
          {allImages.length > 0 && <ImageGallery images={allImages} />}

          {/* 첨부파일 */}
          {post.fileUrls && post.fileUrls.length > 0 && (
            <div className="mt-4 p-3 bg-[#EDEAE4]">
              <p className="text-xs font-bold text-[#1A1A1A] mb-2">첨부파일</p>
              {post.fileUrls.map((file, index) => (
                <a
                  key={index}
                  href={file.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-xs text-[#1A1A1A] hover:underline py-1"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                  {file.name}
                </a>
              ))}
            </div>
          )}

          {/* 하단 액션 줄: 좌=찜·조회·댓글 / 우=공유 */}
          <div className="flex items-center justify-between py-2 mt-4">
            <div className="flex items-center gap-3">
              <LikeButton count={post.likes} isLiked={post.likedBy?.includes(user?.uid || '') || false} onToggle={handleLike} />
              <span className="flex items-center gap-1 text-sm text-[#5C5C5C]">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                {post.viewCount}
              </span>
              <span className="flex items-center gap-1 text-sm text-[#5C5C5C]">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                {post.commentCount}
              </span>
            </div>
            <button
              onClick={handleShare}
              className="flex items-center gap-2 text-sm text-[#5C5C5C] active:scale-90 transition-transform"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
            </button>
          </div>
        </motion.article>

        {/* 댓글 */}
        <section className="pt-4 border-t-2 border-[#1A1A1A]">
          <h3 className="font-bold text-base mb-2 text-[#1A1A1A]">댓글</h3>
          <CommentSection postId={postId} postAuthorId={post.authorId} acceptedCommentId={post.acceptedCommentId} />
        </section>
      </main>
    </motion.div>
    </div>
  );
}
