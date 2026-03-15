import { useState, useEffect } from 'react';
import { collection, db, query, where, onSnapshot, getDocs, limit, Timestamp } from '@/lib/repositories';
import type { User } from 'firebase/auth';
import type { LearningQuiz } from '@/lib/hooks/useLearningQuizzes';

/**
 * 완료된 퀴즈 구독 훅
 *
 * quiz_completions에서 사용자가 완료한 퀴즈를 실시간 구독하고,
 * AI 생성 퀴즈(libraryQuizzesRaw)를 제외한 커스텀/교수 퀴즈만 반환.
 * 삭제된 퀴즈는 quizResults에서 제목을 폴백으로 가져옴.
 */
export function useCompletedQuizzes(
  user: User | null,
  userCourseId: string | null,
  libraryQuizzesRaw: LearningQuiz[]
) {
  const [completedQuizzes, setCompletedQuizzes] = useState<LearningQuiz[]>([]);
  const [completedLoading, setCompletedLoading] = useState(true);

  useEffect(() => {
    if (!user || !userCourseId) {
      setCompletedQuizzes([]);
      setCompletedLoading(false);
      return;
    }

    const completionsRef = collection(db, 'quiz_completions');
    const q = query(completionsRef, where('userId', '==', user.uid));

    const unsub = onSnapshot(q, async (snap) => {
      const completionMap = new Map<string, { score: number; total: number; courseId: string | null; completedAt: Timestamp | null }>();
      snap.docs.forEach(d => {
        const data = d.data();
        completionMap.set(data.quizId, {
          score: data.score ?? 0,
          total: data.totalCount ?? data.totalQuestions ?? 0,
          courseId: data.courseId ?? null,
          completedAt: data.completedAt,
        });
      });

      if (completionMap.size === 0) {
        setCompletedQuizzes([]);
        setCompletedLoading(false);
        return;
      }

      // AI 생성 퀴즈는 이미 libraryQuizzesRaw에 있으므로 제외
      const aiQuizIds = new Set(libraryQuizzesRaw.map(q => q.id));
      const quizIds = Array.from(completionMap.keys()).filter(id => !aiQuizIds.has(id));

      if (quizIds.length === 0) {
        setCompletedQuizzes([]);
        setCompletedLoading(false);
        return;
      }

      // 퀴즈 메타데이터 로드 (10개씩 배치)
      const quizzes: LearningQuiz[] = [];
      const foundIds = new Set<string>();
      for (let i = 0; i < quizIds.length; i += 10) {
        const batch = quizIds.slice(i, i + 10);
        const quizzesRef = collection(db, 'quizzes');
        const batchQuery = query(quizzesRef, where('__name__', 'in', batch));
        const batchSnap = await getDocs(batchQuery);
        batchSnap.docs.forEach(d => {
          const data = d.data();
          if (data.courseId !== userCourseId) return;
          foundIds.add(d.id);
          const comp = completionMap.get(d.id);
          quizzes.push({
            id: d.id,
            title: data.title || '제목 없음',
            questionCount: data.questions?.length || data.questionCount || 0,
            score: comp?.score ?? 0,
            totalQuestions: comp?.total ?? data.questions?.length ?? data.questionCount ?? 0,
            createdAt: data.createdAt?.toDate?.() ?? new Date(),
            completedAt: data.createdAt?.toDate?.() ?? new Date(),
            isPublic: data.isPublic ?? false,
            tags: data.tags || [],
            difficulty: data.difficulty || 'medium',
            myScore: data.userScores?.[user.uid] ?? comp?.score,
            myFirstReviewScore: data.userFirstReviewScores?.[user.uid],
            creatorId: data.creatorId || undefined,
            quizType: data.type || undefined,
            oxCount: data.oxCount,
            multipleChoiceCount: data.multipleChoiceCount,
            subjectiveCount: data.subjectiveCount,
          });
        });
      }

      // 삭제된 퀴즈 폴백: quizResults에서 제목 가져오기
      const missingIds = quizIds.filter(id => !foundIds.has(id));
      for (const missingId of missingIds) {
        const comp = completionMap.get(missingId);
        if (comp?.courseId && comp.courseId !== userCourseId) continue;
        let title = '퀴즈';
        let totalCount = comp?.total ?? 0;
        let quizCreatorId: string | undefined;
        let quizType: string | undefined;
        let quizIsPublic = false;
        try {
          const resultQuery = query(
            collection(db, 'quizResults'),
            where('userId', '==', user.uid),
            where('quizId', '==', missingId),
            limit(1)
          );
          const resultSnap = await getDocs(resultQuery);
          if (!resultSnap.empty) {
            const resultData = resultSnap.docs[0].data();
            title = resultData.quizTitle || '퀴즈';
            totalCount = resultData.totalCount || totalCount;
            quizCreatorId = resultData.quizCreatorId || undefined;
            quizType = resultData.quizType || undefined;
            quizIsPublic = resultData.quizIsPublic ?? false;
          }
        } catch { /* 무시 */ }
        if (!quizType && quizCreatorId && quizCreatorId !== user.uid) {
          quizType = 'professor';
        }
        quizzes.push({
          id: missingId,
          title,
          questionCount: totalCount,
          score: comp?.score ?? 0,
          totalQuestions: totalCount,
          createdAt: comp?.completedAt?.toDate?.() ?? new Date(),
          completedAt: comp?.completedAt?.toDate?.() ?? new Date(),
          isPublic: quizIsPublic,
          tags: [],
          difficulty: 'medium',
          myScore: comp?.score,
          creatorId: quizCreatorId,
          quizType,
        });
      }

      quizzes.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      setCompletedQuizzes(quizzes);
      setCompletedLoading(false);
    });

    return () => unsub();
  }, [user, userCourseId, libraryQuizzesRaw]);

  return { completedQuizzes, completedLoading };
}
