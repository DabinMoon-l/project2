'use client';

import { useCallback, useState, useMemo, memo, useEffect, useRef } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { collection, query, where, getDocs, db } from '@/lib/repositories';
import { Skeleton, ScrollToTopButton } from '@/components/common';
import { SPRING_TAP, TAP_SCALE } from '@/lib/constants/springs';
import { usePosts, usePinnedPosts, useMyPrivatePost, type Post, type Comment, type BoardTag, BOARD_TAGS } from '@/lib/hooks/useBoard';
import { useAuth } from '@/lib/hooks/useAuth';
import { useCourse } from '@/lib/contexts/CourseContext';
import { useUser } from '@/lib/contexts/UserContext';
import { type CourseId } from '@/lib/types/course';
import { generateCourseTags } from '@/lib/courseIndex';
import { scaleCoord, useWideMode } from '@/lib/hooks/useViewportScale';
import { useDetailPanel } from '@/lib/contexts/DetailPanelContext';
import { useHomeScale } from '@/components/home/useHomeScale';
import PostDetailPage from './[id]/page';
import WritePage from './write/page';
/** 기본 토끼 이미지 경로 */
const DEFAULT_RABBIT_IMAGE = '/rabbit/default-news.png';

/** 게시글 통계 줄 (좌=태그, 우=아이콘) */
function PostStats({ post, tag, isPrivate }: { post: Post; tag?: string; isPrivate?: boolean }) {
  return (
    <div className="mt-2 flex items-center gap-2">
      <div className="flex flex-wrap gap-1">
        {tag && (
          <span className="inline-block px-2 py-0.5 text-[11px] font-bold bg-[#1A1A1A] text-[#F5F0E8]">
            #{tag}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 text-[11px] text-[#8A8578] ml-auto">
        {/* 비공개 글은 조회수/찜 숨김, 댓글 수만 표시 */}
        {!isPrivate && (
          <>
            <span className="flex items-center gap-0.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              {post.viewCount || 0}
            </span>
            <span className="flex items-center gap-0.5">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
              </svg>
              {post.likes || 0}
            </span>
          </>
        )}
        <span className="flex items-center gap-0.5">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          {post.commentCount || 0}
        </span>
      </div>
    </div>
  );
}

/** 댓글을 postId별로 그룹화한 Map 타입 */
type CommentsMap = Map<string, Comment[]>;

/** 댓글 CSS line-clamp 클래스 (모든 역할 동일 3줄) */
const COMMENT_CLAMP = 'line-clamp-3 break-words';

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
  const rootComments = comments.filter(c => !c.parentId);

  // 채택된 댓글을 최상단으로
  if (post.acceptedCommentId) {
    const idx = rootComments.findIndex(c => c.id === post.acceptedCommentId);
    if (idx > 0) {
      const [accepted] = rootComments.splice(idx, 1);
      rootComments.unshift(accepted);
    }
  }

  // 댓글 표시 (비공개 글은 최신 1개만, 대댓글 없이)
  const displayItems: { comment: Comment; replies: Comment[] }[] = [];
  const displayRoots = post.isPrivate ? rootComments.slice(0, 1) : rootComments;
  for (const comment of displayRoots) {
    const replies = post.isPrivate ? [] : comments.filter(c => c.parentId === comment.id);
    displayItems.push({ comment, replies });
  }

  return (
    <motion.article
      onClick={onClick}
      whileTap={onClick ? TAP_SCALE : undefined}
      transition={SPRING_TAP}
      className={`group border border-[#1A1A1A] bg-[#F5F0E8] relative transition-[transform,box-shadow] ${onClick ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-md' : ''}`}
      style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
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
        <div className="flex-1 min-w-0 flex flex-col">
          {/* 제목 - 검정 박스 */}
          <div className="bg-[#1A1A1A] px-3 py-3">
            <h1 className="font-serif-display text-2xl md:text-3xl font-black text-[#F5F0E8] leading-tight line-clamp-3" style={{ fontWeight: 900 }}>
              {post.title}
            </h1>
          </div>

          {/* 본문 및 댓글 */}
          <div className="p-3 flex-1 min-w-0">
            <p className="text-xs text-[#1A1A1A] leading-relaxed line-clamp-3 break-words">
              {post.content}
            </p>

            {/* 댓글 및 대댓글 표시 (전체) */}
            {displayItems.length > 0 && (
              <div className="mt-2 pt-2 border-t border-dashed border-[#1A1A1A] overflow-hidden">
                {displayItems.map(({ comment, replies }) => (
                  <div key={comment.id}>
                    <p className={`text-xs text-[#1A1A1A] leading-snug py-0.5 ${COMMENT_CLAMP}`}>
                      <span className="whitespace-nowrap">ㄴ </span>{comment.content}
                    </p>
                    {replies.map((reply) => (
                      <p key={reply.id} className={`text-xs text-[#5C5C5C] leading-snug py-0.5 pl-4 ${COMMENT_CLAMP}`}>
                        <span className="whitespace-nowrap">ㄴ </span>{reply.content}
                      </p>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {/* 태그 + 통계 */}
            <PostStats post={post} tag={post.tag} isPrivate={post.isPrivate} />
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
              key={`dot-${index}`}
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
  const rootComments = comments.filter(c => !c.parentId);

  // 채택된 댓글을 최상단으로
  if (post.acceptedCommentId) {
    const idx = rootComments.findIndex(c => c.id === post.acceptedCommentId);
    if (idx > 0) {
      const [accepted] = rootComments.splice(idx, 1);
      rootComments.unshift(accepted);
    }
  }

  // 모든 댓글 표시
  const displayItems: { comment: Comment; replies: Comment[] }[] = [];
  for (const comment of rootComments) {
    const replies = comments.filter(c => c.parentId === comment.id);
    displayItems.push({ comment, replies });
  }

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
    <h2 className="font-serif-display text-2xl md:text-3xl font-black leading-tight text-[#1A1A1A] break-words" style={{ fontWeight: 900 }}>
      {post.title}
    </h2>
  );

  return (
    <motion.article
      onClick={onClick}
      whileTap={TAP_SCALE}
      transition={SPRING_TAP}
      className="cursor-pointer group break-inside-avoid mb-4 p-3 border border-[#1A1A1A] bg-[#F5F0E8] relative hover:-translate-y-0.5 hover:shadow-md transition-[transform,box-shadow] overflow-hidden"
      style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
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
      <p className="text-xs text-[#1A1A1A] leading-relaxed line-clamp-3 mt-2 break-words">
        {post.content}
      </p>

      {/* 댓글 및 대댓글 표시 (전체) */}
      {displayItems.length > 0 && (
        <div className="mt-2 pt-2 border-t border-dashed border-[#1A1A1A]">
          {displayItems.map(({ comment, replies }) => (
            <div key={comment.id}>
              <p className={`text-xs text-[#1A1A1A] leading-snug py-0.5 ${COMMENT_CLAMP}`}>
                <span className="whitespace-nowrap">ㄴ </span>{comment.content}
              </p>
              {replies.map((reply) => (
                <p key={reply.id} className={`text-xs text-[#5C5C5C] leading-snug py-0.5 pl-4 ${COMMENT_CLAMP}`}>
                  <span className="whitespace-nowrap">ㄴ </span>{reply.content}
                </p>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* 태그 + 통계 */}
      <PostStats post={post} tag={post.tag} isPrivate={post.isPrivate} />
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
          <div key={`skel-${i}`} className="break-inside-avoid mb-4 p-3 border border-[#1A1A1A]">
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
  const { semesterSettings, userCourseId, setProfessorCourse, assignedCourses, getCourseById, courseList: allCourses } = useCourse();
  const { user } = useAuth();
  const { profile } = useUser();
  const isWide = useWideMode();
  const { openDetail, replaceDetail, isDetailOpen, isLocked } = useDetailPanel();
  const pageScale = useHomeScale();

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
  const { privatePost } = useMyPrivatePost();

  // 과목 목록 (교수님용 — assignedCourses 기반 필터링)
  const courseList = useMemo(() => {
    if (assignedCourses.length > 0) {
      return allCourses.filter(c => assignedCourses.includes(c.id));
    }
    return allCourses;
  }, [assignedCourses, allCourses]);

  // 검색
  const [searchQuery, setSearchQuery] = useState('');
  // 태그 필터 (BoardTag + 챕터 태그 혼합)
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showTagFilter, setShowTagFilter] = useState(false);
  // 교수님 픽 필터
  const [profPickActive, setProfPickActive] = useState(false);
  // 댓글 맵 (postId -> comments)
  const [commentsMap, setCommentsMap] = useState<CommentsMap>(new Map());

  // 헤더 가시성 추적 (스크롤 맨 위로 버튼용)
  const headerRef = useRef<HTMLElement>(null);

  // 댓글 미리보기 대상 postId (비공개글 + 고정글 + 최신 20개만 — 카드 미리보기용)
  const commentTargetIds = useMemo(() => {
    const ids = new Set<string>();
    // 비공개 글 우선
    if (privatePost) ids.add(privatePost.id);
    // 고정 글
    pinnedPosts.forEach(p => ids.add(p.id));
    // 나머지 최신 20개
    const otherIds = posts.filter(p => !ids.has(p.id)).slice(0, 20).map(p => p.id);
    otherIds.forEach(id => ids.add(id));
    return [...ids];
  }, [pinnedPosts, posts, privatePost]);

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

    // getDocs 1회 조회 (onSnapshot → getDocs: 목록 미리보기용 실시간 불필요)
    let cancelled = false;
    Promise.all(
      chunks.map(async (chunk, chunkIndex) => {
        const commentsQuery = query(
          collection(db, 'comments'),
          where('postId', 'in', chunk)
        );
        const snapshot = await getDocs(commentsQuery);
        const chunkMap = new Map<string, Comment[]>();
        snapshot.forEach((doc) => {
          const data = doc.data();
          const comment: Comment = {
            id: doc.id,
            postId: data.postId || '',
            parentId: data.parentId || undefined,
            authorId: data.authorId || '',
            authorNickname: data.authorNickname || '알 수 없음',
            authorClassType: data.authorClassType || undefined,
            content: data.content || '',
            isAnonymous: data.isAnonymous || false,
            isAIReply: data.isAIReply || false,
            createdAt: data.createdAt?.toDate() || new Date(),
            likes: data.likes || 0,
            likedBy: data.likedBy || [],
          };
          const existing = chunkMap.get(comment.postId) || [];
          existing.push(comment);
          chunkMap.set(comment.postId, existing);
        });
        chunkResults.set(chunkIndex, chunkMap);
      })
    ).then(() => {
      if (!cancelled) mergeAllChunks();
    }).catch((err) => {
      console.error('댓글 조회 실패:', err);
    });

    return () => { cancelled = true; };
  }, [postIdsKey]);

  // 교수님 픽: 교수님이 찜하거나 댓글 단 글
  const profPickPostIds = useMemo(() => {
    if (!profPickActive) return null;
    const ids = new Set<string>();
    // 교수님이 찜한 글
    posts.forEach(post => {
      if (post.likedBy?.some(uid => {
        // commentsMap에서 교수 댓글 작성자 uid 확인
        // 교수 계정 = authorClassType이 없고 gemini-ai가 아닌 댓글 작성자
        return false; // likedBy에서는 uid만 있어서 역할 확인 불가 → 댓글 기반으로만 판별
      })) {
        ids.add(post.id);
      }
    });
    // 교수님이 댓글 단 글 (authorClassType 없고 gemini-ai 아닌 댓글)
    commentsMap.forEach((comments, postId) => {
      if (comments.some(c => !c.authorClassType && c.authorId !== 'gemini-ai')) {
        ids.add(postId);
      }
    });
    return ids;
  }, [profPickActive, posts, commentsMap]);

  // 전체 챕터 태그 목록 (과목 인덱스 기반 — 게시글 유무와 무관하게 항상 표시)
  const availableChapterTags = useMemo(() => {
    const courseTags = generateCourseTags(selectedCourseId);
    return courseTags.map(t => t.value);
  }, [selectedCourseId]);

  // 검색 + 태그 + 교수님 픽 필터링 및 정렬 (최신순)
  const filteredPosts = useMemo(() => {
    // 타인의 비공개 글 제외
    let result = posts.filter(post =>
      !post.isPrivate || post.authorId === user?.uid
    );

    if (searchQuery.trim()) {
      result = result.filter(post =>
        post.title.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // 교수님 픽 필터
    if (profPickPostIds) {
      result = result.filter(post => profPickPostIds.has(post.id));
    }

    // 태그 필터 적용 (선택된 태그 중 하나와 일치 — BoardTag 또는 챕터 태그)
    if (selectedTags.length > 0) {
      // 글유형 태그(학사/학술/기타)와 챕터 태그 분리 → AND 조합
      const boardTagSet = new Set(['학사', '학술', '기타']);
      const selectedBoardTags = selectedTags.filter(t => boardTagSet.has(t));
      const selectedChapterTags = selectedTags.filter(t => !boardTagSet.has(t));

      result = result.filter(post => {
        // 글유형 태그 필터 (선택된 게 있으면 반드시 매칭)
        if (selectedBoardTags.length > 0) {
          if (!post.tag || !selectedBoardTags.includes(post.tag)) return false;
        }
        // 챕터 태그 필터 (선택된 게 있으면 반드시 매칭)
        if (selectedChapterTags.length > 0) {
          if (!post.chapterTags || !post.chapterTags.some(ct => selectedChapterTags.includes(ct))) return false;
        }
        return true;
      });
    }

    // 최신순 정렬
    result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return result;
  }, [posts, searchQuery, selectedTags, profPickPostIds]);

  const handlePostClick = useCallback((postId: string) => {
    // 스와이프 네비게이션용 게시글 ID 순서 저장 (비공개 글 제외)
    const swipeableIds = filteredPosts.filter(p => !p.isPrivate).map(p => p.id);
    sessionStorage.setItem('board_post_ids', JSON.stringify(swipeableIds));
    if (isWide) {
      // 가로모드: 2쪽 유지, 3쪽에 상세페이지 표시
      const action = isDetailOpen ? replaceDetail : openDetail;
      action(<PostDetailPage panelPostId={postId} />, `/board/${postId}`);
      return;
    }
    sessionStorage.setItem('board_scroll_y', String(window.scrollY));
    sessionStorage.setItem('board_nav', 'board');
    router.push(`/board/${postId}`);
  }, [router, filteredPosts, isWide, isLocked, isDetailOpen, openDetail, replaceDetail]);

  const handleWriteClick = useCallback(() => {
    if (isWide) {
      const action = isDetailOpen ? replaceDetail : openDetail;
      action(<WritePage isPanelMode />);
      return;
    }
    sessionStorage.setItem('board_scroll_y', String(window.scrollY));
    router.push('/board/write');
  }, [router, isWide, isLocked, isDetailOpen, openDetail, replaceDetail]);

  const handleManageClick = useCallback(() => {
    if (isWide) {
      // 관리 페이지는 동적 import로 3쪽에 표시
      import('./manage/page').then(mod => {
        const ManagePage = mod.default;
        const action = isDetailOpen ? replaceDetail : openDetail;
        action(<ManagePage isPanelMode />);
      });
      return;
    }
    router.push(isProfessor ? `/board/manage?course=${selectedCourseId}` : '/board/manage');
  }, [router, isProfessor, selectedCourseId, isWide, isLocked, isDetailOpen, openDetail, replaceDetail]);

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

  // 가로모드: /board/[id]에서 리다이렉트된 경우 3쪽 패널로 열기
  useEffect(() => {
    if (!isWide || isLocked) return;
    const pendingPostId = sessionStorage.getItem('board_panel_post');
    if (pendingPostId) {
      sessionStorage.removeItem('board_panel_post');
      const action = isDetailOpen ? replaceDetail : openDetail;
      action(<PostDetailPage panelPostId={pendingPostId} />, `/board/${pendingPostId}`);
    }
  }, [isWide, isLocked, isDetailOpen, openDetail, replaceDetail]);

  // 비공개 글이 있으면 헤드라인에 고정, 없으면 최신 공개 글
  const publicPosts = useMemo(() =>
    filteredPosts.filter(p => !p.isPrivate),
  [filteredPosts]);
  const headline = privatePost || (publicPosts.length > 0 ? publicPosts[0] : null);
  const masonryPosts = privatePost
    ? publicPosts // 비공개 글이 헤드라인 → 공개 글 전부 masonry
    : publicPosts.slice(1); // 기존 로직: 최신 공개 글이 헤드라인

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
  const userCourse = profile?.courseId ? getCourseById(profile.courseId) : null;
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
          <span>✦ Prof. Jin-A Kim EDITION ✦</span>
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
          <div style={{ containerType: 'inline-size' }}>
            <h1
              className="font-serif-display font-black tracking-tight text-[#1A1A1A] text-center border-y-4 border-[#1A1A1A] whitespace-nowrap"
              style={{ fontSize: 'clamp(2rem, 13cqi, 5rem)', lineHeight: '1.15', paddingTop: '0.15em', paddingBottom: '0.15em' }}
            >
              JIBDAN JISUNG
            </h1>
          </div>
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

        {/* 버튼 + 검색 + 태그 필터 */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleWriteClick}
            className="px-3 h-8 text-[11px] font-bold flex-shrink-0"
            style={{ backgroundColor: '#1A1A1A', color: '#F5F0E8' }}
          >
            글 작성
          </button>
          <button
            onClick={handleManageClick}
            className="px-3 h-8 text-[11px] font-bold flex-shrink-0"
            style={{ backgroundColor: 'transparent', color: '#1A1A1A', border: '1px solid #1A1A1A' }}
          >
            관리
          </button>

          {/* 교수님 픽 필터 */}
          <button
            type="button"
            onClick={() => setProfPickActive(v => !v)}
            className={`px-2 h-8 text-[11px] font-bold flex-shrink-0 border border-[#1A1A1A] transition-colors ${
              profPickActive
                ? 'bg-[#1A1A1A] text-[#F5F0E8]'
                : 'bg-transparent text-[#1A1A1A]'
            }`}
          >
            교수님 픽
          </button>

          {/* 검색창 */}
          <div className="flex-1 min-w-0">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="제목 검색..."
              className="w-full px-2.5 h-8 text-[6px] outline-none"
              style={{ border: '1px solid #1A1A1A', backgroundColor: '#F5F0E8' }}
            />
          </div>

          <button
            type="button"
            onClick={() => setShowTagFilter(!showTagFilter)}
            className={`flex items-center justify-center w-8 h-8 border transition-colors shrink-0 ${
              showTagFilter
                ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                : 'bg-[#F5F0E8] text-[#1A1A1A] border-[#1A1A1A]'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
          </button>
        </div>

        {/* 선택된 태그 칩 (줄바꿈, 우측 정렬) */}
        {selectedTags.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5 mt-2">
            {selectedTags.map((tag) => (
              <div
                key={tag}
                className="flex items-center gap-0.5 px-1.5 h-9 bg-[#1A1A1A] text-[#F5F0E8] text-xs font-bold border border-[#1A1A1A]"
              >
                #{tag}
                <button
                  onClick={() => {
                    setSelectedTags(prev => prev.filter(t => t !== tag));
                  }}
                  className="ml-0.5 hover:text-[#999]"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 태그 필터 확장 패널 */}
        <AnimatePresence>
          {showTagFilter && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden mt-2"
            >
              <div className="p-2 bg-[#EDEAE4] border border-[#D4CFC4] space-y-1.5">
                {/* 기존 태그 (학사/학술/건의/기타) */}
                <div className="flex flex-wrap justify-center gap-1.5">
                  {BOARD_TAGS
                    .filter(t => !selectedTags.includes(t))
                    .map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => {
                          setSelectedTags(prev => [...prev, t]);
                          setShowTagFilter(false);
                          setSearchQuery('');
                        }}
                        className="flex-1 py-1.5 text-xs font-bold bg-[#F5F0E8] text-[#1A1A1A] border border-[#1A1A1A] hover:bg-[#E5E0D8] transition-colors"
                      >
                        #{t}
                      </button>
                    ))}
                </div>
                {/* 챕터 태그 */}
                {availableChapterTags.length > 0 && (
                  <div className="flex flex-wrap justify-center gap-1 pt-1.5 border-t border-[#D4CFC4]">
                    {availableChapterTags
                      .filter(ct => !selectedTags.includes(ct))
                      .map((ct) => (
                        <button
                          key={ct}
                          type="button"
                          onClick={() => {
                            setSelectedTags(prev => [...prev, ct]);
                            setShowTagFilter(false);
                            setSearchQuery('');
                          }}
                          className="py-1 font-bold bg-[#F5F0E8] text-[#1A1A1A] border border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
                          style={{ fontSize: Math.round(10 * pageScale), paddingLeft: Math.round(8 * pageScale), paddingRight: Math.round(8 * pageScale) }}
                        >
                          #{ct}
                        </button>
                      ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
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
              {searchQuery || selectedTags.length > 0 ? '검색 결과 없음' : 'EXTRA! EXTRA!'}
            </h3>
            <p className="text-sm text-[#3A3A3A]">
              {selectedTags.length > 0
                ? `${selectedTags.map(t => `#${t}`).join(' ')} 태그가 있는 글이 없습니다`
                : searchQuery
                  ? '다른 검색어를 입력해보세요.'
                  : '아직 소식이 없습니다. 첫 기사를 작성해보세요!'}
            </p>
          </div>
        )}

        {/* 비공개 글 헤드라인 */}
        {privatePost && (
          <div className="mb-4">
            <HeadlineArticle
              post={privatePost}
              onClick={() => handlePostClick(privatePost.id)}
              comments={commentsMap.get(privatePost.id) || []}
            />
          </div>
        )}

        {/* 헤드라인 (최신 공개 글) */}
        {!privatePost && headline && (
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
          <div className="columns-2 gap-4" style={{ transform: 'translateZ(0)' }}>
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
