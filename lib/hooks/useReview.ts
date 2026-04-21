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
  doc,
  getDoc,
  db,
  increment,
  serverTimestamp,
  reviewRepo,
  quizRepo,
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
      await reviewRepo.deleteReview(reviewId);
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
      // 퀴즈 제목
      let quizTitle = '퀴즈';
      try {
        const quizData = await quizRepo.getQuiz<Record<string, unknown>>(quizId);
        if (quizData) {
          quizTitle = (quizData.title as string) || '퀴즈';
        }
      } catch (e) {
        console.error('퀴즈 제목 로드 실패:', e);
      }

      // solved + wrong 리뷰 병렬 조회
      const [solvedDocs, wrongDocs] = await Promise.all([
        reviewRepo.fetchReviewsByQuiz(user.uid, quizId, { reviewType: 'solved' }),
        reviewRepo.fetchReviewsByQuiz(user.uid, quizId, { reviewType: 'wrong' }),
      ]);

      // 휴지통에 저장 (복원 데이터 포함)
      await reviewRepo.addDeletedItem({
        userId: user.uid,
        courseId: userCourseId || null,
        type: 'solved',
        originalId: quizId,
        title: quizTitle,
        questionCount: solvedDocs.length,
        restoreData: {
          solvedReviews: solvedDocs,
        },
      });

      // 리뷰 일괄 삭제 (repo 경유)
      const reviewIdsToDelete = [
        ...solvedDocs.map(d => d.id),
        ...wrongDocs.map(d => d.id),
      ];
      if (reviewIdsToDelete.length > 0) {
        await reviewRepo.batchDeleteReviews(reviewIdsToDelete);
      }

      // quizResults 삭제
      await quizRepo.deleteQuizResultsByUserAndQuiz(user.uid, quizId);

      // quiz_completions에서 완료 기록 삭제
      try {
        await quizRepo.deleteQuizCompletion(quizId, user.uid);
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
      // 퀴즈 제목 (quiz 도메인 — repo 미적용 유지)
      let quizTitle = '퀴즈';
      try {
        const quizData = await quizRepo.getQuiz<Record<string, unknown>>(quizId);
        if (quizData) {
          quizTitle = (quizData.title as string) || '퀴즈';
        } else {
          const privateQuizDoc = await getDoc(doc(db, 'privateQuizzes', quizId));
          if (privateQuizDoc.exists()) {
            quizTitle = privateQuizDoc.data()?.title || '퀴즈';
          }
        }
      } catch (e) {
        console.error('퀴즈 제목 로드 실패:', e);
      }

      // 해당 챕터의 오답만 가져오기 (chapterId null이면 repo 호출 후 클라이언트 필터)
      const wrongDocs = chapterId
        ? await reviewRepo.fetchReviewsByQuiz(user.uid, quizId, {
            reviewType: 'wrong',
            chapterId,
          })
        : await reviewRepo.fetchReviewsByQuiz(user.uid, quizId, {
            reviewType: 'wrong',
          });

      // chapterId null이면 chapterId가 없는 문서만 필터
      const filteredDocs = chapterId
        ? wrongDocs
        : wrongDocs.filter(d => !(d as { chapterId?: unknown }).chapterId);

      if (filteredDocs.length === 0) {
        return;
      }

      // 휴지통에 저장 (챕터명 · 퀴즈명 형식)
      const displayTitle = chapterName
        ? `${chapterName} · ${quizTitle}`
        : `미분류 · ${quizTitle}`;

      await reviewRepo.addDeletedItem({
        userId: user.uid,
        courseId: userCourseId || null,
        type: 'wrong',
        originalId: quizId,
        chapterId: chapterId || null,
        title: displayTitle,
        questionCount: filteredDocs.length,
        restoreData: {
          wrongReviews: filteredDocs,
        },
      });

      await reviewRepo.batchDeleteReviews(filteredDocs.map(d => d.id));
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
      // 퀴즈 제목 (quiz 도메인 — repo 미적용 유지)
      let quizTitle = '퀴즈';
      try {
        const quizData = await quizRepo.getQuiz<Record<string, unknown>>(quizId);
        if (quizData) {
          quizTitle = (quizData.title as string) || '퀴즈';
        } else {
          const privateQuizDoc = await getDoc(doc(db, 'privateQuizzes', quizId));
          if (privateQuizDoc.exists()) {
            quizTitle = privateQuizDoc.data()?.title || '퀴즈';
          }
        }
      } catch (e) {
        console.error('퀴즈 제목 로드 실패:', e);
      }

      const wrongDocs = await reviewRepo.fetchReviewsByQuiz(user.uid, quizId, {
        reviewType: 'wrong',
      });

      await reviewRepo.addDeletedItem({
        userId: user.uid,
        courseId: userCourseId || null,
        type: 'wrong',
        originalId: quizId,
        title: quizTitle,
        questionCount: wrongDocs.length,
        restoreData: {
          wrongReviews: wrongDocs,
        },
      });

      if (wrongDocs.length > 0) {
        await reviewRepo.batchDeleteReviews(wrongDocs.map(d => d.id));
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
      // 퀴즈 제목
      let quizTitle = '퀴즈';
      try {
        const quizData = await quizRepo.getQuiz<Record<string, unknown>>(quizId);
        if (quizData) {
          quizTitle = (quizData.title as string) || '퀴즈';
        }
      } catch (e) {
        console.error('퀴즈 제목 로드 실패:', e);
      }

      // bookmark 전용 리뷰 + 플래그된 다른 타입 리뷰 병렬 조회
      const [bookmarkDocs, flaggedDocs] = await Promise.all([
        reviewRepo.fetchReviewsByQuiz(user.uid, quizId, { reviewType: 'bookmark' }),
        reviewRepo.fetchReviewsByQuiz(user.uid, quizId, { flaggedOnly: true }),
      ]);

      const nonBookmarkFlagged = flaggedDocs.filter(
        d => (d as { reviewType?: string }).reviewType !== 'bookmark'
      );

      // 휴지통에 저장 (복원용 review ID 목록)
      await reviewRepo.addDeletedItem({
        userId: user.uid,
        courseId: userCourseId || null,
        type: 'bookmark',
        originalId: quizId,
        title: quizTitle,
        questionCount: bookmarkDocs.length,
        restoreData: {
          bookmarkedReviewIds: bookmarkDocs.map(d => d.id),
          flaggedReviewIds: nonBookmarkFlagged.map(d => d.id),
        },
      });

      // bookmark 타입은 삭제, 다른 타입의 isBookmarked=true 는 플래그만 해제
      if (bookmarkDocs.length > 0) {
        await reviewRepo.batchDeleteReviews(bookmarkDocs.map(d => d.id));
      }
      if (nonBookmarkFlagged.length > 0) {
        await reviewRepo.batchUpdateReviews(
          nonBookmarkFlagged.map(d => d.id),
          { isBookmarked: false },
        );
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
      await reviewRepo.updateReview(reviewId, {
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
      // 퀴즈 데이터
      const quizData = await quizRepo.getQuiz<DocumentData>(quizId);
      if (!quizData) return;

      const questions = quizData.questions || [];
      const quizTitle = quizData.title || '퀴즈';
      const quizUpdatedAt = quizData.updatedAt || quizData.createdAt || null;

      // 해당 퀴즈의 기존 review 항목들 가져오기
      const existingReviews = await reviewRepo.fetchReviewsByQuiz(user.uid, quizId);

      // 기존 리뷰를 questionId+reviewType 키로 매핑
      const existingReviewMap = new Map<string, { docId: string; data: DocumentData }>();
      existingReviews.forEach((r) => {
        const data = r as DocumentData;
        const key = `${data.questionId}-${data.reviewType}`;
        existingReviewMap.set(key, { docId: r.id, data });
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
        existingReviewMap.forEach((_value, key) => {
          if (key.startsWith(`${questionId}-`)) {
            existingTypesForQuestion.push(key.split('-')[1]);
          }
        });

        const typesToProcess = existingTypesForQuestion.length > 0
          ? existingTypesForQuestion
          : ['solved'];

        for (const reviewType of typesToProcess) {
          const key = `${questionId}-${reviewType}`;
          const existing = existingReviewMap.get(key);

          if (existing) {
            await reviewRepo.updateReview(existing.docId, {
              quizTitle,
              question: q.text || q.question || '',
              type: normalizedType,
              options: q.choices || q.options || [],
              correctAnswer: q.correctAnswer ?? q.answer ?? '',
              explanation: q.explanation || '',
              quizUpdatedAt,
            });
            existingReviewMap.delete(key);
          } else {
            await reviewRepo.addReview({
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
            });
          }
        }
      }

      // 남은 기존 리뷰들 (새 퀴즈에 없는 문제들)은 삭제하지 않고 유지
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
        // 이미 찜한 문제면 bookmark 리뷰 삭제 (questionId 매칭은 클라 필터)
        const bookmarkDocs = await reviewRepo.fetchReviewsByQuiz(user.uid, item.quizId, {
          reviewType: 'bookmark',
        });
        const matched = bookmarkDocs.filter(
          d => (d as { questionId?: string }).questionId === item.questionId
        );
        for (const d of matched) {
          await reviewRepo.deleteReview(d.id);
        }

        // 원본 리뷰의 isBookmarked 플래그 업데이트
        if (item.reviewType !== 'bookmark') {
          await reviewRepo.updateReview(item.id, { isBookmarked: false });
        }
      } else {
        // 찜 안한 문제면 bookmark 리뷰 생성
        await reviewRepo.addReview({
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
        });

        // 원본 리뷰의 isBookmarked 플래그 업데이트
        if (item.reviewType !== 'bookmark') {
          await reviewRepo.updateReview(item.id, { isBookmarked: true });
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
