/**
 * 퀴즈 북마크(찜) 관련 커스텀 훅
 * 퀴즈 자체를 북마크하여 나중에 다시 풀 수 있도록 저장
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  setDoc,
  deleteDoc,
  getDoc,
  updateDoc,
  increment,
  serverTimestamp,
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

  // 북마크 목록 구독
  useEffect(() => {
    if (!user) {
      setLoading(false);
      setBookmarkedQuizzes([]);
      setBookmarkedQuizIds(new Set());
      return;
    }

    setLoading(true);

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

    const unsubscribe = onSnapshot(
      bookmarksQuery,
      async (snapshot) => {
        const quizzes: BookmarkedQuiz[] = [];
        const ids = new Set<string>();

        for (const docSnapshot of snapshot.docs) {
          const data = docSnapshot.data();
          const quizId = data.quizId;
          ids.add(quizId);

          // 퀴즈 정보 가져오기
          try {
            const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
            if (quizDoc.exists()) {
              const quizData = quizDoc.data();
              // quiz_completions로 완료 여부 확인
              let hasCompleted = false;
              if (user) {
                const completionDoc = await getDoc(doc(db, 'quiz_completions', `${quizId}_${user.uid}`));
                hasCompleted = completionDoc.exists();
              }

              quizzes.push({
                id: quizId,
                quizId,
                title: quizData.title || '제목 없음',
                questionCount: quizData.questionCount || 0,
                participantCount: quizData.participantCount || 0,
                bookmarkedAt: data.bookmarkedAt,
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
                averageScore: quizData.averageScore || (() => {
                  if (quizData.userScores) {
                    const scores = Object.values(quizData.userScores) as number[];
                    return scores.length > 0 ? Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 10) / 10 : 0;
                  }
                  return 0;
                })(),
              });
            }
          } catch (err) {
            console.error('퀴즈 정보 로드 실패:', err);
          }
        }

        // 북마크 시간 기준 정렬 (최신순)
        quizzes.sort((a, b) => {
          const aTime = a.bookmarkedAt?.toMillis?.() || 0;
          const bTime = b.bookmarkedAt?.toMillis?.() || 0;
          return bTime - aTime;
        });

        setBookmarkedQuizzes(quizzes);
        setBookmarkedQuizIds(ids);
        setLoading(false);
      },
      (err) => {
        console.error('퀴즈 북마크 로드 실패:', err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user, userCourseId]);

  /**
   * 퀴즈 북마크 토글
   */
  const toggleBookmark = useCallback(async (quizId: string): Promise<void> => {
    if (!user) return;

    const bookmarkRef = doc(db, 'quizBookmarks', `${user.uid}_${quizId}`);
    const quizRef = doc(db, 'quizzes', quizId);

    try {
      if (bookmarkedQuizIds.has(quizId)) {
        // 북마크 해제
        await deleteDoc(bookmarkRef);
        // 퀴즈의 북마크 수 감소
        await updateDoc(quizRef, {
          bookmarkCount: increment(-1),
        });
      } else {
        // 북마크 추가 (courseId 포함)
        await setDoc(bookmarkRef, {
          userId: user.uid,
          quizId,
          courseId: userCourseId || null,
          bookmarkedAt: serverTimestamp(),
        });
        // 퀴즈의 북마크 수 증가
        await updateDoc(quizRef, {
          bookmarkCount: increment(1),
        });
      }
    } catch (err) {
      console.error('북마크 토글 실패:', err);
      throw new Error('북마크 처리에 실패했습니다.');
    }
  }, [user, bookmarkedQuizIds, userCourseId]);

  /**
   * 특정 퀴즈 북마크 여부 확인
   */
  const isBookmarked = useCallback((quizId: string): boolean => {
    return bookmarkedQuizIds.has(quizId);
  }, [bookmarkedQuizIds]);

  return {
    bookmarkedQuizzes,
    bookmarkedQuizIds,
    loading,
    toggleBookmark,
    isBookmarked,
  };
};

export default useQuizBookmark;
