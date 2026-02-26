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
  chapterId?: string;
  chapterDetailId?: string;
  rubric?: Array<{ criteria: string; percentage: number; description?: string }>;
}

/** 시험 유형 */
export type QuizTypeFilter = 'midterm' | 'final' | 'past';

/** 퀴즈 데이터 */
export interface ProfessorQuiz {
  id: string;
  title: string;
  description?: string;
  type: QuizTypeFilter | 'professor';
  courseId?: string;
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
  tags?: string[];
  pastYear?: number;
  pastExamType?: string;
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
  /** 시험 유형 */
  quizType?: QuizTypeFilter;
  /** 기출 년도 (past 타입 전용) */
  pastYear?: number;
  /** 기출 시험 구분: 중간 or 기말 (past 타입 전용) */
  pastExamType?: 'midterm' | 'final';
  /** 태그 목록 */
  tags?: string[];
}

/** 필터 옵션 */
export interface QuizFilterOptions {
  isPublished?: boolean | 'all';
  targetClass?: TargetClass | 'all';
  quizType?: QuizTypeFilter;
  pageSize?: number;
}

/** 문제별 선택 통계 */
export interface ChoiceStats {
  /** 선지 인덱스 또는 답안 */
  choice: number | string;
  /** 선택 횟수 */
  count: number;
  /** 선택 비율 (0-100) */
  percentage: number;
}

/** 문제별 통계 */
export interface QuestionStats {
  /** 문제 ID */
  questionId: string;
  /** 문제 인덱스 */
  questionIndex: number;
  /** 총 응답 수 */
  totalResponses: number;
  /** 정답 수 */
  correctCount: number;
  /** 오답 수 */
  wrongCount: number;
  /** 정답률 (0-100) */
  correctRate: number;
  /** 오답률 (0-100) */
  wrongRate: number;
  /** 선지별 선택 통계 (OX/객관식) */
  choiceStats?: ChoiceStats[];
  /** 오답 목록 (주관식) */
  wrongAnswers?: string[];
  /** 문제가 수정되었는지 여부 (수정 후 데이터가 있으면 true) */
  isModified?: boolean;
}

/** 퀴즈 전체 통계 */
export interface QuizStatistics {
  /** 문제별 통계 */
  questionStats: QuestionStats[];
  /** 오답률 순위 (높은 순) */
  wrongRateRanking: { questionIndex: number; wrongRate: number }[];
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
  /** 퀴즈 통계 조회 */
  fetchQuizStatistics: (quizId: string, questions: QuizQuestion[]) => Promise<QuizStatistics | null>;
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
    courseId: data.courseId,
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
    tags: data.tags || [],
    pastYear: data.pastYear,
    pastExamType: data.pastExamType,
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

        // type 필터: 특정 quizType이면 해당 타입만, 아니면 모든 교수 퀴즈 타입
        const typeFilter = options.quizType
          ? [options.quizType]
          : ['midterm', 'final', 'past', 'professor'];

        const basePageSize = options.pageSize || PAGE_SIZE;
        // targetClass 클라이언트 필터 시 넉넉히 가져옴 (필터 후에도 충분한 결과 확보)
        const hasClassFilter = options.targetClass && options.targetClass !== 'all';
        const effectivePageSize = hasClassFilter ? basePageSize * 3 : basePageSize;

        // 기본 쿼리: 생성자 필터 + 최신순 정렬
        let q = query(
          collection(db, QUIZZES_COLLECTION),
          where('creatorUid', '==', creatorUid),
          where('type', 'in', typeFilter),
          orderBy('createdAt', 'desc'),
          limit(effectivePageSize)
        );

        // 공개 상태 필터
        if (options.isPublished !== undefined && options.isPublished !== 'all') {
          q = query(
            collection(db, QUIZZES_COLLECTION),
            where('creatorUid', '==', creatorUid),
            where('type', 'in', typeFilter),
            where('isPublished', '==', options.isPublished),
            orderBy('createdAt', 'desc'),
            limit(effectivePageSize)
          );
        }

        const snapshot = await getDocs(q);
        let fetchedQuizzes = snapshot.docs.map(docToQuiz);

        // 대상 반 필터 (클라이언트 측 필터링 - Firestore 복합 쿼리 제한 회피)
        if (hasClassFilter) {
          fetchedQuizzes = fetchedQuizzes.filter(
            (quiz) => quiz.targetClass === options.targetClass || quiz.targetClass === 'all'
          );
        }

        setQuizzes(fetchedQuizzes);
        setLastDoc(snapshot.docs[snapshot.docs.length - 1] || null);
        setHasMore(snapshot.docs.length === effectivePageSize);
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

      const typeFilter = currentFilters.quizType
        ? [currentFilters.quizType]
        : ['midterm', 'final', 'past', 'professor'];

      const hasClassFilter = currentFilters.targetClass && currentFilters.targetClass !== 'all';
      const effectivePageSize = hasClassFilter ? PAGE_SIZE * 3 : PAGE_SIZE;

      let q = query(
        collection(db, QUIZZES_COLLECTION),
        where('creatorUid', '==', currentCreatorUid),
        where('type', 'in', typeFilter),
        orderBy('createdAt', 'desc'),
        startAfter(lastDoc),
        limit(effectivePageSize)
      );

      // 공개 상태 필터
      if (currentFilters.isPublished !== undefined && currentFilters.isPublished !== 'all') {
        q = query(
          collection(db, QUIZZES_COLLECTION),
          where('creatorUid', '==', currentCreatorUid),
          where('type', 'in', typeFilter),
          where('isPublished', '==', currentFilters.isPublished),
          orderBy('createdAt', 'desc'),
          startAfter(lastDoc),
          limit(effectivePageSize)
        );
      }

      const snapshot = await getDocs(q);
      let fetchedQuizzes = snapshot.docs.map(docToQuiz);

      // 대상 반 필터
      if (hasClassFilter) {
        fetchedQuizzes = fetchedQuizzes.filter(
          (quiz) => quiz.targetClass === currentFilters.targetClass || quiz.targetClass === 'all'
        );
      }

      setQuizzes((prev) => [...prev, ...fetchedQuizzes]);
      setLastDoc(snapshot.docs[snapshot.docs.length - 1] || null);
      setHasMore(snapshot.docs.length === effectivePageSize);
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
   * 결합형 문제를 펼쳐서 개별 문제로 변환하는 헬퍼 함수
   */
  const flattenQuestionsForStats = (questions: any[]): QuizQuestion[] => {
    const result: QuizQuestion[] = [];
    let globalIdx = 0;

    questions.forEach((q) => {
      // 이미 펼쳐진 결합형 문제 (combinedGroupId가 있는 경우)
      if (q.combinedGroupId) {
        result.push({
          id: q.id || `q${globalIdx}`,
          text: q.text || '',
          type: q.type,
          choices: q.choices,
          answer: q.answer,
          explanation: q.explanation,
        });
        globalIdx++;
      }
      // 레거시 결합형 문제 (type === 'combined' + subQuestions)
      else if (q.type === 'combined' && q.subQuestions && q.subQuestions.length > 0) {
        const parentId = q.id || `q${globalIdx}`;
        q.subQuestions.forEach((sq: any, idx: number) => {
          // 정답 형식 변환
          let answer: number | string;
          if (sq.type === 'ox') {
            answer = sq.answerIndex ?? 0;
          } else if (sq.type === 'multiple') {
            if (sq.answerIndices?.length > 0) {
              answer = sq.answerIndices.map((i: number) => i + 1).join(',');
            } else if (sq.answerIndex !== undefined) {
              answer = sq.answerIndex + 1;
            } else {
              answer = 0;
            }
          } else {
            answer = sq.answerText || '';
          }

          result.push({
            id: sq.id || `${parentId}_sub${idx}`,
            text: sq.text || '',
            type: sq.type || 'short_answer',
            choices: sq.choices,
            answer,
            explanation: sq.explanation,
          });
        });
        globalIdx++;
      }
      // 일반 문제
      else {
        result.push({
          id: q.id || `q${globalIdx}`,
          text: q.text || '',
          type: q.type,
          choices: q.choices,
          answer: q.answer,
          explanation: q.explanation,
        });
        globalIdx++;
      }
    });

    return result;
  };

  /**
   * 퀴즈 통계 조회
   * quizResults 컬렉션에서 문제별 통계를 계산합니다.
   * 문제가 수정된 경우, 수정 이후의 응답만 통계에 포함합니다.
   */
  const fetchQuizStatistics = useCallback(
    async (quizId: string, questions: QuizQuestion[]): Promise<QuizStatistics | null> => {
      try {
        // 결합형 문제 펼치기 (레거시 호환성)
        const flattenedQuestions = flattenQuestionsForStats(questions);

        // 원본 questions에서 questionUpdatedAt 정보 추출 (결합형 포함)
        const questionUpdatedAtMap = new Map<number, number>(); // idx -> updatedAt timestamp
        const questionModifiedMap = new Map<number, boolean>(); // idx -> isModified

        // 원본 questions에서 questionUpdatedAt 추출
        let flatIdx = 0;
        questions.forEach((q: any) => {
          if (q.type === 'combined' && q.subQuestions && q.subQuestions.length > 0) {
            // 결합형: 각 하위 문제별로 처리
            q.subQuestions.forEach((sq: any) => {
              const updatedAt = sq.questionUpdatedAt || q.questionUpdatedAt;
              if (updatedAt) {
                const ts = updatedAt.toMillis ? updatedAt.toMillis() : (updatedAt.seconds ? updatedAt.seconds * 1000 : 0);
                if (ts > 0) {
                  questionUpdatedAtMap.set(flatIdx, ts);
                  questionModifiedMap.set(flatIdx, true);
                }
              }
              flatIdx++;
            });
          } else if (q.combinedGroupId) {
            // 이미 펼쳐진 결합형 문제
            const updatedAt = q.questionUpdatedAt;
            if (updatedAt) {
              const ts = updatedAt.toMillis ? updatedAt.toMillis() : (updatedAt.seconds ? updatedAt.seconds * 1000 : 0);
              if (ts > 0) {
                questionUpdatedAtMap.set(flatIdx, ts);
                questionModifiedMap.set(flatIdx, true);
              }
            }
            flatIdx++;
          } else {
            // 일반 문제
            const updatedAt = q.questionUpdatedAt;
            if (updatedAt) {
              const ts = updatedAt.toMillis ? updatedAt.toMillis() : (updatedAt.seconds ? updatedAt.seconds * 1000 : 0);
              if (ts > 0) {
                questionUpdatedAtMap.set(flatIdx, ts);
                questionModifiedMap.set(flatIdx, true);
              }
            }
            flatIdx++;
          }
        });

        // quizResults에서 해당 퀴즈의 모든 결과 가져오기
        const resultsQuery = query(
          collection(db, 'quizResults'),
          where('quizId', '==', quizId)
        );
        const resultsSnapshot = await getDocs(resultsQuery);

        if (resultsSnapshot.empty) {
          // 결과가 없으면 빈 통계 반환
          const emptyStats: QuestionStats[] = flattenedQuestions.map((q, idx) => ({
            questionId: q.id,
            questionIndex: idx,
            totalResponses: 0,
            correctCount: 0,
            wrongCount: 0,
            correctRate: 0,
            wrongRate: 0,
            choiceStats: q.type === 'ox'
              ? [{ choice: 0, count: 0, percentage: 0 }, { choice: 1, count: 0, percentage: 0 }]
              : q.type === 'multiple' && q.choices
                ? q.choices.map((_, i) => ({ choice: i, count: 0, percentage: 0 }))
                : undefined,
            wrongAnswers: (q.type === 'subjective' || q.type === 'short_answer') ? [] : undefined,
            isModified: questionModifiedMap.get(idx) || false,
          }));

          return {
            questionStats: emptyStats,
            wrongRateRanking: [],
          };
        }

        // 문제별 통계 계산
        const questionStats: QuestionStats[] = flattenedQuestions.map((question, idx) => {
          let totalResponses = 0;
          let correctCount = 0;
          const choiceCounts: Record<string, number> = {};
          const wrongAnswerSet = new Set<string>();

          // 이 문제의 수정 시간 (없으면 undefined)
          const questionUpdatedAt = questionUpdatedAtMap.get(idx);
          const isModified = questionModifiedMap.get(idx) || false;

          // 각 결과에서 해당 문제의 답안 분석
          resultsSnapshot.docs.forEach((resultDoc, docIdx) => {
            const resultData = resultDoc.data();
            const answers = resultData.answers || [];
            const userAnswer = answers[idx];

            // 문제가 수정된 경우, 수정 이후의 응답만 포함
            if (questionUpdatedAt) {
              // questionScores에서 개별 문제의 응답 시간 확인
              const questionScores = resultData.questionScores || {};
              const questionScore = questionScores[question.id];
              let answeredAt = 0;

              if (questionScore?.answeredAt) {
                const at = questionScore.answeredAt;
                answeredAt = at.toMillis ? at.toMillis() : (at.seconds ? at.seconds * 1000 : 0);
              } else {
                // questionScores가 없으면 결과 생성 시간 사용
                const createdAt = resultData.createdAt;
                if (createdAt) {
                  answeredAt = createdAt.toMillis ? createdAt.toMillis() : (createdAt.seconds ? createdAt.seconds * 1000 : 0);
                }
              }

              // 응답이 문제 수정 이전이면 통계에서 제외
              if (answeredAt > 0 && answeredAt < questionUpdatedAt) {
                return;
              }
            }

            if (userAnswer === undefined || userAnswer === null || userAnswer === '') {
              return; // 미응답 건너뜀
            }

            totalResponses++;

            // 정답 여부 확인
            const correctAnswer = question.answer;
            let isCorrect = false;

            if (question.type === 'ox') {
              // OX: O=0, X=1
              const userOX = String(userAnswer).toUpperCase();
              const correctOX = correctAnswer === 0 ? 'O' : 'X';
              isCorrect = userOX === correctOX || userOX === String(correctAnswer);

              // 선택 카운트
              const choiceKey = userOX === 'O' || userAnswer === 0 || userAnswer === '0' ? '0' : '1';
              choiceCounts[choiceKey] = (choiceCounts[choiceKey] || 0) + 1;
            } else if (question.type === 'multiple') {
              // 객관식
              // answers 배열은 1-indexed 문자열 ("1","2","3"...)로 저장됨 (recordAttempt CF)
              // 복수 선택: "1,3" 형태
              const rawStr = String(userAnswer);
              const selections = rawStr.includes(',')
                ? rawStr.split(',').map(s => parseInt(s.trim(), 10))
                : [typeof userAnswer === 'string' ? parseInt(userAnswer, 10) : userAnswer];

              // 1-indexed → 0-indexed 변환
              const choiceCount = question.choices?.length || 0;
              const zeroIndexed = selections.map(s => {
                // 값이 1 이상이고 choices 범위를 벗어나면 1-indexed로 판단
                if (s >= 1 && s > choiceCount - 1) return s - 1;
                // 값이 1 이상이면 1-indexed로 판단 (recordAttempt 기본 동작)
                if (s >= 1) return s - 1;
                return s;
              });

              if (Array.isArray(correctAnswer)) {
                const userSorted = [...zeroIndexed].sort();
                const correctSorted = [...correctAnswer].sort();
                isCorrect = JSON.stringify(userSorted) === JSON.stringify(correctSorted);
              } else {
                isCorrect = zeroIndexed.length === 1 && zeroIndexed[0] === correctAnswer;
              }

              // 선택 카운트 (0-indexed 기준)
              zeroIndexed.forEach(idx => {
                const choiceKey = String(idx);
                choiceCounts[choiceKey] = (choiceCounts[choiceKey] || 0) + 1;
              });
            } else {
              // 주관식/단답형
              const userStr = String(userAnswer).trim().toLowerCase();
              const correctStr = String(correctAnswer);

              // 복수 정답 지원 (|||로 구분)
              if (correctStr.includes('|||')) {
                const correctAnswers = correctStr.split('|||').map(a => a.trim().toLowerCase());
                isCorrect = correctAnswers.includes(userStr);
              } else {
                isCorrect = userStr === correctStr.trim().toLowerCase();
              }

              // 오답 수집 (소문자 정규화로 중복 제거)
              if (!isCorrect && userStr) {
                wrongAnswerSet.add(userStr);
              }
            }

            if (isCorrect) {
              correctCount++;
            }
          });

          const wrongCount = totalResponses - correctCount;
          const correctRate = totalResponses > 0 ? Math.round((correctCount / totalResponses) * 100) : 0;
          const wrongRate = totalResponses > 0 ? Math.round((wrongCount / totalResponses) * 100) : 0;

          // 선지별 통계 계산
          let choiceStats: ChoiceStats[] | undefined;
          if (question.type === 'ox') {
            choiceStats = [
              { choice: 0, count: choiceCounts['0'] || 0, percentage: totalResponses > 0 ? Math.round(((choiceCounts['0'] || 0) / totalResponses) * 100) : 0 },
              { choice: 1, count: choiceCounts['1'] || 0, percentage: totalResponses > 0 ? Math.round(((choiceCounts['1'] || 0) / totalResponses) * 100) : 0 },
            ];
          } else if (question.type === 'multiple' && question.choices) {
            choiceStats = question.choices.map((_, i) => ({
              choice: i,
              count: choiceCounts[String(i)] || 0,
              percentage: totalResponses > 0 ? Math.round(((choiceCounts[String(i)] || 0) / totalResponses) * 100) : 0,
            }));
          }

          return {
            questionId: question.id,
            questionIndex: idx,
            totalResponses,
            correctCount,
            wrongCount,
            correctRate,
            wrongRate,
            choiceStats,
            wrongAnswers: (question.type === 'subjective' || question.type === 'short_answer')
              ? Array.from(wrongAnswerSet)
              : undefined,
            isModified,
          };
        });

        // 오답률 순위 계산 (높은 순)
        const wrongRateRanking = questionStats
          .filter(s => s.totalResponses > 0)
          .map(s => ({ questionIndex: s.questionIndex, wrongRate: s.wrongRate }))
          .sort((a, b) => b.wrongRate - a.wrongRate);

        return {
          questionStats,
          wrongRateRanking,
        };
      } catch (err) {
        console.error('퀴즈 통계 조회 에러:', err);
        return null;
      }
    },
    []
  );

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

        // undefined 값 제거 (Firestore는 undefined를 허용하지 않음)
        const cleanedInput = JSON.parse(JSON.stringify(input));

        // 문제별 고유 ID 부여
        if (Array.isArray(cleanedInput.questions)) {
          cleanedInput.questions = cleanedInput.questions.map((q: any) => {
            if (q.id) return q;
            return { ...q, id: `q_${crypto.randomUUID().slice(0, 8)}` };
          });
        }

        // 문제 유형별 개수 계산
        const questions = input.questions || [];
        const oxCount = questions.filter(q => q.type === 'ox').length;
        const multipleChoiceCount = questions.filter(q => q.type === 'multiple').length;
        const subjectiveCount = questions.filter(q => q.type === 'short_answer' || q.type === 'subjective' || q.type === 'essay').length;

        const quizData = {
          ...cleanedInput,
          type: input.quizType || 'professor',
          questionCount: actualQuestionCount,
          oxCount,
          multipleChoiceCount,
          subjectiveCount,
          creatorUid,
          creatorNickname,
          participantCount: 0,
          averageScore: 0,
          bookmarkCount: 0,
          feedbackCount: 0,
          createdAt: now,
          updatedAt: now,
        };

        const docRef = await addDoc(collection(db, QUIZZES_COLLECTION), quizData);

        // 목록에 추가
        const newQuiz: ProfessorQuiz = {
          ...input,
          id: docRef.id,
          courseId: input.courseId || undefined,
          type: input.quizType || 'professor',
          questionCount: actualQuestionCount,
          creatorUid,
          creatorNickname,
          participantCount: 0,
          averageScore: 0,
          feedbackCount: 0,
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

        const raw: Record<string, unknown> = {
          ...input,
          updatedAt: Timestamp.now(),
        };

        // 문제별 고유 ID 부여 (기존 퀴즈 수정 시에도 ID 없는 문제에 부여)
        if (input.questions) {
          raw.questions = (input.questions as any[]).map((q: any) => {
            if (q.id) return q;
            return { ...q, id: `q_${crypto.randomUUID().slice(0, 8)}` };
          });
        }

        // 문제 목록이 변경되면 questionCount와 유형별 개수도 업데이트
        if (input.questions) {
          raw.questionCount = input.questionCount ?? input.questions.length;
          raw.oxCount = input.questions.filter(q => q.type === 'ox').length;
          raw.multipleChoiceCount = input.questions.filter(q => q.type === 'multiple').length;
          raw.subjectiveCount = input.questions.filter(q => q.type === 'short_answer' || q.type === 'subjective' || q.type === 'essay').length;
        }

        // Firestore는 undefined 값을 허용하지 않으므로 재귀적으로 제거
        const removeUndefined = (obj: unknown): unknown => {
          if (obj === undefined) return null;
          if (obj === null || typeof obj !== 'object') return obj;
          if (obj instanceof Timestamp || obj instanceof Date) return obj;
          if (Array.isArray(obj)) return obj.map(removeUndefined);
          const cleaned: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
            if (v !== undefined) cleaned[k] = removeUndefined(v);
          }
          return cleaned;
        };
        const updateData = removeUndefined(raw) as Record<string, unknown>;

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
                  courseId: input.courseId !== undefined ? (input.courseId || undefined) : quiz.courseId,
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
    fetchQuizStatistics,
    createQuiz,
    updateQuiz,
    deleteQuiz,
    togglePublish,
    clearError,
  };
};

export default useProfessorQuiz;
