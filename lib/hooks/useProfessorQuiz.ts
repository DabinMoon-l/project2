/**
 * 교수님 퀴즈 관리 훅
 *
 * 퀴즈 CRUD(생성, 조회, 수정, 삭제) 및 공개/비공개 토글 기능을 제공합니다.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  collection,
  doc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  Timestamp,
  DocumentSnapshot,
  QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

// ============================================================
// 타입 정의
// ============================================================

/** 대상 반 타입 */
export type TargetClass = 'A' | 'B' | 'C' | 'D' | 'all';

/** 난이도 타입 */
export type Difficulty = 'easy' | 'normal' | 'hard';

/** 문제 유형 */
export type QuestionType = 'ox' | 'multiple' | 'subjective' | 'short_answer' | 'essay' | 'combined';

/** 문제 데이터 */
export interface QuizQuestion {
  id: string;
  text: string;
  type: QuestionType;
  choices?: string[];
  answer: number | string;
  explanation?: string;
}

/** 퀴즈 데이터 */
export interface ProfessorQuiz {
  id: string;
  title: string;
  description?: string;
  type: 'professor';
  targetClass: TargetClass;
  difficulty: Difficulty;
  isPublished: boolean;
  questions: QuizQuestion[];
  questionCount: number;
  creatorUid: string;
  creatorNickname: string;
  participantCount: number;
  averageScore: number;
  feedbackCount: number;
  completedUsers: string[];
  createdAt: Date;
  updatedAt: Date;
}

/** 퀴즈 생성/수정 입력 데이터 */
export interface QuizInput {
  title: string;
  description?: string;
  targetClass: TargetClass;
  difficulty: Difficulty;
  isPublished: boolean;
  questions: QuizQuestion[];
  /** 실제 문제 수 (결합형 하위 문제 포함, 미지정 시 questions.length 사용) */
  questionCount?: number;
  /** 과목 ID (선택) */
  courseId?: string | null;
}

/** 필터 옵션 */
export interface QuizFilterOptions {
  isPublished?: boolean | 'all';
  targetClass?: TargetClass | 'all';
}

/** 훅 반환 타입 */
interface UseProfessorQuizReturn {
  /** 퀴즈 목록 */
  quizzes: ProfessorQuiz[];
  /** 로딩 상태 */
  loading: boolean;
  /** 더 불러오기 로딩 상태 */
  loadingMore: boolean;
  /** 더 불러올 데이터 있는지 */
  hasMore: boolean;
  /** 에러 메시지 */
  error: string | null;
  /** 퀴즈 목록 조회 */
  fetchQuizzes: (creatorUid: string, options?: QuizFilterOptions) => Promise<void>;
  /** 더 불러오기 */
  fetchMore: () => Promise<void>;
  /** 단일 퀴즈 조회 */
  fetchQuiz: (quizId: string) => Promise<ProfessorQuiz | null>;
  /** 퀴즈 생성 */
  createQuiz: (creatorUid: string, creatorNickname: string, input: QuizInput) => Promise<string>;
  /** 퀴즈 수정 */
  updateQuiz: (quizId: string, input: Partial<QuizInput>) => Promise<void>;
  /** 퀴즈 삭제 */
  deleteQuiz: (quizId: string) => Promise<void>;
  /** 공개 상태 토글 */
  togglePublish: (quizId: string, isPublished: boolean) => Promise<void>;
  /** 에러 초기화 */
  clearError: () => void;
}

// ============================================================
// 상수
// ============================================================

const QUIZZES_COLLECTION = 'quizzes';
const PAGE_SIZE = 10;

// ============================================================
// 유틸리티 함수
// ============================================================

/**
 * Firestore 문서를 ProfessorQuiz 타입으로 변환
 */
const docToQuiz = (doc: DocumentSnapshot | QueryDocumentSnapshot): ProfessorQuiz => {
  const data = doc.data()!;
  return {
    id: doc.id,
    title: data.title,
    description: data.description,
    type: data.type,
    targetClass: data.targetClass,
    difficulty: data.difficulty,
    isPublished: data.isPublished,
    questions: data.questions || [],
    questionCount: data.questionCount || 0,
    creatorUid: data.creatorUid,
    creatorNickname: data.creatorNickname,
    participantCount: data.participantCount || 0,
    averageScore: data.averageScore || 0,
    feedbackCount: data.feedbackCount || 0,
    completedUsers: data.completedUsers || [],
    createdAt: data.createdAt?.toDate() || new Date(),
    updatedAt: data.updatedAt?.toDate() || new Date(),
  };
};

// ============================================================
// 훅
// ============================================================

/**
 * 교수님 퀴즈 관리 훅
 *
 * @example
 * ```tsx
 * const {
 *   quizzes,
 *   loading,
 *   fetchQuizzes,
 *   createQuiz,
 *   updateQuiz,
 *   deleteQuiz,
 *   togglePublish,
 * } = useProfessorQuiz();
 *
 * // 퀴즈 목록 조회
 * useEffect(() => {
 *   fetchQuizzes(user.uid, { isPublished: 'all', targetClass: 'A' });
 * }, [user.uid]);
 *
 * // 퀴즈 생성
 * const quizId = await createQuiz(user.uid, '교수님', {
 *   title: '중간고사 대비',
 *   targetClass: 'A',
 *   difficulty: 'normal',
 *   isPublished: false,
 *   questions: [...],
 * });
 * ```
 */
export const useProfessorQuiz = (): UseProfessorQuizReturn => {
  const [quizzes, setQuizzes] = useState<ProfessorQuiz[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot | null>(null);
  const [currentCreatorUid, setCurrentCreatorUid] = useState<string | null>(null);
  const [currentFilters, setCurrentFilters] = useState<QuizFilterOptions>({});

  /**
   * 퀴즈 목록 조회
   */
  const fetchQuizzes = useCallback(
    async (creatorUid: string, options: QuizFilterOptions = {}): Promise<void> => {
      try {
        setLoading(true);
        setError(null);
        setCurrentCreatorUid(creatorUid);
        setCurrentFilters(options);

        // 기본 쿼리: 생성자 필터 + 최신순 정렬
        let q = query(
          collection(db, QUIZZES_COLLECTION),
          where('creatorUid', '==', creatorUid),
          where('type', '==', 'professor'),
          orderBy('createdAt', 'desc'),
          limit(PAGE_SIZE)
        );

        // 공개 상태 필터
        if (options.isPublished !== undefined && options.isPublished !== 'all') {
          q = query(
            collection(db, QUIZZES_COLLECTION),
            where('creatorUid', '==', creatorUid),
            where('type', '==', 'professor'),
            where('isPublished', '==', options.isPublished),
            orderBy('createdAt', 'desc'),
            limit(PAGE_SIZE)
          );
        }

        const snapshot = await getDocs(q);
        let fetchedQuizzes = snapshot.docs.map(docToQuiz);

        // 대상 반 필터 (클라이언트 측 필터링 - Firestore 복합 쿼리 제한 회피)
        if (options.targetClass && options.targetClass !== 'all') {
          fetchedQuizzes = fetchedQuizzes.filter(
            (quiz) => quiz.targetClass === options.targetClass || quiz.targetClass === 'all'
          );
        }

        setQuizzes(fetchedQuizzes);
        setLastDoc(snapshot.docs[snapshot.docs.length - 1] || null);
        setHasMore(snapshot.docs.length === PAGE_SIZE);
      } catch (err) {
        const message = err instanceof Error ? err.message : '퀴즈 목록을 불러오는데 실패했습니다.';
        setError(message);
        console.error('퀴즈 목록 조회 에러:', err);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /**
   * 더 불러오기 (무한 스크롤)
   */
  const fetchMore = useCallback(async (): Promise<void> => {
    if (!currentCreatorUid || !lastDoc || !hasMore || loadingMore) return;

    try {
      setLoadingMore(true);

      let q = query(
        collection(db, QUIZZES_COLLECTION),
        where('creatorUid', '==', currentCreatorUid),
        where('type', '==', 'professor'),
        orderBy('createdAt', 'desc'),
        startAfter(lastDoc),
        limit(PAGE_SIZE)
      );

      // 공개 상태 필터
      if (currentFilters.isPublished !== undefined && currentFilters.isPublished !== 'all') {
        q = query(
          collection(db, QUIZZES_COLLECTION),
          where('creatorUid', '==', currentCreatorUid),
          where('type', '==', 'professor'),
          where('isPublished', '==', currentFilters.isPublished),
          orderBy('createdAt', 'desc'),
          startAfter(lastDoc),
          limit(PAGE_SIZE)
        );
      }

      const snapshot = await getDocs(q);
      let fetchedQuizzes = snapshot.docs.map(docToQuiz);

      // 대상 반 필터
      if (currentFilters.targetClass && currentFilters.targetClass !== 'all') {
        fetchedQuizzes = fetchedQuizzes.filter(
          (quiz) => quiz.targetClass === currentFilters.targetClass || quiz.targetClass === 'all'
        );
      }

      setQuizzes((prev) => [...prev, ...fetchedQuizzes]);
      setLastDoc(snapshot.docs[snapshot.docs.length - 1] || null);
      setHasMore(snapshot.docs.length === PAGE_SIZE);
    } catch (err) {
      const message = err instanceof Error ? err.message : '더 불러오는데 실패했습니다.';
      setError(message);
      console.error('퀴즈 더 불러오기 에러:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [currentCreatorUid, currentFilters, lastDoc, hasMore, loadingMore]);

  /**
   * 단일 퀴즈 조회
   */
  const fetchQuiz = useCallback(async (quizId: string): Promise<ProfessorQuiz | null> => {
    try {
      const docRef = doc(db, QUIZZES_COLLECTION, quizId);
      const docSnap = await getDoc(docRef);

      if (!docSnap.exists()) {
        return null;
      }

      return docToQuiz(docSnap);
    } catch (err) {
      const message = err instanceof Error ? err.message : '퀴즈를 불러오는데 실패했습니다.';
      setError(message);
      console.error('퀴즈 조회 에러:', err);
      return null;
    }
  }, []);

  /**
   * 퀴즈 생성
   */
  const createQuiz = useCallback(
    async (
      creatorUid: string,
      creatorNickname: string,
      input: QuizInput
    ): Promise<string> => {
      try {
        setError(null);

        const now = Timestamp.now();
        // 실제 문제 수: input.questionCount가 있으면 사용, 없으면 questions.length 사용
        const actualQuestionCount = input.questionCount ?? input.questions.length;
        const quizData = {
          ...input,
          type: 'professor',
          questionCount: actualQuestionCount,
          creatorUid,
          creatorNickname,
          participantCount: 0,
          averageScore: 0,
          feedbackCount: 0,
          completedUsers: [],
          createdAt: now,
          updatedAt: now,
        };

        const docRef = await addDoc(collection(db, QUIZZES_COLLECTION), quizData);

        // 목록에 추가
        const newQuiz: ProfessorQuiz = {
          ...input,
          id: docRef.id,
          type: 'professor',
          questionCount: actualQuestionCount,
          creatorUid,
          creatorNickname,
          participantCount: 0,
          averageScore: 0,
          feedbackCount: 0,
          completedUsers: [],
          createdAt: now.toDate(),
          updatedAt: now.toDate(),
        };

        setQuizzes((prev) => [newQuiz, ...prev]);

        return docRef.id;
      } catch (err) {
        const message = err instanceof Error ? err.message : '퀴즈 생성에 실패했습니다.';
        setError(message);
        console.error('퀴즈 생성 에러:', err);
        throw err;
      }
    },
    []
  );

  /**
   * 퀴즈 수정
   */
  const updateQuiz = useCallback(
    async (quizId: string, input: Partial<QuizInput>): Promise<void> => {
      try {
        setError(null);

        const updateData: Record<string, unknown> = {
          ...input,
          updatedAt: Timestamp.now(),
        };

        // 문제 목록이 변경되면 questionCount도 업데이트
        if (input.questions) {
          // input.questionCount가 있으면 사용, 없으면 questions.length 사용
          updateData.questionCount = input.questionCount ?? input.questions.length;
        }

        const docRef = doc(db, QUIZZES_COLLECTION, quizId);
        await updateDoc(docRef, updateData);

        // 목록 업데이트
        const actualQuestionCount = input.questionCount ?? input.questions?.length;
        setQuizzes((prev) =>
          prev.map((quiz) =>
            quiz.id === quizId
              ? {
                  ...quiz,
                  ...input,
                  questionCount: actualQuestionCount ?? quiz.questionCount,
                  updatedAt: new Date(),
                }
              : quiz
          )
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : '퀴즈 수정에 실패했습니다.';
        setError(message);
        console.error('퀴즈 수정 에러:', err);
        throw err;
      }
    },
    []
  );

  /**
   * 퀴즈 삭제
   */
  const deleteQuiz = useCallback(async (quizId: string): Promise<void> => {
    try {
      setError(null);

      const docRef = doc(db, QUIZZES_COLLECTION, quizId);
      await deleteDoc(docRef);

      // 목록에서 제거
      setQuizzes((prev) => prev.filter((quiz) => quiz.id !== quizId));
    } catch (err) {
      const message = err instanceof Error ? err.message : '퀴즈 삭제에 실패했습니다.';
      setError(message);
      console.error('퀴즈 삭제 에러:', err);
      throw err;
    }
  }, []);

  /**
   * 공개 상태 토글
   */
  const togglePublish = useCallback(
    async (quizId: string, isPublished: boolean): Promise<void> => {
      try {
        setError(null);

        const docRef = doc(db, QUIZZES_COLLECTION, quizId);
        await updateDoc(docRef, {
          isPublished,
          updatedAt: Timestamp.now(),
        });

        // 목록 업데이트
        setQuizzes((prev) =>
          prev.map((quiz) =>
            quiz.id === quizId ? { ...quiz, isPublished, updatedAt: new Date() } : quiz
          )
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : '공개 상태 변경에 실패했습니다.';
        setError(message);
        console.error('공개 상태 토글 에러:', err);
        throw err;
      }
    },
    []
  );

  /**
   * 에러 초기화
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    quizzes,
    loading,
    loadingMore,
    hasMore,
    error,
    fetchQuizzes,
    fetchMore,
    fetchQuiz,
    createQuiz,
    updateQuiz,
    deleteQuiz,
    togglePublish,
    clearError,
  };
};

export default useProfessorQuiz;
