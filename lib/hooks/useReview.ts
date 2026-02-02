/**
 * 복습 관련 커스텀 훅
 *
 * useReview: 오답/찜한 문제 목록 가져오기, 삭제, 복습 완료 처리
 * 퀴즈 풀이 기록, 커스텀 폴더 관리 포함
 */

'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  doc,
  deleteDoc,
  updateDoc,
  addDoc,
  increment,
  serverTimestamp,
  Timestamp,
  getDoc,
  getDocs,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './useAuth';
import { useCourse } from '../contexts/CourseContext';

// ============================================================
// 타입 정의
// ============================================================

/**
 * 복습 문제 유형
 * - wrong: 오답
 * - bookmark: 찜한 문제
 * - solved: 푼 문제 (정답/오답 무관)
 */
export type ReviewType = 'wrong' | 'bookmark' | 'solved';

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
  /** 문제 유형 (ox, multiple, short, subjective) */
  type: 'ox' | 'multiple' | 'short' | 'subjective';
  /** 객관식 선지 */
  options?: string[];
  /** 정답 */
  correctAnswer: string;
  /** 내가 제출한 답 */
  userAnswer: string;
  /** 해설 */
  explanation?: string;
  /** 복습 유형 (오답/찜/푼문제) */
  reviewType: ReviewType;
  /** 찜 여부 */
  isBookmarked: boolean;
  /** 정답 여부 (solved 타입에서 사용) */
  isCorrect?: boolean;
  /** 복습 횟수 */
  reviewCount: number;
  /** 마지막 복습 일시 */
  lastReviewedAt: Timestamp | null;
  /** 추가된 일시 */
  createdAt: Timestamp;
  /** 퀴즈 수정 시간 (저장 당시) */
  quizUpdatedAt?: Timestamp | null;
}

/**
 * 퀴즈별로 그룹핑된 복습 문제
 */
export interface GroupedReviewItems {
  quizId: string;
  quizTitle: string;
  items: ReviewItem[];
  /** 퀴즈가 수정되었는지 여부 */
  hasUpdate?: boolean;
}

/**
 * 퀴즈 풀이 기록 (푼 문제)
 */
export interface QuizAttempt {
  /** 결과 ID */
  id: string;
  /** 퀴즈 ID */
  quizId: string;
  /** 퀴즈 제목 */
  quizTitle: string;
  /** 맞은 개수 */
  correctCount: number;
  /** 전체 문제 수 */
  totalCount: number;
  /** 획득 골드 */
  earnedGold: number;
  /** 획득 경험치 */
  earnedExp: number;
  /** 소요 시간 (초) */
  timeSpentSeconds: number;
  /** 완료 일시 */
  completedAt: Timestamp;
}

/**
 * 커스텀 폴더
 */
export interface CustomFolder {
  /** 폴더 ID */
  id: string;
  /** 폴더 이름 */
  name: string;
  /** 생성 일시 */
  createdAt: Timestamp;
  /** 문제 목록 */
  questions: { questionId: string; quizId: string; quizTitle: string }[];
}

/**
 * 퀴즈 업데이트 정보
 */
export interface QuizUpdateInfo {
  quizId: string;
  quizTitle: string;
  hasUpdate: boolean;
}

/**
 * useReview 훅의 반환 타입
 */
interface UseReviewReturn {
  /** 오답 문제 목록 */
  wrongItems: ReviewItem[];
  /** 찜한 문제 목록 */
  bookmarkedItems: ReviewItem[];
  /** 푼 문제 목록 */
  solvedItems: ReviewItem[];
  /** 퀴즈별 그룹핑된 오답 */
  groupedWrongItems: GroupedReviewItems[];
  /** 퀴즈별 그룹핑된 찜한 문제 */
  groupedBookmarkedItems: GroupedReviewItems[];
  /** 퀴즈별 그룹핑된 푼 문제 */
  groupedSolvedItems: GroupedReviewItems[];
  /** 퀴즈 풀이 기록 (푼 문제) */
  quizAttempts: QuizAttempt[];
  /** 커스텀 폴더 목록 */
  customFolders: CustomFolder[];
  /** 업데이트된 퀴즈 목록 */
  updatedQuizzes: Map<string, QuizUpdateInfo>;
  /** 로딩 상태 */
  loading: boolean;
  /** 에러 메시지 */
  error: string | null;
  /** 문제 삭제 */
  deleteReviewItem: (reviewId: string) => Promise<void>;
  /** 푼 문제(폴더) 삭제 - 퀴즈 목록에 다시 표시 */
  deleteSolvedQuiz: (quizId: string) => Promise<void>;
  /** 복습 완료 처리 */
  markAsReviewed: (reviewId: string) => Promise<void>;
  /** 커스텀 폴더 생성 */
  createCustomFolder: (name: string) => Promise<string | null>;
  /** 커스텀 폴더 삭제 */
  deleteCustomFolder: (folderId: string) => Promise<void>;
  /** 문제를 커스텀 폴더에 추가 */
  addToCustomFolder: (folderId: string, questions: { questionId: string; quizId: string; quizTitle: string }[]) => Promise<void>;
  /** 커스텀 폴더에서 문제 제거 */
  removeFromCustomFolder: (folderId: string, questionId: string) => Promise<void>;
  /** 퀴즈 업데이트 확인 후 review 항목 업데이트 */
  updateReviewItemsFromQuiz: (quizId: string) => Promise<void>;
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

  // 각 그룹 내 문제를 questionId 기준으로 정렬 (문제 순서 유지)
  for (const group of grouped.values()) {
    group.items.sort((a, b) => {
      // questionId에서 숫자 추출 (예: "q0", "q1" -> 0, 1)
      const aNum = parseInt(a.questionId.replace(/\D/g, '') || '0', 10);
      const bNum = parseInt(b.questionId.replace(/\D/g, '') || '0', 10);
      return aNum - bNum;
    });
  }

  // 그룹은 최신 추가 순으로 정렬
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
  const { userCourseId } = useCourse();
  const [wrongItems, setWrongItems] = useState<ReviewItem[]>([]);
  const [bookmarkedItems, setBookmarkedItems] = useState<ReviewItem[]>([]);
  const [solvedItems, setSolvedItems] = useState<ReviewItem[]>([]);
  const [quizAttempts, setQuizAttempts] = useState<QuizAttempt[]>([]);
  const [customFolders, setCustomFolders] = useState<CustomFolder[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState<number>(0);

  // 퀴즈 제목 캐시
  const [quizTitles, setQuizTitles] = useState<Record<string, string>>({});

  // 퀴즈 업데이트 정보
  const [updatedQuizzes, setUpdatedQuizzes] = useState<Map<string, QuizUpdateInfo>>(new Map());

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
      setSolvedItems([]);
      return;
    }

    setLoading(true);
    setError(null);

    // 오답 문제 구독 (courseId로 필터링)
    const wrongQuery = userCourseId
      ? query(
          collection(db, 'reviews'),
          where('userId', '==', user.uid),
          where('reviewType', '==', 'wrong'),
          where('courseId', '==', userCourseId)
        )
      : query(
          collection(db, 'reviews'),
          where('userId', '==', user.uid),
          where('reviewType', '==', 'wrong')
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
            quizUpdatedAt: data.quizUpdatedAt || null,
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

        // 클라이언트에서 정렬
        items.sort((a, b) => {
          const aTime = a.createdAt?.toMillis?.() || 0;
          const bTime = b.createdAt?.toMillis?.() || 0;
          return bTime - aTime;
        });

        setWrongItems(items);
        setLoading(false);
      },
      (err) => {
        console.error('오답 목록 로드 실패:', err);
        setError('오답 목록을 불러오는데 실패했습니다.');
        setLoading(false);
      }
    );

    // 찜한 문제 구독 (courseId로 필터링)
    const bookmarkQuery = userCourseId
      ? query(
          collection(db, 'reviews'),
          where('userId', '==', user.uid),
          where('reviewType', '==', 'bookmark'),
          where('courseId', '==', userCourseId)
        )
      : query(
          collection(db, 'reviews'),
          where('userId', '==', user.uid),
          where('reviewType', '==', 'bookmark')
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
            quizUpdatedAt: data.quizUpdatedAt || null,
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

        // 클라이언트에서 정렬
        items.sort((a, b) => {
          const aTime = a.createdAt?.toMillis?.() || 0;
          const bTime = b.createdAt?.toMillis?.() || 0;
          return bTime - aTime;
        });

        setBookmarkedItems(items);
      },
      (err) => {
        console.error('찜한 문제 목록 로드 실패:', err);
      }
    );

    // 푼 문제 구독 (courseId로 필터링)
    const solvedQuery = userCourseId
      ? query(
          collection(db, 'reviews'),
          where('userId', '==', user.uid),
          where('reviewType', '==', 'solved'),
          where('courseId', '==', userCourseId)
        )
      : query(
          collection(db, 'reviews'),
          where('userId', '==', user.uid),
          where('reviewType', '==', 'solved')
        );

    const unsubscribeSolved = onSnapshot(
      solvedQuery,
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
            isCorrect: data.isCorrect,
            reviewCount: data.reviewCount || 0,
            lastReviewedAt: data.lastReviewedAt,
            createdAt: data.createdAt,
            quizUpdatedAt: data.quizUpdatedAt || null,
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

        // 클라이언트에서 정렬
        items.sort((a, b) => {
          const aTime = a.createdAt?.toMillis?.() || 0;
          const bTime = b.createdAt?.toMillis?.() || 0;
          return bTime - aTime;
        });

        setSolvedItems(items);
      },
      (err) => {
        console.error('푼 문제 목록 로드 실패:', err);
      }
    );

    // 퀴즈 풀이 기록 구독 (courseId로 필터링)
    const attemptsQuery = userCourseId
      ? query(
          collection(db, 'quizResults'),
          where('userId', '==', user.uid),
          where('courseId', '==', userCourseId)
        )
      : query(
          collection(db, 'quizResults'),
          where('userId', '==', user.uid)
        );

    const unsubscribeAttempts = onSnapshot(
      attemptsQuery,
      async (snapshot) => {
        const attempts: QuizAttempt[] = [];
        const quizIds = new Set<string>();

        snapshot.forEach((doc) => {
          const data = doc.data();
          quizIds.add(data.quizId);
          attempts.push({
            id: doc.id,
            quizId: data.quizId,
            quizTitle: '', // 나중에 채움
            correctCount: data.correctCount || 0,
            totalCount: data.totalCount || 0,
            earnedGold: data.earnedGold || 0,
            earnedExp: data.earnedExp || 0,
            timeSpentSeconds: data.timeSpentSeconds || 0,
            completedAt: data.createdAt,
          });
        });

        // 퀴즈 제목 로드
        for (const quizId of Array.from(quizIds)) {
          const title = await fetchQuizTitle(quizId);
          attempts.forEach((attempt) => {
            if (attempt.quizId === quizId) {
              attempt.quizTitle = title;
            }
          });
        }

        // 클라이언트에서 정렬
        attempts.sort((a, b) => {
          const aTime = a.completedAt?.toMillis?.() || 0;
          const bTime = b.completedAt?.toMillis?.() || 0;
          return bTime - aTime;
        });

        setQuizAttempts(attempts);
      },
      (err) => {
        console.error('퀴즈 풀이 기록 로드 실패:', err);
      }
    );

    // 커스텀 폴더 구독 (courseId로 필터링)
    const foldersQuery = userCourseId
      ? query(
          collection(db, 'customFolders'),
          where('userId', '==', user.uid),
          where('courseId', '==', userCourseId)
        )
      : query(
          collection(db, 'customFolders'),
          where('userId', '==', user.uid)
        );

    const unsubscribeFolders = onSnapshot(
      foldersQuery,
      (snapshot) => {
        console.log('[useReview] 커스텀 폴더 스냅샷:', snapshot.size, '개');
        const folders: CustomFolder[] = [];

        snapshot.forEach((doc) => {
          const data = doc.data();
          console.log('[useReview] 폴더:', doc.id, data.name);
          folders.push({
            id: doc.id,
            name: data.name,
            createdAt: data.createdAt,
            questions: data.questions || [],
          });
        });

        // createdAt이 있는 것들 정렬 (serverTimestamp는 처음엔 null일 수 있음)
        folders.sort((a, b) => {
          const aTime = a.createdAt?.toMillis?.() || Date.now();
          const bTime = b.createdAt?.toMillis?.() || Date.now();
          return bTime - aTime;
        });

        setCustomFolders(folders);
      },
      (err) => {
        console.error('커스텀 폴더 로드 실패:', err);
        console.error('에러 코드:', err.code);
        console.error('에러 메시지:', err.message);
      }
    );

    return () => {
      unsubscribeWrong();
      unsubscribeBookmark();
      unsubscribeSolved();
      unsubscribeAttempts();
      unsubscribeFolders();
    };
  }, [user, userCourseId, refreshKey, fetchQuizTitle]);

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
   * 푼 문제(퀴즈) 삭제 - 퀴즈 목록에서 다시 풀 수 있도록
   */
  const deleteSolvedQuiz = useCallback(async (quizId: string): Promise<void> => {
    if (!user) return;

    try {
      // 해당 퀴즈의 모든 solved 리뷰 삭제
      const solvedQuery = query(
        collection(db, 'reviews'),
        where('userId', '==', user.uid),
        where('quizId', '==', quizId),
        where('reviewType', '==', 'solved')
      );
      const solvedDocs = await getDocs(solvedQuery);
      for (const docSnap of solvedDocs.docs) {
        await deleteDoc(docSnap.ref);
      }

      // 해당 퀴즈의 모든 wrong 리뷰도 삭제
      const wrongQuery = query(
        collection(db, 'reviews'),
        where('userId', '==', user.uid),
        where('quizId', '==', quizId),
        where('reviewType', '==', 'wrong')
      );
      const wrongDocs = await getDocs(wrongQuery);
      for (const docSnap of wrongDocs.docs) {
        await deleteDoc(docSnap.ref);
      }

      // quizResults에서 해당 기록 삭제
      const resultsQuery = query(
        collection(db, 'quizResults'),
        where('userId', '==', user.uid),
        where('quizId', '==', quizId)
      );
      const resultsDocs = await getDocs(resultsQuery);
      for (const docSnap of resultsDocs.docs) {
        await deleteDoc(docSnap.ref);
      }

      // 퀴즈 문서에서 completedUsers에서 현재 사용자 제거
      try {
        const quizRef = doc(db, 'quizzes', quizId);
        const quizDoc = await getDoc(quizRef);
        if (quizDoc.exists()) {
          const completedUsers = quizDoc.data()?.completedUsers || [];
          const newCompletedUsers = completedUsers.filter((uid: string) => uid !== user.uid);
          await updateDoc(quizRef, { completedUsers: newCompletedUsers });
        }
      } catch (updateErr) {
        console.error('퀴즈 완료 사용자 제거 실패:', updateErr);
      }
    } catch (err) {
      console.error('푼 문제 삭제 실패:', err);
      throw new Error('삭제에 실패했습니다.');
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
    setUpdatedQuizzes(new Map());
  }, []);

  /**
   * 퀴즈에서 업데이트된 문제를 review 항목에 반영
   * 기존 리뷰 데이터를 최대한 보존하면서 문제 내용만 업데이트
   */
  const updateReviewItemsFromQuiz = useCallback(async (quizId: string): Promise<void> => {
    if (!user) return;

    try {
      // 퀴즈 데이터 가져오기
      const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
      if (!quizDoc.exists()) return;

      const quizData = quizDoc.data();
      const questions = quizData.questions || [];
      const quizTitle = quizData.title || '퀴즈';
      const quizUpdatedAt = quizData.updatedAt || quizData.createdAt || null;

      // 해당 퀴즈의 기존 review 항목들 가져오기
      const existingReviewsQuery = query(
        collection(db, 'reviews'),
        where('userId', '==', user.uid),
        where('quizId', '==', quizId)
      );
      const existingReviews = await getDocs(existingReviewsQuery);

      // 기존 리뷰를 questionId+reviewType 키로 매핑
      const existingReviewMap = new Map<string, { docId: string; data: any }>();
      existingReviews.forEach((docSnapshot) => {
        const data = docSnapshot.data();
        const key = `${data.questionId}-${data.reviewType}`;
        existingReviewMap.set(key, { docId: docSnapshot.id, data });
      });

      // 새 퀴즈의 questionId 집합
      const newQuestionIds = new Set<string>();
      questions.forEach((q: any, i: number) => {
        newQuestionIds.add(q.id || `q${i}`);
      });

      // 기존 리뷰에서 새 퀴즈에 없는 문제의 리뷰는 삭제하지 않고 유지
      // (단, questionId가 완전히 달라진 경우는 인덱스 기반으로 매핑 시도)

      // 인덱스 기반 매핑을 위해 기존 리뷰의 questionId 추출 (sorted)
      const existingQuestionIds = new Set<string>();
      existingReviews.forEach((docSnapshot) => {
        existingQuestionIds.add(docSnapshot.data().questionId);
      });

      // 각 문제에 대해 업데이트 또는 생성
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const questionId = q.id || `q${i}`;

        // 타입 정규화: subjective -> short
        const rawType = q.type || 'short';
        const normalizedType = rawType === 'subjective' ? 'short' : rawType;

        // 이 문제에 대한 기존 리뷰 타입들 찾기
        const existingTypesForQuestion: string[] = [];
        existingReviewMap.forEach((value, key) => {
          if (key.startsWith(`${questionId}-`)) {
            existingTypesForQuestion.push(key.split('-')[1]);
          }
        });

        // 기존 타입이 없으면 'solved'만 생성
        const typesToProcess = existingTypesForQuestion.length > 0
          ? existingTypesForQuestion
          : ['solved'];

        for (const reviewType of typesToProcess) {
          const key = `${questionId}-${reviewType}`;
          const existing = existingReviewMap.get(key);

          if (existing) {
            // 기존 리뷰 업데이트 - 문제 내용만 업데이트하고 userAnswer, isCorrect 등은 유지
            await updateDoc(doc(db, 'reviews', existing.docId), {
              quizTitle,
              question: q.text || q.question || '',
              type: normalizedType,
              options: q.choices || q.options || [],
              correctAnswer: q.correctAnswer || q.answer || '',
              explanation: q.explanation || '',
              quizUpdatedAt,
              // userAnswer, isCorrect, reviewCount, lastReviewedAt 등은 유지
            });
            // 처리됨 표시
            existingReviewMap.delete(key);
          } else {
            // 새 리뷰 생성
            await addDoc(collection(db, 'reviews'), {
              userId: user.uid,
              quizId,
              quizTitle,
              questionId,
              question: q.text || q.question || '',
              type: normalizedType,
              options: q.choices || q.options || [],
              correctAnswer: q.correctAnswer || q.answer || '',
              userAnswer: '',
              explanation: q.explanation || '',
              reviewType,
              isBookmarked: reviewType === 'bookmark',
              isCorrect: null,
              reviewCount: 0,
              lastReviewedAt: null,
              quizUpdatedAt,
              courseId: userCourseId || null,
              createdAt: serverTimestamp(),
            });
          }
        }
      }

      // 남은 기존 리뷰들 (새 퀴즈에 없는 문제들)은 삭제하지 않고 유지
      // 사용자가 직접 삭제할 때까지 보존

      // 업데이트 정보 제거
      setUpdatedQuizzes((prev) => {
        const newMap = new Map(prev);
        newMap.delete(`wrong-${quizId}`);
        newMap.delete(`bookmark-${quizId}`);
        newMap.delete(`solved-${quizId}`);
        return newMap;
      });

    } catch (err) {
      console.error('문제 업데이트 실패:', err);
      throw new Error('문제 업데이트에 실패했습니다.');
    }
  }, [user, userCourseId]);

  /**
   * 커스텀 폴더 생성
   */
  const createCustomFolder = useCallback(async (name: string): Promise<string | null> => {
    if (!user) {
      console.error('커스텀 폴더 생성 실패: 로그인 필요');
      return null;
    }

    try {
      console.log('[useReview] 폴더 생성 시도:', name, 'userId:', user.uid);
      const docRef = await addDoc(collection(db, 'customFolders'), {
        userId: user.uid,
        name,
        questions: [],
        courseId: userCourseId || null,
        createdAt: serverTimestamp(),
      });
      console.log('[useReview] 폴더 생성 성공:', docRef.id);
      return docRef.id;
    } catch (err: any) {
      console.error('커스텀 폴더 생성 실패:', err);
      console.error('에러 코드:', err.code);
      console.error('에러 메시지:', err.message);
      return null;
    }
  }, [user, userCourseId]);

  /**
   * 커스텀 폴더 삭제
   */
  const deleteCustomFolder = useCallback(async (folderId: string): Promise<void> => {
    if (!user) return;

    try {
      await deleteDoc(doc(db, 'customFolders', folderId));
    } catch (err) {
      console.error('커스텀 폴더 삭제 실패:', err);
      throw new Error('폴더 삭제에 실패했습니다.');
    }
  }, [user]);

  /**
   * 문제를 커스텀 폴더에 추가
   */
  const addToCustomFolder = useCallback(async (
    folderId: string,
    questions: { questionId: string; quizId: string; quizTitle: string }[]
  ): Promise<void> => {
    if (!user) return;

    try {
      const folderRef = doc(db, 'customFolders', folderId);
      const folderDoc = await getDoc(folderRef);

      if (!folderDoc.exists()) {
        throw new Error('폴더를 찾을 수 없습니다.');
      }

      const currentQuestions = folderDoc.data().questions || [];
      const newQuestions = [...currentQuestions];

      // 중복 제거하며 추가
      for (const q of questions) {
        if (!newQuestions.some(existing => existing.questionId === q.questionId)) {
          newQuestions.push(q);
        }
      }

      await updateDoc(folderRef, { questions: newQuestions });
    } catch (err) {
      console.error('문제 추가 실패:', err);
      throw new Error('문제 추가에 실패했습니다.');
    }
  }, [user]);

  /**
   * 커스텀 폴더에서 문제 제거
   */
  const removeFromCustomFolder = useCallback(async (
    folderId: string,
    questionId: string
  ): Promise<void> => {
    if (!user) return;

    try {
      const folderRef = doc(db, 'customFolders', folderId);
      const folderDoc = await getDoc(folderRef);

      if (!folderDoc.exists()) {
        throw new Error('폴더를 찾을 수 없습니다.');
      }

      const currentQuestions = folderDoc.data().questions || [];
      const newQuestions = currentQuestions.filter(
        (q: { questionId: string }) => q.questionId !== questionId
      );

      await updateDoc(folderRef, { questions: newQuestions });
    } catch (err) {
      console.error('문제 제거 실패:', err);
      throw new Error('문제 제거에 실패했습니다.');
    }
  }, [user]);

  // 그룹핑된 데이터 (useMemo로 메모이제이션하여 무한 루프 방지)
  const groupedWrongItems = useMemo(() => groupByQuiz(wrongItems), [wrongItems]);
  const groupedBookmarkedItems = useMemo(() => groupByQuiz(bookmarkedItems), [bookmarkedItems]);
  const groupedSolvedItems = useMemo(() => groupByQuiz(solvedItems), [solvedItems]);

  // 퀴즈 업데이트 확인 (items 로드 후, 한 번만 실행)
  useEffect(() => {
    // 로딩 중이거나 데이터가 없으면 스킵
    if (loading) return;
    if (wrongItems.length === 0 && bookmarkedItems.length === 0 && solvedItems.length === 0) return;

    const checkAllUpdates = async () => {
      const newUpdatedQuizzes = new Map<string, QuizUpdateInfo>();

      // 오답 문제 업데이트 확인
      for (const group of groupedWrongItems) {
        if (group.items.length > 0 && group.items[0].quizUpdatedAt) {
          try {
            const quizDoc = await getDoc(doc(db, 'quizzes', group.quizId));
            if (quizDoc.exists()) {
              const quizData = quizDoc.data();
              const currentUpdatedAt = quizData?.updatedAt || quizData?.createdAt;
              const savedUpdatedAt = group.items[0].quizUpdatedAt;

              if (currentUpdatedAt && savedUpdatedAt) {
                const savedTime = savedUpdatedAt.toMillis ? savedUpdatedAt.toMillis() : 0;
                const currentTime = currentUpdatedAt.toMillis ? currentUpdatedAt.toMillis() : 0;

                if (currentTime > savedTime) {
                  newUpdatedQuizzes.set(`wrong-${group.quizId}`, {
                    quizId: group.quizId,
                    quizTitle: group.quizTitle,
                    hasUpdate: true,
                  });
                }
              }
            }
          } catch (err) {
            console.error('퀴즈 업데이트 확인 실패:', err);
          }
        }
      }

      // 찜한 문제 업데이트 확인
      for (const group of groupedBookmarkedItems) {
        if (group.items.length > 0 && group.items[0].quizUpdatedAt) {
          try {
            const quizDoc = await getDoc(doc(db, 'quizzes', group.quizId));
            if (quizDoc.exists()) {
              const quizData = quizDoc.data();
              const currentUpdatedAt = quizData?.updatedAt || quizData?.createdAt;
              const savedUpdatedAt = group.items[0].quizUpdatedAt;

              if (currentUpdatedAt && savedUpdatedAt) {
                const savedTime = savedUpdatedAt.toMillis ? savedUpdatedAt.toMillis() : 0;
                const currentTime = currentUpdatedAt.toMillis ? currentUpdatedAt.toMillis() : 0;

                if (currentTime > savedTime) {
                  newUpdatedQuizzes.set(`bookmark-${group.quizId}`, {
                    quizId: group.quizId,
                    quizTitle: group.quizTitle,
                    hasUpdate: true,
                  });
                }
              }
            }
          } catch (err) {
            console.error('퀴즈 업데이트 확인 실패:', err);
          }
        }
      }

      // 푼 문제 업데이트 확인
      for (const group of groupedSolvedItems) {
        if (group.items.length > 0 && group.items[0].quizUpdatedAt) {
          try {
            const quizDoc = await getDoc(doc(db, 'quizzes', group.quizId));
            if (quizDoc.exists()) {
              const quizData = quizDoc.data();
              const currentUpdatedAt = quizData?.updatedAt || quizData?.createdAt;
              const savedUpdatedAt = group.items[0].quizUpdatedAt;

              if (currentUpdatedAt && savedUpdatedAt) {
                const savedTime = savedUpdatedAt.toMillis ? savedUpdatedAt.toMillis() : 0;
                const currentTime = currentUpdatedAt.toMillis ? currentUpdatedAt.toMillis() : 0;

                if (currentTime > savedTime) {
                  newUpdatedQuizzes.set(`solved-${group.quizId}`, {
                    quizId: group.quizId,
                    quizTitle: group.quizTitle,
                    hasUpdate: true,
                  });
                }
              }
            }
          } catch (err) {
            console.error('퀴즈 업데이트 확인 실패:', err);
          }
        }
      }

      setUpdatedQuizzes(newUpdatedQuizzes);
    };

    checkAllUpdates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, groupedWrongItems, groupedBookmarkedItems, groupedSolvedItems]);

  return {
    wrongItems,
    bookmarkedItems,
    solvedItems,
    groupedWrongItems,
    groupedBookmarkedItems,
    groupedSolvedItems,
    quizAttempts,
    customFolders,
    updatedQuizzes,
    loading,
    error,
    deleteReviewItem,
    deleteSolvedQuiz,
    markAsReviewed,
    createCustomFolder,
    deleteCustomFolder,
    addToCustomFolder,
    removeFromCustomFolder,
    updateReviewItemsFromQuiz,
    refresh,
  };
};

export default useReview;
