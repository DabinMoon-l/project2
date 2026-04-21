/**
 * useBoard 유틸리티 함수
 *
 * 도배 방지, Firestore 문서 변환 등 순수 함수
 */

import type {
  DocumentSnapshot,
  QueryDocumentSnapshot,
} from '@/lib/repositories';
import type { Post, Comment } from './useBoardTypes';

// ============================================================
// 페이지 크기 상수
// ============================================================
export const PAGE_SIZE = 10;

// ============================================================
// 도배 방지 유틸리티
// ============================================================

/** 마지막 글 작성 시간 저장 키 */
const LAST_COMMENT_TIME_KEY = 'hero-quiz-last-comment-time';
const POST_COUNT_KEY = 'hero-quiz-post-count';

/** 글 작성 제한: 1분에 3개 */
const POST_LIMIT_DURATION = 60 * 1000; // 1분
const POST_LIMIT_COUNT = 3;

/** 댓글 작성 제한: 30초에 1개 */
const COMMENT_LIMIT_DURATION = 30 * 1000; // 30초

/**
 * 글 작성 가능 여부 확인
 */
export const canCreatePost = (): { canCreate: boolean; waitTime: number } => {
  const now = Date.now();
  const lastPostData = localStorage.getItem(POST_COUNT_KEY);

  if (!lastPostData) {
    return { canCreate: true, waitTime: 0 };
  }

  const { times } = JSON.parse(lastPostData) as { times: number[] };
  const recentPosts = times.filter((t) => now - t < POST_LIMIT_DURATION);

  if (recentPosts.length >= POST_LIMIT_COUNT) {
    const oldestTime = Math.min(...recentPosts);
    const waitTime = POST_LIMIT_DURATION - (now - oldestTime);
    return { canCreate: false, waitTime };
  }

  return { canCreate: true, waitTime: 0 };
};

/**
 * 글 작성 시간 기록
 */
export const recordPostTime = (): void => {
  const now = Date.now();
  const lastPostData = localStorage.getItem(POST_COUNT_KEY);

  let times: number[] = [];
  if (lastPostData) {
    const parsed = JSON.parse(lastPostData) as { times: number[] };
    times = parsed.times.filter((t) => now - t < POST_LIMIT_DURATION);
  }

  times.push(now);
  localStorage.setItem(POST_COUNT_KEY, JSON.stringify({ times }));
};

/**
 * 댓글 작성 가능 여부 확인
 */
export const canCreateComment = (): { canCreate: boolean; waitTime: number } => {
  const now = Date.now();
  const lastCommentTime = localStorage.getItem(LAST_COMMENT_TIME_KEY);

  if (!lastCommentTime) {
    return { canCreate: true, waitTime: 0 };
  }

  const timeDiff = now - parseInt(lastCommentTime, 10);
  if (timeDiff < COMMENT_LIMIT_DURATION) {
    return { canCreate: false, waitTime: COMMENT_LIMIT_DURATION - timeDiff };
  }

  return { canCreate: true, waitTime: 0 };
};

/**
 * 댓글 작성 시간 기록
 */
export const recordCommentTime = (): void => {
  localStorage.setItem(LAST_COMMENT_TIME_KEY, Date.now().toString());
};

// ============================================================
// Firestore 문서 -> Post 변환 (snapshot 또는 { id, ...data } 평탄 객체 둘 다 지원)
// ============================================================
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DocOrData = QueryDocumentSnapshot | DocumentSnapshot | ({ id: string } & Record<string, any>);

export const docToPost = (input: DocOrData): Post => {
  const maybeSnap = input as { data?: unknown; id: string };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any =
    typeof maybeSnap.data === 'function'
      ? (maybeSnap.data as () => Record<string, unknown>)()
      : (input as Record<string, unknown>);
  return {
    id: maybeSnap.id,
    title: data?.title || '',
    content: data?.content || '',
    imageUrl: data?.imageUrl,
    imageUrls: data?.imageUrls || [],
    fileUrls: data?.fileUrls || [],
    authorId: data?.authorId || '',
    authorNickname: data?.authorNickname || '알 수 없음',
    authorClassType: data?.authorClassType,
    isAnonymous: data?.isAnonymous || false,
    category: data?.category || 'community',
    courseId: data?.courseId,
    likes: data?.likes || 0,
    likedBy: data?.likedBy || [],
    commentCount: data?.commentCount || 0,
    isNotice: data?.isNotice || false,
    createdAt: data?.createdAt?.toDate() || new Date(),
    updatedAt: data?.updatedAt?.toDate(),
    // 고정 게시글 관련 필드
    isPinned: data?.isPinned || false,
    pinnedAt: data?.pinnedAt?.toDate(),
    pinnedBy: data?.pinnedBy,
    // 교수님께 전달 여부
    toProfessor: data?.toProfessor || false,
    // 조회수
    viewCount: data?.viewCount || 0,
    // 태그
    tag: data?.tag || undefined,
    // 챕터 태그
    chapterTags: data?.chapterTags || undefined,
    // 채택된 댓글 ID
    acceptedCommentId: data?.acceptedCommentId || undefined,
    // 비공개 글
    isPrivate: data?.isPrivate || false,
  };
};

// ============================================================
// Firestore 문서 -> Comment 변환 (snapshot 또는 { id, ...data } 평탄 객체 둘 다 지원)
// ============================================================
export const docToComment = (input: DocOrData): Comment => {
  const maybeSnap = input as { data?: unknown; id: string };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any =
    typeof maybeSnap.data === 'function'
      ? (maybeSnap.data as () => Record<string, unknown>)()
      : (input as Record<string, unknown>);
  return {
    id: maybeSnap.id,
    postId: data?.postId || '',
    parentId: data?.parentId || undefined,
    authorId: data?.authorId || '',
    authorNickname: data?.authorNickname || '알 수 없음',
    authorClassType: data?.authorClassType,
    content: data?.content || '',
    imageUrls: data?.imageUrls || [],
    isAnonymous: data?.isAnonymous || false,
    createdAt: data?.createdAt?.toDate() || new Date(),
    likes: data?.likes || 0,
    likedBy: data?.likedBy || [],
    isAccepted: data?.isAccepted || false,
  };
};
