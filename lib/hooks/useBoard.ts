/**
 * 게시판 관련 커스텀 훅
 *
 * 게시글 및 댓글의 CRUD 작업을 위한 훅을 제공합니다.
 * - 글 목록 조회 (카테고리별, 무한 스크롤)
 * - 글 작성/수정/삭제
 * - 댓글 작성/삭제
 * - 좋아요 토글
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  collection,
  doc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  increment,
  serverTimestamp,
  DocumentSnapshot,
  QueryDocumentSnapshot,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './useAuth';

// ============================================================
// 타입 정의
// ============================================================

/** 게시판 카테고리 */
export type BoardCategory = 'toProfessor' | 'community' | 'all';

/** 첨부파일 정보 타입 */
export interface AttachedFile {
  name: string;
  url: string;
  type: string;
  size: number;
}

/** 게시글 데이터 타입 */
export interface Post {
  id: string;
  title: string;
  content: string;
  imageUrl?: string; // 대표 이미지 (하위 호환)
  imageUrls?: string[]; // 여러 이미지
  fileUrls?: AttachedFile[]; // 첨부 파일 목록
  authorId: string;
  authorNickname: string;
  authorClassType?: 'A' | 'B' | 'C' | 'D'; // 작성자 반
  isAnonymous: boolean;
  category: BoardCategory;
  courseId?: string; // 과목 ID (과목별 분리)
  likes: number;
  likedBy: string[]; // 좋아요한 사용자 ID 배열
  commentCount: number;
  isNotice: boolean;
  createdAt: Date;
  updatedAt?: Date;
  // 고정 게시글 관련 필드
  isPinned?: boolean;
  pinnedAt?: Date;
  pinnedBy?: string;
  // 교수님께 전달 여부
  toProfessor?: boolean;
}

/** 댓글 데이터 타입 */
export interface Comment {
  id: string;
  postId: string;
  parentId?: string; // 대댓글인 경우 부모 댓글 ID
  authorId: string;
  authorNickname: string;
  authorClassType?: 'A' | 'B' | 'C' | 'D'; // 작성자 반
  content: string;
  isAnonymous: boolean;
  createdAt: Date;
  replies?: Comment[]; // 대댓글 목록 (클라이언트에서 구성)
  likes?: number; // 좋아요 수
  likedBy?: string[]; // 좋아요 누른 사용자 ID 목록
}

/** 글 작성 데이터 */
export interface CreatePostData {
  title: string;
  content: string;
  imageUrl?: string; // 대표 이미지 (하위 호환)
  imageUrls?: string[]; // 여러 이미지
  fileUrls?: AttachedFile[]; // 첨부 파일 목록
  isAnonymous: boolean;
  category: BoardCategory;
  courseId?: string; // 과목 ID (과목별 분리)
  toProfessor?: boolean; // 교수님께 전달 여부
}

/** 댓글 작성 데이터 */
export interface CreateCommentData {
  postId: string;
  content: string;
  isAnonymous: boolean;
  parentId?: string; // 대댓글인 경우 부모 댓글 ID
}

/** usePosts 훅 반환 타입 */
interface UsePostsReturn {
  posts: Post[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
}

/** usePost 훅 반환 타입 */
interface UsePostReturn {
  post: Post | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/** useComments 훅 반환 타입 */
interface UseCommentsReturn {
  comments: Comment[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/** useCreatePost 훅 반환 타입 */
interface UseCreatePostReturn {
  createPost: (data: CreatePostData) => Promise<string | null>;
  loading: boolean;
  error: string | null;
}

/** useUpdatePost 훅 반환 타입 */
interface UseUpdatePostReturn {
  updatePost: (postId: string, data: Partial<CreatePostData>) => Promise<boolean>;
  loading: boolean;
  error: string | null;
}

/** useDeletePost 훅 반환 타입 */
interface UseDeletePostReturn {
  deletePost: (postId: string) => Promise<boolean>;
  loading: boolean;
  error: string | null;
}

/** useCreateComment 훅 반환 타입 */
interface UseCreateCommentReturn {
  createComment: (data: CreateCommentData) => Promise<string | null>;
  loading: boolean;
  error: string | null;
}

/** useDeleteComment 훅 반환 타입 */
interface UseDeleteCommentReturn {
  deleteComment: (commentId: string, postId: string) => Promise<boolean>;
  loading: boolean;
  error: string | null;
}

/** useMyComments 훅 반환 타입 */
interface UseMyCommentsReturn {
  comments: (Comment & { postTitle?: string })[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/** useUpdateComment 훅 반환 타입 */
interface UseUpdateCommentReturn {
  updateComment: (commentId: string, content: string) => Promise<boolean>;
  loading: boolean;
  error: string | null;
}

/** useLike 훅 반환 타입 */
interface UseLikeReturn {
  toggleLike: (postId: string) => Promise<boolean>;
  isLiked: (postId: string) => boolean;
  loading: boolean;
  error: string | null;
}

/** useMyLikedPosts 훅 반환 타입 */
interface UseMyLikedPostsReturn {
  posts: Post[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/** usePinnedPosts 훅 반환 타입 */
interface UsePinnedPostsReturn {
  pinnedPosts: Post[];
  loading: boolean;
  error: string | null;
  pinPost: (postId: string) => Promise<boolean>;
  unpinPost: (postId: string) => Promise<boolean>;
  refresh: () => Promise<void>;
}

/** useToProfessorPosts 훅 반환 타입 */
interface UseToProfessorPostsReturn {
  posts: Post[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/** usePostsByClass 훅 반환 타입 */
interface UsePostsByClassReturn {
  posts: Post[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

// ============================================================
// 페이지 크기 상수
// ============================================================
const PAGE_SIZE = 10;

// ============================================================
// 도배 방지 유틸리티
// ============================================================

/** 마지막 글 작성 시간 저장 키 */
const LAST_POST_TIME_KEY = 'hero-quiz-last-post-time';
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
const canCreatePost = (): { canCreate: boolean; waitTime: number } => {
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
const recordPostTime = (): void => {
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
const canCreateComment = (): { canCreate: boolean; waitTime: number } => {
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
const recordCommentTime = (): void => {
  localStorage.setItem(LAST_COMMENT_TIME_KEY, Date.now().toString());
};

// ============================================================
// Firestore 문서 -> Post 변환
// ============================================================
const docToPost = (doc: QueryDocumentSnapshot | DocumentSnapshot): Post => {
  const data = doc.data();
  return {
    id: doc.id,
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
  };
};

// ============================================================
// Firestore 문서 -> Comment 변환
// ============================================================
const docToComment = (doc: QueryDocumentSnapshot | DocumentSnapshot): Comment => {
  const data = doc.data();
  return {
    id: doc.id,
    postId: data?.postId || '',
    parentId: data?.parentId || undefined,
    authorId: data?.authorId || '',
    authorNickname: data?.authorNickname || '알 수 없음',
    authorClassType: data?.authorClassType,
    content: data?.content || '',
    isAnonymous: data?.isAnonymous || false,
    createdAt: data?.createdAt?.toDate() || new Date(),
    likes: data?.likes || 0,
    likedBy: data?.likedBy || [],
  };
};

// ============================================================
// usePosts 훅 - 글 목록 조회
// ============================================================

/**
 * 게시글 목록을 조회하는 훅
 *
 * @param category - 게시판 카테고리 ('all'이면 전체 조회)
 * @param courseId - 과목 ID (과목별 필터링, 필수)
 * @returns 글 목록, 로딩 상태, 에러, 추가 로드 함수
 */
export const usePosts = (category: BoardCategory, courseId?: string): UsePostsReturn => {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot | null>(null);

  // 초기 로드
  const loadPosts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      let noticeQuery;
      let normalQuery;

      if (category === 'all') {
        // 전체 조회 (courseId 필터링 적용)
        if (courseId) {
          noticeQuery = query(
            collection(db, 'posts'),
            where('courseId', '==', courseId),
            where('isNotice', '==', true),
            orderBy('createdAt', 'desc')
          );

          normalQuery = query(
            collection(db, 'posts'),
            where('courseId', '==', courseId),
            where('isNotice', '==', false),
            orderBy('createdAt', 'desc'),
            limit(PAGE_SIZE)
          );
        } else {
          // courseId가 없으면 빈 결과 반환 (기존 게시물 호환을 위해 courseId 없는 것도 조회)
          noticeQuery = query(
            collection(db, 'posts'),
            where('isNotice', '==', true),
            orderBy('createdAt', 'desc')
          );

          normalQuery = query(
            collection(db, 'posts'),
            where('isNotice', '==', false),
            orderBy('createdAt', 'desc'),
            limit(PAGE_SIZE)
          );
        }
      } else {
        // 카테고리별 조회 (courseId 필터링 적용)
        if (courseId) {
          noticeQuery = query(
            collection(db, 'posts'),
            where('courseId', '==', courseId),
            where('category', '==', category),
            where('isNotice', '==', true),
            orderBy('createdAt', 'desc')
          );

          normalQuery = query(
            collection(db, 'posts'),
            where('courseId', '==', courseId),
            where('category', '==', category),
            where('isNotice', '==', false),
            orderBy('createdAt', 'desc'),
            limit(PAGE_SIZE)
          );
        } else {
          noticeQuery = query(
            collection(db, 'posts'),
            where('category', '==', category),
            where('isNotice', '==', true),
            orderBy('createdAt', 'desc')
          );

          normalQuery = query(
            collection(db, 'posts'),
            where('category', '==', category),
            where('isNotice', '==', false),
            orderBy('createdAt', 'desc'),
            limit(PAGE_SIZE)
          );
        }
      }

      const [noticeSnapshot, normalSnapshot] = await Promise.all([
        getDocs(noticeQuery),
        getDocs(normalQuery),
      ]);

      const notices = noticeSnapshot.docs.map(docToPost);
      const normalPosts = normalSnapshot.docs.map(docToPost);

      setPosts([...notices, ...normalPosts]);
      setHasMore(normalSnapshot.docs.length === PAGE_SIZE);
      setLastDoc(normalSnapshot.docs[normalSnapshot.docs.length - 1] || null);
    } catch (err) {
      console.error('게시글 로드 실패:', err);
      setError('게시글을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [category, courseId]);

  // 추가 로드 (무한 스크롤)
  const loadMore = useCallback(async () => {
    if (!hasMore || loading || !lastDoc) return;

    try {
      setLoading(true);

      let moreQuery;

      if (category === 'all') {
        if (courseId) {
          moreQuery = query(
            collection(db, 'posts'),
            where('courseId', '==', courseId),
            where('isNotice', '==', false),
            orderBy('createdAt', 'desc'),
            startAfter(lastDoc),
            limit(PAGE_SIZE)
          );
        } else {
          moreQuery = query(
            collection(db, 'posts'),
            where('isNotice', '==', false),
            orderBy('createdAt', 'desc'),
            startAfter(lastDoc),
            limit(PAGE_SIZE)
          );
        }
      } else {
        if (courseId) {
          moreQuery = query(
            collection(db, 'posts'),
            where('courseId', '==', courseId),
            where('category', '==', category),
            where('isNotice', '==', false),
            orderBy('createdAt', 'desc'),
            startAfter(lastDoc),
            limit(PAGE_SIZE)
          );
        } else {
          moreQuery = query(
            collection(db, 'posts'),
            where('category', '==', category),
            where('isNotice', '==', false),
            orderBy('createdAt', 'desc'),
            startAfter(lastDoc),
            limit(PAGE_SIZE)
          );
        }
      }

      const snapshot = await getDocs(moreQuery);
      const morePosts = snapshot.docs.map(docToPost);

      setPosts((prev) => [...prev, ...morePosts]);
      setHasMore(snapshot.docs.length === PAGE_SIZE);
      setLastDoc(snapshot.docs[snapshot.docs.length - 1] || null);
    } catch (err) {
      console.error('추가 게시글 로드 실패:', err);
      setError('추가 게시글을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [category, courseId, hasMore, loading, lastDoc]);

  // 새로고침
  const refresh = useCallback(async () => {
    setLastDoc(null);
    setHasMore(true);
    await loadPosts();
  }, [loadPosts]);

  // 초기 로드
  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  return { posts, loading, error, hasMore, loadMore, refresh };
};

// ============================================================
// useMyPosts 훅 - 내가 쓴 글 목록 조회
// ============================================================

/** useMyPosts 훅 반환 타입 */
interface UseMyPostsReturn {
  posts: Post[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * 현재 사용자가 작성한 글 목록을 조회하는 훅
 *
 * @returns 내 글 목록, 로딩 상태, 에러, 추가 로드 함수
 */
export const useMyPosts = (): UseMyPostsReturn => {
  const { user } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot | null>(null);

  // 초기 로드
  const loadPosts = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const myPostsQuery = query(
        collection(db, 'posts'),
        where('authorId', '==', user.uid),
        orderBy('createdAt', 'desc'),
        limit(PAGE_SIZE)
      );

      const snapshot = await getDocs(myPostsQuery);
      const myPosts = snapshot.docs.map(docToPost);

      setPosts(myPosts);
      setHasMore(snapshot.docs.length === PAGE_SIZE);
      setLastDoc(snapshot.docs[snapshot.docs.length - 1] || null);
    } catch (err) {
      console.error('내 게시글 로드 실패:', err);
      setError('게시글을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  // 추가 로드 (무한 스크롤)
  const loadMore = useCallback(async () => {
    if (!hasMore || loading || !lastDoc || !user) return;

    try {
      setLoading(true);

      const moreQuery = query(
        collection(db, 'posts'),
        where('authorId', '==', user.uid),
        orderBy('createdAt', 'desc'),
        startAfter(lastDoc),
        limit(PAGE_SIZE)
      );

      const snapshot = await getDocs(moreQuery);
      const morePosts = snapshot.docs.map(docToPost);

      setPosts((prev) => [...prev, ...morePosts]);
      setHasMore(snapshot.docs.length === PAGE_SIZE);
      setLastDoc(snapshot.docs[snapshot.docs.length - 1] || null);
    } catch (err) {
      console.error('추가 게시글 로드 실패:', err);
      setError('추가 게시글을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [user, hasMore, loading, lastDoc]);

  // 새로고침
  const refresh = useCallback(async () => {
    setLastDoc(null);
    setHasMore(true);
    await loadPosts();
  }, [loadPosts]);

  // 초기 로드
  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  return { posts, loading, error, hasMore, loadMore, refresh };
};

// ============================================================
// usePost 훅 - 단일 글 조회
// ============================================================

/**
 * 단일 게시글을 조회하는 훅
 *
 * @param postId - 게시글 ID
 * @returns 글 정보, 로딩 상태, 에러
 */
export const usePost = (postId: string): UsePostReturn => {
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPost = useCallback(async () => {
    if (!postId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const docRef = doc(db, 'posts', postId);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        setPost(docToPost(docSnap));
      } else {
        setError('게시글을 찾을 수 없습니다.');
        setPost(null);
      }
    } catch (err) {
      console.error('게시글 로드 실패:', err);
      setError('게시글을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [postId]);

  const refresh = useCallback(async () => {
    await loadPost();
  }, [loadPost]);

  useEffect(() => {
    loadPost();
  }, [loadPost]);

  return { post, loading, error, refresh };
};

// ============================================================
// useComments 훅 - 댓글 목록 조회
// ============================================================

/**
 * 댓글 목록을 조회하는 훅
 *
 * @param postId - 게시글 ID
 * @returns 댓글 목록, 로딩 상태, 에러
 */
export const useComments = (postId: string): UseCommentsReturn => {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadComments = useCallback(async () => {
    if (!postId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const commentsQuery = query(
        collection(db, 'comments'),
        where('postId', '==', postId),
        orderBy('createdAt', 'asc')
      );

      const snapshot = await getDocs(commentsQuery);
      setComments(snapshot.docs.map(docToComment));
    } catch (err) {
      console.error('댓글 로드 실패:', err);
      setError('댓글을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [postId]);

  const refresh = useCallback(async () => {
    await loadComments();
  }, [loadComments]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  return { comments, loading, error, refresh };
};

// ============================================================
// useCreatePost 훅 - 글 작성
// ============================================================

/**
 * 글 작성 훅
 *
 * @returns 글 작성 함수, 로딩 상태, 에러
 */
export const useCreatePost = (): UseCreatePostReturn => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createPost = useCallback(
    async (data: CreatePostData): Promise<string | null> => {
      if (!user) {
        setError('로그인이 필요합니다.');
        return null;
      }

      // 도배 방지 체크
      const { canCreate, waitTime } = canCreatePost();
      if (!canCreate) {
        const seconds = Math.ceil(waitTime / 1000);
        setError(`잠시 후에 다시 작성해주세요. (${seconds}초 후)`);
        return null;
      }

      try {
        setLoading(true);
        setError(null);

        // Firestore에서 사용자 정보 가져오기 (보안 강화)
        let userNickname = '용사';
        let userClassType: 'A' | 'B' | 'C' | 'D' | undefined;
        const userDocRef = doc(db, 'users', user.uid);
        const userDocSnap = await getDoc(userDocRef);
        if (userDocSnap.exists()) {
          const userData = userDocSnap.data();
          userNickname = userData.nickname || '용사';
          userClassType = userData.classId; // Firestore 필드명은 classId
        }

        const postData = {
          title: data.title,
          content: data.content,
          isAnonymous: false, // 익명 기능 사용 안 함
          category: data.category,
          courseId: data.courseId || null, // 과목 ID 저장
          imageUrl: data.imageUrl || null,
          imageUrls: data.imageUrls || [],
          fileUrls: data.fileUrls || [],
          authorId: user.uid,
          authorNickname: userNickname,
          authorClassType: userClassType || null,
          likes: 0,
          likedBy: [],
          commentCount: 0,
          isNotice: false,
          toProfessor: data.toProfessor || false, // 교수님께 전달 여부
          createdAt: serverTimestamp(),
        };

        const docRef = await addDoc(collection(db, 'posts'), postData);

        // 작성 시간 기록
        recordPostTime();

        return docRef.id;
      } catch (err) {
        console.error('글 작성 실패:', err);
        setError('글 작성에 실패했습니다.');
        return null;
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  return { createPost, loading, error };
};

// ============================================================
// useUpdatePost 훅 - 글 수정
// ============================================================

/**
 * 글 수정 훅
 *
 * @returns 글 수정 함수, 로딩 상태, 에러
 */
export const useUpdatePost = (): UseUpdatePostReturn => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updatePost = useCallback(
    async (postId: string, data: Partial<CreatePostData>): Promise<boolean> => {
      if (!user) {
        setError('로그인이 필요합니다.');
        return false;
      }

      try {
        setLoading(true);
        setError(null);

        // 글 작성자 확인
        const postRef = doc(db, 'posts', postId);
        const postSnap = await getDoc(postRef);

        if (!postSnap.exists()) {
          setError('게시글을 찾을 수 없습니다.');
          return false;
        }

        if (postSnap.data().authorId !== user.uid) {
          setError('수정 권한이 없습니다.');
          return false;
        }

        await updateDoc(postRef, {
          ...data,
          updatedAt: serverTimestamp(),
        });

        return true;
      } catch (err) {
        console.error('글 수정 실패:', err);
        setError('글 수정에 실패했습니다.');
        return false;
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  return { updatePost, loading, error };
};

// ============================================================
// useDeletePost 훅 - 글 삭제
// ============================================================

/**
 * 글 삭제 훅
 *
 * @returns 글 삭제 함수, 로딩 상태, 에러
 */
export const useDeletePost = (): UseDeletePostReturn => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deletePost = useCallback(
    async (postId: string): Promise<boolean> => {
      if (!user) {
        setError('로그인이 필요합니다.');
        return false;
      }

      try {
        setLoading(true);
        setError(null);

        // 글 작성자 확인
        const postRef = doc(db, 'posts', postId);
        const postSnap = await getDoc(postRef);

        if (!postSnap.exists()) {
          setError('게시글을 찾을 수 없습니다.');
          return false;
        }

        if (postSnap.data().authorId !== user.uid) {
          setError('삭제 권한이 없습니다.');
          return false;
        }

        // 해당 글의 모든 댓글도 삭제
        const commentsQuery = query(
          collection(db, 'comments'),
          where('postId', '==', postId)
        );
        const commentsSnapshot = await getDocs(commentsQuery);

        const deletePromises = commentsSnapshot.docs.map((doc) =>
          deleteDoc(doc.ref)
        );
        await Promise.all(deletePromises);

        // 글 삭제
        await deleteDoc(postRef);

        return true;
      } catch (err) {
        console.error('글 삭제 실패:', err);
        setError('글 삭제에 실패했습니다.');
        return false;
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  return { deletePost, loading, error };
};

// ============================================================
// useCreateComment 훅 - 댓글 작성
// ============================================================

/**
 * 댓글 작성 훅
 *
 * @returns 댓글 작성 함수, 로딩 상태, 에러
 */
export const useCreateComment = (): UseCreateCommentReturn => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createComment = useCallback(
    async (data: CreateCommentData): Promise<string | null> => {
      if (!user) {
        setError('로그인이 필요합니다.');
        return null;
      }

      // 도배 방지 체크
      const { canCreate, waitTime } = canCreateComment();
      if (!canCreate) {
        const seconds = Math.ceil(waitTime / 1000);
        setError(`잠시 후에 다시 작성해주세요. (${seconds}초 후)`);
        return null;
      }

      try {
        setLoading(true);
        setError(null);

        // Firestore에서 사용자 정보 가져오기 (보안 강화)
        let userNickname = '용사';
        let userClassType: 'A' | 'B' | 'C' | 'D' | undefined;
        const userDocRef = doc(db, 'users', user.uid);
        const userDocSnap = await getDoc(userDocRef);
        if (userDocSnap.exists()) {
          const userData = userDocSnap.data();
          userNickname = userData.nickname || '용사';
          userClassType = userData.classId; // Firestore 필드명은 classId
        }

        const commentData: Record<string, unknown> = {
          postId: data.postId,
          authorId: user.uid,
          authorNickname: userNickname,
          authorClassType: userClassType || null,
          content: data.content,
          isAnonymous: false, // 익명 기능 사용 안 함
          createdAt: serverTimestamp(),
        };

        // 대댓글인 경우 parentId 추가
        if (data.parentId) {
          commentData.parentId = data.parentId;
        }

        const docRef = await addDoc(collection(db, 'comments'), commentData);

        // 게시글의 댓글 수 증가
        const postRef = doc(db, 'posts', data.postId);
        await updateDoc(postRef, {
          commentCount: increment(1),
        });

        // 작성 시간 기록
        recordCommentTime();

        return docRef.id;
      } catch (err) {
        console.error('댓글 작성 실패:', err);
        setError('댓글 작성에 실패했습니다.');
        return null;
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  return { createComment, loading, error };
};

// ============================================================
// useDeleteComment 훅 - 댓글 삭제
// ============================================================

/**
 * 댓글 삭제 훅
 *
 * @returns 댓글 삭제 함수, 로딩 상태, 에러
 */
export const useDeleteComment = (): UseDeleteCommentReturn => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deleteComment = useCallback(
    async (commentId: string, postId: string): Promise<boolean> => {
      if (!user) {
        setError('로그인이 필요합니다.');
        return false;
      }

      try {
        setLoading(true);
        setError(null);

        // 댓글 작성자 확인
        const commentRef = doc(db, 'comments', commentId);
        const commentSnap = await getDoc(commentRef);

        if (!commentSnap.exists()) {
          setError('댓글을 찾을 수 없습니다.');
          return false;
        }

        if (commentSnap.data().authorId !== user.uid) {
          setError('삭제 권한이 없습니다.');
          return false;
        }

        // 댓글 삭제
        await deleteDoc(commentRef);

        // 게시글의 댓글 수 감소
        const postRef = doc(db, 'posts', postId);
        await updateDoc(postRef, {
          commentCount: increment(-1),
        });

        return true;
      } catch (err) {
        console.error('댓글 삭제 실패:', err);
        setError('댓글 삭제에 실패했습니다.');
        return false;
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  return { deleteComment, loading, error };
};

// ============================================================
// useMyComments 훅 - 내가 쓴 댓글 목록 조회
// ============================================================

/**
 * 현재 사용자가 작성한 댓글 목록을 조회하는 훅
 *
 * @returns 내 댓글 목록, 로딩 상태, 에러
 */
export const useMyComments = (): UseMyCommentsReturn => {
  const { user } = useAuth();
  const [comments, setComments] = useState<(Comment & { postTitle?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadComments = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // 내가 쓴 댓글 조회 (인덱스 없이 조회 후 클라이언트에서 정렬)
      const myCommentsQuery = query(
        collection(db, 'comments'),
        where('authorId', '==', user.uid),
        limit(50)
      );

      const snapshot = await getDocs(myCommentsQuery);
      const myComments = snapshot.docs.map(docToComment)
        // 클라이언트 측에서 최신순 정렬
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      // 게시글 제목 가져오기
      const postIds = [...new Set(myComments.map(c => c.postId))];
      const postTitles = new Map<string, string>();

      // 30개씩 나눠서 조회 (Firestore 제한)
      for (let i = 0; i < postIds.length; i += 30) {
        const chunk = postIds.slice(i, i + 30);
        const postsPromises = chunk.map(async (postId) => {
          try {
            const postDoc = await getDoc(doc(db, 'posts', postId));
            if (postDoc.exists()) {
              postTitles.set(postId, postDoc.data().title || '삭제된 게시글');
            } else {
              postTitles.set(postId, '삭제된 게시글');
            }
          } catch {
            postTitles.set(postId, '삭제된 게시글');
          }
        });
        await Promise.all(postsPromises);
      }

      // 댓글에 게시글 제목 추가
      const commentsWithTitle = myComments.map(comment => ({
        ...comment,
        postTitle: postTitles.get(comment.postId) || '삭제된 게시글',
      }));

      setComments(commentsWithTitle);
    } catch (err) {
      console.error('내 댓글 로드 실패:', err);
      setError('댓글을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  const refresh = useCallback(async () => {
    await loadComments();
  }, [loadComments]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  return { comments, loading, error, refresh };
};

// ============================================================
// useUpdateComment 훅 - 댓글 수정
// ============================================================

/**
 * 댓글 수정 훅
 *
 * @returns 댓글 수정 함수, 로딩 상태, 에러
 */
export const useUpdateComment = (): UseUpdateCommentReturn => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateComment = useCallback(
    async (commentId: string, content: string): Promise<boolean> => {
      if (!user) {
        setError('로그인이 필요합니다.');
        return false;
      }

      try {
        setLoading(true);
        setError(null);

        // 댓글 작성자 확인
        const commentRef = doc(db, 'comments', commentId);
        const commentSnap = await getDoc(commentRef);

        if (!commentSnap.exists()) {
          setError('댓글을 찾을 수 없습니다.');
          return false;
        }

        if (commentSnap.data().authorId !== user.uid) {
          setError('수정 권한이 없습니다.');
          return false;
        }

        await updateDoc(commentRef, {
          content,
          updatedAt: serverTimestamp(),
        });

        return true;
      } catch (err) {
        console.error('댓글 수정 실패:', err);
        setError('댓글 수정에 실패했습니다.');
        return false;
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  return { updateComment, loading, error };
};

// ============================================================
// useLike 훅 - 좋아요 토글
// ============================================================

/**
 * 좋아요 기능 훅
 *
 * @returns 좋아요 토글 함수, 좋아요 상태 확인 함수, 로딩 상태, 에러
 */
export const useLike = (): UseLikeReturn => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [likedPosts, setLikedPosts] = useState<Set<string>>(new Set());

  // 좋아요 상태 확인
  const isLiked = useCallback(
    (postId: string): boolean => {
      return likedPosts.has(postId);
    },
    [likedPosts]
  );

  // 좋아요 토글
  const toggleLike = useCallback(
    async (postId: string): Promise<boolean> => {
      if (!user) {
        setError('로그인이 필요합니다.');
        return false;
      }

      try {
        setLoading(true);
        setError(null);

        const postRef = doc(db, 'posts', postId);
        const postSnap = await getDoc(postRef);

        if (!postSnap.exists()) {
          setError('게시글을 찾을 수 없습니다.');
          return false;
        }

        const postData = postSnap.data();
        const likedBy: string[] = postData.likedBy || [];
        const isCurrentlyLiked = likedBy.includes(user.uid);

        if (isCurrentlyLiked) {
          // 좋아요 취소
          const newLikedBy = likedBy.filter((id) => id !== user.uid);
          await updateDoc(postRef, {
            likedBy: newLikedBy,
            likes: increment(-1),
          });
          setLikedPosts((prev) => {
            const newSet = new Set(prev);
            newSet.delete(postId);
            return newSet;
          });
        } else {
          // 좋아요
          await updateDoc(postRef, {
            likedBy: [...likedBy, user.uid],
            likes: increment(1),
          });
          setLikedPosts((prev) => new Set(prev).add(postId));
        }

        return true;
      } catch (err) {
        console.error('좋아요 토글 실패:', err);
        setError('좋아요 처리에 실패했습니다.');
        return false;
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  // 사용자의 좋아요 목록 로드
  useEffect(() => {
    if (!user) {
      setLikedPosts(new Set());
      return;
    }

    // 사용자가 좋아요한 글 목록을 로드하는 것은 성능상 이슈가 있을 수 있음
    // 여기서는 각 글을 조회할 때 likedBy를 확인하는 방식으로 처리
  }, [user]);

  return { toggleLike, isLiked, loading, error };
};

// ============================================================
// useCommentLike 훅 - 댓글 좋아요 토글
// ============================================================

/** useCommentLike 훅 반환 타입 */
interface UseCommentLikeReturn {
  toggleCommentLike: (commentId: string) => Promise<boolean>;
  isCommentLiked: (commentId: string) => boolean;
  loading: boolean;
  error: string | null;
}

/**
 * 댓글 좋아요 기능 훅
 *
 * @returns 댓글 좋아요 토글 함수, 좋아요 상태 확인 함수, 로딩 상태, 에러
 */
export const useCommentLike = (): UseCommentLikeReturn => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [likedComments, setLikedComments] = useState<Set<string>>(new Set());

  // 좋아요 상태 확인
  const isCommentLiked = useCallback(
    (commentId: string): boolean => {
      return likedComments.has(commentId);
    },
    [likedComments]
  );

  // 좋아요 토글
  const toggleCommentLike = useCallback(
    async (commentId: string): Promise<boolean> => {
      if (!user) {
        setError('로그인이 필요합니다.');
        return false;
      }

      try {
        setLoading(true);
        setError(null);

        const commentRef = doc(db, 'comments', commentId);
        const commentSnap = await getDoc(commentRef);

        if (!commentSnap.exists()) {
          setError('댓글을 찾을 수 없습니다.');
          return false;
        }

        const commentData = commentSnap.data();
        const likedBy: string[] = commentData.likedBy || [];
        const isCurrentlyLiked = likedBy.includes(user.uid);

        if (isCurrentlyLiked) {
          // 좋아요 취소
          const newLikedBy = likedBy.filter((id) => id !== user.uid);
          await updateDoc(commentRef, {
            likedBy: newLikedBy,
            likes: increment(-1),
          });
          setLikedComments((prev) => {
            const newSet = new Set(prev);
            newSet.delete(commentId);
            return newSet;
          });
        } else {
          // 좋아요
          await updateDoc(commentRef, {
            likedBy: [...likedBy, user.uid],
            likes: increment(1),
          });
          setLikedComments((prev) => new Set(prev).add(commentId));
        }

        return true;
      } catch (err) {
        console.error('댓글 좋아요 토글 실패:', err);
        setError('좋아요 처리에 실패했습니다.');
        return false;
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  // 사용자의 좋아요 목록 초기화
  useEffect(() => {
    if (!user) {
      setLikedComments(new Set());
    }
  }, [user]);

  return { toggleCommentLike, isCommentLiked, loading, error };
};

// ============================================================
// useMyLikedPosts 훅 - 내가 좋아요한 글 목록 조회
// ============================================================

/**
 * 현재 사용자가 좋아요한 게시글 목록을 조회하는 훅
 *
 * @returns 좋아요한 글 목록, 로딩 상태, 에러
 */
export const useMyLikedPosts = (): UseMyLikedPostsReturn => {
  const { user } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadLikedPosts = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // 내가 좋아요한 글 조회 (likedBy 배열에 내 uid가 포함된 글)
      const likedQuery = query(
        collection(db, 'posts'),
        where('likedBy', 'array-contains', user.uid),
        limit(30)
      );

      const snapshot = await getDocs(likedQuery);
      const likedPosts = snapshot.docs.map(docToPost)
        // 최신순 정렬
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      setPosts(likedPosts);
    } catch (err) {
      console.error('좋아요한 글 로드 실패:', err);
      setError('좋아요한 글을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  const refresh = useCallback(async () => {
    await loadLikedPosts();
  }, [loadLikedPosts]);

  useEffect(() => {
    loadLikedPosts();
  }, [loadLikedPosts]);

  return { posts, loading, error, refresh };
};

// ============================================================
// usePinnedPosts 훅 - 고정된 게시글 관리
// ============================================================

/**
 * 고정된 게시글을 관리하는 훅 (교수님 전용)
 *
 * @param courseId - 과목 ID (과목별 필터링)
 * @returns 고정된 글 목록, 로딩 상태, 에러, 고정/해제 함수
 */
export const usePinnedPosts = (courseId?: string): UsePinnedPostsReturn => {
  const { user } = useAuth();
  const [pinnedPosts, setPinnedPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPinnedPosts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // 고정된 글 조회 (courseId 필터링)
      let pinnedQuery;
      if (courseId) {
        pinnedQuery = query(
          collection(db, 'posts'),
          where('courseId', '==', courseId),
          where('isPinned', '==', true),
          limit(10)
        );
      } else {
        pinnedQuery = query(
          collection(db, 'posts'),
          where('isPinned', '==', true),
          limit(10)
        );
      }

      const snapshot = await getDocs(pinnedQuery);
      const pinned = snapshot.docs.map(docToPost)
        // 고정 시간순 정렬 (최근 고정이 먼저)
        .sort((a, b) => {
          const aPinnedAt = (a as any).pinnedAt?.getTime() || 0;
          const bPinnedAt = (b as any).pinnedAt?.getTime() || 0;
          return bPinnedAt - aPinnedAt;
        });

      setPinnedPosts(pinned);
    } catch (err) {
      console.error('고정 글 로드 실패:', err);
      setError('고정된 글을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  // 게시글 고정
  const pinPost = useCallback(async (postId: string): Promise<boolean> => {
    if (!user) {
      setError('로그인이 필요합니다.');
      return false;
    }

    try {
      const postRef = doc(db, 'posts', postId);
      await updateDoc(postRef, {
        isPinned: true,
        pinnedAt: serverTimestamp(),
        pinnedBy: user.uid,
      });

      await loadPinnedPosts();
      return true;
    } catch (err) {
      console.error('게시글 고정 실패:', err);
      setError('게시글 고정에 실패했습니다.');
      return false;
    }
  }, [user, loadPinnedPosts]);

  // 게시글 고정 해제
  const unpinPost = useCallback(async (postId: string): Promise<boolean> => {
    if (!user) {
      setError('로그인이 필요합니다.');
      return false;
    }

    try {
      const postRef = doc(db, 'posts', postId);
      await updateDoc(postRef, {
        isPinned: false,
        pinnedAt: null,
        pinnedBy: null,
      });

      await loadPinnedPosts();
      return true;
    } catch (err) {
      console.error('게시글 고정 해제 실패:', err);
      setError('게시글 고정 해제에 실패했습니다.');
      return false;
    }
  }, [user, loadPinnedPosts]);

  const refresh = useCallback(async () => {
    await loadPinnedPosts();
  }, [loadPinnedPosts]);

  useEffect(() => {
    loadPinnedPosts();
  }, [loadPinnedPosts]);

  return { pinnedPosts, loading, error, pinPost, unpinPost, refresh };
};

// ============================================================
// useToProfessorPosts 훅 - 교수님께 전달된 게시글 조회
// ============================================================

/**
 * 교수님께 전달된 게시글을 조회하는 훅 (교수님 전용)
 *
 * @param courseId - 과목 ID (과목별 필터링)
 * @returns 교수님께 전달된 글 목록, 로딩 상태, 에러, 새로고침 함수
 */
export const useToProfessorPosts = (courseId?: string): UseToProfessorPostsReturn => {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPosts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // toProfessor=true인 글 조회
      let postsQuery;
      if (courseId) {
        postsQuery = query(
          collection(db, 'posts'),
          where('courseId', '==', courseId),
          where('toProfessor', '==', true),
          orderBy('createdAt', 'desc'),
          limit(50)
        );
      } else {
        postsQuery = query(
          collection(db, 'posts'),
          where('toProfessor', '==', true),
          orderBy('createdAt', 'desc'),
          limit(50)
        );
      }

      const snapshot = await getDocs(postsQuery);
      const loadedPosts = snapshot.docs.map(docToPost);
      setPosts(loadedPosts);
    } catch (err) {
      console.error('교수님께 전달된 글 로드 실패:', err);
      setError('글을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  const refresh = useCallback(async () => {
    await loadPosts();
  }, [loadPosts]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  return { posts, loading, error, refresh };
};

// ============================================================
// usePostsByClass 훅 - 반별 게시글 조회
// ============================================================

/**
 * 반별 게시글을 조회하는 훅 (교수님 전용)
 *
 * @param courseId - 과목 ID (과목별 필터링)
 * @param classType - 반 ('A', 'B', 'C', 'D' 또는 undefined면 전체)
 * @returns 해당 반 글 목록, 로딩 상태, 에러, 새로고침 함수
 */
export const usePostsByClass = (
  courseId?: string,
  classType?: 'A' | 'B' | 'C' | 'D'
): UsePostsByClassReturn => {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPosts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // 반별 글 조회
      let postsQuery;

      if (courseId && classType) {
        // 과목 + 반 필터링
        postsQuery = query(
          collection(db, 'posts'),
          where('courseId', '==', courseId),
          where('authorClassType', '==', classType),
          orderBy('createdAt', 'desc'),
          limit(50)
        );
      } else if (courseId) {
        // 과목만 필터링
        postsQuery = query(
          collection(db, 'posts'),
          where('courseId', '==', courseId),
          orderBy('createdAt', 'desc'),
          limit(50)
        );
      } else if (classType) {
        // 반만 필터링
        postsQuery = query(
          collection(db, 'posts'),
          where('authorClassType', '==', classType),
          orderBy('createdAt', 'desc'),
          limit(50)
        );
      } else {
        // 전체 조회
        postsQuery = query(
          collection(db, 'posts'),
          orderBy('createdAt', 'desc'),
          limit(50)
        );
      }

      const snapshot = await getDocs(postsQuery);
      const loadedPosts = snapshot.docs.map(docToPost);
      setPosts(loadedPosts);
    } catch (err) {
      console.error('반별 글 로드 실패:', err);
      setError('글을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [courseId, classType]);

  const refresh = useCallback(async () => {
    await loadPosts();
  }, [loadPosts]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  return { posts, loading, error, refresh };
};

// 기본 내보내기
export default {
  usePosts,
  useMyPosts,
  usePost,
  useComments,
  useMyComments,
  useCreatePost,
  useUpdatePost,
  useDeletePost,
  useCreateComment,
  useUpdateComment,
  useDeleteComment,
  useLike,
  useCommentLike,
  useMyLikedPosts,
  usePinnedPosts,
  useToProfessorPosts,
  usePostsByClass,
};
