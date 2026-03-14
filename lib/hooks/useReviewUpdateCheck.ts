import { useState, useEffect, useCallback, useRef } from 'react';
import { doc, getDoc, db, Timestamp } from '@/lib/repositories';
import type { GroupedReviewItems, QuizUpdateInfo } from './useReviewTypes';
import type { CustomFolder } from './useReviewTypes';

/**
 * 복습 문제의 퀴즈 업데이트 확인 훅
 *
 * 각 문제의 questionUpdatedAt과 저장된 quizUpdatedAt을 비교하여
 * 문제 내용이 수정되었는지 확인합니다.
 * 최초 로드 후 한 번만 실행됩니다.
 */
export function useReviewUpdateCheck(
  loading: boolean,
  groupedWrongItems: GroupedReviewItems[],
  groupedBookmarkedItems: GroupedReviewItems[],
  groupedSolvedItems: GroupedReviewItems[],
  customFolders: CustomFolder[],
  refreshKey: number,
  userId: string | undefined,
  courseId: string | null,
) {
  const [updatedQuizzes, setUpdatedQuizzes] = useState<Map<string, QuizUpdateInfo>>(new Map());
  const updateCheckDoneRef = useRef(false);

  // 퀴즈의 문제 수정 여부 확인
  const checkQuizQuestionUpdates = useCallback(async (
    quizId: string,
    savedQuizUpdatedAt: Timestamp | null
  ): Promise<boolean> => {
    if (!savedQuizUpdatedAt) return false;

    try {
      const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
      if (!quizDoc.exists()) return false;

      const quizData = quizDoc.data();
      const questions = quizData?.questions || [];
      const savedTime = savedQuizUpdatedAt.toMillis ? savedQuizUpdatedAt.toMillis() : 0;

      for (const q of questions) {
        const questionUpdatedAt = q.questionUpdatedAt;
        if (questionUpdatedAt) {
          const updatedTime = questionUpdatedAt.toMillis ? questionUpdatedAt.toMillis() : 0;
          if (updatedTime > savedTime) {
            return true;
          }
        }
      }

      return false;
    } catch (err) {
      console.error('문제 수정 확인 실패:', err);
      return false;
    }
  }, []);

  // loading/user/courseId가 바뀌면 체크 플래그 리셋
  useEffect(() => {
    updateCheckDoneRef.current = false;
  }, [userId, courseId, refreshKey]);

  useEffect(() => {
    if (loading) return;
    if (updateCheckDoneRef.current) return;
    if (groupedWrongItems.length === 0 && groupedBookmarkedItems.length === 0 && groupedSolvedItems.length === 0) return;

    updateCheckDoneRef.current = true;

    const checkAllUpdates = async () => {
      const newUpdatedQuizzes = new Map<string, QuizUpdateInfo>();

      // 오답 문제 업데이트 확인
      for (const group of groupedWrongItems) {
        if (group.items.length > 0 && group.items[0].quizUpdatedAt) {
          const hasQuestionUpdate = await checkQuizQuestionUpdates(
            group.quizId,
            group.items[0].quizUpdatedAt
          );
          if (hasQuestionUpdate) {
            newUpdatedQuizzes.set(`wrong-${group.quizId}`, {
              quizId: group.quizId,
              quizTitle: group.quizTitle,
              hasUpdate: true,
            });
          }
        }
      }

      // 찜한 문제 업데이트 확인
      for (const group of groupedBookmarkedItems) {
        if (group.items.length > 0 && group.items[0].quizUpdatedAt) {
          const hasQuestionUpdate = await checkQuizQuestionUpdates(
            group.quizId,
            group.items[0].quizUpdatedAt
          );
          if (hasQuestionUpdate) {
            newUpdatedQuizzes.set(`bookmark-${group.quizId}`, {
              quizId: group.quizId,
              quizTitle: group.quizTitle,
              hasUpdate: true,
            });
          }
        }
      }

      // 푼 문제 업데이트 확인
      for (const group of groupedSolvedItems) {
        if (group.items.length > 0 && group.items[0].quizUpdatedAt) {
          const hasQuestionUpdate = await checkQuizQuestionUpdates(
            group.quizId,
            group.items[0].quizUpdatedAt
          );
          if (hasQuestionUpdate) {
            newUpdatedQuizzes.set(`solved-${group.quizId}`, {
              quizId: group.quizId,
              quizTitle: group.quizTitle,
              hasUpdate: true,
            });
          }
        }
      }

      // 커스텀 폴더 업데이트 확인
      for (const folder of customFolders) {
        const folderQuestions = folder.questions || [];
        if (folderQuestions.length === 0) continue;

        const quizGroups = new Map<string, string[]>();
        for (const q of folderQuestions) {
          const existing = quizGroups.get(q.quizId) || [];
          existing.push(q.questionId);
          quizGroups.set(q.quizId, existing);
        }

        let hasAnyUpdate = false;
        for (const [quizId, questionIds] of quizGroups) {
          try {
            const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
            if (!quizDoc.exists()) continue;

            const quizData = quizDoc.data();
            const questions = quizData?.questions || [];

            for (const q of questions) {
              if (!questionIds.includes(q.id)) continue;
              const questionUpdatedAt = q.questionUpdatedAt;
              if (questionUpdatedAt) {
                const updatedTime = questionUpdatedAt.toMillis ? questionUpdatedAt.toMillis() : 0;
                const folderCreatedAt = folder.createdAt?.toMillis ? folder.createdAt.toMillis() : 0;
                if (updatedTime > folderCreatedAt) {
                  hasAnyUpdate = true;
                  break;
                }
              }
            }
            if (hasAnyUpdate) break;
          } catch (err) {
            console.error('커스텀 폴더 업데이트 확인 실패:', err);
          }
        }

        if (hasAnyUpdate) {
          newUpdatedQuizzes.set(`custom-${folder.id}`, {
            quizId: folder.id,
            quizTitle: folder.name,
            hasUpdate: true,
          });
        }
      }

      setUpdatedQuizzes(newUpdatedQuizzes);
    };

    checkAllUpdates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, groupedWrongItems, groupedBookmarkedItems, groupedSolvedItems, customFolders, checkQuizQuestionUpdates]);

  return updatedQuizzes;
}
