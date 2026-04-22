/**
 * 게시판 게시글 관련 훅
 *
 * 게시글 목록 조회, 단일 글 조회, 글 작성/수정/삭제,
 * 고정 글, 교수님께 전달된 글, 반별 글, 과목 전체 글 등
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  serverTimestamp,
  postRepo,
  userRepo,
  type PostPageCursor,
} from '@/lib/repositories';
import { useAuth } from './useAuth';
import type {
  BoardCategory,
  Post,
  CreatePostData,
  UsePostsReturn,
  UsePostReturn,
  UseCreatePostReturn,
  UseUpdatePostReturn,
  UseDeletePostReturn,
  UsePinnedPostsReturn,
  UseToProfessorPostsReturn,
  UsePostsByClassReturn,
} from './useBoardTypes';
import {
  PAGE_SIZE,
  canCreatePost,
  recordPostTime,
  docToPost,
} from './useBoardUtils';

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
  const [pageCount, setPageCount] = useState(1);

  // onSnapshot 단일 리스너 (공지+일반 통합 — 이중 구독 방지)
  useEffect(() => {
    setLoading(true);
    setError(null);

    const listLimit = pageCount * PAGE_SIZE + 20; // 공지 여유분 (+20)
    const unsub = postRepo.subscribePostsFeed(
      { courseId: courseId ?? null, category: category !== 'all' ? category : null },
      listLimit,
      (allDocs) => {
        const mapped = allDocs.map((d) => docToPost(d));
        const notices = mapped.filter((p) => p.isNotice);
        const normalPosts = mapped.filter((p) => !p.isNotice).slice(0, pageCount * PAGE_SIZE);
        setPosts([...notices, ...normalPosts]);
        setHasMore(normalPosts.length === pageCount * PAGE_SIZE);
        setLoading(false);
      },
      (err) => {
        console.error('게시글 실시간 구독 실패:', err);
        setError('게시글을 불러오는데 실패했습니다.');
        setLoading(false);
      },
    );

    return () => unsub();
  }, [category, courseId, pageCount]);

  // 추가 로드 (pageCount 증가 → useEffect 재실행)
  const loadMore = useCallback(async () => {
    if (!hasMore || loading) return;
    setPageCount((prev) => prev + 1);
  }, [hasMore, loading]);

  // 새로고침 (pageCount 초기화)
  const refresh = useCallback(async () => {
    setPageCount(1);
  }, []);

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
export const useMyPosts = (skip = false): UseMyPostsReturn => {
  const { user } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(!skip);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [cursor, setCursor] = useState<PostPageCursor | null>(null);

  // 초기 로드
  const loadPosts = useCallback(async () => {
    if (!user || skip) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const result = await postRepo.fetchMyPostsPage(user.uid, PAGE_SIZE);
      setPosts(result.items.map((d) => docToPost(d)));
      setHasMore(result.hasMore);
      setCursor(result.nextCursor);
    } catch (err) {
      console.error('내 게시글 로드 실패:', err);
      setError('게시글을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [user, skip]);

  // 추가 로드 (무한 스크롤)
  const loadMore = useCallback(async () => {
    if (!hasMore || loading || !cursor || !user || skip) return;

    try {
      setLoading(true);
      const result = await postRepo.fetchMyPostsPage(user.uid, PAGE_SIZE, cursor);
      setPosts((prev) => [...prev, ...result.items.map((d) => docToPost(d))]);
      setHasMore(result.hasMore);
      setCursor(result.nextCursor);
    } catch (err) {
      console.error('추가 게시글 로드 실패:', err);
      setError('추가 게시글을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [user, skip, hasMore, loading, cursor]);

  // 새로고침
  const refresh = useCallback(async () => {
    setCursor(null);
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
export const usePost = (postId: string, initialPost?: Post | null): UsePostReturn => {
  const [post, setPost] = useState<Post | null>(initialPost ?? null);
  const [loading, setLoading] = useState(!initialPost);
  const [error, setError] = useState<string | null>(null);
  // initialPost 있으면 실제 post 가 한 번이라도 도착하기 전까지 모든 null 콜백을 유예
  // (Firestore + Supabase dual-write + CF 트리거 전파로 수 초 지연 가능)
  const hasReceivedPostRef = useRef(false);

  // onSnapshot 실시간 구독
  useEffect(() => {
    if (!postId) {
      setLoading(false);
      return;
    }

    if (!initialPost) setLoading(true);

    // initialPost 기반 유예는 최대 15초 — 그 이후에도 실제 post 가 안 오면 진짜 삭제로 판정
    let graceTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let graceActive = !!initialPost;
    if (graceActive) {
      graceTimeoutId = setTimeout(() => {
        graceActive = false;
      }, 15000);
    }

    const unsubscribe = postRepo.subscribePost(
      postId,
      (p) => {
        if (p) {
          setPost(docToPost(p));
          setError(null);
          hasReceivedPostRef.current = true;
          graceActive = false;
          if (graceTimeoutId) {
            clearTimeout(graceTimeoutId);
            graceTimeoutId = null;
          }
        } else if (graceActive && !hasReceivedPostRef.current) {
          // 작성 직후 서버 전파 대기 중 — initialPost 유지, 에러 설정 안 함
        } else {
          setError('게시글을 찾을 수 없습니다.');
          setPost(null);
        }
        setLoading(false);
      },
      (err) => {
        console.error('게시글 실시간 구독 실패:', err);
        setError('게시글을 불러오는데 실패했습니다.');
        setLoading(false);
      },
    );

    return () => {
      unsubscribe();
      if (graceTimeoutId) clearTimeout(graceTimeoutId);
    };
  }, [postId, initialPost]);

  // onSnapshot이 자동 처리하므로 no-op
  const refresh = useCallback(async () => {}, []);

  return { post, loading, error, refresh };
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
    async (data: CreatePostData): Promise<import('./useBoardTypes').CreatedPost | null> => {
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
        const { nickname: userNickname, classId: userClassType } =
          await userRepo.getNicknameAndClassId(user.uid);

        // 비공개 글 중복 체크 (서버 사이드 안전장치)
        if (data.isPrivate) {
          const hasPrivate = await postRepo.hasPrivatePost(user.uid);
          if (hasPrivate) {
            setError('이미 비공개 글이 있습니다. 삭제 후 다시 작성해주세요.');
            return null;
          }
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
          tag: data.tag || null, // 태그 (학사/학술/기타/비공개)
          ...(data.chapterTags && data.chapterTags.length > 0 ? { chapterTags: data.chapterTags } : {}),
          ...(data.aiDetailedAnswer ? { aiDetailedAnswer: true } : {}),
          ...(data.isPrivate ? { isPrivate: true } : {}),
          viewCount: 0,
        };

        const newPostId = await postRepo.createPost(postData);

        // 작성 시간 기록
        recordPostTime();

        // 프론트 즉시 렌더용 Post 객체 (createdAt 은 실제 서버 타임스탬프로 realtime 이 덮어씀)
        const now = new Date();
        const post = {
          id: newPostId,
          title: postData.title,
          content: postData.content,
          imageUrl: postData.imageUrl ?? undefined,
          imageUrls: postData.imageUrls ?? [],
          fileUrls: postData.fileUrls ?? [],
          authorId: postData.authorId,
          authorNickname: postData.authorNickname,
          authorClassType: postData.authorClassType ?? undefined,
          isAnonymous: postData.isAnonymous,
          category: postData.category,
          courseId: postData.courseId ?? undefined,
          likes: 0,
          likedBy: [],
          commentCount: 0,
          isNotice: false,
          createdAt: now,
          updatedAt: now,
          toProfessor: postData.toProfessor,
          viewCount: 0,
          tag: postData.tag ?? undefined,
          chapterTags: data.chapterTags,
          aiDetailedAnswer: data.aiDetailedAnswer,
          isPrivate: data.isPrivate,
        } as unknown as import('./useBoardTypes').Post;

        return { postId: newPostId, post };
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
        const post = await postRepo.getPost(postId);
        if (!post) {
          setError('게시글을 찾을 수 없습니다.');
          return false;
        }
        if (post.authorId !== user.uid) {
          setError('수정 권한이 없습니다.');
          return false;
        }

        await postRepo.updatePost(postId, {
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

        // CF로 글 + 댓글 원자적 삭제 (Admin SDK — 타인 댓글 권한 문제 해결)
        const { callFunction } = await import('@/lib/api');
        await callFunction('deletePost', { postId });

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
// usePinnedPosts 훅 - 고정된 게시글 관리
// ============================================================

/**
 * 고정된 게시글을 관리하는 훅
 * onSnapshot으로 실시간 구독하여 교수님이 고정/해제 시 학생에게도 즉시 반영
 *
 * @param courseId - 과목 ID (과목별 필터링)
 * @returns 고정된 글 목록, 로딩 상태, 에러, 고정/해제 함수
 */
export const usePinnedPosts = (courseId?: string): UsePinnedPostsReturn => {
  const { user } = useAuth();
  const [pinnedPosts, setPinnedPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // onSnapshot 실시간 구독
  useEffect(() => {
    setLoading(true);
    setError(null);

    const unsubscribe = postRepo.subscribePostsFeed(
      { courseId: courseId ?? null, isPinned: true },
      10,
      (docs) => {
        const pinned = docs.map((d) => docToPost(d))
          .sort((a, b) => {
            const aPinnedAt = a.pinnedAt?.getTime() || 0;
            const bPinnedAt = b.pinnedAt?.getTime() || 0;
            return bPinnedAt - aPinnedAt;
          });
        setPinnedPosts(pinned);
        setLoading(false);
      },
      (err) => {
        console.error('고정 글 실시간 구독 실패:', err);
        setError('고정된 글을 불러오는데 실패했습니다.');
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [courseId]);

  // 게시글 고정 (교수만 가능 — Firestore Rules에서도 검증)
  const pinPost = useCallback(async (postId: string): Promise<boolean> => {
    if (!user) {
      setError('로그인이 필요합니다.');
      return false;
    }

    try {
      await postRepo.pinPost(postId, user.uid);
      return true;
    } catch (err: unknown) {
      console.error('게시글 고정 실패:', err);
      // Firestore 권한 거부 시 명확한 메시지
      if ((err as { code?: string })?.code === 'permission-denied') {
        setError('교수님만 게시글을 고정할 수 있습니다.');
      } else {
        setError('게시글 고정에 실패했습니다.');
      }
      return false;
    }
  }, [user]);

  // 게시글 고정 해제 (교수만 가능)
  const unpinPost = useCallback(async (postId: string): Promise<boolean> => {
    if (!user) {
      setError('로그인이 필요합니다.');
      return false;
    }

    try {
      await postRepo.unpinPost(postId);
      // onSnapshot이 자동으로 상태 업데이트
      return true;
    } catch (err: unknown) {
      console.error('게시글 고정 해제 실패:', err);
      if ((err as { code?: string })?.code === 'permission-denied') {
        setError('교수님만 게시글 고정을 해제할 수 있습니다.');
      } else {
        setError('게시글 고정 해제에 실패했습니다.');
      }
      return false;
    }
  }, [user]);

  // onSnapshot이 자동 처리하므로 no-op
  const refresh = useCallback(async () => {}, []);

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

  // onSnapshot 실시간 구독
  useEffect(() => {
    setLoading(true);
    setError(null);

    const unsubscribe = postRepo.subscribePostsFeed(
      { courseId: courseId ?? null, toProfessor: true },
      50,
      (docs) => {
        setPosts(docs.map((d) => docToPost(d)));
        setLoading(false);
      },
      (err) => {
        console.error('교수님께 전달된 글 실시간 구독 실패:', err);
        setError('글을 불러오는데 실패했습니다.');
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [courseId]);

  // onSnapshot이 자동 처리하므로 no-op
  const refresh = useCallback(async () => {}, []);

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

      const docs = await postRepo.fetchPostsByClass(courseId, classType, 50);
      setPosts(docs.map((d) => docToPost(d)));
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

// ============================================================
// useAllPostsForCourse 훅 - 과목 전체 게시글 로드 (관리 대시보드용)
// ============================================================

/** useAllPostsForCourse 훅 반환 타입 */
interface UseAllPostsForCourseReturn {
  posts: Post[];
  loading: boolean;
  error: string | null;
}

/**
 * 과목별 전체 게시글을 실시간 구독하는 훅 (교수님 관리 대시보드용)
 * onSnapshot으로 실시간 업데이트 (조회수, 좋아요, 댓글수 등 즉시 반영)
 *
 * @param courseId - 과목 ID
 * @returns 전체 글 목록, 로딩 상태, 에러
 */
export const useAllPostsForCourse = (courseId?: string): UseAllPostsForCourseReturn => {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!courseId) {
      setPosts([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    let cancelled = false;
    const loadPosts = async () => {
      try {
        const docs = await postRepo.fetchAllPostsForCourse(courseId, 200);
        if (!cancelled) {
          setPosts(docs.map((d) => docToPost(d)));
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('전체 게시글 로드 실패:', err);
          setError('게시글을 불러오는데 실패했습니다.');
          setLoading(false);
        }
      }
    };

    loadPosts();
    return () => { cancelled = true; };
  }, [courseId]);

  return { posts, loading, error };
};

// ============================================================
// useMyPrivatePost 훅 - 내 비공개 글 조회
// ============================================================

/**
 * 현재 사용자의 비공개 글을 실시간 구독하는 훅
 * 비공개 글은 1인당 1개만 존재 가능
 */
export const useMyPrivatePost = (): { privatePost: Post | null; loading: boolean } => {
  const { user } = useAuth();
  const [privatePost, setPrivatePost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    const unsub = postRepo.subscribeMyPrivatePost(
      user.uid,
      (p) => {
        setPrivatePost(p ? docToPost(p) : null);
        setLoading(false);
      },
      (err) => {
        console.error('비공개 글 구독 실패:', err);
        setLoading(false);
      },
    );

    return () => unsub();
  }, [user]);

  return { privatePost, loading };
};
