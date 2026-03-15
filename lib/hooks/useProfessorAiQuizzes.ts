'use client';

/**
 * 교수 AI 생성 퀴즈 실시간 구독 훅
 *
 * Firestore `quizzes` 컬렉션에서 creatorId + courseId 기반으로 구독.
 * 클라이언트에서 type 필터링 (복합 인덱스 최소화).
 */

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
  serverTimestamp,
  db,
} from '@/lib/repositories';
import { useUser } from '@/lib/contexts';
import { useCourse } from '@/lib/contexts/CourseContext';

export interface ProfessorAiQuiz {
  id: string;
  title: string;
  description?: string;
  difficulty: string;
  questionCount: number;
  questions: Record<string, unknown>[];
  tags: string[];
  type: string;
  isPublished?: boolean;
  wasPublished?: boolean;
  publishedType?: string; // midterm | final | past
  createdAt: { seconds: number; nanoseconds: number; getTime?: () => number } | null;
  updatedAt: { seconds: number; nanoseconds: number; getTime?: () => number } | null;
}

export function useProfessorAiQuizzes() {
  const { profile } = useUser();
  const { userCourseId } = useCourse();
  const [allQuizzes, setAllQuizzes] = useState<ProfessorAiQuiz[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile?.uid || !userCourseId) {
      setLoading(false);
      return;
    }

    // creatorUid + courseId + createdAt desc 인덱스 활용
    // (수동 생성 퀴즈는 creatorId 없이 creatorUid만 있으므로 creatorUid 사용)
    const q = query(
      collection(db, 'quizzes'),
      where('creatorUid', '==', profile.uid),
      where('courseId', '==', userCourseId),
      orderBy('createdAt', 'desc')
    );

    const unsub = onSnapshot(q, (snapshot) => {
      const items: ProfessorAiQuiz[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      })) as ProfessorAiQuiz[];
      setAllQuizzes(items);
      setLoading(false);
    }, (err) => {
      console.error('[useProfessorAiQuizzes] 쿼리 오류:', err);
      setLoading(false);
    });

    return unsub;
  }, [profile?.uid, userCourseId]);

  // 전체 퀴즈 (AI + 커스텀 통합)
  const quizzes = allQuizzes;

  // 퀴즈 삭제
  const deleteQuiz = useCallback(async (quizId: string) => {
    try {
      await deleteDoc(doc(db, 'quizzes', quizId));
    } catch (err: unknown) {
      console.error('[deleteQuiz] 삭제 실패:', err);
      alert('퀴즈 삭제에 실패했습니다: ' + (((err as Error)?.message) || ''));
      throw err;
    }
  }, []);

  // 퀴즈 공개 (type을 midterm/final/past로 변경 + creatorUid 보정)
  const publishQuiz = useCallback(async (quizId: string, publishType: string, pastExamInfo?: { pastYear: number; pastExamType: string }) => {
    try {
      const updateData: Record<string, unknown> = {
        type: publishType,
        originalType: 'professor-ai', // AI 출처 기록 (PDF 정답 인덱싱용)
        isPublished: true,
        isPublic: true,
        wasPublished: true, // 한 번이라도 공개되면 영구 마킹 (Stats 활성 조건)
        updatedAt: serverTimestamp(),
      };
      // 기출 타입일 경우 년도/시험유형 추가
      if (publishType === 'past' && pastExamInfo) {
        updateData.pastYear = pastExamInfo.pastYear;
        updateData.pastExamType = pastExamInfo.pastExamType;
      }
      // creatorUid/creatorId 양쪽 보정 (CF 호환)
      if (profile?.uid) {
        updateData.creatorUid = profile.uid;
        updateData.creatorId = profile.uid;
      }
      await updateDoc(doc(db, 'quizzes', quizId), updateData);
    } catch (err: unknown) {
      console.error('[publishQuiz] 공개 실패:', err);
      alert('퀴즈 공개에 실패했습니다: ' + (((err as Error)?.message) || ''));
      throw err;
    }
  }, [profile?.uid]);

  // 퀴즈 비공개 전환
  const unpublishQuiz = useCallback(async (quizId: string) => {
    try {
      await updateDoc(doc(db, 'quizzes', quizId), {
        isPublished: false,
        isPublic: false,
        type: 'professor', // type 초기화 → 캐러셀에서 제거
        updatedAt: serverTimestamp(),
      });
    } catch (err: unknown) {
      console.error('[unpublishQuiz] 비공개 전환 실패:', err);
      alert('비공개 전환에 실패했습니다: ' + (((err as Error)?.message) || ''));
      throw err;
    }
  }, []);

  // 퀴즈 제목 수정
  const updateTitle = useCallback(async (quizId: string, newTitle: string) => {
    await updateDoc(doc(db, 'quizzes', quizId), {
      title: newTitle,
      updatedAt: serverTimestamp(),
    });
  }, []);

  // 퀴즈 문제 수정 (questions 배열 전체 교체 + questionCount 동기화)
  const updateQuestions = useCallback(async (quizId: string, questions: Record<string, unknown>[]) => {
    // 문제별 고유 ID 부여
    const questionsWithIds = questions.map((q) => {
      if (q.id) return q;
      return { ...q, id: `q_${crypto.randomUUID().slice(0, 8)}` };
    });
    await updateDoc(doc(db, 'quizzes', quizId), {
      questions: questionsWithIds,
      questionCount: questionsWithIds.length,
      updatedAt: serverTimestamp(),
    });
  }, []);

  // 퀴즈 메타 수정 (description, tags, type, difficulty 등)
  const updateMeta = useCallback(async (quizId: string, meta: {
    description?: string;
    tags?: string[];
    type?: string;
    difficulty?: string;
  }) => {
    const data: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (meta.description !== undefined) data.description = meta.description;
    if (meta.tags !== undefined) data.tags = meta.tags;
    if (meta.type !== undefined) data.type = meta.type;
    if (meta.difficulty !== undefined) data.difficulty = meta.difficulty;
    await updateDoc(doc(db, 'quizzes', quizId), data);
  }, []);

  return { quizzes, loading, deleteQuiz, publishQuiz, unpublishQuiz, updateTitle, updateQuestions, updateMeta };
}
