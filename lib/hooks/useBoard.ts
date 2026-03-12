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
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  QueryDocumentSnapshot,
  onSnapshot,
  deleteField,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './useAuth';
import type {
  BoardCategory,
  Post,
  Comment,
  CreatePostData,
  CreateCommentData,
  UsePostsReturn,
  UsePostReturn,
  UseCommentsReturn,
  UseCreatePostReturn,
  UseUpdatePostReturn,
  UseDeletePostReturn,
  UseCreateCommentReturn,
  UseDeleteCommentReturn,
  UseMyCommentsReturn,
  UseUpdateCommentReturn,
  UseLikeReturn,
  UseMyLikedPostsReturn,
  UsePinnedPostsReturn,
  UseToProfessorPostsReturn,
  UsePostsByClassReturn,
} from './useBoardTypes';
import {
  PAGE_SIZE,
  canCreatePost,
  recordPostTime,
  canCreateComment,
  recordCommentTime,
  docToPost,
  docToComment,
} from './useBoardUtils';

// 하위 호환을 위한 re-export
export type { BoardCategory, BoardTag, AttachedFile, Post, Comment, CreatePostData, CreateCommentData } from './useBoardTypes';
export { BOARD_TAGS } from './useBoardTypes';

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

    // 공지+일반 통합 쿼리 (isNotice 필터 제거, 클라이언트에서 분리)
    const constraints = [
      ...(courseId ? [where('courseId', '==', courseId)] : []),
      ...(category !== 'all' ? [where('category', '==', category)] : []),
      orderBy('createdAt', 'desc'),
      limit(pageCount * PAGE_SIZE + 20), // 공지 여유분 (+20)
    ];

    const postsQuery = query(collection(db, 'posts'), ...constraints);

    const unsub = onSnapshot(
      postsQuery,
      (snapshot) => {
        const allDocs = snapshot.docs.map(docToPost);
        // 공지는 상단, 일반은 하단 (원래와 동일한 결과)
        const notices = allDocs.filter(p => p.isNotice);
        const normalPosts = allDocs.filter(p => !p.isNotice).slice(0, pageCount * PAGE_SIZE);
        setPosts([...notices, ...normalPosts]);
        setHasMore(normalPosts.length === pageCount * PAGE_SIZE);
        setLoading(false);
      },
      (err) => {
        console.error('게시글 실시간 구독 실패:', err);
        setError('게시글을 불러오는데 실패했습니다.');
        setLoading(false);
      }
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
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot | null>(null);

  // 초기 로드
  const loadPosts = useCallback(async () => {
    if (!user || skip) {
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
  }, [user, skip]);

  // 추가 로드 (무한 스크롤)
  const loadMore = useCallback(async () => {
    if (!hasMore || loading || !lastDoc || !user || skip) return;

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

  // onSnapshot 실시간 구독
  useEffect(() => {
    if (!postId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const docRef = doc(db, 'posts', postId);
    const unsubscribe = onSnapshot(
      docRef,
      (docSnap) => {
        if (docSnap.exists()) {
          setPost(docToPost(docSnap));
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
      }
    );

    return () => unsubscribe();
  }, [postId]);

  // onSnapshot이 자동 처리하므로 no-op
  const refresh = useCallback(async () => {}, []);

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

  // onSnapshot 실시간 구독
  useEffect(() => {
    if (!postId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const commentsQuery = query(
      collection(db, 'comments'),
      where('postId', '==', postId),
      orderBy('createdAt', 'asc')
    );

    const unsubscribe = onSnapshot(
      commentsQuery,
      (snapshot) => {
        setComments(snapshot.docs.map(docToComment));
        setLoading(false);
      },
      (err) => {
        console.error('댓글 실시간 구독 실패:', err);
        setError('댓글을 불러오는데 실패했습니다.');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [postId]);

  // refresh는 onSnapshot이 자동 처리하므로 no-op
  const refresh = useCallback(async () => {}, []);

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
          tag: data.tag || null, // 태그 (학사/학술/기타)
          viewCount: 0,
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

        // CF로 글 + 댓글 원자적 삭제 (Admin SDK — 타인 댓글 권한 문제 해결)
        const { getFunctions, httpsCallable } = await import('firebase/functions');
        const functions = getFunctions(undefined, 'asia-northeast3');
        const deletePostFn = httpsCallable(functions, 'deletePost');
        await deletePostFn({ postId });

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
          imageUrls: data.imageUrls || [],
          isAnonymous: false, // 익명 기능 사용 안 함
          createdAt: serverTimestamp(),
        };

        // 대댓글인 경우 parentId 추가
        if (data.parentId) {
          commentData.parentId = data.parentId;
        }

        const docRef = await addDoc(collection(db, 'comments'), commentData);

        // commentCount 증가는 CF(onCommentCreate)에서 서버사이드 처리

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

        // 댓글 삭제 → CF(onCommentDeleted)에서 commentCount 서버사이드 감소
        await deleteDoc(commentRef);

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
export const useMyComments = (skip = false): UseMyCommentsReturn => {
  const { user } = useAuth();
  const [comments, setComments] = useState<(Comment & { postTitle?: string })[]>([]);
  const [loading, setLoading] = useState(!skip);
  const [error, setError] = useState<string | null>(null);

  const loadComments = useCallback(async () => {
    if (!user || skip) {
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
  }, [user, skip]);

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
    async (commentId: string, content: string, imageUrls?: string[]): Promise<boolean> => {
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

        const updateData: Record<string, unknown> = {
          content,
          updatedAt: serverTimestamp(),
        };
        if (imageUrls !== undefined) {
          updateData.imageUrls = imageUrls;
        }

        await updateDoc(commentRef, updateData);

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

  // 좋아요 상태 확인 — post.likedBy 배열로 직접 판단 (호출 측에서 post 전달)
  // 기존 인터페이스 유지: postId만 받되, 내부에서는 사용 안 함
  // → 실제 판단은 board/[id]/page.tsx에서 post.likedBy로 직접 수행
  const isLiked = useCallback(
    (_postId: string): boolean => {
      // 이 함수는 더 이상 사용하지 않음 — post.likedBy?.includes(uid) 직접 사용 권장
      return false;
    },
    []
  );

  // 좋아요 토글 — like 문서 존재 여부를 getDoc으로 확인 (Set 의존 제거)
  const toggleLike = useCallback(
    async (postId: string): Promise<boolean> => {
      if (!user) {
        setError('로그인이 필요합니다.');
        return false;
      }

      try {
        setLoading(true);
        setError(null);

        const likeDocId = `${user.uid}_post_${postId}`;
        const likeRef = doc(db, 'likes', likeDocId);
        const likeSnap = await getDoc(likeRef);

        if (likeSnap.exists()) {
          // 좋아요 취소 — likes 컬렉션에서 삭제 → CF가 posts.likes/likedBy 업데이트
          await deleteDoc(likeRef);
        } else {
          // 좋아요 — likes 컬렉션에 생성 → CF가 posts.likes/likedBy 업데이트
          const postSnap = await getDoc(doc(db, 'posts', postId));
          const postAuthorId = postSnap.data()?.authorId || postSnap.data()?.userId || '';
          await setDoc(likeRef, {
            userId: user.uid,
            targetType: 'post',
            targetId: postId,
            targetUserId: postAuthorId,
            createdAt: serverTimestamp(),
          });
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

  // 좋아요 상태 확인 — comment.likedBy 배열로 직접 판단 (호출 측에서 처리)
  const isCommentLiked = useCallback(
    (_commentId: string): boolean => {
      return false;
    },
    []
  );

  // 좋아요 토글 — like 문서 존재 여부를 getDoc으로 확인 (Set 의존 제거)
  const toggleCommentLike = useCallback(
    async (commentId: string): Promise<boolean> => {
      if (!user) {
        setError('로그인이 필요합니다.');
        return false;
      }

      try {
        setLoading(true);
        setError(null);

        const likeDocId = `${user.uid}_comment_${commentId}`;
        const likeRef = doc(db, 'likes', likeDocId);
        const likeSnap = await getDoc(likeRef);

        if (likeSnap.exists()) {
          // 좋아요 취소 — likes 컬렉션에서 삭제 → CF가 comments.likes/likedBy 업데이트
          await deleteDoc(likeRef);
        } else {
          // 좋아요 — likes 컬렉션에 생성 → CF가 comments.likes/likedBy 업데이트
          const commentSnap = await getDoc(doc(db, 'comments', commentId));
          const commentAuthorId = commentSnap.data()?.authorId || commentSnap.data()?.userId || '';
          await setDoc(likeRef, {
            userId: user.uid,
            targetType: 'comment',
            targetId: commentId,
            targetUserId: commentAuthorId,
            createdAt: serverTimestamp(),
          });
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
export const useMyLikedPosts = (skip = false): UseMyLikedPostsReturn => {
  const { user } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(!skip);
  const [error, setError] = useState<string | null>(null);

  const loadLikedPosts = useCallback(async () => {
    if (!user || skip) {
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
  }, [user, skip]);

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

    const unsubscribe = onSnapshot(
      pinnedQuery,
      (snapshot) => {
        const pinned = snapshot.docs.map(docToPost)
          .sort((a, b) => {
            const aPinnedAt = (a as any).pinnedAt?.getTime() || 0;
            const bPinnedAt = (b as any).pinnedAt?.getTime() || 0;
            return bPinnedAt - aPinnedAt;
          });
        setPinnedPosts(pinned);
        setLoading(false);
      },
      (err) => {
        console.error('고정 글 실시간 구독 실패:', err);
        setError('고정된 글을 불러오는데 실패했습니다.');
        setLoading(false);
      }
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
      const postRef = doc(db, 'posts', postId);
      await updateDoc(postRef, {
        isPinned: true,
        pinnedAt: serverTimestamp(),
        pinnedBy: user.uid,
      });
      return true;
    } catch (err: any) {
      console.error('게시글 고정 실패:', err);
      // Firestore 권한 거부 시 명확한 메시지
      if (err?.code === 'permission-denied') {
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
      const postRef = doc(db, 'posts', postId);
      await updateDoc(postRef, {
        isPinned: false,
        pinnedAt: deleteField(),
        pinnedBy: deleteField(),
      });
      // onSnapshot이 자동으로 상태 업데이트
      return true;
    } catch (err: any) {
      console.error('게시글 고정 해제 실패:', err);
      if (err?.code === 'permission-denied') {
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

    const constraints = [
      ...(courseId ? [where('courseId', '==', courseId)] : []),
      where('toProfessor', '==', true),
      orderBy('createdAt', 'desc'),
      limit(50),
    ];

    const postsQuery = query(collection(db, 'posts'), ...constraints);

    const unsubscribe = onSnapshot(
      postsQuery,
      (snapshot) => {
        setPosts(snapshot.docs.map(docToPost));
        setLoading(false);
      },
      (err) => {
        console.error('교수님께 전달된 글 실시간 구독 실패:', err);
        setError('글을 불러오는데 실패했습니다.');
        setLoading(false);
      }
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
        const allQuery = query(
          collection(db, 'posts'),
          where('courseId', '==', courseId),
          orderBy('createdAt', 'desc'),
          limit(200)
        );
        const snapshot = await getDocs(allQuery);
        if (!cancelled) {
          setPosts(snapshot.docs.map(docToPost));
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
// useAcceptComment 훅 - 댓글 채택
// ============================================================

/** useAcceptComment 훅 반환 타입 */
interface UseAcceptCommentReturn {
  acceptComment: (postId: string, commentId: string) => Promise<boolean>;
  loading: boolean;
}

/**
 * 댓글 채택 훅 (글 작성자만 사용 가능)
 */
export const useAcceptComment = (): UseAcceptCommentReturn => {
  const [loading, setLoading] = useState(false);

  const accept = useCallback(async (postId: string, commentId: string): Promise<boolean> => {
    setLoading(true);
    try {
      const { httpsCallable } = await import('firebase/functions');
      const { functions } = await import('../firebase');
      const fn = httpsCallable(functions, 'acceptComment');
      await fn({ postId, commentId });
      return true;
    } catch (err) {
      console.error('댓글 채택 실패:', err);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return { acceptComment: accept, loading };
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
  useAllPostsForCourse,
  useAcceptComment,
};
