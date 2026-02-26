'use client';

import { useCallback, useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { doc, updateDoc, increment, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Skeleton, ImageViewer } from '@/components/common';
import LikeButton from '@/components/board/LikeButton';
import CommentSection from '@/components/board/CommentSection';
import { usePost, useDeletePost, useLike } from '@/lib/hooks/useBoard';
import { useAuth } from '@/lib/hooks/useAuth';
import { useUser } from '@/lib/contexts';

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
function ImageGallery({ images }: { images: string[] }) {
  const [currentPage, setCurrentPage] = useState(0);
  const [viewerInfo, setViewerInfo] = useState<{ index: number } | null>(null);

  // 2장씩 페이지 분할
  const pages: string[][] = [];
  for (let i = 0; i < images.length; i += 2) {
    pages.push(images.slice(i, i + 2));
  }

  const totalPages = pages.length;

  if (images.length === 0) return null;

  return (
    <div className="mt-4">
      {/* 이미지 그리드 - 2장씩 동일 크기 */}
      <div className="grid grid-cols-2 gap-2">
        {pages[currentPage]?.map((url, index) => {
          const globalIndex = currentPage * 2 + index;
          return (
            <div
              key={`${currentPage}-${index}`}
              className="relative aspect-square bg-gray-100 cursor-pointer"
              onClick={() => setViewerInfo({ index: globalIndex })}
            >
              <img
                src={url}
                alt={`이미지 ${globalIndex + 1}`}
                className="w-full h-full object-cover"
                draggable={false}
              />
            </div>
          );
        })}
      </div>

      {/* 슬라이드 컨트롤 (2장 초과 시) */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-3">
          <button
            onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
            disabled={currentPage === 0}
            className="px-3 py-1 text-sm disabled:opacity-30"
            style={{ border: '1px solid #1A1A1A' }}
          >
            ←
          </button>
          <span className="text-sm text-[#3A3A3A]">
            {currentPage + 1} / {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={currentPage === totalPages - 1}
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

  const { user } = useAuth();
  const { profile } = useUser();
  const isProfessor = profile?.role === 'professor';
  const { post, loading, error, refresh } = usePost(postId);
  const { deletePost, loading: deleting } = useDeletePost();
  const { toggleLike, isLiked } = useLike();

  const isOwner = user?.uid === post?.authorId;

  // 교수님일 때 작성자 실명 조회
  const [authorName, setAuthorName] = useState<string | null>(null);
  useEffect(() => {
    if (!isProfessor || !post?.authorId) return;
    getDoc(doc(db, 'users', post.authorId)).then(snap => {
      if (snap.exists()) setAuthorName(snap.data().name || null);
    }).catch(() => {});
  }, [isProfessor, post?.authorId]);

  // 안전한 뒤로가기 — 내부 히스토리 없으면 게시판 목록으로
  const goBack = useCallback(() => {
    if (window.history.length > 1 && document.referrer.includes(window.location.host)) {
      router.back();
    } else {
      router.push('/board');
    }
  }, [router]);

  // 조회수 기록 (세션 내 1회만)
  useEffect(() => {
    if (!postId) return;
    const key = `viewed_${postId}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
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

  // 로딩
  if (loading) {
    return (
      <div className="min-h-screen pb-6" style={{ backgroundColor: '#F5F0E8' }}>
        <header className="mx-4 mt-4 pb-4 border-b-2 border-[#1A1A1A]">
          <button onClick={() => goBack()} className="flex items-center gap-2 text-sm py-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            뒤로가기
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
        <header className="mx-4 mt-4 pb-4 border-b-2 border-[#1A1A1A]">
          <button onClick={() => goBack()} className="flex items-center gap-2 text-sm py-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            뒤로가기
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
    <div className="min-h-screen pb-16 overflow-x-hidden" style={{ backgroundColor: '#F5F0E8' }}>
      {/* 헤더 */}
      <header className="mx-4 mt-4 pb-4">
        <button
          onClick={() => goBack()}
          className="flex items-center gap-2 text-sm py-2 text-[#3A3A3A]"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          뒤로가기
        </button>
      </header>

      <div className="mx-4 border-b-2 border-[#1A1A1A] mb-4" />

      {/* 본문 */}
      <main className="px-4">
        <motion.article initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="pb-1">
          {/* 공지 */}
          {post.isNotice && (
            <span
              className="inline-block px-3 py-1 text-sm font-bold mb-3"
              style={{ backgroundColor: '#1A1A1A', color: '#F5F0E8' }}
            >
              NOTICE
            </span>
          )}

          {/* 제목 */}
          <h2 className="font-serif-display text-3xl md:text-4xl font-black leading-tight mb-3 text-[#1A1A1A]">
            {post.title}
          </h2>

          {/* 메타 정보: 좌=글쓴이, 우=월일시 */}
          <div className="flex items-center justify-between text-[15px] text-[#3A3A3A] mb-4 pb-4 border-b border-dashed border-[#1A1A1A]">
            <span>
              {isProfessor && authorName ? `${authorName} ` : ''}{post.authorNickname}·{post.authorClassType || '?'}반
            </span>
            <span>{formatDate(post.createdAt)}</span>
          </div>

          {/* 본문 */}
          <p className="text-[18px] leading-relaxed whitespace-pre-wrap text-[#1A1A1A] mb-4">
            {post.content}
          </p>

          {/* 이미지 갤러리 */}
          {allImages.length > 0 && <ImageGallery images={allImages} />}

          {/* 첨부파일 */}
          {post.fileUrls && post.fileUrls.length > 0 && (
            <div className="mt-4 p-3 bg-[#EDEAE4]">
              <p className="text-[15px] font-bold text-[#1A1A1A] mb-2">첨부파일</p>
              {post.fileUrls.map((file, index) => (
                <a
                  key={index}
                  href={file.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-[15px] text-[#1A1A1A] hover:underline py-1"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                  {file.name}
                </a>
              ))}
            </div>
          )}

          {/* 찜 줄: 좌=찜, 우=조회·댓글 */}
          <div className="flex items-center justify-between py-2 mt-4 border-t border-dashed border-[#1A1A1A]">
            <LikeButton count={post.likes} isLiked={isLiked(postId)} onToggle={handleLike} />
            <div className="flex items-center gap-3 text-[15px] text-[#5C5C5C]">
              <span>조회 {post.viewCount}</span>
              <span>댓글 {post.commentCount}</span>
            </div>
          </div>

          {/* 수정/삭제 (작성자만) */}
          {isOwner && (
            <div className="flex items-center justify-end gap-3 pt-1">
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
        </motion.article>

        {/* 댓글 */}
        <section className="pt-4 border-t-2 border-[#1A1A1A]">
          <h3 className="font-bold text-xl mb-2 text-[#1A1A1A]">댓글</h3>
          <CommentSection postId={postId} postAuthorId={post.authorId} />
        </section>
      </main>
    </div>
  );
}
