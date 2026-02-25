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
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useUser } from '@/lib/contexts';
import { useCourse } from '@/lib/contexts/CourseContext';

export interface ProfessorAiQuiz {
  id: string;
  title: string;
  description?: string;
  difficulty: string;
  questionCount: number;
  questions: any[];
  tags: string[];
  type: string;
  isPublished?: boolean;
  publishedType?: string; // midterm | final | past
  createdAt: any;
  updatedAt: any;
}

// AI 생성 퀴즈 타입 (서재에서 표시할 퀴즈)
const AI_QUIZ_TYPES = new Set(['professor-ai', 'ai-generated']);

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

    // 기존 인덱스(creatorId + isPublic + createdAt desc)를 활용하는 단순 쿼리
    // type 필터는 클라이언트에서 수행 (복합 인덱스 추가 불필요)
    const q = query(
      collection(db, 'quizzes'),
      where('creatorId', '==', profile.uid),
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

  // 클라이언트 필터: AI 생성 퀴즈만
  const quizzes = useMemo(
    () => allQuizzes.filter(q => AI_QUIZ_TYPES.has(q.type)),
    [allQuizzes]
  );

  // 퀴즈 삭제
  const deleteQuiz = useCallback(async (quizId: string) => {
    await deleteDoc(doc(db, 'quizzes', quizId));
  }, []);

  // 퀴즈 공개 (type을 midterm/final/past로 변경 + creatorUid 보정)
  const publishQuiz = useCallback(async (quizId: string, publishType: string) => {
    const updateData: Record<string, any> = {
      type: publishType,
      isPublished: true,
      isPublic: true,
      updatedAt: serverTimestamp(),
    };
    // creatorUid가 없는 기존 서재 퀴즈를 위해 공개 시 보정
    if (profile?.uid) {
      updateData.creatorUid = profile.uid;
    }
    await updateDoc(doc(db, 'quizzes', quizId), updateData);
  }, [profile?.uid]);

  // 퀴즈 제목 수정
  const updateTitle = useCallback(async (quizId: string, newTitle: string) => {
    await updateDoc(doc(db, 'quizzes', quizId), {
      title: newTitle,
      updatedAt: serverTimestamp(),
    });
  }, []);

  // 퀴즈 문제 수정 (questions 배열 전체 교체)
  const updateQuestions = useCallback(async (quizId: string, questions: any[]) => {
    await updateDoc(doc(db, 'quizzes', quizId), {
      questions,
      updatedAt: serverTimestamp(),
    });
  }, []);

  // 퀴즈 메타 수정 (description, tags 등)
  const updateMeta = useCallback(async (quizId: string, meta: { description?: string; tags?: string[] }) => {
    const data: Record<string, any> = { updatedAt: serverTimestamp() };
    if (meta.description !== undefined) data.description = meta.description;
    if (meta.tags !== undefined) data.tags = meta.tags;
    await updateDoc(doc(db, 'quizzes', quizId), data);
  }, []);

  return { quizzes, loading, deleteQuiz, publishQuiz, updateTitle, updateQuestions, updateMeta };
}
