/**
 * 복습 아이템 로딩 + 페이지네이션 훅
 *
 * Firestore에서 오답/찜/푼 문제를 일회성 조회하고,
 * 퀴즈 풀이 기록 및 비공개 퀴즈 목록도 함께 로드한다.
 * 페이지네이션(loadMore)과 퀴즈별/챕터별 그룹핑도 포함.
 */

'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  doc,
  limit,
  startAfter,
  getDoc,
  getDocs,
  db,
  type DocumentData,
} from '@/lib/repositories';
import type { ReviewItem, QuizAttempt, PrivateQuiz, GroupedReviewItems, ChapterGroupedWrongItems } from './useReviewTypes';
import { groupByQuiz, groupByChapterAndQuiz } from './useReviewUtils';

// ============================================================
// 내부 헬퍼: 문서 → ReviewItem 변환
// ============================================================

/** Firestore 스냅샷 문서를 ReviewItem으로 변환 */
function mapDocToReviewItem(docSnapshot: { id: string; data: () => unknown }): ReviewItem {
  const data = docSnapshot.data() as DocumentData;
  return {
    id: docSnapshot.id,
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
    combinedGroupId: data.combinedGroupId,
    combinedIndex: data.combinedIndex,
    combinedTotal: data.combinedTotal,
    passage: data.passage,
    passageType: data.passageType,
    passageImage: data.passageImage,
    koreanAbcItems: data.koreanAbcItems,
    passageMixedExamples: data.passageMixedExamples,
    commonQuestion: data.commonQuestion,
    image: data.image,
    subQuestionOptions: data.subQuestionOptions,
    subQuestionOptionsType: data.subQuestionOptionsType,
    mixedExamples: data.mixedExamples,
    subQuestionImage: data.subQuestionImage,
    quizCreatorId: data.quizCreatorId,
    quizType: data.quizType,
    chapterId: data.chapterId,
    chapterDetailId: data.chapterDetailId,
    choiceExplanations: data.choiceExplanations || null,
    imageUrl: data.imageUrl || null,
    passagePrompt: data.passagePrompt,
    bogiQuestionText: data.bogiQuestionText,
    bogi: data.bogi || null,
  };
}

// ============================================================
// 퀴즈 제목 캐시 (모듈 수준 — 훅 재생성 시에도 유지)
// ============================================================

const quizTitlesCache: Record<string, string> = {};

/** 퀴즈 제목 가져오기 (모듈 캐시 사용) */
async function fetchQuizTitle(quizId: string): Promise<string> {
  if (quizTitlesCache[quizId]) {
    return quizTitlesCache[quizId];
  }

  try {
    const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
    if (quizDoc.exists()) {
      const title = quizDoc.data()?.title || '퀴즈';
      quizTitlesCache[quizId] = title;
      return title;
    }
  } catch (err) {
    console.error('퀴즈 제목 로드 실패:', err);
  }

  return '퀴즈';
}

/** 퀴즈 제목을 병렬로 가져와서 아이템에 채우는 헬퍼 */
async function fillQuizTitles(items: { quizId: string; quizTitle?: string }[]) {
  const quizIds = new Set<string>();
  items.forEach(item => quizIds.add(item.quizId));

  // 병렬로 제목 가져오기
  const titleEntries = await Promise.all(
    Array.from(quizIds).map(async (quizId) => {
      const title = await fetchQuizTitle(quizId);
      return [quizId, title] as const;
    })
  );
  const titleMap = new Map(titleEntries);

  items.forEach((item) => {
    if (!item.quizTitle) {
      item.quizTitle = titleMap.get(item.quizId) || '퀴즈';
    }
  });
}

// ============================================================
// useReviewItems 반환 타입
// ============================================================

export interface UseReviewItemsReturn {
  /** 오답 문제 목록 */
  wrongItems: ReviewItem[];
  /** 찜한 문제 목록 */
  bookmarkedItems: ReviewItem[];
  /** 푼 문제 목록 */
  solvedItems: ReviewItem[];
  /** 푼 문제 추가 로드 가능 여부 */
  hasMoreSolved: boolean;
  /** 푼 문제 추가 로드 */
  loadMoreSolved: () => Promise<void>;
  /** 오답 추가 로드 가능 여부 */
  hasMoreWrong: boolean;
  /** 오답 추가 로드 */
  loadMoreWrong: () => Promise<void>;
  /** 찜한 문제 추가 로드 가능 여부 */
  hasMoreBookmark: boolean;
  /** 찜한 문제 추가 로드 */
  loadMoreBookmark: () => Promise<void>;
  /** 퀴즈별 그룹핑된 오답 */
  groupedWrongItems: GroupedReviewItems[];
  /** 챕터별로 그룹핑된 오답 */
  chapterGroupedWrongItems: ChapterGroupedWrongItems[];
  /** 퀴즈별 그룹핑된 찜한 문제 */
  groupedBookmarkedItems: GroupedReviewItems[];
  /** 퀴즈별 그룹핑된 푼 문제 */
  groupedSolvedItems: GroupedReviewItems[];
  /** 퀴즈 풀이 기록 */
  quizAttempts: QuizAttempt[];
  /** 비공개 퀴즈 목록 */
  privateQuizzes: PrivateQuiz[];
  /** 로딩 상태 */
  loading: boolean;
  /** 에러 메시지 */
  error: string | null;
  /** refreshKey (외부에서 증가시키면 재조회) */
  refreshKey: number;
  /** 데이터 새로고침 */
  refresh: () => void;
}

// ============================================================
// useReviewItems 훅
// ============================================================

/**
 * 복습 아이템 로딩 + 페이지네이션 + 그룹핑
 *
 * @param userId - 사용자 UID (useAuth에서 가져옴)
 * @param userCourseId - 현재 과목 ID (useCourse에서 가져옴)
 */
export function useReviewItems(
  userId: string | undefined,
  userCourseId: string | null,
): UseReviewItemsReturn {
  // 상태 관리
  const [wrongItems, setWrongItems] = useState<ReviewItem[]>([]);
  const [bookmarkedItems, setBookmarkedItems] = useState<ReviewItem[]>([]);
  const [solvedItems, setSolvedItems] = useState<ReviewItem[]>([]);
  const [hasMoreSolved, setHasMoreSolved] = useState(false);
  const [hasMoreWrong, setHasMoreWrong] = useState(false);
  const [hasMoreBookmark, setHasMoreBookmark] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Firestore 페이지네이션 커서
  const solvedLastDocRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Firestore 페이지네이션 커서
  const wrongLastDocRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Firestore 페이지네이션 커서
  const bookmarkLastDocRef = useRef<any>(null);
  const solvedQueryBaseRef = useRef<ReturnType<typeof query> | null>(null);
  const wrongQueryBaseRef = useRef<ReturnType<typeof query> | null>(null);
  const bookmarkQueryBaseRef = useRef<ReturnType<typeof query> | null>(null);
  const [quizAttempts, setQuizAttempts] = useState<QuizAttempt[]>([]);
  const [privateQuizzes, setPrivateQuizzes] = useState<PrivateQuiz[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState<number>(0);

  // ──────────────────────────────────────────────
  // 데이터 로딩 (오답/찜/푼문제/풀이기록/비공개퀴즈)
  // ──────────────────────────────────────────────
  useEffect(() => {
    if (!userId) {
      setLoading(false);
      setWrongItems([]);
      setBookmarkedItems([]);
      setSolvedItems([]);
      return;
    }

    setLoading(true);
    setError(null);

    // 초기 로딩 카운터: 핵심 3개(wrong, bookmark, solved) 응답 후 로딩 해제
    let loadedCount = 0;
    const CORE_LISTENER_COUNT = 3;
    let isMounted = true;

    const markLoaded = () => {
      loadedCount++;
      if (loadedCount >= CORE_LISTENER_COUNT && isMounted) {
        setLoading(false);
      }
    };

    // 오답/찜 페이지네이션 크기
    const REVIEW_PAGE_SIZE = 100;

    // ── 오답 문제 조회 ──
    const wrongQuery = userCourseId
      ? query(
          collection(db, 'reviews'),
          where('userId', '==', userId),
          where('reviewType', '==', 'wrong'),
          where('courseId', '==', userCourseId),
          orderBy('createdAt', 'desc'),
          limit(REVIEW_PAGE_SIZE + 1)
        )
      : query(
          collection(db, 'reviews'),
          where('userId', '==', userId),
          where('reviewType', '==', 'wrong'),
          orderBy('createdAt', 'desc'),
          limit(REVIEW_PAGE_SIZE + 1)
        );

    wrongQueryBaseRef.current = userCourseId
      ? query(
          collection(db, 'reviews'),
          where('userId', '==', userId),
          where('reviewType', '==', 'wrong'),
          where('courseId', '==', userCourseId),
          orderBy('createdAt', 'desc')
        )
      : query(
          collection(db, 'reviews'),
          where('userId', '==', userId),
          where('reviewType', '==', 'wrong'),
          orderBy('createdAt', 'desc')
        );

    getDocs(wrongQuery).then(async (snapshot) => {
      try {
        const docs = snapshot.docs;
        const hasMore = docs.length > REVIEW_PAGE_SIZE;
        const pageDocs = hasMore ? docs.slice(0, REVIEW_PAGE_SIZE) : docs;

        const items: ReviewItem[] = pageDocs.map(mapDocToReviewItem);
        await fillQuizTitles(items);

        if (isMounted) {
          setWrongItems(items);
          setHasMoreWrong(hasMore);
          wrongLastDocRef.current = pageDocs.length > 0
            ? pageDocs[pageDocs.length - 1]
            : null;
        }
      } catch (e) {
        console.error('오답 처리 실패:', e);
      } finally {
        if (isMounted) markLoaded();
      }
    }).catch((err) => {
      console.error('오답 목록 로드 실패:', err);
      if (isMounted) {
        setError('오답 목록을 불러오는데 실패했습니다.');
        markLoaded();
      }
    });

    // ── 찜한 문제 조회 ──
    const bookmarkQuery = userCourseId
      ? query(
          collection(db, 'reviews'),
          where('userId', '==', userId),
          where('reviewType', '==', 'bookmark'),
          where('courseId', '==', userCourseId),
          orderBy('createdAt', 'desc'),
          limit(REVIEW_PAGE_SIZE + 1)
        )
      : query(
          collection(db, 'reviews'),
          where('userId', '==', userId),
          where('reviewType', '==', 'bookmark'),
          orderBy('createdAt', 'desc'),
          limit(REVIEW_PAGE_SIZE + 1)
        );

    bookmarkQueryBaseRef.current = userCourseId
      ? query(
          collection(db, 'reviews'),
          where('userId', '==', userId),
          where('reviewType', '==', 'bookmark'),
          where('courseId', '==', userCourseId),
          orderBy('createdAt', 'desc')
        )
      : query(
          collection(db, 'reviews'),
          where('userId', '==', userId),
          where('reviewType', '==', 'bookmark'),
          orderBy('createdAt', 'desc')
        );

    getDocs(bookmarkQuery).then(async (snapshot) => {
      try {
        const docs = snapshot.docs;
        const hasMore = docs.length > REVIEW_PAGE_SIZE;
        const pageDocs = hasMore ? docs.slice(0, REVIEW_PAGE_SIZE) : docs;

        const items: ReviewItem[] = pageDocs.map(mapDocToReviewItem);
        await fillQuizTitles(items);

        if (isMounted) {
          setBookmarkedItems(items);
          setHasMoreBookmark(hasMore);
          bookmarkLastDocRef.current = pageDocs.length > 0
            ? pageDocs[pageDocs.length - 1]
            : null;
        }
      } catch (e) {
        console.error('찜한 문제 처리 실패:', e);
      } finally {
        if (isMounted) markLoaded();
      }
    }).catch((err) => {
      console.error('찜한 문제 목록 로드 실패:', err);
      if (isMounted) markLoaded();
    });

    // ── 푼 문제 조회 ──
    const SOLVED_PAGE_SIZE = 50;
    const solvedBaseQuery = userCourseId
      ? query(
          collection(db, 'reviews'),
          where('userId', '==', userId),
          where('reviewType', '==', 'solved'),
          where('courseId', '==', userCourseId),
          orderBy('createdAt', 'desc'),
          limit(SOLVED_PAGE_SIZE + 1)
        )
      : query(
          collection(db, 'reviews'),
          where('userId', '==', userId),
          where('reviewType', '==', 'solved'),
          orderBy('createdAt', 'desc'),
          limit(SOLVED_PAGE_SIZE + 1)
        );

    solvedQueryBaseRef.current = userCourseId
      ? query(
          collection(db, 'reviews'),
          where('userId', '==', userId),
          where('reviewType', '==', 'solved'),
          where('courseId', '==', userCourseId),
          orderBy('createdAt', 'desc')
        )
      : query(
          collection(db, 'reviews'),
          where('userId', '==', userId),
          where('reviewType', '==', 'solved'),
          orderBy('createdAt', 'desc')
        );

    getDocs(solvedBaseQuery).then(async (snapshot) => {
      try {
        const docs = snapshot.docs;
        const hasMore = docs.length > SOLVED_PAGE_SIZE;
        const pageDocs = hasMore ? docs.slice(0, SOLVED_PAGE_SIZE) : docs;

        const items: ReviewItem[] = pageDocs.map(mapDocToReviewItem);
        await fillQuizTitles(items);

        if (isMounted) {
          setSolvedItems(items);
          setHasMoreSolved(hasMore);
          solvedLastDocRef.current = pageDocs.length > 0
            ? pageDocs[pageDocs.length - 1]
            : null;
        }
      } catch (e) {
        console.error('푼 문제 처리 실패:', e);
      } finally {
        if (isMounted) markLoaded();
      }
    }).catch((err) => {
      console.error('푼 문제 목록 로드 실패:', err);
      if (isMounted) markLoaded();
    });

    // ── 퀴즈 풀이 기록 (1회 조회) ──
    const attemptsQuery = userCourseId
      ? query(
          collection(db, 'quizResults'),
          where('userId', '==', userId),
          where('courseId', '==', userCourseId)
        )
      : query(
          collection(db, 'quizResults'),
          where('userId', '==', userId)
        );

    getDocs(attemptsQuery).then(async (snapshot) => {
      try {
        const attempts: QuizAttempt[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          attempts.push({
            id: docSnap.id,
            quizId: data.quizId,
            quizTitle: '',
            correctCount: data.correctCount || 0,
            totalCount: data.totalCount || 0,
            earnedGold: data.earnedGold || 0,
            earnedExp: data.earnedExp || 0,
            timeSpentSeconds: data.timeSpentSeconds || 0,
            completedAt: data.createdAt,
          });
        });
        await fillQuizTitles(attempts);
        attempts.sort((a, b) => (b.completedAt?.toMillis?.() || 0) - (a.completedAt?.toMillis?.() || 0));
        if (isMounted) setQuizAttempts(attempts);
      } catch (e) {
        console.error('퀴즈 풀이 기록 처리 실패:', e);
      }
    }).catch((err) => {
      console.error('퀴즈 풀이 기록 로드 실패:', err);
    });

    // ── 비공개 퀴즈 (1회 조회) ──
    const privateQuizzesQuery = userCourseId
      ? query(
          collection(db, 'quizzes'),
          where('creatorId', '==', userId),
          where('isPublic', '==', false),
          where('courseId', '==', userCourseId)
        )
      : query(
          collection(db, 'quizzes'),
          where('creatorId', '==', userId),
          where('isPublic', '==', false)
        );

    getDocs(privateQuizzesQuery).then((snapshot) => {
      const quizzes: PrivateQuiz[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        quizzes.push({
          id: docSnap.id,
          title: data.title || '퀴즈',
          questionCount: data.questions?.length || 0,
          createdAt: data.createdAt,
        });
      });

      quizzes.sort((a, b) => {
        const aTime = a.createdAt?.toMillis?.() || 0;
        const bTime = b.createdAt?.toMillis?.() || 0;
        return bTime - aTime;
      });

      if (isMounted) setPrivateQuizzes(quizzes);
    }).catch((err) => {
      console.error('비공개 퀴즈 로드 실패:', err);
    });

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, userCourseId, refreshKey]);

  // ──────────────────────────────────────────────
  // 페이지네이션 (loadMore)
  // ──────────────────────────────────────────────

  /** 푼 문제 추가 로드 */
  const loadMoreSolved = useCallback(async () => {
    if (!hasMoreSolved || !solvedLastDocRef.current || !solvedQueryBaseRef.current) return;

    const PAGE_SIZE = 50;
    const nextQuery = query(
      solvedQueryBaseRef.current,
      startAfter(solvedLastDocRef.current),
      limit(PAGE_SIZE + 1)
    );

    const snapshot = await getDocs(nextQuery);
    const docs = snapshot.docs;
    const hasMore = docs.length > PAGE_SIZE;
    const pageDocs = hasMore ? docs.slice(0, PAGE_SIZE) : docs;

    const newItems: ReviewItem[] = pageDocs.map(mapDocToReviewItem);
    await fillQuizTitles(newItems);

    setSolvedItems(prev => [...prev, ...newItems]);
    setHasMoreSolved(hasMore);
    solvedLastDocRef.current = pageDocs.length > 0
      ? pageDocs[pageDocs.length - 1]
      : null;
  }, [hasMoreSolved]);

  /** 오답 추가 로드 */
  const loadMoreWrong = useCallback(async () => {
    if (!hasMoreWrong || !wrongLastDocRef.current || !wrongQueryBaseRef.current) return;

    const PAGE_SIZE = 100;
    const nextQuery = query(
      wrongQueryBaseRef.current,
      startAfter(wrongLastDocRef.current),
      limit(PAGE_SIZE + 1)
    );

    const snapshot = await getDocs(nextQuery);
    const docs = snapshot.docs;
    const hasMore = docs.length > PAGE_SIZE;
    const pageDocs = hasMore ? docs.slice(0, PAGE_SIZE) : docs;

    const newItems: ReviewItem[] = pageDocs.map(mapDocToReviewItem);
    await fillQuizTitles(newItems);

    setWrongItems(prev => [...prev, ...newItems]);
    setHasMoreWrong(hasMore);
    wrongLastDocRef.current = pageDocs.length > 0
      ? pageDocs[pageDocs.length - 1]
      : null;
  }, [hasMoreWrong]);

  /** 찜한 문제 추가 로드 */
  const loadMoreBookmark = useCallback(async () => {
    if (!hasMoreBookmark || !bookmarkLastDocRef.current || !bookmarkQueryBaseRef.current) return;

    const PAGE_SIZE = 100;
    const nextQuery = query(
      bookmarkQueryBaseRef.current,
      startAfter(bookmarkLastDocRef.current),
      limit(PAGE_SIZE + 1)
    );

    const snapshot = await getDocs(nextQuery);
    const docs = snapshot.docs;
    const hasMore = docs.length > PAGE_SIZE;
    const pageDocs = hasMore ? docs.slice(0, PAGE_SIZE) : docs;

    const newItems: ReviewItem[] = pageDocs.map(mapDocToReviewItem);
    await fillQuizTitles(newItems);

    setBookmarkedItems(prev => [...prev, ...newItems]);
    setHasMoreBookmark(hasMore);
    bookmarkLastDocRef.current = pageDocs.length > 0
      ? pageDocs[pageDocs.length - 1]
      : null;
  }, [hasMoreBookmark]);

  // ──────────────────────────────────────────────
  // 그룹핑 (useMemo)
  // ──────────────────────────────────────────────

  const groupedWrongItems = useMemo(() => groupByQuiz(wrongItems), [wrongItems]);
  const chapterGroupedWrongItems = useMemo(
    () => groupByChapterAndQuiz(wrongItems, userCourseId || undefined),
    [wrongItems, userCourseId]
  );
  const groupedBookmarkedItems = useMemo(() => groupByQuiz(bookmarkedItems), [bookmarkedItems]);
  const groupedSolvedItems = useMemo(() => groupByQuiz(solvedItems), [solvedItems]);

  /** 데이터 새로고침 */
  const refresh = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  return {
    wrongItems,
    bookmarkedItems,
    solvedItems,
    hasMoreSolved,
    loadMoreSolved,
    hasMoreWrong,
    loadMoreWrong,
    hasMoreBookmark,
    loadMoreBookmark,
    groupedWrongItems,
    chapterGroupedWrongItems,
    groupedBookmarkedItems,
    groupedSolvedItems,
    quizAttempts,
    privateQuizzes,
    loading,
    error,
    refreshKey,
    refresh,
  };
}
