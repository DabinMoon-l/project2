'use client';

import { useCallback, useState, useMemo, memo } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Skeleton } from '@/components/common';
import { usePosts, type Post } from '@/lib/hooks/useBoard';

/** 기본 토끼 이미지 경로 */
const DEFAULT_RABBIT_IMAGE = '/rabbit/default-news.png';

/** 랜덤 명언 목록 */
const MOTIVATIONAL_QUOTES = [
  "Fortune favors the bold",
  "The only limit is your mind",
  "Dream it. Believe it. Achieve it.",
  "Where there's a will, there's a way",
  "Impossible is nothing",
  "You are stronger than you think",
  "Per aspera ad astra",
  "Believe and you're halfway there",
];

/**
 * 헤드라인 기사 (최신 글)
 */
const HeadlineArticle = memo(function HeadlineArticle({ post, onClick }: { post: Post; onClick: () => void }) {
  const imageUrl = post.imageUrl || post.imageUrls?.[0] || DEFAULT_RABBIT_IMAGE;

  return (
    <article
      onClick={onClick}
      className="cursor-pointer group border-2 border-[#1A1A1A] flex"
    >
      {/* 좌측 - 이미지 */}
      <div className="relative w-1/3 min-h-[160px] flex-shrink-0 bg-[#EDEAE4]">
        <Image
          src={imageUrl}
          alt={post.title}
          fill
          sizes="(max-width: 768px) 33vw, 200px"
          className="object-contain grayscale-[20%] group-hover:grayscale-0 transition-all"
        />
      </div>

      {/* 우측 - 제목, 본문, 댓글 수 */}
      <div className="flex-1 flex flex-col">
        {/* 제목 - 검정 박스 */}
        <div className="bg-[#1A1A1A] px-3 py-3">
          <h1 className="font-serif-display text-3xl md:text-4xl font-black text-[#F5F0E8] leading-tight">
            {post.title}
          </h1>
        </div>

        {/* 본문 및 댓글 수 */}
        <div className="p-3 flex-1">
          <p className="text-sm text-[#1A1A1A] leading-relaxed line-clamp-3">
            {post.content}
          </p>

          {/* 댓글 수 표시 */}
          {post.commentCount > 0 && (
            <p className="mt-2 pt-2 border-t border-dashed border-[#1A1A1A] text-xs text-[#5C5C5C]">
              ㄴ {post.commentCount}개의 댓글
            </p>
          )}
        </div>
      </div>
    </article>
  );
});

/**
 * Masonry 아이템
 * @param imagePosition - 이미지 위치 ('top' 또는 'bottom')
 */
const MasonryItem = memo(function MasonryItem({ post, onClick, imagePosition = 'top' }: { post: Post; onClick: () => void; imagePosition?: 'top' | 'bottom' }) {
  const hasImage = post.imageUrl || (post.imageUrls && post.imageUrls.length > 0);
  const imageUrl = post.imageUrl || post.imageUrls?.[0];

  const ImageSection = hasImage && imageUrl && (
    <div className="relative w-full aspect-[4/3] border border-[#1A1A1A] bg-[#EDEAE4]">
      <Image
        src={imageUrl}
        alt={post.title}
        fill
        sizes="(max-width: 768px) 50vw, 300px"
        className="object-contain grayscale-[30%] group-hover:grayscale-0 transition-all"
      />
    </div>
  );

  const TitleSection = (
    <h2 className="font-serif-display text-3xl md:text-4xl font-black leading-tight text-[#1A1A1A]">
      {post.title}
    </h2>
  );

  return (
    <article
      onClick={onClick}
      className="cursor-pointer group break-inside-avoid mb-4 p-3 border border-[#1A1A1A]"
    >
      {imagePosition === 'top' ? (
        <>
          {ImageSection && <div className="mb-2">{ImageSection}</div>}
          {TitleSection}
        </>
      ) : (
        <>
          {TitleSection}
          {ImageSection && <div className="mt-2">{ImageSection}</div>}
        </>
      )}

      {/* 본문 */}
      <p className="text-sm text-[#1A1A1A] leading-relaxed line-clamp-4 mt-2">
        {post.content}
      </p>

      {/* 댓글 수 표시 */}
      {post.commentCount > 0 && (
        <p className="mt-2 pt-2 border-t border-dashed border-[#1A1A1A] text-xs text-[#5C5C5C]">
          ㄴ {post.commentCount}개의 댓글
        </p>
      )}
    </article>
  );
});

/**
 * 스켈레톤
 */
function NewspaperSkeleton() {
  return (
    <div className="space-y-4">
      <div className="p-4 border-2 border-[#1A1A1A]">
        <Skeleton className="w-3/4 h-10 rounded-none mb-3" />
        <div className="flex gap-4">
          <Skeleton className="w-40 h-32 rounded-none flex-shrink-0" />
          <div className="flex-1">
            <Skeleton className="w-full h-20 rounded-none" />
          </div>
        </div>
      </div>
      <div className="columns-2 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="break-inside-avoid mb-4 p-3 border border-[#1A1A1A]">
            <Skeleton className="w-full h-24 rounded-none mb-2" />
            <Skeleton className="w-full h-6 rounded-none mb-2" />
            <Skeleton className="w-full h-12 rounded-none" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 게시판 메인 페이지
 */
export default function BoardPage() {
  const router = useRouter();
  const { posts, loading, error, hasMore, loadMore, refresh } = usePosts('all');

  // 검색
  const [searchQuery, setSearchQuery] = useState('');

  // 검색 필터링
  const filteredPosts = searchQuery.trim()
    ? posts.filter(post =>
        post.title.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : posts;

  const handlePostClick = useCallback((postId: string) => {
    router.push(`/board/${postId}`);
  }, [router]);

  const handleWriteClick = useCallback(() => {
    router.push('/board/write');
  }, [router]);

  const handleManageClick = useCallback(() => {
    router.push('/board/manage');
  }, [router]);

  const headline = filteredPosts.length > 0 ? filteredPosts[0] : null;
  const masonryPosts = filteredPosts.slice(1);

  // 랜덤 명언 (컴포넌트 마운트 시 한 번만 선택)
  const randomQuote = useMemo(() => {
    return MOTIVATIONAL_QUOTES[Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length)];
  }, []);

  // 오늘 날짜
  const today = new Date();
  const dateString = today.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });

  return (
    <div className="min-h-screen pb-28" style={{ backgroundColor: '#F5F0E8' }}>
      {/* 헤더 */}
      <header className="mx-4 mt-4 pb-6 border-b-4 border-double border-[#1A1A1A]">
        {/* 상단 날짜 및 에디션 */}
        <div className="flex justify-between items-center text-xs text-[#3A3A3A] mb-3">
          <span>{dateString}</span>
          <span className="font-bold">Vol. {today.getFullYear() - 2025} No. 1</span>
          <span>✦ SPECIAL EDITION ✦</span>
        </div>

        {/* 상단 장식선 */}
        <div className="border-t-2 border-[#1A1A1A] mb-2" />

        {/* 타이틀 */}
        <h1 className="font-serif-display text-5xl md:text-7xl font-black tracking-tight text-[#1A1A1A] text-center py-6 border-y-4 border-[#1A1A1A]">
          THE Q&A TIMES
        </h1>

        {/* 서브타이틀 및 슬로건 */}
        <div className="flex justify-between items-center mt-3 mb-4">
          <p className="text-xs text-[#3A3A3A] italic">
            "{randomQuote}"
          </p>
          <p className="text-xs text-[#3A3A3A]">
            2026 1st Semester · Microbiology
          </p>
        </div>

        {/* 하단 장식선 */}
        <div className="border-t border-[#1A1A1A] mb-4" />

        {/* 버튼 + 검색 */}
        <div className="flex items-center gap-3">
          {/* 버튼들 - 좌측 */}
          <button
            onClick={handleWriteClick}
            className="px-4 py-2 text-sm font-bold"
            style={{
              backgroundColor: '#1A1A1A',
              color: '#F5F0E8',
            }}
          >
            글 작성
          </button>
          <button
            onClick={handleManageClick}
            className="px-4 py-2 text-sm font-bold"
            style={{
              backgroundColor: 'transparent',
              color: '#1A1A1A',
              border: '1px solid #1A1A1A',
            }}
          >
            글 관리
          </button>

          {/* 검색창 - 우측 */}
          <div className="flex-1">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="제목 검색..."
              className="w-full px-3 py-2 text-sm outline-none"
              style={{
                border: '1px solid #1A1A1A',
                backgroundColor: '#F5F0E8',
              }}
            />
          </div>
        </div>
      </header>

      <main className="px-4 pt-4">
        {error && (
          <div className="p-4 text-sm text-center border border-[#1A1A1A] mb-4">
            {error}
            <button onClick={refresh} className="ml-2 underline">다시 시도</button>
          </div>
        )}

        {loading && posts.length === 0 && <NewspaperSkeleton />}

        {!loading && filteredPosts.length === 0 && !error && (
          <div className="py-12 text-center">
            <h3 className="font-serif-display text-2xl font-black mb-2 text-[#1A1A1A]">
              {searchQuery ? '검색 결과 없음' : 'EXTRA! EXTRA!'}
            </h3>
            <p className="text-sm text-[#3A3A3A]">
              {searchQuery ? '다른 검색어를 입력해보세요.' : '아직 소식이 없습니다. 첫 기사를 작성해보세요!'}
            </p>
          </div>
        )}

        {/* 헤드라인 */}
        {headline && (
          <div className="mb-4">
            <HeadlineArticle
              post={headline}
              onClick={() => handlePostClick(headline.id)}
            />
          </div>
        )}

        {/* Masonry 2열 */}
        {masonryPosts.length > 0 && (
          <div className="columns-2 gap-4">
            {masonryPosts.map((post, index) => (
              <MasonryItem
                key={post.id}
                post={post}
                onClick={() => handlePostClick(post.id)}
                imagePosition={index % 2 === 0 ? 'top' : 'bottom'}
              />
            ))}
          </div>
        )}

        {/* 더 보기 */}
        {hasMore && filteredPosts.length > 0 && !searchQuery && (
          <div className="text-center py-4">
            <button
              type="button"
              onClick={loadMore}
              disabled={loading}
              className="text-sm font-bold text-[#1A1A1A] hover:underline disabled:opacity-50"
            >
              {loading ? 'Loading...' : 'MORE →'}
            </button>
          </div>
        )}
      </main>

    </div>
  );
}
