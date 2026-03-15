/**
 * 복습 관련 커스텀 훅 (조합 훅)
 *
 * useReviewItems + useReviewTrash + useCustomFolders를 조합하여
 * 기존 useReview와 동일한 인터페이스를 제공한다.
 *
 * 액션 콜백(삭제/북마크/업데이트 등)은 이 파일에 유지.
 */

'use client';

import { useCallback } from 'react';
import {
  collection,
  query,
  where,
  doc,
  deleteDoc,
  updateDoc,
  addDoc,
  increment,
  serverTimestamp,
  getDoc,
  getDocs,
  writeBatch,
  db,
  type DocumentData,
} from '@/lib/repositories';
import { useAuth } from './useAuth';
import { useCourse } from '../contexts/CourseContext';
import { useCustomFolders } from './useCustomFolders';
import { useReviewItems } from './useReviewItems';
import { useReviewTrash } from './useReviewTrash';
import { useReviewUpdateCheck } from './useReviewUpdateCheck';

// 타입 정의 → useReviewTypes.ts로 분리됨
export type { ReviewType, ReviewItem, GroupedReviewItems, ChapterGroupedWrongItems, QuizAttempt, QuizUpdateInfo, PrivateQuiz, DeletedItem, UseReviewReturn } from './useReviewTypes';
export type { CustomFolder, CustomFolderQuestion, FolderCategory } from './useReviewTypes';
import type { ReviewItem, UseReviewReturn } from './useReviewTypes';

// 유틸리티 함수 재내보내기 (기존 import 경로 호환)
export { calculateCustomFolderQuestionCount } from './useReviewUtils';

// ============================================================
// useReview 훅 (조합)
// ============================================================

/**
 * 복습 문제(오답/찜)를 관리하는 커스텀 훅
 *
 * Firestore의 reviews 컬렉션을 조회하고,
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
  const { user } = useAuth();
  const { userCourseId } = useCourse();

  // ── 서브 훅 조합 ──
  const {
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
  } = useReviewItems(user?.uid, userCourseId);

  const {
    customFolders,
    createCustomFolder,
    deleteCustomFolder,
    addToCustomFolder,
    removeFromCustomFolder,
    addCategoryToFolder,
    removeCategoryFromFolder,
    assignQuestionToCategory,
    updateCategoryName,
  } = useCustomFolders();

  const {
    deletedItems,
    restoreDeletedItem,
    permanentlyDeleteItem,
  } = useReviewTrash(user?.uid, userCourseId, refreshKey);

  // 퀴즈 업데이트 확인 (별도 훅)
  const updatedQuizzes = useReviewUpdateCheck(
    loading,
    groupedWrongItems,
    groupedBookmarkedItems,
    groupedSolvedItems,
    customFolders,
    refreshKey,
    user?.uid,
    userCourseId,
  );

  // ================================================================
  // 액션 콜백
  // ================================================================

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
      // 퀴즈 제목 가져오기
      let quizTitle = '퀴즈';
      try {
        const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
        if (quizDoc.exists()) {
          quizTitle = quizDoc.data()?.title || '퀴즈';
        }
      } catch (e) {
        console.error('퀴즈 제목 로드 실패:', e);
      }

      // 해당 퀴즈의 모든 solved 리뷰 가져오기
      const solvedQuery = query(
        collection(db, 'reviews'),
        where('userId', '==', user.uid),
        where('quizId', '==', quizId),
        where('reviewType', '==', 'solved')
      );
      const solvedDocs = await getDocs(solvedQuery);

      // 휴지통에 저장 (복원 데이터 포함)
      const restoreData = {
        solvedReviews: solvedDocs.docs.map(d => ({ id: d.id, ...d.data() })),
      };

      await addDoc(collection(db, 'deletedReviewItems'), {
        userId: user.uid,
        courseId: userCourseId || null,
        type: 'solved',
        originalId: quizId,
        title: quizTitle,
        questionCount: solvedDocs.size,
        deletedAt: serverTimestamp(),
        restoreData,
      });

      // 해당 퀴즈의 모든 wrong 리뷰 + quizResults도 병렬 조회
      const [wrongDocs, resultsDocs] = await Promise.all([
        getDocs(query(
          collection(db, 'reviews'),
          where('userId', '==', user.uid),
          where('quizId', '==', quizId),
          where('reviewType', '==', 'wrong')
        )),
        getDocs(query(
          collection(db, 'quizResults'),
          where('userId', '==', user.uid),
          where('quizId', '==', quizId)
        )),
      ]);

      // writeBatch로 일괄 삭제 (순차 deleteDoc → 단일 배치)
      const allDocs = [...solvedDocs.docs, ...wrongDocs.docs, ...resultsDocs.docs];
      for (let i = 0; i < allDocs.length; i += 500) {
        const batch = writeBatch(db);
        allDocs.slice(i, i + 500).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }

      // quiz_completions에서 완료 기록 삭제
      try {
        const completionDocId = `${quizId}_${user.uid}`;
        await deleteDoc(doc(db, 'quiz_completions', completionDocId));
      } catch (updateErr) {
        console.error('quiz_completions 삭제 실패:', updateErr);
      }
    } catch (err) {
      console.error('푼 문제 삭제 실패:', err);
      throw new Error('삭제에 실패했습니다.');
    }
  }, [user, userCourseId]);

  /**
   * 오답 폴더 삭제 (챕터별) - 특정 챕터의 오답만 삭제
   * @param quizId 퀴즈 ID
   * @param chapterId 챕터 ID (null이면 미분류)
   * @param chapterName 챕터 이름 (휴지통 표시용)
   */
  const deleteWrongQuizByChapter = useCallback(async (
    quizId: string,
    chapterId: string | null,
    chapterName?: string
  ): Promise<void> => {
    if (!user) return;

    try {
      // 퀴즈 제목 가져오기
      let quizTitle = '퀴즈';
      try {
        const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
        if (quizDoc.exists()) {
          quizTitle = quizDoc.data()?.title || '퀴즈';
        } else {
          const privateQuizDoc = await getDoc(doc(db, 'privateQuizzes', quizId));
          if (privateQuizDoc.exists()) {
            quizTitle = privateQuizDoc.data()?.title || '퀴즈';
          }
        }
      } catch (e) {
        console.error('퀴즈 제목 로드 실패:', e);
      }

      // 해당 챕터의 오답만 가져오기
      let wrongQuery;
      if (chapterId) {
        wrongQuery = query(
          collection(db, 'reviews'),
          where('userId', '==', user.uid),
          where('quizId', '==', quizId),
          where('chapterId', '==', chapterId),
          where('reviewType', '==', 'wrong')
        );
      } else {
        // 미분류 (chapterId가 null 또는 없음)
        wrongQuery = query(
          collection(db, 'reviews'),
          where('userId', '==', user.uid),
          where('quizId', '==', quizId),
          where('reviewType', '==', 'wrong')
        );
        // chapterId가 없는 문서만 필터링
      }
      const wrongDocs = await getDocs(wrongQuery);

      // chapterId가 null인 경우 추가 필터링
      let filteredDocs = wrongDocs.docs;
      if (!chapterId) {
        filteredDocs = wrongDocs.docs.filter(d => !d.data().chapterId);
      }

      // 0문제면 삭제할 것이 없음
      if (filteredDocs.length === 0) {
        return;
      }

      // 휴지통에 저장 (챕터명 · 퀴즈명 형식)
      const displayTitle = chapterName
        ? `${chapterName} · ${quizTitle}`
        : `미분류 · ${quizTitle}`;

      const restoreData = {
        wrongReviews: filteredDocs.map(d => ({ id: d.id, ...d.data() })),
      };

      await addDoc(collection(db, 'deletedReviewItems'), {
        userId: user.uid,
        courseId: userCourseId || null,
        type: 'wrong',
        originalId: quizId,
        chapterId: chapterId || null,
        title: displayTitle,
        questionCount: filteredDocs.length,
        deletedAt: serverTimestamp(),
        restoreData,
      });

      // writeBatch로 일괄 삭제
      for (let i = 0; i < filteredDocs.length; i += 500) {
        const batch = writeBatch(db);
        filteredDocs.slice(i, i + 500).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
    } catch (err) {
      console.error('오답 폴더 삭제 실패:', err);
      throw new Error('삭제에 실패했습니다.');
    }
  }, [user, userCourseId]);

  /**
   * 오답 폴더 삭제 - 해당 퀴즈의 오답만 삭제 (레거시, 전체 삭제)
   */
  const deleteWrongQuiz = useCallback(async (quizId: string): Promise<void> => {
    if (!user) return;

    try {
      // 퀴즈 제목 가져오기 (공개 퀴즈 또는 비공개 퀴즈)
      let quizTitle = '퀴즈';
      try {
        // 먼저 공개 퀴즈에서 찾기
        const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
        if (quizDoc.exists()) {
          quizTitle = quizDoc.data()?.title || '퀴즈';
        } else {
          // 비공개 퀴즈에서 찾기
          const privateQuizDoc = await getDoc(doc(db, 'privateQuizzes', quizId));
          if (privateQuizDoc.exists()) {
            quizTitle = privateQuizDoc.data()?.title || '퀴즈';
          }
        }
      } catch (e) {
        console.error('퀴즈 제목 로드 실패:', e);
      }

      // 해당 퀴즈의 모든 wrong 리뷰 가져오기
      const wrongQuery = query(
        collection(db, 'reviews'),
        where('userId', '==', user.uid),
        where('quizId', '==', quizId),
        where('reviewType', '==', 'wrong')
      );
      const wrongDocs = await getDocs(wrongQuery);

      // 휴지통에 저장
      const restoreData = {
        wrongReviews: wrongDocs.docs.map(d => ({ id: d.id, ...d.data() })),
      };

      await addDoc(collection(db, 'deletedReviewItems'), {
        userId: user.uid,
        courseId: userCourseId || null,
        type: 'wrong',
        originalId: quizId,
        title: quizTitle,
        questionCount: wrongDocs.size,
        deletedAt: serverTimestamp(),
        restoreData,
      });

      // writeBatch로 일괄 삭제
      for (let i = 0; i < wrongDocs.docs.length; i += 500) {
        const batch = writeBatch(db);
        wrongDocs.docs.slice(i, i + 500).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
    } catch (err) {
      console.error('오답 폴더 삭제 실패:', err);
      throw new Error('삭제에 실패했습니다.');
    }
  }, [user, userCourseId]);

  /**
   * 찜한 문제 폴더 삭제 - 해당 퀴즈의 찜한 문제만 삭제 (isBookmarked 해제)
   */
  const deleteBookmarkQuiz = useCallback(async (quizId: string): Promise<void> => {
    if (!user) return;

    try {
      // 퀴즈 제목 가져오기
      let quizTitle = '퀴즈';
      try {
        const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
        if (quizDoc.exists()) {
          quizTitle = quizDoc.data()?.title || '퀴즈';
        }
      } catch (e) {
        console.error('퀴즈 제목 로드 실패:', e);
      }

      // 해당 퀴즈의 bookmark 전용 리뷰 가져오기
      const bookmarkQuery = query(
        collection(db, 'reviews'),
        where('userId', '==', user.uid),
        where('quizId', '==', quizId),
        where('reviewType', '==', 'bookmark')
      );
      const bookmarkDocs = await getDocs(bookmarkQuery);

      // 다른 타입(solved/wrong)에서 isBookmarked=true인 리뷰도 가져오기
      const flaggedQuery = query(
        collection(db, 'reviews'),
        where('userId', '==', user.uid),
        where('quizId', '==', quizId),
        where('isBookmarked', '==', true)
      );
      const flaggedDocs = await getDocs(flaggedQuery);
      // bookmark 타입이 아닌 문서만 필터
      const nonBookmarkFlagged = flaggedDocs.docs.filter(d => d.data().reviewType !== 'bookmark');

      // 휴지통에 저장 (복원용 review ID 목록)
      const restoreData = {
        bookmarkedReviewIds: bookmarkDocs.docs.map(d => d.id),
        flaggedReviewIds: nonBookmarkFlagged.map(d => d.id),
      };

      await addDoc(collection(db, 'deletedReviewItems'), {
        userId: user.uid,
        courseId: userCourseId || null,
        type: 'bookmark',
        originalId: quizId,
        title: quizTitle,
        questionCount: bookmarkDocs.size,
        deletedAt: serverTimestamp(),
        restoreData,
      });

      // writeBatch로 일괄 처리 (삭제 + 플래그 해제)
      const allBatchDocs = [...bookmarkDocs.docs, ...nonBookmarkFlagged];
      for (let i = 0; i < allBatchDocs.length; i += 500) {
        const batch = writeBatch(db);
        allBatchDocs.slice(i, i + 500).forEach(d => {
          if (bookmarkDocs.docs.includes(d)) {
            batch.delete(d.ref);
          } else {
            batch.update(d.ref, { isBookmarked: false });
          }
        });
        await batch.commit();
      }
    } catch (err) {
      console.error('찜한 문제 폴더 삭제 실패:', err);
      throw new Error('삭제에 실패했습니다.');
    }
  }, [user, userCourseId]);

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
      const existingReviewMap = new Map<string, { docId: string; data: DocumentData }>();
      existingReviews.forEach((docSnapshot) => {
        const data = docSnapshot.data();
        const key = `${data.questionId}-${data.reviewType}`;
        existingReviewMap.set(key, { docId: docSnapshot.id, data });
      });

      // 새 퀴즈의 questionId 집합
      const newQuestionIds = new Set<string>();
      questions.forEach((q: DocumentData, i: number) => {
        newQuestionIds.add(q.id || `q${i}`);
      });

      // 인덱스 기반 매핑을 위해 기존 리뷰의 questionId 추출
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
              correctAnswer: q.correctAnswer ?? q.answer ?? '',
              explanation: q.explanation || '',
              quizUpdatedAt,
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
              correctAnswer: q.correctAnswer ?? q.answer ?? '',
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

      // 업데이트 정보 리셋 (refreshKey 변경으로 useReviewUpdateCheck 재실행)
      refresh();

    } catch (err) {
      console.error('문제 업데이트 실패:', err);
      throw new Error('문제 업데이트에 실패했습니다.');
    }
  }, [user, userCourseId, refresh]);

  /**
   * 문제 찜 토글 (찜한 문제로 추가/제거)
   */
  const toggleQuestionBookmark = useCallback(async (item: ReviewItem): Promise<void> => {
    if (!user) return;

    try {
      if (item.isBookmarked) {
        // 이미 찜한 문제면 bookmark 리뷰 삭제
        const bookmarkQuery = query(
          collection(db, 'reviews'),
          where('userId', '==', user.uid),
          where('quizId', '==', item.quizId),
          where('questionId', '==', item.questionId),
          where('reviewType', '==', 'bookmark')
        );
        const bookmarkDocs = await getDocs(bookmarkQuery);
        for (const docSnap of bookmarkDocs.docs) {
          await deleteDoc(docSnap.ref);
        }

        // 원본 리뷰의 isBookmarked 플래그 업데이트
        if (item.reviewType !== 'bookmark') {
          await updateDoc(doc(db, 'reviews', item.id), { isBookmarked: false });
        }
      } else {
        // 찜 안한 문제면 bookmark 리뷰 생성
        await addDoc(collection(db, 'reviews'), {
          userId: user.uid,
          quizId: item.quizId,
          quizTitle: item.quizTitle || '',
          questionId: item.questionId,
          question: item.question,
          type: item.type,
          options: item.options || [],
          correctAnswer: item.correctAnswer,
          userAnswer: item.userAnswer || '',
          explanation: item.explanation || '',
          reviewType: 'bookmark',
          isBookmarked: true,
          isCorrect: item.isCorrect ?? null,
          reviewCount: 0,
          lastReviewedAt: null,
          quizUpdatedAt: item.quizUpdatedAt || null,
          courseId: userCourseId || null,
          // 결합형 문제 필드
          ...(item.combinedGroupId && { combinedGroupId: item.combinedGroupId }),
          ...(item.combinedIndex !== undefined && { combinedIndex: item.combinedIndex }),
          ...(item.combinedTotal !== undefined && { combinedTotal: item.combinedTotal }),
          ...(item.passage && { passage: item.passage }),
          ...(item.passageType && { passageType: item.passageType }),
          ...(item.passageImage && { passageImage: item.passageImage }),
          ...(item.koreanAbcItems && { koreanAbcItems: item.koreanAbcItems }),
          ...(item.passageMixedExamples && { passageMixedExamples: item.passageMixedExamples }),
          ...(item.commonQuestion && { commonQuestion: item.commonQuestion }),
          // 이미지/보기 필드
          ...(item.image && { image: item.image }),
          ...(item.imageUrl && { imageUrl: item.imageUrl }),
          ...(item.subQuestionOptions && { subQuestionOptions: item.subQuestionOptions }),
          ...(item.subQuestionOptionsType && { subQuestionOptionsType: item.subQuestionOptionsType }),
          ...(item.subQuestionImage && { subQuestionImage: item.subQuestionImage }),
          ...(item.mixedExamples && { mixedExamples: item.mixedExamples }),
          // 챕터/해설 필드
          ...(item.chapterId && { chapterId: item.chapterId }),
          ...(item.chapterDetailId && { chapterDetailId: item.chapterDetailId }),
          ...(item.choiceExplanations && { choiceExplanations: item.choiceExplanations }),
          ...(item.passagePrompt && { passagePrompt: item.passagePrompt }),
          ...(item.bogiQuestionText && { bogiQuestionText: item.bogiQuestionText }),
          ...(item.bogi && { bogi: item.bogi }),
          createdAt: serverTimestamp(),
        });

        // 원본 리뷰의 isBookmarked 플래그 업데이트
        if (item.reviewType !== 'bookmark') {
          await updateDoc(doc(db, 'reviews', item.id), { isBookmarked: true });
        }
      }
    } catch (err) {
      console.error('찜 토글 실패:', err);
      throw new Error('찜 처리에 실패했습니다.');
    }
  }, [user, userCourseId]);

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
    groupedBookmarkedItems,
    groupedSolvedItems,
    chapterGroupedWrongItems,
    quizAttempts,
    customFolders,
    privateQuizzes,
    updatedQuizzes,
    loading,
    error,
    deleteReviewItem,
    deleteSolvedQuiz,
    deleteWrongQuiz,
    deleteWrongQuizByChapter,
    deleteBookmarkQuiz,
    markAsReviewed,
    createCustomFolder,
    deleteCustomFolder,
    addToCustomFolder,
    removeFromCustomFolder,
    toggleQuestionBookmark,
    updateReviewItemsFromQuiz,
    refresh,
    addCategoryToFolder,
    removeCategoryFromFolder,
    assignQuestionToCategory,
    updateCategoryName,
    deletedItems,
    restoreDeletedItem,
    permanentlyDeleteItem,
  };
};

export default useReview;
