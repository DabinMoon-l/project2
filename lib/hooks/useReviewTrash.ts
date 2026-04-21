/**
 * 복습 휴지통(삭제된 항목) 관리 훅
 *
 * deletedReviewItems 컬렉션에서 삭제된 항목을 로드하고,
 * 복원 및 영구 삭제 기능을 제공한다.
 *
 * 주의: deletedReviewItems 는 Phase 2 Supabase 이관 대상에서 제외됨 (Firebase 전용).
 * 휴지통은 삭제 스냅샷의 일시 저장소라 전환 가치가 낮다.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  serverTimestamp,
  reviewRepo,
  quizRepo,
} from '@/lib/repositories';
import type { DeletedItem } from './useReviewTypes';

// ============================================================
// useReviewTrash 반환 타입
// ============================================================

export interface UseReviewTrashReturn {
  /** 삭제된 항목 목록 (휴지통) */
  deletedItems: DeletedItem[];
  /** 삭제된 항목 복원 */
  restoreDeletedItem: (deletedItemId: string) => Promise<void>;
  /** 삭제된 항목 영구 삭제 */
  permanentlyDeleteItem: (deletedItemId: string) => Promise<void>;
}

// ============================================================
// useReviewTrash 훅
// ============================================================

/**
 * 휴지통 아이템 로딩 + 복원 + 영구 삭제
 *
 * @param userId - 사용자 UID
 * @param userCourseId - 현재 과목 ID
 * @param refreshKey - 외부에서 증가시키면 재조회
 */
export function useReviewTrash(
  userId: string | undefined,
  userCourseId: string | null,
  refreshKey: number,
): UseReviewTrashReturn {
  const [deletedItems, setDeletedItems] = useState<DeletedItem[]>([]);

  // ── 삭제된 항목 로드 (1회 조회) ──
  useEffect(() => {
    if (!userId) {
      setDeletedItems([]);
      return;
    }

    let isMounted = true;

    reviewRepo.fetchDeletedItems(userId, userCourseId).then((docs) => {
      const items: DeletedItem[] = docs.map((d) => {
        const data = d as Record<string, unknown>;
        return {
          id: d.id,
          userId: data.userId as string,
          courseId: data.courseId as string | null,
          type: data.type as DeletedItem['type'],
          originalId: data.originalId as string,
          title: data.title as string,
          questionCount: (data.questionCount as number) || 0,
          deletedAt: data.deletedAt as DeletedItem['deletedAt'],
          restoreData: data.restoreData as DeletedItem['restoreData'],
        };
      });
      if (isMounted) setDeletedItems(items);
    }).catch((err) => {
      console.error('삭제된 항목 로드 실패:', err);
    });

    return () => {
      isMounted = false;
    };
  }, [userId, userCourseId, refreshKey]);

  // ── 삭제된 항목 복원 ──
  const restoreDeletedItem = useCallback(async (deletedItemId: string): Promise<void> => {
    if (!userId) return;

    try {
      const deletedData = await reviewRepo.getDeletedItem(deletedItemId);
      if (!deletedData) {
        throw new Error('삭제된 항목을 찾을 수 없습니다.');
      }

      const data = deletedData as Record<string, unknown>;
      const restoreData = data.restoreData as Record<string, unknown> | undefined;

      // 타입에 따라 복원
      if (data.type === 'solved' && restoreData?.solvedReviews) {
        const solvedReviews = restoreData.solvedReviews as Record<string, unknown>[];
        const toInsert = solvedReviews.map((review) => {
          const { id: _id, ...reviewData } = review;
          return reviewData;
        });
        await reviewRepo.batchAddReviews(toInsert);

        // quiz_completions 복원
        try {
          await quizRepo.mergeQuizCompletion(data.originalId as string, userId, {
            quizId: data.originalId,
            userId: userId,
            completedAt: serverTimestamp(),
          });
        } catch (e) {
          console.error('quiz_completions 복원 실패:', e);
        }
      } else if (data.type === 'wrong' && restoreData?.wrongReviews) {
        const wrongReviews = restoreData.wrongReviews as Record<string, unknown>[];
        const toInsert = wrongReviews.map((review) => {
          const { id: _id, ...reviewData } = review;
          return reviewData;
        });
        await reviewRepo.batchAddReviews(toInsert);
      } else if (data.type === 'bookmark' && restoreData?.bookmarkedReviewIds) {
        const reviewIds = restoreData.bookmarkedReviewIds as string[];
        await reviewRepo.batchUpdateReviews(reviewIds, { isBookmarked: true });
      } else if (data.type === 'custom' && restoreData?.folderData) {
        const folderData = restoreData.folderData as Record<string, unknown>;
        const { id: _id, ...rest } = folderData;
        await reviewRepo.addFolder(rest);
      }

      // 휴지통에서 삭제
      await reviewRepo.deleteDeletedItem(deletedItemId);
    } catch (err) {
      console.error('항목 복원 실패:', err);
      throw new Error('복원에 실패했습니다.');
    }
  }, [userId]);

  // ── 삭제된 항목 영구 삭제 ──
  const permanentlyDeleteItem = useCallback(async (deletedItemId: string): Promise<void> => {
    if (!userId) return;

    try {
      await reviewRepo.deleteDeletedItem(deletedItemId);
    } catch (err) {
      console.error('영구 삭제 실패:', err);
      throw new Error('영구 삭제에 실패했습니다.');
    }
  }, [userId]);

  return {
    deletedItems,
    restoreDeletedItem,
    permanentlyDeleteItem,
  };
}
