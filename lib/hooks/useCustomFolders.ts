/**
 * 커스텀 폴더 관리 훅
 *
 * useReview.ts에서 커스텀 폴더 관련 로직만 추출.
 * 교수/학생 모두 사용 가능.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { reviewRepo, Timestamp } from '@/lib/repositories';
import { useAuth } from './useAuth';
import { useCourse } from '../contexts/CourseContext';

// ============================================================
// 타입 정의
// ============================================================

/** 커스텀 폴더 카테고리 */
export interface FolderCategory {
  id: string;
  name: string;
}

/** 커스텀 폴더 문제 항목 */
export interface CustomFolderQuestion {
  questionId: string;
  quizId: string;
  quizTitle: string;
  categoryId?: string;
  combinedGroupId?: string | null;
}

/** 커스텀 폴더 */
export interface CustomFolder {
  id: string;
  name: string;
  createdAt: Timestamp;
  questions: CustomFolderQuestion[];
  categories?: FolderCategory[];
}

/** useCustomFolders 훅 반환 타입 */
export interface UseCustomFoldersReturn {
  customFolders: CustomFolder[];
  loading: boolean;
  createCustomFolder: (name: string) => Promise<string | null>;
  deleteCustomFolder: (folderId: string) => Promise<void>;
  addToCustomFolder: (folderId: string, questions: { questionId: string; quizId: string; quizTitle: string; combinedGroupId?: string | null }[]) => Promise<void>;
  removeFromCustomFolder: (folderId: string, questionId: string) => Promise<void>;
  addCategoryToFolder: (folderId: string, categoryName: string) => Promise<string | null>;
  removeCategoryFromFolder: (folderId: string, categoryId: string) => Promise<void>;
  assignQuestionToCategory: (folderId: string, questionId: string, categoryId: string | null) => Promise<void>;
  updateCategoryName: (folderId: string, categoryId: string, newName: string) => Promise<void>;
}

// ============================================================
// useCustomFolders 훅
// ============================================================

export const useCustomFolders = (): UseCustomFoldersReturn => {
  const { user } = useAuth();
  const { userCourseId } = useCourse();
  const [customFolders, setCustomFolders] = useState<CustomFolder[]>([]);
  const [loading, setLoading] = useState(true);

  // 커스텀 폴더 실시간 구독
  useEffect(() => {
    if (!user) {
      setCustomFolders([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const unsubscribe = reviewRepo.subscribeCustomFolders(
      user.uid,
      userCourseId,
      (docs) => {
        const folders: CustomFolder[] = docs.map((d) => {
          const data = d as Record<string, unknown>;
          return {
            id: d.id,
            name: data.name as string,
            createdAt: data.createdAt as Timestamp,
            questions: (data.questions as CustomFolderQuestion[]) || [],
            categories: (data.categories as FolderCategory[]) || [],
          };
        });

        folders.sort((a, b) => {
          const aTime = a.createdAt?.toMillis?.() || Date.now();
          const bTime = b.createdAt?.toMillis?.() || Date.now();
          return bTime - aTime;
        });

        setCustomFolders(folders);
        setLoading(false);
      },
      (err) => {
        console.error('커스텀 폴더 로드 실패:', err);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [user, userCourseId]);

  /** 커스텀 폴더 생성 */
  const createCustomFolder = useCallback(async (name: string): Promise<string | null> => {
    if (!user) return null;

    try {
      const id = await reviewRepo.addFolder({
        userId: user.uid,
        name,
        questions: [],
        courseId: userCourseId || null,
      });
      return id;
    } catch (err: unknown) {
      console.error('커스텀 폴더 생성 실패:', err);
      return null;
    }
  }, [user, userCourseId]);

  /** 커스텀 폴더 삭제 (휴지통 저장 후 삭제) */
  const deleteCustomFolder = useCallback(async (folderId: string): Promise<void> => {
    if (!user) return;

    try {
      const folderData = await reviewRepo.getFolder(folderId);
      if (!folderData) {
        throw new Error('폴더를 찾을 수 없습니다.');
      }

      // 휴지통에 저장
      await reviewRepo.addDeletedItem({
        userId: user.uid,
        courseId: userCourseId || null,
        type: 'custom',
        originalId: folderId,
        title: (folderData.name as string) || '폴더',
        questionCount: (folderData.questions as unknown[])?.length || 0,
        restoreData: {
          folderData: { ...folderData, id: folderId },
        },
      });

      await reviewRepo.deleteFolder(folderId);
    } catch (err) {
      console.error('커스텀 폴더 삭제 실패:', err);
      throw new Error('폴더 삭제에 실패했습니다.');
    }
  }, [user, userCourseId]);

  /** 문제를 커스텀 폴더에 추가 (중복 제거) */
  const addToCustomFolder = useCallback(async (
    folderId: string,
    questions: { questionId: string; quizId: string; quizTitle: string; combinedGroupId?: string | null }[]
  ): Promise<void> => {
    if (!user) return;

    try {
      const folderData = await reviewRepo.getFolder(folderId);
      if (!folderData) {
        throw new Error('폴더를 찾을 수 없습니다.');
      }

      const currentQuestions = (folderData.questions as CustomFolderQuestion[]) || [];
      const newQuestions = [...currentQuestions];

      for (const q of questions) {
        if (!newQuestions.some(existing =>
          existing.questionId === q.questionId && existing.quizId === q.quizId
        )) {
          newQuestions.push(q);
        }
      }

      await reviewRepo.updateFolder(folderId, { questions: newQuestions });
    } catch (err) {
      console.error('문제 추가 실패:', err);
      throw new Error('문제 추가에 실패했습니다.');
    }
  }, [user]);

  /** 커스텀 폴더에서 문제 제거 */
  const removeFromCustomFolder = useCallback(async (
    folderId: string,
    questionId: string
  ): Promise<void> => {
    if (!user) return;

    try {
      const folderData = await reviewRepo.getFolder(folderId);
      if (!folderData) {
        throw new Error('폴더를 찾을 수 없습니다.');
      }

      const currentQuestions = (folderData.questions as CustomFolderQuestion[]) || [];
      const newQuestions = currentQuestions.filter(
        (q) => q.questionId !== questionId
      );

      await reviewRepo.updateFolder(folderId, { questions: newQuestions });
    } catch (err) {
      console.error('문제 제거 실패:', err);
      throw new Error('문제 제거에 실패했습니다.');
    }
  }, [user]);

  /** 커스텀 폴더에 카테고리 추가 */
  const addCategoryToFolder = useCallback(async (
    folderId: string,
    categoryName: string
  ): Promise<string | null> => {
    if (!user) return null;

    try {
      const folderData = await reviewRepo.getFolder(folderId);
      if (!folderData) {
        throw new Error('폴더를 찾을 수 없습니다.');
      }

      const currentCategories = (folderData.categories as FolderCategory[]) || [];
      const newCategoryId = `cat_${Date.now()}`;
      const newCategory: FolderCategory = {
        id: newCategoryId,
        name: categoryName,
      };

      await reviewRepo.updateFolder(folderId, {
        categories: [...currentCategories, newCategory],
      });

      return newCategoryId;
    } catch (err) {
      console.error('카테고리 추가 실패:', err);
      return null;
    }
  }, [user]);

  /** 커스텀 폴더에서 카테고리 삭제 (문제는 미분류로 변경) */
  const removeCategoryFromFolder = useCallback(async (
    folderId: string,
    categoryId: string
  ): Promise<void> => {
    if (!user) return;

    try {
      const folderData = await reviewRepo.getFolder(folderId);
      if (!folderData) {
        throw new Error('폴더를 찾을 수 없습니다.');
      }

      const currentCategories = (folderData.categories as FolderCategory[]) || [];
      const currentQuestions = (folderData.questions as CustomFolderQuestion[]) || [];

      const newCategories = currentCategories.filter(
        (cat) => cat.id !== categoryId
      );

      const newQuestions = currentQuestions.map((q) => ({
        ...q,
        categoryId: q.categoryId === categoryId ? undefined : q.categoryId,
      }));

      await reviewRepo.updateFolder(folderId, {
        categories: newCategories,
        questions: newQuestions,
      });
    } catch (err) {
      console.error('카테고리 삭제 실패:', err);
      throw new Error('카테고리 삭제에 실패했습니다.');
    }
  }, [user]);

  /** 문제를 카테고리에 배정 (null이면 미분류) */
  const assignQuestionToCategory = useCallback(async (
    folderId: string,
    questionId: string,
    categoryId: string | null
  ): Promise<void> => {
    if (!user) return;

    try {
      const folderData = await reviewRepo.getFolder(folderId);
      if (!folderData) {
        throw new Error('폴더를 찾을 수 없습니다.');
      }

      const currentQuestions = (folderData.questions as CustomFolderQuestion[]) || [];
      const newQuestions = currentQuestions.map((q) => {
        if (q.questionId === questionId) {
          return { ...q, categoryId: categoryId || undefined };
        }
        return q;
      });

      await reviewRepo.updateFolder(folderId, { questions: newQuestions });
    } catch (err) {
      console.error('문제 카테고리 배정 실패:', err);
      throw new Error('카테고리 배정에 실패했습니다.');
    }
  }, [user]);

  /** 카테고리 이름 수정 */
  const updateCategoryName = useCallback(async (
    folderId: string,
    categoryId: string,
    newName: string
  ): Promise<void> => {
    if (!user) return;

    try {
      const folderData = await reviewRepo.getFolder(folderId);
      if (!folderData) {
        throw new Error('폴더를 찾을 수 없습니다.');
      }

      const currentCategories = (folderData.categories as FolderCategory[]) || [];
      const newCategories = currentCategories.map((cat) => {
        if (cat.id === categoryId) {
          return { ...cat, name: newName };
        }
        return cat;
      });

      await reviewRepo.updateFolder(folderId, { categories: newCategories });
    } catch (err) {
      console.error('카테고리 이름 수정 실패:', err);
      throw new Error('카테고리 수정에 실패했습니다.');
    }
  }, [user]);

  return {
    customFolders,
    loading,
    createCustomFolder,
    deleteCustomFolder,
    addToCustomFolder,
    removeFromCustomFolder,
    addCategoryToFolder,
    removeCategoryFromFolder,
    assignQuestionToCategory,
    updateCategoryName,
  };
};

export default useCustomFolders;
