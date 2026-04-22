/**
 * 게시판 댓글 관련 훅
 *
 * 댓글 목록 조회, 작성, 수정, 삭제, 내 댓글, 채택 등
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  serverTimestamp,
  postRepo,
  userRepo,
} from '@/lib/repositories';
import { useAuth } from './useAuth';
import type {
  Comment,
  CreateCommentData,
  UseCommentsReturn,
  UseCreateCommentReturn,
  UseDeleteCommentReturn,
  UseMyCommentsReturn,
  UseUpdateCommentReturn,
} from './useBoardTypes';
import {
  canCreateComment,
  recordCommentTime,
  docToComment,
} from './useBoardUtils';

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

    const unsubscribe = postRepo.subscribeComments(
      postId,
      (docs) => {
        setComments(docs.map((d) => docToComment(d)));
        setLoading(false);
      },
      (err) => {
        console.error('댓글 실시간 구독 실패:', err);
        setError('댓글을 불러오는데 실패했습니다.');
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [postId]);

  // refresh는 onSnapshot이 자동 처리하므로 no-op
  const refresh = useCallback(async () => {}, []);

  return { comments, loading, error, refresh };
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
        const [{ nickname: userNickname, classId: userClassType }, userRole] = await Promise.all([
          userRepo.getNicknameAndClassId(user.uid),
          userRepo.getRole(user.uid),
        ]);

        const commentData: Record<string, unknown> = {
          postId: data.postId,
          authorId: user.uid,
          authorNickname: userNickname,
          authorClassType: userClassType || null,
          authorRole: userRole || 'student', // 명시적 role 저장 (classType 역추론 대체)
          content: data.content,
          imageUrls: data.imageUrls || [],
          isAnonymous: false, // 익명 기능 사용 안 함
        };

        // 대댓글인 경우 parentId 추가
        if (data.parentId) {
          commentData.parentId = data.parentId;
        }

        const newCommentId = await postRepo.createComment(commentData);

        // commentCount 증가는 CF(onCommentCreate)에서 서버사이드 처리

        // 작성 시간 기록
        recordCommentTime();

        return newCommentId;
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
        const commentData = await postRepo.getComment(commentId);
        if (!commentData) {
          setError('댓글을 찾을 수 없습니다.');
          return false;
        }
        if (commentData.authorId !== user.uid) {
          setError('삭제 권한이 없습니다.');
          return false;
        }

        // 댓글 삭제 → CF(onCommentDeleted)에서 commentCount 서버사이드 감소
        await postRepo.deleteComment(commentId);

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
      const rawComments = await postRepo.fetchCommentsByAuthor(user.uid, 50);
      const myComments = rawComments
        .map((d) => docToComment(d))
        // 클라이언트 측에서 최신순 정렬
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      // 게시글 제목 가져오기 (전체 병렬)
      const postIds = [...new Set(myComments.map(c => c.postId))];
      const postTitles = new Map<string, string>();

      await Promise.all(postIds.map(async (postId) => {
        try {
          const post = await postRepo.getPost(postId);
          postTitles.set(postId, post ? ((post.title as string) || '삭제된 게시글') : '삭제된 게시글');
        } catch {
          postTitles.set(postId, '삭제된 게시글');
        }
      }));

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
        const commentData = await postRepo.getComment(commentId);
        if (!commentData) {
          setError('댓글을 찾을 수 없습니다.');
          return false;
        }
        if (commentData.authorId !== user.uid) {
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

        await postRepo.updateComment(commentId, updateData);

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
      const { callFunction } = await import('@/lib/api');
      await callFunction('acceptComment', { postId, commentId });
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
