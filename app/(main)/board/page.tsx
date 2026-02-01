'use client';

import { useCallback, useState, useMemo, memo, useEffect, useRef } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Skeleton } from '@/components/common';
import { usePosts, usePinnedPosts, type Post, type Comment } from '@/lib/hooks/useBoard';
import { useCourse } from '@/lib/contexts/CourseContext';
import { useUser } from '@/lib/contexts/UserContext';
import { COURSES, type CourseId } from '@/lib/types/course';

/** 기본 토끼 이미지 경로 */
const DEFAULT_RABBIT_IMAGE = '/rabbit/default-news.png';

/** 댓글을 postId별로 그룹화한 Map 타입 */
type CommentsMap = Map<string, Comment[]>;

/** 댓글 말줄임 상수 */
const COMMENT_MAX_LENGTH = 57;

/** 댓글 내용 말줄임 함수 */
function truncateComment(content: string): string {
  if (content.length <= COMMENT_MAX_LENGTH) {
    return content;
  }
  return content.slice(0, COMMENT_MAX_LENGTH) + '...더보기';
}

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
const HeadlineArticle = memo(function HeadlineArticle({
  post,
  onClick,
  comments = [],
  isProfessor = false,
  isPinned = false,
  onPin,
  onUnpin,
}: {
  post: Post;
  onClick: () => void;
  comments?: Comment[];
  isProfessor?: boolean;
  isPinned?: boolean;
  onPin?: () => void;
  onUnpin?: () => void;
}) {
  const imageUrl = post.imageUrl || post.imageUrls?.[0] || DEFAULT_RABBIT_IMAGE;
  // 헤드라인/고정글은 총 3개 댓글까지 (대댓글 포함)
  const totalCommentCount = comments.length;
  const rootComments = comments.filter(c => !c.parentId);

  // 표시할 댓글과 대댓글 합쳐서 최대 3개
  let displayCount = 0;
  const maxDisplay = 3;
  const displayItems: { comment: Comment; replies: Comment[] }[] = [];

  for (const comment of rootComments) {
    if (displayCount >= maxDisplay) break;
    const replies = comments.filter(c => c.parentId === comment.id);
    const availableSlots = maxDisplay - displayCount;
    const replyCount = Math.min(replies.length, availableSlots - 1);
    displayItems.push({ comment, replies: replies.slice(0, replyCount > 0 ? replyCount : 0) });
    displayCount += 1 + (replyCount > 0 ? replyCount : 0);
  }

  const remainingCount = totalCommentCount - displayCount;

  return (
    <article
      className="cursor-pointer group border-2 border-[#1A1A1A] flex relative"
    >
      {/* 고정 버튼 (교수님 전용) */}
      {isProfessor && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (isPinned) {
              onUnpin?.();
            } else {
              onPin?.();
            }
          }}
          className={`absolute top-2 right-2 z-10 p-1.5 transition-colors ${
            isPinned
              ? 'bg-[#D4AF37] text-[#1A1A1A]'
              : 'bg-[#1A1A1A]/80 text-[#F5F0E8] hover:bg-[#D4AF37] hover:text-[#1A1A1A]'
          }`}
          title={isPinned ? '고정 해제' : '글 고정'}
        >
          <svg
            className="w-4 h-4"
            fill={isPinned ? 'currentColor' : 'none'}
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
            />
          </svg>
        </button>
      )}

      {/* 고정됨 표시 */}
      {isPinned && (
        <div className="absolute top-2 left-2 z-10 px-2 py-0.5 bg-[#D4AF37] text-[#1A1A1A] text-xs font-bold">
          📌 PINNED
        </div>
      )}

      {/* 좌측 - 이미지 */}
      <div
        onClick={onClick}
        className="relative w-1/3 min-h-[160px] flex-shrink-0 bg-[#EDEAE4]"
      >
        <Image
          src={imageUrl}
          alt={post.title}
          fill
          sizes="(max-width: 768px) 33vw, 200px"
          className="object-contain grayscale-[20%] group-hover:grayscale-0 transition-all"
          priority
        />
      </div>

      {/* 우측 - 제목, 본문, 댓글 */}
      <div onClick={onClick} className="flex-1 flex flex-col">
        {/* 제목 - 검정 박스 */}
        <div className="bg-[#1A1A1A] px-3 py-3">
          <h1 className="font-serif-display text-3xl md:text-4xl font-black text-[#F5F0E8] leading-tight">
            {post.title}
          </h1>
        </div>

        {/* 본문 및 댓글 */}
        <div className="p-3 flex-1">
          <p className="text-sm text-[#1A1A1A] leading-relaxed line-clamp-3">
            {post.content}
          </p>

          {/* 댓글 및 대댓글 표시 (최대 3개, 대댓글 포함) */}
          {displayItems.length > 0 && (
            <div className="mt-2 pt-2 border-t border-dashed border-[#1A1A1A] overflow-hidden">
              {displayItems.map(({ comment, replies }) => (
                <div key={comment.id} className="overflow-hidden">
                  <p className="text-sm text-[#1A1A1A] leading-snug py-0.5 overflow-hidden text-ellipsis" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere', maxWidth: '100%' }}>
                    ㄴ {truncateComment(comment.content)}
                  </p>
                  {/* 대댓글 표시 */}
                  {replies.map((reply) => (
                    <p key={reply.id} className="text-sm text-[#5C5C5C] leading-snug py-0.5 pl-4 overflow-hidden text-ellipsis" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere', maxWidth: '100%' }}>
                      ㄴ {truncateComment(reply.content)}
                    </p>
                  ))}
                </div>
              ))}
              {/* 더보기 버튼 (검정 테두리 네모박스, 하단 중앙) */}
              {remainingCount > 0 && (
                <div className="flex justify-center mt-2">
                  <span className="px-3 py-1 text-xs border border-[#1A1A1A] text-[#1A1A1A]">
                    더보기→
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
});

/**
 * 고정 게시글 캐러셀
 */
const PinnedPostsCarousel = memo(function PinnedPostsCarousel({
  posts,
  commentsMap,
  onPostClick,
  isProfessor,
  onUnpin,
}: {
  posts: Post[];
  commentsMap: CommentsMap;
  onPostClick: (postId: string) => void;
  isProfessor: boolean;
  onUnpin: (postId: string) => void;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const touchStartX = useRef<number>(0);
  const touchEndX = useRef<number>(0);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchEndX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = () => {
    const diff = touchStartX.current - touchEndX.current;
    const threshold = 50;

    if (diff > threshold && currentIndex < posts.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else if (diff < -threshold && currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  if (posts.length === 0) return null;

  return (
    <div className="relative">
      {/* 캐러셀 컨테이너 */}
      <div
        className="overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={currentIndex}
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -50 }}
            transition={{ duration: 0.3 }}
          >
            <HeadlineArticle
              post={posts[currentIndex]}
              onClick={() => onPostClick(posts[currentIndex].id)}
              comments={commentsMap.get(posts[currentIndex].id) || []}
              isProfessor={isProfessor}
              isPinned={true}
              onUnpin={() => onUnpin(posts[currentIndex].id)}
            />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* 네비게이션 화살표 (PC) */}
      {posts.length > 1 && (
        <>
          {currentIndex > 0 && (
            <button
              type="button"
              onClick={() => setCurrentIndex(currentIndex - 1)}
              className="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-8 h-8 flex items-center justify-center bg-[#1A1A1A]/80 text-[#F5F0E8] hover:bg-[#1A1A1A]"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          {currentIndex < posts.length - 1 && (
            <button
              type="button"
              onClick={() => setCurrentIndex(currentIndex + 1)}
              className="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-8 h-8 flex items-center justify-center bg-[#1A1A1A]/80 text-[#F5F0E8] hover:bg-[#1A1A1A]"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </>
      )}

      {/* 점 인디케이터 */}
      {posts.length > 1 && (
        <div className="flex justify-center gap-2 mt-3">
          {posts.map((_, index) => (
            <button
              key={index}
              type="button"
              onClick={() => setCurrentIndex(index)}
              className={`w-2 h-2 transition-all ${
                index === currentIndex
                  ? 'bg-[#1A1A1A] w-4'
                  : 'bg-[#1A1A1A]/30 hover:bg-[#1A1A1A]/50'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
});

/**
 * Masonry 아이템
 * @param imagePosition - 이미지 위치 ('top' 또는 'bottom')
 */
const MasonryItem = memo(function MasonryItem({
  post,
  onClick,
  imagePosition = 'top',
  comments = [],
  isPriority = false,
  isProfessor = false,
  isPinned = false,
  onPin,
}: {
  post: Post;
  onClick: () => void;
  imagePosition?: 'top' | 'bottom';
  comments?: Comment[];
  isPriority?: boolean;
  isProfessor?: boolean;
  isPinned?: boolean;
  onPin?: () => void;
}) {
  const hasImage = post.imageUrl || (post.imageUrls && post.imageUrls.length > 0);
  const imageUrl = post.imageUrl || post.imageUrls?.[0];
  // 일반 글은 총 4개 댓글까지 (대댓글 포함)
  const totalCommentCount = comments.length;
  const rootComments = comments.filter(c => !c.parentId);

  // 표시할 댓글과 대댓글 합쳐서 최대 4개
  let displayCount = 0;
  const maxDisplay = 4;
  const displayItems: { comment: Comment; replies: Comment[] }[] = [];

  for (const comment of rootComments) {
    if (displayCount >= maxDisplay) break;
    const replies = comments.filter(c => c.parentId === comment.id);
    const availableSlots = maxDisplay - displayCount;
    const replyCount = Math.min(replies.length, availableSlots - 1);
    displayItems.push({ comment, replies: replies.slice(0, replyCount > 0 ? replyCount : 0) });
    displayCount += 1 + (replyCount > 0 ? replyCount : 0);
  }

  const remainingCount = totalCommentCount - displayCount;

  const ImageSection = hasImage && imageUrl && (
    <div className="relative w-full aspect-[4/3] border border-[#1A1A1A] bg-[#EDEAE4]">
      <Image
        src={imageUrl}
        alt={post.title}
        fill
        sizes="(max-width: 768px) 50vw, 300px"
        className="object-contain grayscale-[30%] group-hover:grayscale-0 transition-all"
        priority={isPriority}
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
      className="cursor-pointer group break-inside-avoid mb-4 p-3 border border-[#1A1A1A] relative"
    >
      {/* 고정 버튼 (교수님 전용) */}
      {isProfessor && !isPinned && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPin?.();
          }}
          className="absolute top-1 right-1 z-10 p-1 bg-[#1A1A1A]/60 text-[#F5F0E8] hover:bg-[#D4AF37] hover:text-[#1A1A1A] transition-colors opacity-0 group-hover:opacity-100"
          title="글 고정"
        >
          <svg
            className="w-3 h-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
            />
          </svg>
        </button>
      )}

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

      {/* 댓글 및 대댓글 표시 (최대 4개, 대댓글 포함) */}
      {displayItems.length > 0 && (
        <div className="mt-2 pt-2 border-t border-dashed border-[#1A1A1A] overflow-hidden">
          {displayItems.map(({ comment, replies }) => (
            <div key={comment.id} className="overflow-hidden">
              <p className="text-sm text-[#1A1A1A] leading-snug py-0.5 overflow-hidden text-ellipsis" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere', maxWidth: '100%' }}>
                ㄴ {truncateComment(comment.content)}
              </p>
              {/* 대댓글 표시 */}
              {replies.map((reply) => (
                <p key={reply.id} className="text-sm text-[#5C5C5C] leading-snug py-0.5 pl-4 overflow-hidden text-ellipsis" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere', maxWidth: '100%' }}>
                  ㄴ {truncateComment(reply.content)}
                </p>
              ))}
            </div>
          ))}
          {/* 더보기 버튼 (검정 테두리 네모박스, 하단 중앙) */}
          {remainingCount > 0 && (
            <div className="flex justify-center mt-2">
              <span className="px-3 py-1 text-xs border border-[#1A1A1A] text-[#1A1A1A]">
                더보기→
              </span>
            </div>
          )}
        </div>
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
  const { semesterSettings } = useCourse();
  const { profile } = useUser();

  // 사용자의 과목 ID로 게시물 필터링
  const userCourseId = profile?.courseId;
  const { posts, loading, error, hasMore, loadMore, refresh } = usePosts('all', userCourseId);
  const { pinnedPosts, pinPost, unpinPost, refresh: refreshPinned } = usePinnedPosts(userCourseId);

  // 교수님 여부 확인
  const isProfessor = profile?.role === 'professor';

  // 검색
  const [searchQuery, setSearchQuery] = useState('');
  // 댓글 맵 (postId -> comments)
  const [commentsMap, setCommentsMap] = useState<CommentsMap>(new Map());

  // 헤더 가시성 추적 (스크롤 맨 위로 버튼용)
  const headerRef = useRef<HTMLElement>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);

  // 헤더 가시성 감지
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        // 헤더가 화면에서 사라지면 버튼 표시
        setShowScrollTop(!entry.isIntersecting);
      },
      { threshold: 0 }
    );

    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  // 맨 위로 스크롤
  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // 게시글 ID 목록이 변경되면 댓글 한 번에 로드
  useEffect(() => {
    if (posts.length === 0) return;

    const loadAllComments = async () => {
      try {
        // 모든 게시글의 댓글을 한 번에 조회
        const postIds = posts.map(p => p.id);

        // Firestore는 'in' 쿼리에 최대 30개까지만 지원
        // 필요시 청크로 나눠서 쿼리
        const chunks: string[][] = [];
        for (let i = 0; i < postIds.length; i += 30) {
          chunks.push(postIds.slice(i, i + 30));
        }

        const newMap = new Map<string, Comment[]>();

        for (const chunk of chunks) {
          const commentsQuery = query(
            collection(db, 'comments'),
            where('postId', 'in', chunk)
          );

          const snapshot = await getDocs(commentsQuery);
          snapshot.forEach((doc) => {
            const data = doc.data();
            const comment: Comment = {
              id: doc.id,
              postId: data.postId || '',
              parentId: data.parentId || undefined,
              authorId: data.authorId || '',
              authorNickname: data.authorNickname || '알 수 없음',
              content: data.content || '',
              isAnonymous: data.isAnonymous || false,
              createdAt: data.createdAt?.toDate() || new Date(),
              likes: data.likes || 0,
              likedBy: data.likedBy || [],
            };

            const existing = newMap.get(comment.postId) || [];
            existing.push(comment);
            newMap.set(comment.postId, existing);
          });
        }

        // 각 게시글의 댓글을 좋아요순 > 오래된순으로 정렬
        // 대댓글의 좋아요도 고려하여 루트 댓글 정렬
        newMap.forEach((comments, postId) => {
          // 루트 댓글과 대댓글 분리
          const rootComments = comments.filter(c => !c.parentId);
          const replies = comments.filter(c => c.parentId);

          // 각 루트 댓글의 점수 계산 (본인 좋아요 + 대댓글 최대 좋아요)
          const getMaxLikes = (rootComment: Comment): number => {
            const ownLikes = rootComment.likes || 0;
            const childReplies = replies.filter(r => r.parentId === rootComment.id);
            const replyMaxLikes = childReplies.length > 0
              ? Math.max(...childReplies.map(r => r.likes || 0))
              : 0;
            return Math.max(ownLikes, replyMaxLikes);
          };

          // 루트 댓글 정렬: 좋아요순 > 오래된순
          rootComments.sort((a, b) => {
            const aMaxLikes = getMaxLikes(a);
            const bMaxLikes = getMaxLikes(b);
            if (bMaxLikes !== aMaxLikes) return bMaxLikes - aMaxLikes;
            return a.createdAt.getTime() - b.createdAt.getTime();
          });

          // 정렬된 순서로 재구성 (루트 댓글 뒤에 해당 대댓글들)
          const sortedComments: Comment[] = [];
          rootComments.forEach(root => {
            sortedComments.push(root);
            // 대댓글도 좋아요순 > 오래된순으로 정렬
            const childReplies = replies
              .filter(r => r.parentId === root.id)
              .sort((a, b) => {
                const likeDiff = (b.likes || 0) - (a.likes || 0);
                if (likeDiff !== 0) return likeDiff;
                return a.createdAt.getTime() - b.createdAt.getTime();
              });
            sortedComments.push(...childReplies);
          });

          newMap.set(postId, sortedComments);
        });

        setCommentsMap(newMap);
      } catch (err) {
        console.error('댓글 로드 실패:', err);
      }
    };

    loadAllComments();
  }, [posts]);

  // 검색 필터링 및 정렬 (좋아요 수 > 최신순)
  const filteredPosts = useMemo(() => {
    let result = searchQuery.trim()
      ? posts.filter(post =>
          post.title.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : [...posts];

    // 좋아요 수 내림차순, 같으면 최신순 정렬
    result.sort((a, b) => {
      if (b.likes !== a.likes) {
        return b.likes - a.likes;
      }
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    return result;
  }, [posts, searchQuery]);

  const handlePostClick = useCallback((postId: string) => {
    router.push(`/board/${postId}`);
  }, [router]);

  const handleWriteClick = useCallback(() => {
    router.push('/board/write');
  }, [router]);

  const handleManageClick = useCallback(() => {
    router.push('/board/manage');
  }, [router]);

  // 게시글 고정 핸들러
  const handlePinPost = useCallback(async (postId: string) => {
    const success = await pinPost(postId);
    if (success) {
      refreshPinned();
    }
  }, [pinPost, refreshPinned]);

  // 게시글 고정 해제 핸들러
  const handleUnpinPost = useCallback(async (postId: string) => {
    const success = await unpinPost(postId);
    if (success) {
      refreshPinned();
    }
  }, [unpinPost, refreshPinned]);

  // 고정 글이 있으면 캐러셀 표시, 없으면 최신 글 표시
  const hasPinnedPosts = pinnedPosts.length > 0;
  const headline = !hasPinnedPosts && filteredPosts.length > 0 ? filteredPosts[0] : null;
  // 고정글이 있으면 모든 글을 masonry에, 없으면 첫 글 제외
  const masonryPosts = hasPinnedPosts ? filteredPosts : filteredPosts.slice(1);

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

  // 헤더 정보 계산
  const currentYear = semesterSettings?.currentYear || today.getFullYear();
  const currentSemester = semesterSettings?.currentSemester || 1;
  const volNumber = currentYear - 2025; // 2026년 = 1, 2027년 = 2, ...
  const semesterOrdinal = currentSemester === 1 ? '1st' : '2nd';
  // profile에서 courseId를 가져와서 과목명 조회
  const userCourse = profile?.courseId ? COURSES[profile.courseId as CourseId] : null;
  const courseName = userCourse?.nameEn || '';


  return (
    <div className="min-h-screen pb-28" style={{ backgroundColor: '#F5F0E8' }}>
      {/* 헤더 */}
      <header ref={headerRef} className="mx-4 mt-4 pb-6 border-b-4 border-double border-[#1A1A1A]">
        {/* 상단 날짜 및 에디션 */}
        <div className="flex justify-between items-center text-xs text-[#3A3A3A] mb-3">
          <span>{dateString}</span>
          <span className="font-bold">Vol. {volNumber} No. {currentSemester}</span>
          <span>✦ Prof. Jin-Ah Kim EDITION ✦</span>
        </div>

        {/* 상단 장식선 */}
        <div className="border-t-2 border-[#1A1A1A] mb-2" />

        {/* 타이틀 */}
        <h1 className="font-serif-display text-5xl md:text-7xl font-black tracking-tight text-[#1A1A1A] text-center py-6 border-y-4 border-[#1A1A1A]">
          JIBDAN JISUNG
        </h1>

        {/* 서브타이틀 및 슬로건 */}
        <div className="flex justify-between items-center mt-3 mb-4">
          <p className="text-xs text-[#3A3A3A] italic">
            "{randomQuote}"
          </p>
          <p className="text-xs text-[#3A3A3A]">
            {currentYear} {semesterOrdinal} Semester{courseName ? ` · ${courseName}` : ''}
          </p>
        </div>

        {/* 하단 장식선 */}
        <div className="border-t border-[#1A1A1A] mb-4" />

        {/* 버튼 + 검색 */}
        <div className="flex items-center gap-2">
          {/* 버튼들 - 동일한 너비로 좌측 절반 차지 */}
          <div className="flex gap-2 flex-1">
            <button
              onClick={handleWriteClick}
              className="flex-1 px-4 py-2.5 text-sm font-bold"
              style={{
                backgroundColor: '#1A1A1A',
                color: '#F5F0E8',
              }}
            >
              글 작성
            </button>
            <button
              onClick={handleManageClick}
              className="flex-1 px-4 py-2.5 text-sm font-bold"
              style={{
                backgroundColor: 'transparent',
                color: '#1A1A1A',
                border: '1px solid #1A1A1A',
              }}
            >
              관리
            </button>
          </div>

          {/* 검색창 - 우측 절반 */}
          <div className="flex-1">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="제목 검색..."
              className="w-full px-3 py-2.5 text-sm outline-none"
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
          <div
            className="flex flex-col items-center justify-center text-center"
            style={{ minHeight: 'calc(100vh - 380px)' }}
          >
            <h3 className="font-serif-display text-2xl font-black mb-2 text-[#1A1A1A]">
              {searchQuery ? '검색 결과 없음' : 'EXTRA! EXTRA!'}
            </h3>
            <p className="text-sm text-[#3A3A3A]">
              {searchQuery ? '다른 검색어를 입력해보세요.' : '아직 소식이 없습니다. 첫 기사를 작성해보세요!'}
            </p>
          </div>
        )}

        {/* 고정 글 캐러셀 또는 헤드라인 */}
        {hasPinnedPosts ? (
          <div className="mb-4">
            <PinnedPostsCarousel
              posts={pinnedPosts}
              commentsMap={commentsMap}
              onPostClick={handlePostClick}
              isProfessor={isProfessor}
              onUnpin={handleUnpinPost}
            />
          </div>
        ) : headline && (
          <div className="mb-4">
            <HeadlineArticle
              post={headline}
              onClick={() => handlePostClick(headline.id)}
              comments={commentsMap.get(headline.id) || []}
              isProfessor={isProfessor}
              isPinned={false}
              onPin={() => handlePinPost(headline.id)}
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
                comments={commentsMap.get(post.id) || []}
                isPriority={index < 4}
                isProfessor={isProfessor}
                isPinned={post.isPinned}
                onPin={() => handlePinPost(post.id)}
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

      {/* 스크롤 맨 위로 버튼 */}
      <AnimatePresence>
        {showScrollTop && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={scrollToTop}
            className="fixed bottom-24 right-4 z-40 w-12 h-12 bg-[#1A1A1A] text-[#F5F0E8] rounded-full shadow-lg flex items-center justify-center hover:bg-[#3A3A3A] transition-colors"
            aria-label="맨 위로"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 10l7-7m0 0l7 7m-7-7v18"
              />
            </svg>
          </motion.button>
        )}
      </AnimatePresence>

    </div>
  );
}
