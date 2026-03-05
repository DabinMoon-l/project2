/**
 * 퀴즈 북마크(찜) 관련 커스텀 훅
 * 퀴즈 자체를 북마크하여 나중에 다시 풀 수 있도록 저장
 *
 * onSnapshot → getDocs + 낙관적 업데이트로 전환
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  setDoc,
  deleteDoc,
  updateDoc,
  increment,
  serverTimestamp,
  documentId,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './useAuth';
import { useCourse } from '../contexts/CourseContext';

/**
 * 북마크된 퀴즈 데이터 타입
 */
export interface BookmarkedQuiz {
  /** 북마크 ID (quizId와 동일) */
  id: string;
  /** 퀴즈 ID */
  quizId: string;
  /** 퀴즈 제목 */
  title: string;
  /** 문제 수 */
  questionCount: number;
  /** 참여자 수 */
  participantCount: number;
  /** 북마크 일시 */
  bookmarkedAt: Timestamp;
  /** 난이도 */
  difficulty?: 'easy' | 'normal' | 'hard';
  /** 챕터 ID */
  chapterId?: string;
  /** 제작자 닉네임 */
  creatorNickname?: string;
  /** 태그 목록 */
  tags?: string[];
  /** OX 문제 수 */
  oxCount?: number;
  /** 객관식 문제 수 */
  multipleChoiceCount?: number;
  /** 주관식 문제 수 */
  subjectiveCount?: number;
  /** 처음 푼 점수 */
  myScore?: number;
  /** 첫번째 복습 점수 */
  myFirstReviewScore?: number;
  /** 퀴즈 완료 여부 (completedUsers 배열에 있는지) */
  hasCompleted?: boolean;
  /** 찜한 수 (전체 사용자) */
  bookmarkCount?: number;
  /** AI 생성 퀴즈 여부 */
  isAiGenerated?: boolean;
  /** 평균 점수 */
  averageScore?: number;
  /** 퀴즈 타입 (midterm, professor 등) */
  type?: string;
}

/**
 * useQuizBookmark 훅의 반환 타입
 */
interface UseQuizBookmarkReturn {
  /** 북마크된 퀴즈 목록 */
  bookmarkedQuizzes: BookmarkedQuiz[];
  /** 북마크된 퀴즈 ID Set (빠른 조회용) */
  bookmarkedQuizIds: Set<string>;
  /** 로딩 상태 */
  loading: boolean;
  /** 퀴즈 북마크 토글 */
  toggleBookmark: (quizId: string) => Promise<void>;
  /** 특정 퀴즈 북마크 여부 확인 */
  isBookmarked: (quizId: string) => boolean;
  /** 수동 새로고침 */
  refresh: () => void;
}

/**
 * 퀴즈 북마크 관리 훅
 */
export const useQuizBookmark = (): UseQuizBookmarkReturn => {
  const { user } = useAuth();
  const { userCourseId } = useCourse();
  const [bookmarkedQuizzes, setBookmarkedQuizzes] = useState<BookmarkedQuiz[]>([]);
  const [bookmarkedQuizIds, setBookmarkedQuizIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const fetchingRef = useRef(false);

  // 북마크 목록 조회
  const fetchBookmarks = useCallback(async () => {
    if (!user || fetchingRef.current) return;
    fetchingRef.current = true;

    try {
      // courseId로 필터링 (과목별 분리)
      const bookmarksQuery = userCourseId
        ? query(
            collection(db, 'quizBookmarks'),
            where('userId', '==', user.uid),
            where('courseId', '==', userCourseId)
          )
        : query(
            collection(db, 'quizBookmarks'),
            where('userId', '==', user.uid)
          );

      const snapshot = await getDocs(bookmarksQuery);

      const ids = new Set<string>();
      const bookmarkDataMap = new Map<string, any>();

      for (const docSnapshot of snapshot.docs) {
        const data = docSnapshot.data();
        ids.add(data.quizId);
        bookmarkDataMap.set(data.quizId, data);
      }

      // 퀴즈 정보 + 완료 여부를 배치 조회 (N+1 → 2~4 쿼리)
      const quizIds = Array.from(ids);
      const BATCH_SIZE = 30; // Firestore 'in' 쿼리 최대 30개

      // 퀴즈 문서 배치 조회
      const quizDataMap2 = new Map<string, any>();
      for (let i = 0; i < quizIds.length; i += BATCH_SIZE) {
        const batch = quizIds.slice(i, i + BATCH_SIZE);
        const quizSnap = await getDocs(
          query(collection(db, 'quizzes'), where(documentId(), 'in', batch))
        );
        for (const d of quizSnap.docs) {
          quizDataMap2.set(d.id, d.data());
        }
      }

      // 완료 여부 배치 조회
      const completionSet = new Set<string>();
      if (user) {
        const completionIds = quizIds.map(qid => `${qid}_${user.uid}`);
        for (let i = 0; i < completionIds.length; i += BATCH_SIZE) {
          const batch = completionIds.slice(i, i + BATCH_SIZE);
          const compSnap = await getDocs(
            query(collection(db, 'quiz_completions'), where(documentId(), 'in', batch))
          );
          for (const d of compSnap.docs) {
            completionSet.add(d.id);
          }
        }
      }

      // 결과 조합
      const quizzes: BookmarkedQuiz[] = [];
      for (const quizId of quizIds) {
        const quizData = quizDataMap2.get(quizId);
        if (!quizData) continue;

        const bmData = bookmarkDataMap.get(quizId);
        const hasCompleted = user ? completionSet.has(`${quizId}_${user.uid}`) : false;

        quizzes.push({
          id: quizId,
          quizId,
          title: quizData.title || '제목 없음',
          questionCount: quizData.questionCount || 0,
          participantCount: quizData.participantCount || 0,
          bookmarkedAt: bmData?.bookmarkedAt,
          difficulty: quizData.difficulty || 'normal',
          chapterId: quizData.chapterId || undefined,
          creatorNickname: quizData.creatorNickname || '익명',
          tags: quizData.tags || [],
          oxCount: quizData.oxCount || 0,
          multipleChoiceCount: quizData.multipleChoiceCount || 0,
          subjectiveCount: quizData.subjectiveCount || 0,
          myScore: user ? quizData.userScores?.[user.uid] : undefined,
          myFirstReviewScore: user ? quizData.userFirstReviewScores?.[user.uid] : undefined,
          hasCompleted,
          bookmarkCount: quizData.bookmarkCount || 0,
          isAiGenerated: quizData.isAiGenerated || quizData.type === 'ai-generated',
          type: quizData.type || 'custom',
          averageScore: quizData.averageScore || (() => {
            if (quizData.userScores) {
              const scores = Object.values(quizData.userScores) as number[];
              return scores.length > 0 ? Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 10) / 10 : 0;
            }
            return 0;
          })(),
        });
      }
      quizzes.sort((a, b) => {
        const aTime = a.bookmarkedAt?.toMillis?.() || 0;
        const bTime = b.bookmarkedAt?.toMillis?.() || 0;
        return bTime - aTime;
      });

      setBookmarkedQuizzes(quizzes);
      setBookmarkedQuizIds(ids);
    } catch (err) {
      console.error('퀴즈 북마크 로드 실패:', err);
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, [user, userCourseId]);

  // 초기 로드 + 의존성 변경 시 재조회
  useEffect(() => {
    if (!user) {
      setLoading(false);
      setBookmarkedQuizzes([]);
      setBookmarkedQuizIds(new Set());
      return;
    }

    setLoading(true);
    fetchBookmarks();
  }, [user, userCourseId, fetchBookmarks]);

  /**
   * 퀴즈 북마크 토글 (낙관적 업데이트)
   */
  const toggleBookmark = useCallback(async (quizId: string): Promise<void> => {
    if (!user) return;

    const bookmarkRef = doc(db, 'quizBookmarks', `${user.uid}_${quizId}`);
    const quizRef = doc(db, 'quizzes', quizId);
    const wasBookmarked = bookmarkedQuizIds.has(quizId);

    // 낙관적 업데이트: 즉시 UI 반영
    if (wasBookmarked) {
      setBookmarkedQuizIds(prev => {
        const next = new Set(prev);
        next.delete(quizId);
        return next;
      });
      setBookmarkedQuizzes(prev => prev.filter(q => q.quizId !== quizId));
    } else {
      setBookmarkedQuizIds(prev => new Set(prev).add(quizId));
    }

    try {
      if (wasBookmarked) {
        await deleteDoc(bookmarkRef);
        await updateDoc(quizRef, { bookmarkCount: increment(-1) });
      } else {
        await setDoc(bookmarkRef, {
          userId: user.uid,
          quizId,
          courseId: userCourseId || null,
          bookmarkedAt: serverTimestamp(),
        });
        await updateDoc(quizRef, { bookmarkCount: increment(1) });
        // 추가 시 배경에서 전체 새로고침 (퀴즈 상세 정보 포함)
        fetchBookmarks();
      }
    } catch (err) {
      console.error('북마크 토글 실패:', err);
      // 실패 시 롤백: 배경 새로고침
      fetchBookmarks();
      throw new Error('북마크 처리에 실패했습니다.');
    }
  }, [user, bookmarkedQuizIds, userCourseId, fetchBookmarks]);

  /**
   * 특정 퀴즈 북마크 여부 확인
   */
  const isBookmarked = useCallback((quizId: string): boolean => {
    return bookmarkedQuizIds.has(quizId);
  }, [bookmarkedQuizIds]);

  /**
   * 수동 새로고침
   */
  const refresh = useCallback(() => {
    fetchBookmarks();
  }, [fetchBookmarks]);

  return {
    bookmarkedQuizzes,
    bookmarkedQuizIds,
    loading,
    toggleBookmark,
    isBookmarked,
    refresh,
  };
};

export default useQuizBookmark;
