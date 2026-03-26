import { useState, useEffect, useRef, useMemo } from 'react';
import { collection, db, query, where, onSnapshot, getDocs, limit, Timestamp } from '@/lib/repositories';
import type { User } from 'firebase/auth';
import type { LearningQuiz } from '@/lib/hooks/useLearningQuizzes';

// 퀴즈 메타데이터 모듈 캐시 — onSnapshot 재실행 시 Firestore 재조회 방지
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _quizMetaCache = new Map<string, Record<string, any> | null>();

/**
 * 완료된 퀴즈 구독 훅
 *
 * 최적화:
 * - 배치 크기 10 → 30 (Firestore in 쿼리 최대값)
 * - 삭제된 퀴즈 폴백도 배치 처리
 * - libraryQuizzesRaw ID Set을 ref로 캐시하여 불필요한 재실행 방지
 * - 모듈 캐시로 퀴즈 메타데이터 재조회 방지
 */
export function useCompletedQuizzes(
  user: User | null,
  userCourseId: string | null,
  libraryQuizzesRaw: LearningQuiz[]
) {
  const [completedQuizzes, setCompletedQuizzes] = useState<LearningQuiz[]>([]);
  const [completedLoading, setCompletedLoading] = useState(true);

  // libraryQuizzesRaw ID를 안정적으로 캐시 (배열 참조 변경에 무관)
  const aiQuizIdsKey = useMemo(() => libraryQuizzesRaw.map(q => q.id).sort().join(','), [libraryQuizzesRaw]);
  const aiQuizIds = useRef(new Set<string>());
  aiQuizIds.current = new Set(libraryQuizzesRaw.map(q => q.id));

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

      // AI 생성 퀴즈 제외
      const quizIds = Array.from(completionMap.keys()).filter(id => !aiQuizIds.current.has(id));

      if (quizIds.length === 0) {
        setCompletedQuizzes([]);
        setCompletedLoading(false);
        return;
      }

      // 퀴즈 메타데이터 배치 로드 (캐시 우선, 미캐싱분만 Firestore 조회)
      const quizzes: LearningQuiz[] = [];
      const foundIds = new Set<string>();
      const BATCH = 30;

      // 캐시에 없는 ID만 fetch
      const uncachedIds = quizIds.filter(id => !_quizMetaCache.has(id));
      if (uncachedIds.length > 0) {
        const metaBatches = [];
        for (let i = 0; i < uncachedIds.length; i += BATCH) {
          metaBatches.push(uncachedIds.slice(i, i + BATCH));
        }
        const metaResults = await Promise.all(
          metaBatches.map(batch =>
            getDocs(query(collection(db, 'quizzes'), where('__name__', 'in', batch)))
          )
        );
        for (const batchSnap of metaResults) {
          batchSnap.docs.forEach(d => {
            _quizMetaCache.set(d.id, { id: d.id, ...d.data() });
          });
        }
        // 존재하지 않는 퀴즈도 null로 캐시 (재조회 방지)
        for (const id of uncachedIds) {
          if (!_quizMetaCache.has(id)) _quizMetaCache.set(id, null);
        }
      }

      // 캐시에서 퀴즈 메타데이터 구성
      for (const quizId of quizIds) {
        const data = _quizMetaCache.get(quizId);
        if (!data) continue; // null = 삭제된 퀴즈 → 폴백으로 처리
        if (data.courseId !== userCourseId) continue;
        foundIds.add(quizId);
        const comp = completionMap.get(quizId);
        quizzes.push({
          id: quizId,
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
      }

      // 삭제된 퀴즈 폴백: quizResults에서 배치 조회 (순차 → 병렬)
      const missingIds = quizIds.filter(id => !foundIds.has(id));
      if (missingIds.length > 0) {
        const fallbackResults = await Promise.all(
          missingIds.map(async (missingId) => {
            const comp = completionMap.get(missingId);
            if (comp?.courseId && comp.courseId !== userCourseId) return null;
            let title = '퀴즈';
            let totalCount = comp?.total ?? 0;
            let quizCreatorId: string | undefined;
            let quizType: string | undefined;
            let quizIsPublic = false;
            try {
              const resultSnap = await getDocs(query(
                collection(db, 'quizResults'),
                where('userId', '==', user.uid),
                where('quizId', '==', missingId),
                limit(1)
              ));
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
            return {
              id: missingId,
              title,
              questionCount: totalCount,
              score: comp?.score ?? 0,
              totalQuestions: totalCount,
              createdAt: comp?.completedAt?.toDate?.() ?? new Date(),
              completedAt: comp?.completedAt?.toDate?.() ?? new Date(),
              isPublic: quizIsPublic,
              tags: [],
              difficulty: 'medium' as const,
              myScore: comp?.score,
              creatorId: quizCreatorId,
              quizType,
            };
          })
        );
        for (const q of fallbackResults) {
          if (q) quizzes.push(q);
        }
      }

      quizzes.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      setCompletedQuizzes(quizzes);
      setCompletedLoading(false);
    });

    return () => unsub();
  }, [user, userCourseId, aiQuizIdsKey]); // ID 키 문자열로 안정적 비교

  return { completedQuizzes, completedLoading };
}
