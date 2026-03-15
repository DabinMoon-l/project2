/**
 * 복습 휴지통(삭제된 항목) 관리 훅
 *
 * deletedReviewItems 컬렉션에서 삭제된 항목을 로드하고,
 * 복원 및 영구 삭제 기능을 제공한다.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  doc,
  deleteDoc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  writeBatch,
  serverTimestamp,
  db,
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

    const deletedQuery = userCourseId
      ? query(
          collection(db, 'deletedReviewItems'),
          where('userId', '==', userId),
          where('courseId', '==', userCourseId),
          orderBy('deletedAt', 'desc')
        )
      : query(
          collection(db, 'deletedReviewItems'),
          where('userId', '==', userId),
          orderBy('deletedAt', 'desc')
        );

    getDocs(deletedQuery).then((snapshot) => {
      const items: DeletedItem[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        items.push({
          id: docSnap.id,
          userId: data.userId,
          courseId: data.courseId,
          type: data.type,
          originalId: data.originalId,
          title: data.title,
          questionCount: data.questionCount || 0,
          deletedAt: data.deletedAt,
          restoreData: data.restoreData,
        });
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
      const deletedRef = doc(db, 'deletedReviewItems', deletedItemId);
      const deletedDoc = await getDoc(deletedRef);

      if (!deletedDoc.exists()) {
        throw new Error('삭제된 항목을 찾을 수 없습니다.');
      }

      const data = deletedDoc.data();
      const restoreData = data.restoreData;

      // 타입에 따라 복원 (writeBatch로 일괄 처리)
      if (data.type === 'solved' && restoreData?.solvedReviews) {
        // 푼 문제 복원
        for (let i = 0; i < restoreData.solvedReviews.length; i += 500) {
          const batch = writeBatch(db);
          restoreData.solvedReviews.slice(i, i + 500).forEach((review: Record<string, unknown>) => {
            const { id, ...reviewData } = review;
            const newRef = doc(collection(db, 'reviews'));
            batch.set(newRef, { ...reviewData, createdAt: serverTimestamp() });
          });
          await batch.commit();
        }
        // quiz_completions 복원
        try {
          const completionDocId = `${data.originalId}_${userId}`;
          await setDoc(doc(db, 'quiz_completions', completionDocId), {
            quizId: data.originalId,
            userId: userId,
            completedAt: serverTimestamp(),
          }, { merge: true });
        } catch (e) {
          console.error('quiz_completions 복원 실패:', e);
        }
      } else if (data.type === 'wrong' && restoreData?.wrongReviews) {
        // 오답 복원
        for (let i = 0; i < restoreData.wrongReviews.length; i += 500) {
          const batch = writeBatch(db);
          restoreData.wrongReviews.slice(i, i + 500).forEach((review: Record<string, unknown>) => {
            const { id, ...reviewData } = review;
            const newRef = doc(collection(db, 'reviews'));
            batch.set(newRef, { ...reviewData, createdAt: serverTimestamp() });
          });
          await batch.commit();
        }
      } else if (data.type === 'bookmark' && restoreData?.bookmarkedReviewIds) {
        // 찜 복원
        const reviewIds = restoreData.bookmarkedReviewIds as string[];
        for (let i = 0; i < reviewIds.length; i += 500) {
          const batch = writeBatch(db);
          reviewIds.slice(i, i + 500).forEach((reviewId: string) => {
            batch.update(doc(db, 'reviews', reviewId), { isBookmarked: true });
          });
          await batch.commit();
        }
      } else if (data.type === 'custom' && restoreData?.folderData) {
        // 커스텀 폴더 복원
        const { id, ...folderData } = restoreData.folderData;
        await addDoc(collection(db, 'customFolders'), {
          ...folderData,
          createdAt: serverTimestamp(),
        });
      }

      // 휴지통에서 삭제
      await deleteDoc(deletedRef);
    } catch (err) {
      console.error('항목 복원 실패:', err);
      throw new Error('복원에 실패했습니다.');
    }
  }, [userId]);

  // ── 삭제된 항목 영구 삭제 ──
  const permanentlyDeleteItem = useCallback(async (deletedItemId: string): Promise<void> => {
    if (!userId) return;

    try {
      await deleteDoc(doc(db, 'deletedReviewItems', deletedItemId));
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
