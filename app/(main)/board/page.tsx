'use client';

import { useCallback, useState, useMemo, memo, useEffect, useRef } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Skeleton, ScrollToTopButton } from '@/components/common';
import { SPRING_TAP, TAP_SCALE } from '@/lib/constants/springs';
import { usePosts, usePinnedPosts, type Post, type Comment } from '@/lib/hooks/useBoard';
import { useCourse } from '@/lib/contexts/CourseContext';
import { useUser } from '@/lib/contexts/UserContext';
import { COURSES, type CourseId, getCourseList } from '@/lib/types/course';
import { scaleCoord } from '@/lib/hooks/useViewportScale';
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
  onClick?: () => void;
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
    <motion.article
      onClick={onClick}
      whileTap={onClick ? TAP_SCALE : undefined}
      transition={SPRING_TAP}
      className={`group border border-[#1A1A1A] bg-[#F5F0E8] relative transition-all ${onClick ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-md' : ''}`}
    >
      {/* 콘텐츠 래퍼 */}
      <div className="flex">
        {/* 좌측 - 이미지 */}
        <div
          className="relative w-1/3 min-h-[130px] flex-shrink-0 bg-[#EDEAE4]"
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
        <div className="flex-1 flex flex-col">
          {/* 제목 - 검정 박스 */}
          <div className="bg-[#1A1A1A] px-3 py-3">
            <h1 className="font-serif-display text-2xl md:text-3xl font-black text-[#F5F0E8] leading-tight" style={{ fontWeight: 900 }}>
              {post.title}
            </h1>
          </div>

          {/* 본문 및 댓글 */}
          <div className="p-3 flex-1">
            <p className="text-xs text-[#1A1A1A] leading-relaxed line-clamp-3">
              {post.content}
            </p>

            {/* 댓글 및 대댓글 표시 (최대 3개, 대댓글 포함) */}
            {displayItems.length > 0 && (
              <div className="mt-2 pt-2 border-t border-dashed border-[#1A1A1A] overflow-hidden">
                {displayItems.map(({ comment, replies }) => (
                  <div key={comment.id} className="overflow-hidden">
                    <p className="text-xs text-[#1A1A1A] leading-snug py-0.5 overflow-hidden text-ellipsis" style={{ wordBreak: 'break-all', maxWidth: '100%' }}>
                      <span className="whitespace-nowrap">ㄴ </span>{truncateComment(comment.content)}
                    </p>
                    {/* 대댓글 표시 */}
                    {replies.map((reply) => (
                      <p key={reply.id} className="text-xs text-[#5C5C5C] leading-snug py-0.5 pl-4 overflow-hidden text-ellipsis" style={{ wordBreak: 'break-all', maxWidth: '100%' }}>
                        <span className="whitespace-nowrap">ㄴ </span>{truncateComment(reply.content)}
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
      </div>
    </motion.article>
  );
});

/**
 * 고정 게시글 캐러셀
 */
const PinnedPostsCarousel = memo(function PinnedPostsCarousel({
  posts,
  commentsMap,
  onPostClick,
  isProfessor = false,
  onUnpin,
}: {
  posts: Post[];
  commentsMap: CommentsMap;
  onPostClick: (postId: string) => void;
  isProfessor?: boolean;
  onUnpin?: (postId: string) => void;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const touchStartX = useRef<number>(0);
  const touchEndX = useRef<number>(0);

  const isSwiping = useRef(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = scaleCoord(e.touches[0].clientX);
    touchEndX.current = scaleCoord(e.touches[0].clientX); // 탭 시 diff=0이 되도록 초기화
    isSwiping.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchEndX.current = scaleCoord(e.touches[0].clientX);
    isSwiping.current = true;
  };

  const handleTouchEnd = () => {
    if (!isSwiping.current) return; // 순수 탭이면 스와이프 무시
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
    <div className="relative" style={{ touchAction: 'pan-y' }}>
      {/* 캐러셀 컨테이너 — overflow-hidden 제거 (pointer-events 차단 원인) */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div
          onClick={() => onPostClick(posts[currentIndex].id)}
          className="cursor-pointer"
        >
          <HeadlineArticle
            post={posts[currentIndex]}
            comments={commentsMap.get(posts[currentIndex].id) || []}
            isPinned={true}
            isProfessor={isProfessor}
            onUnpin={onUnpin ? () => onUnpin(posts[currentIndex].id) : undefined}
          />
        </div>
      </div>

      {/* 점 인디케이터 + 화살표 */}
      {posts.length > 1 && (
        <div className="flex items-center justify-center gap-3 mt-3">
          <button
            type="button"
            onClick={() => setCurrentIndex(currentIndex > 0 ? currentIndex - 1 : posts.length - 1)}
            className="text-[#1A1A1A]/40 hover:text-[#1A1A1A] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
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
          <button
            type="button"
            onClick={() => setCurrentIndex(currentIndex < posts.length - 1 ? currentIndex + 1 : 0)}
            className="text-[#1A1A1A]/40 hover:text-[#1A1A1A] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
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
  onUnpin,
}: {
  post: Post;
  onClick: () => void;
  imagePosition?: 'top' | 'bottom';
  comments?: Comment[];
  isPriority?: boolean;
  isProfessor?: boolean;
  isPinned?: boolean;
  onPin?: () => void;
  onUnpin?: () => void;
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
    <h2 className="font-serif-display text-2xl md:text-3xl font-black leading-tight text-[#1A1A1A]" style={{ fontWeight: 900 }}>
      {post.title}
    </h2>
  );

  return (
    <motion.article
      onClick={onClick}
      whileTap={TAP_SCALE}
      transition={SPRING_TAP}
      className="cursor-pointer group break-inside-avoid mb-4 p-3 border border-[#1A1A1A] bg-[#F5F0E8] relative hover:-translate-y-0.5 hover:shadow-md transition-all"
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
      <p className="text-xs text-[#1A1A1A] leading-relaxed line-clamp-4 mt-2">
        {post.content}
      </p>

      {/* 댓글 및 대댓글 표시 (최대 4개, 대댓글 포함) */}
      {displayItems.length > 0 && (
        <div className="mt-2 pt-2 border-t border-dashed border-[#1A1A1A] overflow-hidden">
          {displayItems.map(({ comment, replies }) => (
            <div key={comment.id} className="overflow-hidden">
              <p className="text-xs text-[#1A1A1A] leading-snug py-0.5 overflow-hidden text-ellipsis" style={{ wordBreak: 'break-all', maxWidth: '100%' }}>
                <span className="whitespace-nowrap">ㄴ </span>{truncateComment(comment.content)}
              </p>
              {/* 대댓글 표시 */}
              {replies.map((reply) => (
                <p key={reply.id} className="text-xs text-[#5C5C5C] leading-snug py-0.5 pl-4 overflow-hidden text-ellipsis" style={{ wordBreak: 'break-all', maxWidth: '100%' }}>
                  <span className="whitespace-nowrap">ㄴ </span>{truncateComment(reply.content)}
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
    </motion.article>
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
  const { semesterSettings, userCourseId, setProfessorCourse } = useCourse();
  const { profile } = useUser();

  // 교수님 여부 확인
  const isProfessor = profile?.role === 'professor';

  // 교수님용 과목 선택 (CourseContext에서 통합 관리)
  const selectedCourseId = (userCourseId as CourseId) || 'microbiology';
  const setSelectedCourseId = useCallback((courseId: CourseId) => {
    setProfessorCourse(courseId);
  }, [setProfessorCourse]);

  // 과목 스와이프 터치 좌표
  const courseTouchStartX = useRef<number>(0);
  const courseTouchEndX = useRef<number>(0);

  // 핀 피드백 토스트
  const [pinToast, setPinToast] = useState<string | null>(null);
  const pinToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 사용자의 과목 ID (교수님은 선택한 과목, 학생은 자신의 과목)
  const activeCourseId = isProfessor ? selectedCourseId : profile?.courseId;
  const { posts, loading, error, hasMore, loadMore, refresh } = usePosts('all', activeCourseId);
  const { pinnedPosts, pinPost, unpinPost } = usePinnedPosts(activeCourseId);

  // 과목 목록 (교수님용)
  const courseList = useMemo(() => getCourseList(), []);

  // 검색
  const [searchQuery, setSearchQuery] = useState('');
  // 댓글 맵 (postId -> comments)
  const [commentsMap, setCommentsMap] = useState<CommentsMap>(new Map());

  // 헤더 가시성 추적 (스크롤 맨 위로 버튼용)
  const headerRef = useRef<HTMLElement>(null);

  // 댓글 미리보기 대상 postId (고정글 + 최신 20개만 — 카드 미리보기용)
  const commentTargetIds = useMemo(() => {
    const pinnedIds = pinnedPosts.map(p => p.id);
    const pinnedSet = new Set(pinnedIds);
    const otherIds = posts.filter(p => !pinnedSet.has(p.id)).slice(0, 20).map(p => p.id);
    return [...pinnedIds, ...otherIds];
  }, [pinnedPosts, posts]);

  const postIdsKey = useMemo(() => commentTargetIds.join(','), [commentTargetIds]);

  // 댓글 미리보기 구독 (상위 글만 — 카드에서 3~4개 미리보기용)
  useEffect(() => {
    if (!postIdsKey) return;

    const postIds = postIdsKey.split(',').filter(Boolean);
    if (postIds.length === 0) return;

    // Firestore는 'in' 쿼리에 최대 30개까지만 지원
    const chunks: string[][] = [];
    for (let i = 0; i < postIds.length; i += 30) {
      chunks.push(postIds.slice(i, i + 30));
    }

    // chunk별 댓글 결과를 저장할 맵
    const chunkResults = new Map<number, Map<string, Comment[]>>();
    const unsubscribes: (() => void)[] = [];

    // 모든 chunk 결과를 합쳐서 정렬 후 setCommentsMap (ID 기반 중복 제거)
    const mergeAllChunks = () => {
      const newMap = new Map<string, Comment[]>();

      chunkResults.forEach((chunkMap) => {
        chunkMap.forEach((comments, postId) => {
          const existing = newMap.get(postId) || [];
          const seenIds = new Set(existing.map(c => c.id));
          for (const c of comments) {
            if (!seenIds.has(c.id)) {
              existing.push(c);
              seenIds.add(c.id);
            }
          }
          newMap.set(postId, existing);
        });
      });

      // 각 게시글의 댓글을 좋아요순 > 오래된순으로 정렬
      newMap.forEach((comments, postId) => {
        const rootComments = comments.filter(c => !c.parentId);
        const replies = comments.filter(c => c.parentId);

        const getMaxLikes = (rootComment: Comment): number => {
          const ownLikes = rootComment.likes || 0;
          const childReplies = replies.filter(r => r.parentId === rootComment.id);
          const replyMaxLikes = childReplies.length > 0
            ? Math.max(...childReplies.map(r => r.likes || 0))
            : 0;
          return Math.max(ownLikes, replyMaxLikes);
        };

        rootComments.sort((a, b) => {
          const aMaxLikes = getMaxLikes(a);
          const bMaxLikes = getMaxLikes(b);
          if (bMaxLikes !== aMaxLikes) return bMaxLikes - aMaxLikes;
          return a.createdAt.getTime() - b.createdAt.getTime();
        });

        const sortedComments: Comment[] = [];
        rootComments.forEach(root => {
          sortedComments.push(root);
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
    };

    chunks.forEach((chunk, chunkIndex) => {
      const commentsQuery = query(
        collection(db, 'comments'),
        where('postId', 'in', chunk)
      );

      const unsub = onSnapshot(
        commentsQuery,
        (snapshot) => {
          const chunkMap = new Map<string, Comment[]>();
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
            const existing = chunkMap.get(comment.postId) || [];
            existing.push(comment);
            chunkMap.set(comment.postId, existing);
          });
          chunkResults.set(chunkIndex, chunkMap);
          mergeAllChunks();
        },
        (err) => {
          console.error('댓글 실시간 구독 실패:', err);
        }
      );

      unsubscribes.push(unsub);
    });

    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, [postIdsKey]);

  // 검색 필터링 및 정렬 (최신순)
  const filteredPosts = useMemo(() => {
    let result = searchQuery.trim()
      ? posts.filter(post =>
          post.title.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : [...posts];

    // 최신순 정렬
    result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return result;
  }, [posts, searchQuery]);

  const handlePostClick = useCallback((postId: string) => {
    sessionStorage.setItem('board_scroll_y', String(window.scrollY));
    router.push(`/board/${postId}`);
  }, [router]);

  const handleWriteClick = useCallback(() => {
    sessionStorage.setItem('board_scroll_y', String(window.scrollY));
    router.push('/board/write');
  }, [router]);

  const handleManageClick = useCallback(() => {
    router.push(isProfessor ? `/board/manage?course=${selectedCourseId}` : '/board/manage');
  }, [router, isProfessor, selectedCourseId]);

  // 핀 토스트 표시
  const showPinToast = useCallback((message: string) => {
    if (pinToastTimer.current) clearTimeout(pinToastTimer.current);
    setPinToast(message);
    pinToastTimer.current = setTimeout(() => setPinToast(null), 2000);
  }, []);

  // 게시글 고정 핸들러
  const handlePinPost = useCallback(async (postId: string) => {
    const success = await pinPost(postId);
    if (success) {
      showPinToast('게시글이 고정되었습니다');
    }
  }, [pinPost, showPinToast]);

  // 게시글 고정 해제 핸들러
  const handleUnpinPost = useCallback(async (postId: string) => {
    // unpinPost 내부에서 낙관적 UI 업데이트 수행 (즉시 상태 반영)
    const success = await unpinPost(postId);
    if (success) {
      showPinToast('고정이 해제되었습니다');
    }
  }, [unpinPost, showPinToast]);

  // 스크롤 위치 복원 (글 상세/작성에서 돌아왔을 때)
  useEffect(() => {
    if (loading || posts.length === 0) return;
    const saved = sessionStorage.getItem('board_scroll_y');
    if (saved) {
      sessionStorage.removeItem('board_scroll_y');
      requestAnimationFrame(() => window.scrollTo(0, Number(saved)));
    }
  }, [loading, posts.length]);

  // 최신 글을 헤드라인으로, 나머지를 masonry에
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

  // 헤더 정보 계산
  const currentYear = semesterSettings?.currentYear || today.getFullYear();
  const currentSemester = semesterSettings?.currentSemester || 1;
  const volNumber = currentYear - 2025; // 2026년 = 1, 2027년 = 2, ...
  const semesterOrdinal = currentSemester === 1 ? '1st' : '2nd';
  // profile에서 courseId를 가져와서 과목명 조회
  const userCourse = profile?.courseId ? COURSES[profile.courseId as CourseId] : null;
  const courseName = userCourse?.nameEn || '';


  return (
    <div className="min-h-screen pb-28 overflow-x-hidden" style={{ backgroundColor: '#F5F0E8' }}>
      {/* 교수님용 과목 탭 — 타이틀 영역에 통합됨 */}

      {/* 헤더 */}
      <header ref={headerRef} className="mx-4 mt-2 pb-2 border-b-4 border-double border-[#1A1A1A]">
        {/* 상단 날짜 및 에디션 */}
        <div className="flex justify-between items-center text-[10px] text-[#3A3A3A] mb-3 whitespace-nowrap">
          <span>{dateString}</span>
          <span className="font-bold">Vol. {volNumber} No. {currentSemester}</span>
          <span>✦ Prof. Jin-Ah Kim EDITION ✦</span>
        </div>

        {/* 상단 장식선 */}
        <div className="border-t-2 border-[#1A1A1A] mb-2" />

        {/* 타이틀 — 교수님은 과목 체인지, 학생은 JIBDAN JISUNG */}
        {isProfessor ? (
          <div
            className="border-y-4 border-[#1A1A1A] pt-2 pb-2 flex items-center justify-center gap-2 select-none overflow-hidden"
            style={{ touchAction: 'pan-y' }}
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
            {/* 좌측 화살표 (순환) */}
            <button
              type="button"
              onClick={() => {
                const idx = courseList.findIndex(c => c.id === selectedCourseId);
                const prev = idx <= 0 ? courseList.length - 1 : idx - 1;
                setSelectedCourseId(courseList[prev].id);
              }}
              className="p-1 opacity-60 hover:opacity-100 transition-opacity"
            >
              <svg className="w-7 h-7" fill="none" stroke="#1A1A1A" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            {/* 과목명 */}
            <AnimatePresence mode="wait">
              <motion.h1
                key={selectedCourseId}
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -30 }}
                transition={{ duration: 0.2 }}
                className="font-serif-display font-black tracking-tight text-[#1A1A1A] text-center whitespace-nowrap h-[2.5rem] flex items-center justify-center"
              >
                {(() => {
                  const name = courseList.find(c => c.id === selectedCourseId)?.nameEn.toUpperCase() || 'BIOLOGY';
                  const isLong = name.length > 10;
                  return <span className={isLong ? 'text-[1.6rem] md:text-4xl' : 'text-[1.85rem] md:text-5xl'}>{name}</span>;
                })()}
              </motion.h1>
            </AnimatePresence>

            {/* 우측 화살표 (순환) */}
            <button
              type="button"
              onClick={() => {
                const idx = courseList.findIndex(c => c.id === selectedCourseId);
                const next = idx >= courseList.length - 1 ? 0 : idx + 1;
                setSelectedCourseId(courseList[next].id);
              }}
              className="p-1 opacity-60 hover:opacity-100 transition-opacity"
            >
              <svg className="w-7 h-7" fill="none" stroke="#1A1A1A" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        ) : (
          <h1 className="font-serif-display text-4xl md:text-6xl font-black tracking-tight text-[#1A1A1A] text-center pt-2 pb-2 border-y-4 border-[#1A1A1A]">
            JIBDAN JISUNG
          </h1>
        )}

        {/* 서브타이틀 및 슬로건 */}
        <div className="flex justify-between items-center mt-2 mb-2">
          <p className="text-[10px] text-[#3A3A3A] italic">
            "{randomQuote}"
          </p>
          <p className="text-[10px] text-[#3A3A3A]">
            {currentYear} {semesterOrdinal} Semester{courseName ? ` · ${courseName}` : ''}
          </p>
        </div>

        {/* 하단 장식선 */}
        <div className="border-t border-[#1A1A1A] mb-2" />

        {/* 버튼 + 검색 */}
        <div className="flex items-center gap-2">
          {isProfessor ? (
            /* 교수님: 관리 버튼 1개 + 검색 (1:1 비율) */
            <>
              <div className="flex-1 min-w-0">
                <button
                  onClick={handleManageClick}
                  className="w-full px-3 py-2 text-xs font-bold"
                  style={{
                    border: '1px solid #1A1A1A',
                    backgroundColor: 'transparent',
                    color: '#1A1A1A',
                  }}
                >
                  관리
                </button>
              </div>
              <div className="flex-1 min-w-0">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="제목 검색..."
                  className="w-full px-2.5 py-2 text-xs outline-none"
                  style={{
                    border: '1px solid #1A1A1A',
                    backgroundColor: '#F5F0E8',
                  }}
                />
              </div>
            </>
          ) : (
            /* 학생: 글 작성 + 관리 + 검색 */
            <>
              <div className="flex gap-2 flex-1">
                <button
                  onClick={handleWriteClick}
                  className="flex-1 px-3 py-2 text-xs font-bold"
                  style={{
                    backgroundColor: '#1A1A1A',
                    color: '#F5F0E8',
                  }}
                >
                  글 작성
                </button>
                <button
                  onClick={handleManageClick}
                  className="flex-1 px-3 py-2 text-xs font-bold"
                  style={{
                    backgroundColor: 'transparent',
                    color: '#1A1A1A',
                    border: '1px solid #1A1A1A',
                  }}
                >
                  관리
                </button>
              </div>
              <div className="flex-1">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="제목 검색..."
                  className="w-full px-2.5 py-2 text-xs outline-none"
                  style={{
                    border: '1px solid #1A1A1A',
                    backgroundColor: '#F5F0E8',
                  }}
                />
              </div>
            </>
          )}
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

        {/* 헤드라인 (최신 글) */}
        {headline && (
          <div className="mb-4">
            <HeadlineArticle
              post={headline}
              onClick={() => handlePostClick(headline.id)}
              comments={commentsMap.get(headline.id) || []}
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
      <ScrollToTopButton targetRef={headerRef} />

      {/* 핀 피드백 토스트 */}
      <AnimatePresence>
        {pinToast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-12 inset-x-0 z-50 mx-auto w-fit px-5 py-2.5 bg-[#1A1A1A] text-[#F5F0E8] text-sm font-bold shadow-lg rounded-lg"
          >
            {pinToast}
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
