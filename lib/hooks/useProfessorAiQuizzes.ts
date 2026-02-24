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

  // 퀴즈 공개 (type을 midterm/final/past로 변경)
  const publishQuiz = useCallback(async (quizId: string, publishType: string) => {
    await updateDoc(doc(db, 'quizzes', quizId), {
      type: publishType,
      isPublished: true,
      isPublic: true,
      updatedAt: serverTimestamp(),
    });
  }, []);

  return { quizzes, loading, deleteQuiz, publishQuiz };
}
