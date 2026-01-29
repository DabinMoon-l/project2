/**
 * 복습 관련 커스텀 훅
 *
 * useReview: 오답/찜한 문제 목록 가져오기, 삭제, 복습 완료 처리
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  doc,
  deleteDoc,
  updateDoc,
  increment,
  serverTimestamp,
  Timestamp,
  getDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './useAuth';

// ============================================================
// 타입 정의
// ============================================================

/**
 * 복습 문제 유형
 * - wrong: 오답
 * - bookmark: 찜한 문제
 */
export type ReviewType = 'wrong' | 'bookmark';

/**
 * 복습 문제 데이터 타입
 */
export interface ReviewItem {
  /** 복습 문제 ID */
  id: string;
  /** 사용자 ID */
  userId: string;
  /** 퀴즈 ID */
  quizId: string;
  /** 퀴즈 제목 */
  quizTitle?: string;
  /** 문제 ID */
  questionId: string;
  /** 문제 내용 */
  question: string;
  /** 문제 유형 (ox, multiple, short) */
  type: 'ox' | 'multiple' | 'short';
  /** 객관식 선지 */
  options?: string[];
  /** 정답 */
  correctAnswer: string;
  /** 내가 제출한 답 */
  userAnswer: string;
  /** 해설 */
  explanation?: string;
  /** 복습 유형 (오답/찜) */
  reviewType: ReviewType;
  /** 찜 여부 */
  isBookmarked: boolean;
  /** 복습 횟수 */
  reviewCount: number;
  /** 마지막 복습 일시 */
  lastReviewedAt: Timestamp | null;
  /** 추가된 일시 */
  createdAt: Timestamp;
}

/**
 * 퀴즈별로 그룹핑된 복습 문제
 */
export interface GroupedReviewItems {
  quizId: string;
  quizTitle: string;
  items: ReviewItem[];
}

/**
 * useReview 훅의 반환 타입
 */
interface UseReviewReturn {
  /** 오답 문제 목록 */
  wrongItems: ReviewItem[];
  /** 찜한 문제 목록 */
  bookmarkedItems: ReviewItem[];
  /** 퀴즈별 그룹핑된 오답 */
  groupedWrongItems: GroupedReviewItems[];
  /** 퀴즈별 그룹핑된 찜한 문제 */
  groupedBookmarkedItems: GroupedReviewItems[];
  /** 로딩 상태 */
  loading: boolean;
  /** 에러 메시지 */
  error: string | null;
  /** 문제 삭제 */
  deleteReviewItem: (reviewId: string) => Promise<void>;
  /** 복습 완료 처리 */
  markAsReviewed: (reviewId: string) => Promise<void>;
  /** 데이터 새로고침 */
  refresh: () => void;
}

// ============================================================
// 유틸리티 함수
// ============================================================

/**
 * 복습 문제를 퀴즈별로 그룹핑
 */
function groupByQuiz(items: ReviewItem[]): GroupedReviewItems[] {
  const grouped = new Map<string, GroupedReviewItems>();

  items.forEach((item) => {
    const existing = grouped.get(item.quizId);
    if (existing) {
      existing.items.push(item);
    } else {
      grouped.set(item.quizId, {
        quizId: item.quizId,
        quizTitle: item.quizTitle || '퀴즈',
        items: [item],
      });
    }
  });

  // 최신 추가 순으로 정렬
  return Array.from(grouped.values()).sort((a, b) => {
    const aTime = a.items[0]?.createdAt?.toMillis() || 0;
    const bTime = b.items[0]?.createdAt?.toMillis() || 0;
    return bTime - aTime;
  });
}

// ============================================================
// useReview 훅
// ============================================================

/**
 * 복습 문제(오답/찜)를 관리하는 커스텀 훅
 *
 * Firestore의 reviews 컬렉션을 실시간으로 구독하고,
 * 문제 삭제, 복습 완료 처리 기능을 제공합니다.
 *
 * @example
 * ```tsx
 * const {
 *   wrongItems,
 *   bookmarkedItems,
 *   groupedWrongItems,
 *   loading,
 *   deleteReviewItem,
 *   markAsReviewed
 * } = useReview();
 *
 * if (loading) return <LoadingSpinner />;
 *
 * return (
 *   <ReviewList
 *     items={groupedWrongItems}
 *     onDelete={deleteReviewItem}
 *   />
 * );
 * ```
 */
export const useReview = (): UseReviewReturn => {
  // 상태 관리
  const { user } = useAuth();
  const [wrongItems, setWrongItems] = useState<ReviewItem[]>([]);
  const [bookmarkedItems, setBookmarkedItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState<number>(0);

  // 퀴즈 제목 캐시
  const [quizTitles, setQuizTitles] = useState<Record<string, string>>({});

  /**
   * 퀴즈 제목 가져오기
   */
  const fetchQuizTitle = useCallback(async (quizId: string): Promise<string> => {
    // 캐시 확인
    if (quizTitles[quizId]) {
      return quizTitles[quizId];
    }

    try {
      const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
      if (quizDoc.exists()) {
        const title = quizDoc.data()?.title || '퀴즈';
        setQuizTitles((prev) => ({ ...prev, [quizId]: title }));
        return title;
      }
    } catch (err) {
      console.error('퀴즈 제목 로드 실패:', err);
    }

    return '퀴즈';
  }, [quizTitles]);

  /**
   * 복습 문제 구독
   */
  useEffect(() => {
    if (!user) {
      setLoading(false);
      setWrongItems([]);
      setBookmarkedItems([]);
      return;
    }

    setLoading(true);
    setError(null);

    // 오답 문제 구독
    const wrongQuery = query(
      collection(db, 'reviews'),
      where('userId', '==', user.uid),
      where('reviewType', '==', 'wrong'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribeWrong = onSnapshot(
      wrongQuery,
      async (snapshot) => {
        const items: ReviewItem[] = [];
        const quizIds = new Set<string>();

        snapshot.forEach((doc) => {
          const data = doc.data();
          items.push({
            id: doc.id,
            userId: data.userId,
            quizId: data.quizId,
            quizTitle: data.quizTitle,
            questionId: data.questionId,
            question: data.question,
            type: data.type,
            options: data.options,
            correctAnswer: data.correctAnswer,
            userAnswer: data.userAnswer,
            explanation: data.explanation,
            reviewType: data.reviewType,
            isBookmarked: data.isBookmarked,
            reviewCount: data.reviewCount || 0,
            lastReviewedAt: data.lastReviewedAt,
            createdAt: data.createdAt,
          });
          quizIds.add(data.quizId);
        });

        // 퀴즈 제목 로드
        for (const quizId of Array.from(quizIds)) {
          const title = await fetchQuizTitle(quizId);
          items.forEach((item) => {
            if (item.quizId === quizId && !item.quizTitle) {
              item.quizTitle = title;
            }
          });
        }

        setWrongItems(items);
        setLoading(false);
      },
      (err) => {
        console.error('오답 목록 로드 실패:', err);
        setError('오답 목록을 불러오는데 실패했습니다.');
        setLoading(false);
      }
    );

    // 찜한 문제 구독
    const bookmarkQuery = query(
      collection(db, 'reviews'),
      where('userId', '==', user.uid),
      where('reviewType', '==', 'bookmark'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribeBookmark = onSnapshot(
      bookmarkQuery,
      async (snapshot) => {
        const items: ReviewItem[] = [];
        const quizIds = new Set<string>();

        snapshot.forEach((doc) => {
          const data = doc.data();
          items.push({
            id: doc.id,
            userId: data.userId,
            quizId: data.quizId,
            quizTitle: data.quizTitle,
            questionId: data.questionId,
            question: data.question,
            type: data.type,
            options: data.options,
            correctAnswer: data.correctAnswer,
            userAnswer: data.userAnswer,
            explanation: data.explanation,
            reviewType: data.reviewType,
            isBookmarked: data.isBookmarked,
            reviewCount: data.reviewCount || 0,
            lastReviewedAt: data.lastReviewedAt,
            createdAt: data.createdAt,
          });
          quizIds.add(data.quizId);
        });

        // 퀴즈 제목 로드
        for (const quizId of Array.from(quizIds)) {
          const title = await fetchQuizTitle(quizId);
          items.forEach((item) => {
            if (item.quizId === quizId && !item.quizTitle) {
              item.quizTitle = title;
            }
          });
        }

        setBookmarkedItems(items);
      },
      (err) => {
        console.error('찜한 문제 목록 로드 실패:', err);
      }
    );

    return () => {
      unsubscribeWrong();
      unsubscribeBookmark();
    };
  }, [user, refreshKey, fetchQuizTitle]);

  /**
   * 복습 문제 삭제
   */
  const deleteReviewItem = useCallback(async (reviewId: string): Promise<void> => {
    if (!user) return;

    try {
      await deleteDoc(doc(db, 'reviews', reviewId));
    } catch (err) {
      console.error('복습 문제 삭제 실패:', err);
      throw new Error('문제 삭제에 실패했습니다.');
    }
  }, [user]);

  /**
   * 복습 완료 처리
   */
  const markAsReviewed = useCallback(async (reviewId: string): Promise<void> => {
    if (!user) return;

    try {
      await updateDoc(doc(db, 'reviews', reviewId), {
        reviewCount: increment(1),
        lastReviewedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('복습 완료 처리 실패:', err);
      throw new Error('복습 완료 처리에 실패했습니다.');
    }
  }, [user]);

  /**
   * 데이터 새로고침
   */
  const refresh = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  // 그룹핑된 데이터
  const groupedWrongItems = groupByQuiz(wrongItems);
  const groupedBookmarkedItems = groupByQuiz(bookmarkedItems);

  return {
    wrongItems,
    bookmarkedItems,
    groupedWrongItems,
    groupedBookmarkedItems,
    loading,
    error,
    deleteReviewItem,
    markAsReviewed,
    refresh,
  };
};

export default useReview;
