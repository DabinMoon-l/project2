'use client';

/**
 * 게시판 좋아요 관련 훅
 *
 * useLike — 게시글 좋아요 토글
 * useCommentLike — 댓글 좋아요 토글
 * useMyLikedPosts — 내가 좋아요한 글 목록
 */

import { useState, useEffect, useCallback } from 'react';
import { postRepo } from '@/lib/repositories';
import { useAuth } from './useAuth';
import type { Post, UseLikeReturn, UseMyLikedPostsReturn } from './useBoardTypes';
import { docToPost } from './useBoardUtils';

// ============================================================
// useLike 훅 - 게시글 좋아요 토글
// ============================================================

export const useLike = (): UseLikeReturn => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isLiked = useCallback(
    (_postId: string): boolean => {
      return false;
    },
    []
  );

  const toggleLike = useCallback(
    async (postId: string): Promise<boolean> => {
      if (!user) {
        setError('로그인이 필요합니다.');
        return false;
      }

      try {
        setLoading(true);
        setError(null);

        await postRepo.togglePostLike(postId, user.uid);

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

interface UseCommentLikeReturn {
  toggleCommentLike: (commentId: string) => Promise<boolean>;
  isCommentLiked: (commentId: string) => boolean;
  loading: boolean;
  error: string | null;
}

export const useCommentLike = (): UseCommentLikeReturn => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCommentLiked = useCallback(
    (_commentId: string): boolean => {
      return false;
    },
    []
  );

  const toggleCommentLike = useCallback(
    async (commentId: string): Promise<boolean> => {
      if (!user) {
        setError('로그인이 필요합니다.');
        return false;
      }

      try {
        setLoading(true);
        setError(null);

        await postRepo.toggleCommentLike(commentId, user.uid);

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

      const raw = await postRepo.fetchLikedPostsByUser(user.uid, 30);
      const likedPosts = raw
        .map((d) => docToPost(d))
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
