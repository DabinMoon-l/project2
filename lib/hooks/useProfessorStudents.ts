'use client';

import { useState, useCallback } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getDocs,
  doc,
  getDoc,
  QueryDocumentSnapshot,
  DocumentData,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

// ============================================================
// 타입 정의
// ============================================================

/** 반 타입 */
export type ClassType = 'A' | 'B' | 'C' | 'D';

/** 학생 데이터 */
export interface StudentData {
  uid: string;
  nickname: string;
  studentId: string;
  classId: ClassType;

  // 통계
  level: number;
  experience: number;

  // 퀴즈 통계
  quizStats: {
    totalAttempts: number;     // 총 퀴즈 시도
    totalCorrect: number;      // 총 정답 수
    averageScore: number;      // 평균 점수
    lastAttemptAt?: Date;      // 마지막 시도 시간
  };

  // 피드백 통계
  feedbackCount: number;

  // 타임스탬프
  createdAt: Date;
  lastActiveAt: Date;
}

/** 학생 상세 정보 */
export interface StudentDetail extends StudentData {
  // 최근 퀴즈 기록
  recentQuizzes: {
    quizId: string;
    quizTitle: string;
    score: number;
    totalQuestions: number;
    completedAt: Date;
  }[];

  // 최근 피드백
  recentFeedbacks: {
    feedbackId: string;
    quizTitle: string;
    content: string;
    createdAt: Date;
  }[];
}

/** 필터 옵션 */
export interface StudentFilterOptions {
  classId?: ClassType | 'all';
  sortBy?: 'name' | 'score' | 'activity' | 'level';
  sortOrder?: 'asc' | 'desc';
  searchQuery?: string;
}

/** 훅 반환 타입 */
interface UseProfessorStudentsReturn {
  students: StudentData[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;

  fetchStudents: (options?: StudentFilterOptions) => Promise<void>;
  fetchMore: () => Promise<void>;
  fetchStudentDetail: (uid: string) => Promise<StudentDetail | null>;
  getClassStats: () => ClassStats[];
  clearError: () => void;
}

/** 반별 통계 */
export interface ClassStats {
  classId: ClassType;
  studentCount: number;
  averageScore: number;
  participationRate: number;
  topStudent?: {
    nickname: string;
    score: number;
  };
}

// ============================================================
// 상수
// ============================================================

const PAGE_SIZE = 20;

/** 반별 색상 */
export const CLASS_COLORS: Record<ClassType, string> = {
  A: '#DC2626', // 빨강
  B: '#F59E0B', // 노랑
  C: '#10B981', // 초록
  D: '#3B82F6', // 파랑
};

// ============================================================
// 훅 구현
// ============================================================

/**
 * 교수님 학생 모니터링 훅
 */
export function useProfessorStudents(): UseProfessorStudentsReturn {
  const [students, setStudents] = useState<StudentData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [currentFilter, setCurrentFilter] = useState<StudentFilterOptions>({});

  /**
   * Firestore 문서를 StudentData로 변환
   */
  const convertToStudentData = (
    docSnap: QueryDocumentSnapshot<DocumentData>
  ): StudentData => {
    const data = docSnap.data();
    return {
      uid: docSnap.id,
      nickname: data.nickname || '익명',
      studentId: data.studentId || '',
      classId: data.classId || 'A',
      level: data.level || 1,
      experience: data.experience || 0,
      quizStats: {
        totalAttempts: data.quizStats?.totalAttempts || 0,
        totalCorrect: data.quizStats?.totalCorrect || 0,
        averageScore: data.quizStats?.averageScore || 0,
        lastAttemptAt: data.quizStats?.lastAttemptAt?.toDate?.() || undefined,
      },
      feedbackCount: data.feedbackCount || 0,
      createdAt: data.createdAt?.toDate?.() || new Date(),
      lastActiveAt: data.lastActiveAt?.toDate?.() || new Date(),
    };
  };

  /**
   * 학생 목록 조회
   */
  const fetchStudents = useCallback(async (options: StudentFilterOptions = {}) => {
    try {
      setLoading(true);
      setError(null);
      setCurrentFilter(options);

      const usersRef = collection(db, 'users');
      let q = query(
        usersRef,
        where('role', '==', 'student'),
        orderBy('lastActiveAt', 'desc'),
        limit(PAGE_SIZE)
      );

      // 반별 필터 (클라이언트 사이드에서 처리)
      const snapshot = await getDocs(q);
      let studentsList = snapshot.docs.map(convertToStudentData);

      // 클라이언트 사이드 필터링
      if (options.classId && options.classId !== 'all') {
        studentsList = studentsList.filter(s => s.classId === options.classId);
      }

      // 검색어 필터
      if (options.searchQuery) {
        const query = options.searchQuery.toLowerCase();
        studentsList = studentsList.filter(
          s =>
            s.nickname.toLowerCase().includes(query) ||
            s.studentId.toLowerCase().includes(query)
        );
      }

      // 정렬
      if (options.sortBy) {
        studentsList.sort((a, b) => {
          let comparison = 0;
          switch (options.sortBy) {
            case 'name':
              comparison = a.nickname.localeCompare(b.nickname);
              break;
            case 'score':
              comparison = a.quizStats.averageScore - b.quizStats.averageScore;
              break;
            case 'activity':
              comparison = a.lastActiveAt.getTime() - b.lastActiveAt.getTime();
              break;
            case 'level':
              comparison = a.level - b.level;
              break;
          }
          return options.sortOrder === 'asc' ? comparison : -comparison;
        });
      }

      setStudents(studentsList);
      setLastDoc(snapshot.docs[snapshot.docs.length - 1] || null);
      setHasMore(snapshot.docs.length === PAGE_SIZE);
    } catch (err) {
      console.error('학생 목록 조회 실패:', err);
      setError('학생 목록을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * 추가 학생 로드
   */
  const fetchMore = useCallback(async () => {
    if (!hasMore || !lastDoc || loading) return;

    try {
      setLoading(true);

      const usersRef = collection(db, 'users');
      const q = query(
        usersRef,
        where('role', '==', 'student'),
        orderBy('lastActiveAt', 'desc'),
        startAfter(lastDoc),
        limit(PAGE_SIZE)
      );

      const snapshot = await getDocs(q);
      let newStudents = snapshot.docs.map(convertToStudentData);

      // 클라이언트 사이드 필터링
      if (currentFilter.classId && currentFilter.classId !== 'all') {
        newStudents = newStudents.filter(s => s.classId === currentFilter.classId);
      }

      if (currentFilter.searchQuery) {
        const query = currentFilter.searchQuery.toLowerCase();
        newStudents = newStudents.filter(
          s =>
            s.nickname.toLowerCase().includes(query) ||
            s.studentId.toLowerCase().includes(query)
        );
      }

      setStudents(prev => [...prev, ...newStudents]);
      setLastDoc(snapshot.docs[snapshot.docs.length - 1] || null);
      setHasMore(snapshot.docs.length === PAGE_SIZE);
    } catch (err) {
      console.error('추가 학생 로드 실패:', err);
      setError('추가 데이터를 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [hasMore, lastDoc, loading, currentFilter]);

  /**
   * 학생 상세 정보 조회
   */
  const fetchStudentDetail = useCallback(async (uid: string): Promise<StudentDetail | null> => {
    try {
      // 사용자 기본 정보
      const userRef = doc(db, 'users', uid);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        return null;
      }

      const userData = userSnap.data();
      const baseData: StudentData = {
        uid: userSnap.id,
        nickname: userData.nickname || '익명',
        studentId: userData.studentId || '',
        classId: userData.classId || 'A',
        level: userData.level || 1,
        experience: userData.experience || 0,
        quizStats: {
          totalAttempts: userData.quizStats?.totalAttempts || 0,
          totalCorrect: userData.quizStats?.totalCorrect || 0,
          averageScore: userData.quizStats?.averageScore || 0,
          lastAttemptAt: userData.quizStats?.lastAttemptAt?.toDate?.() || undefined,
        },
        feedbackCount: userData.feedbackCount || 0,
        createdAt: userData.createdAt?.toDate?.() || new Date(),
        lastActiveAt: userData.lastActiveAt?.toDate?.() || new Date(),
      };

      // 최근 퀴즈 기록 조회
      const quizResultsRef = collection(db, 'quizResults');
      const quizResultsQuery = query(
        quizResultsRef,
        where('userId', '==', uid),
        orderBy('completedAt', 'desc'),
        limit(5)
      );
      const quizResultsSnap = await getDocs(quizResultsQuery);

      const recentQuizzes = quizResultsSnap.docs.map(doc => {
        const data = doc.data();
        return {
          quizId: data.quizId || '',
          quizTitle: data.quizTitle || '퀴즈',
          score: data.score || 0,
          totalQuestions: data.totalQuestions || 0,
          completedAt: data.completedAt?.toDate?.() || new Date(),
        };
      });

      // 최근 피드백 조회
      const feedbacksRef = collection(db, 'feedbacks');
      const feedbacksQuery = query(
        feedbacksRef,
        where('userId', '==', uid),
        orderBy('createdAt', 'desc'),
        limit(5)
      );
      const feedbacksSnap = await getDocs(feedbacksQuery);

      const recentFeedbacks = feedbacksSnap.docs.map(doc => {
        const data = doc.data();
        return {
          feedbackId: doc.id,
          quizTitle: data.quizTitle || '퀴즈',
          content: data.content || '',
          createdAt: data.createdAt?.toDate?.() || new Date(),
        };
      });

      return {
        ...baseData,
        recentQuizzes,
        recentFeedbacks,
      };
    } catch (err) {
      console.error('학생 상세 정보 조회 실패:', err);
      return null;
    }
  }, []);

  /**
   * 반별 통계 계산
   */
  const getClassStats = useCallback((): ClassStats[] => {
    const classMap = new Map<ClassType, StudentData[]>();

    // 반별로 그룹화
    (['A', 'B', 'C', 'D'] as ClassType[]).forEach(classId => {
      classMap.set(classId, []);
    });

    students.forEach(student => {
      const list = classMap.get(student.classId);
      if (list) {
        list.push(student);
      }
    });

    // 통계 계산
    return (['A', 'B', 'C', 'D'] as ClassType[]).map(classId => {
      const classStudents = classMap.get(classId) || [];
      const studentCount = classStudents.length;

      if (studentCount === 0) {
        return {
          classId,
          studentCount: 0,
          averageScore: 0,
          participationRate: 0,
        };
      }

      const totalScore = classStudents.reduce(
        (sum, s) => sum + s.quizStats.averageScore,
        0
      );
      const averageScore = Math.round(totalScore / studentCount);

      // 최근 7일 내 활동한 학생 수로 참여율 계산
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const activeCount = classStudents.filter(
        s => s.lastActiveAt >= weekAgo
      ).length;
      const participationRate = Math.round((activeCount / studentCount) * 100);

      // 최고 점수 학생
      const topStudent = classStudents.reduce((top, s) => {
        if (!top || s.quizStats.averageScore > top.quizStats.averageScore) {
          return s;
        }
        return top;
      }, null as StudentData | null);

      return {
        classId,
        studentCount,
        averageScore,
        participationRate,
        topStudent: topStudent ? {
          nickname: topStudent.nickname,
          score: topStudent.quizStats.averageScore,
        } : undefined,
      };
    });
  }, [students]);

  /**
   * 에러 초기화
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    students,
    loading,
    error,
    hasMore,
    fetchStudents,
    fetchMore,
    fetchStudentDetail,
    getClassStats,
    clearError,
  };
}
