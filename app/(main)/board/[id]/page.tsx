'use client';

import { useCallback, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Skeleton } from '@/components/common';
import LikeButton from '@/components/board/LikeButton';
import CommentSection from '@/components/board/CommentSection';
import { usePost, useDeletePost, useLike } from '@/lib/hooks/useBoard';
import { useAuth } from '@/lib/hooks/useAuth';

/**
 * 날짜 포맷
 */
function formatDate(date: Date) {
  return date.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * 이미지 갤러리 컴포넌트 (2장씩, 슬라이드, 꾹 눌러 다운로드, 클릭 시 크게 보기)
 */
function ImageGallery({ images }: { images: string[] }) {
  const [currentPage, setCurrentPage] = useState(0);
  const [viewingImage, setViewingImage] = useState<string | null>(null);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const isLongPress = useRef(false);

  // 2장씩 페이지 분할
  const pages: string[][] = [];
  for (let i = 0; i < images.length; i += 2) {
    pages.push(images.slice(i, i + 2));
  }

  const totalPages = pages.length;

  const handlePrev = () => {
    setCurrentPage((prev) => (prev > 0 ? prev - 1 : prev));
  };

  const handleNext = () => {
    setCurrentPage((prev) => (prev < totalPages - 1 ? prev + 1 : prev));
  };

  // 꾹 눌러 다운로드
  const handleLongPressStart = (imageUrl: string) => {
    isLongPress.current = false;
    longPressTimer.current = setTimeout(() => {
      isLongPress.current = true;
      // 다운로드 링크 생성
      const link = document.createElement('a');
      link.href = imageUrl;
      link.download = `image_${Date.now()}.jpg`;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }, 800); // 0.8초 꾹 누르면 다운로드
  };

  const handleLongPressEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  // 클릭 시 크게 보기 (롱프레스가 아닌 경우만)
  const handleImageClick = (imageUrl: string) => {
    if (!isLongPress.current) {
      setViewingImage(imageUrl);
    }
    isLongPress.current = false;
  };

  if (images.length === 0) return null;

  return (
    <div className="mt-4">
      {/* 이미지 그리드 - 2장씩 동일 크기 */}
      <div className="grid grid-cols-2 gap-2">
        {pages[currentPage]?.map((url, index) => (
          <div
            key={`${currentPage}-${index}`}
            className="relative aspect-square bg-gray-100 cursor-pointer"
            onMouseDown={() => handleLongPressStart(url)}
            onMouseUp={handleLongPressEnd}
            onMouseLeave={handleLongPressEnd}
            onTouchStart={() => handleLongPressStart(url)}
            onTouchEnd={handleLongPressEnd}
            onClick={() => handleImageClick(url)}
          >
            <img
              src={url}
              alt={`이미지 ${currentPage * 2 + index + 1}`}
              className="w-full h-full object-cover"
              draggable={false}
            />
          </div>
        ))}
      </div>

      {/* 슬라이드 컨트롤 (2장 초과 시) */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-3">
          <button
            onClick={handlePrev}
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
            onClick={handleNext}
            disabled={currentPage === totalPages - 1}
            className="px-3 py-1 text-sm disabled:opacity-30"
            style={{ border: '1px solid #1A1A1A' }}
          >
            →
          </button>
        </div>
      )}

      {/* 이미지 크게 보기 모달 */}
      {viewingImage && (
        <div
          className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setViewingImage(null)}
        >
          <button
            className="absolute top-4 right-4 text-white text-3xl font-bold z-10"
            onClick={() => setViewingImage(null)}
          >
            ×
          </button>
          <img
            src={viewingImage}
            alt="크게 보기"
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
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
  const { post, loading, error, refresh } = usePost(postId);
  const { deletePost, loading: deleting } = useDeletePost();
  const { toggleLike, isLiked } = useLike();

  const isOwner = user?.uid === post?.authorId;

  const handleDelete = useCallback(async () => {
    if (!window.confirm('정말 삭제하시겠습니까?')) return;
    const success = await deletePost(postId);
    if (success) {
      router.back();
    }
  }, [deletePost, postId, router]);

  const handleLike = useCallback(async () => {
    await toggleLike(postId);
    refresh();
  }, [toggleLike, postId, refresh]);

  // 로딩
  if (loading) {
    return (
      <div className="min-h-screen pb-28" style={{ backgroundColor: '#F5F0E8' }}>
        <header className="mx-4 mt-4 pb-4 border-b-2 border-[#1A1A1A]">
          <button onClick={() => router.back()} className="flex items-center gap-2 text-sm py-2">
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
      <div className="min-h-screen pb-28" style={{ backgroundColor: '#F5F0E8' }}>
        <header className="mx-4 mt-4 pb-4 border-b-2 border-[#1A1A1A]">
          <button onClick={() => router.back()} className="flex items-center gap-2 text-sm py-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            뒤로가기
          </button>
        </header>
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
          <h3 className="text-xl font-bold mb-2 text-[#1A1A1A]">글을 찾을 수 없습니다</h3>
          <p className="text-sm mb-4 text-[#3A3A3A]">{error || '삭제되었거나 존재하지 않는 글입니다.'}</p>
          <button onClick={() => router.back()} className="px-6 py-2" style={{ border: '1px solid #1A1A1A' }}>
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
    <div className="min-h-screen pb-28" style={{ backgroundColor: '#F5F0E8' }}>
      {/* 헤더 */}
      <header className="mx-4 mt-4 pb-4">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-sm py-2 text-[#3A3A3A]"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          뒤로가기
        </button>
        <h1 className="font-serif-display text-3xl font-black text-center text-[#1A1A1A] mt-2">
          JIBDAN JISUNG
        </h1>
      </header>

      <div className="mx-4 border-b-2 border-[#1A1A1A] mb-4" />

      {/* 본문 */}
      <main className="px-4">
        <motion.article initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="pb-6">
          {/* 공지 */}
          {post.isNotice && (
            <span
              className="inline-block px-3 py-1 text-xs font-bold mb-3"
              style={{ backgroundColor: '#1A1A1A', color: '#F5F0E8' }}
            >
              NOTICE
            </span>
          )}

          {/* 제목 */}
          <h2 className="font-serif-display text-2xl md:text-3xl font-black leading-tight mb-3 text-[#1A1A1A]">
            {post.title}
          </h2>

          {/* 메타 정보 */}
          <div className="flex items-center gap-2 text-sm text-[#3A3A3A] mb-4 pb-4 border-b border-dashed border-[#1A1A1A]">
            {/* 작성자: 닉네임·반·계급 형식 */}
            <span>
              {post.authorNickname}·{post.authorClassType || '?'}반·{post.authorRank || '견습생'}
            </span>
            <span>·</span>
            <span>{formatDate(post.createdAt)}</span>
            <span>·</span>
            <span>♥ {post.likes}</span>
            <span>·</span>
            <span>댓글 {post.commentCount}</span>
          </div>

          {/* 본문 */}
          <p className="text-base leading-relaxed whitespace-pre-wrap text-[#1A1A1A] mb-4">
            {post.content}
          </p>

          {/* 이미지 갤러리 */}
          {allImages.length > 0 && <ImageGallery images={allImages} />}

          {/* 첨부파일 */}
          {post.fileUrls && post.fileUrls.length > 0 && (
            <div className="mt-4 p-3 bg-[#EDEAE4]">
              <p className="text-sm font-bold text-[#1A1A1A] mb-2">첨부파일</p>
              {post.fileUrls.map((file, index) => (
                <a
                  key={index}
                  href={file.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-[#1A1A1A] hover:underline py-1"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                  {file.name}
                </a>
              ))}
            </div>
          )}

          {/* 좋아요 / 수정삭제 */}
          <div className="flex items-center justify-between py-4 mt-4 border-t border-dashed border-[#1A1A1A]">
            <LikeButton count={post.likes} isLiked={isLiked(postId)} onToggle={handleLike} />

            {isOwner && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => router.push(`/board/${postId}/edit`)}
                  className="px-3 py-1 text-sm"
                  style={{ border: '1px solid #1A1A1A', color: '#1A1A1A' }}
                >
                  수정
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="px-3 py-1 text-sm disabled:opacity-50"
                  style={{ border: '1px solid #8B1A1A', color: '#8B1A1A' }}
                >
                  {deleting ? '삭제중...' : '삭제'}
                </button>
              </div>
            )}
          </div>
        </motion.article>

        {/* 댓글 */}
        <section className="pt-4 border-t-2 border-[#1A1A1A]">
          <h3 className="font-bold text-lg mb-4 text-[#1A1A1A]">댓글</h3>
          <CommentSection postId={postId} />
        </section>
      </main>
    </div>
  );
}
