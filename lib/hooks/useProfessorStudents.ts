'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  doc,
  getDoc,
  onSnapshot,
  QueryDocumentSnapshot,
  DocumentData,
  Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { rankPercentile } from '@/lib/utils/statistics';
import { RadarNormData, readRadarNormCache, writeRadarNormCache } from '@/lib/utils/radarNormCache';

// ============================================================
// 타입 정의
// ============================================================

/** 반 타입 */
export type ClassType = 'A' | 'B' | 'C' | 'D';

/** 학생 데이터 */
export interface StudentData {
  uid: string;
  name?: string;          // 실명 (교수 등록 이름)
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

  // 활동 정보
  currentActivity?: string;   // '퀴즈 풀이', '복습', '게시판' 등
  profileRabbitId?: number;   // 프로필 토끼 ID (0~79)

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

  // 종합 역량 레이더 메트릭 (정규화 0~100)
  radarMetrics?: {
    quizScore: number;      // 정답률 (0-100 절대값)
    growth: number;         // 성장세 (0-100, 50=기준선)
    quizCreation: number;   // 출제력 (0-100 백분위)
    community: number;      // 소통 (0-100 백분위)
    review: number;         // 복습력 (0-100 백분위)
    activity: number;       // 활동량 (0-100 백분위)
  };

  // 가중 석차 점수 (교수 퀴즈 ×6, 학생 퀴즈 ×4)
  weightedScore?: number;
  classWeightedScores?: { uid: string; classId: ClassType; score: number }[];

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

  subscribeStudents: (courseId: string) => void;
  /** 캐시에서 동기적으로 즉시 데이터 반환 (쿼리 0개) */
  getInstantDetail: (uid: string) => StudentDetail | null;
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
// 모듈 레벨 캐시 — 과목별 Map (페이지 이동·과목 전환에도 유지)
// ============================================================
const _studentsListCacheMap = new Map<string, StudentData[]>();
/** 현재 활성 과목 */
let _activeCourseId: string | null = null;

/** radarNorm onSnapshot 데이터 (과목별) */
const _radarNormMap = new Map<string, RadarNormData>();
/** radarNorm onSnapshot 구독 해제 함수 (과목별) */
const _radarNormUnsubMap = new Map<string, Unsubscribe>();

/** 학생 상세 캐시 — 재클릭 시 쿼리 0개 즉시 표시 */
const _studentDetailCacheMap = new Map<string, { detail: StudentDetail; ts: number }>();
const DETAIL_CACHE_TTL = 5 * 60 * 1000; // 5분

// ============================================================
// 훅 구현
// ============================================================

/**
 * norm 데이터(Record)에서 레이더 메트릭 계산
 */
function computeRadarFromNorm(
  uid: string,
  norm: RadarNormData,
  quizScore: number,
  totalExp: number,
): NonNullable<StudentDetail['radarMetrics']> {
  // 성장세: norm에 growthByUid가 있으면 사용, 없으면 50(기준선)
  const growth = norm.growthByUid?.[uid] ?? 50;
  return {
    quizScore,
    growth,
    quizCreation: rankPercentile(norm.quizCreationByUid[uid] ?? 0, norm.quizCreationCounts),
    community: rankPercentile(norm.communityByUid[uid] ?? 0, norm.communityScores),
    review: rankPercentile(norm.activeReviewByUid[uid] ?? 0, norm.activeReviewCounts),
    activity: rankPercentile(totalExp, norm.expValues),
  };
}

/**
 * norm 데이터에서 classWeightedScores 배열 생성
 */
function buildClassWeightedScores(norm: RadarNormData): { uid: string; classId: ClassType; score: number }[] {
  return Object.entries(norm.weightedScoreByUid).map(([suid, score]) => ({
    uid: suid,
    classId: (norm.studentClassMap[suid] ?? 'A') as ClassType,
    score,
  }));
}

/**
 * 교수님 학생 모니터링 훅
 */
export function useProfessorStudents(): UseProfessorStudentsReturn {
  const [students, setStudents] = useState<StudentData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // onSnapshot 구독 해제용
  const unsubRef = useRef<Unsubscribe | null>(null);
  // 첫 로드 완료 여부 (과목 전환 시 스피너 방지)
  const hasLoadedRef = useRef(false);

  // 현재 fetchStudentDetail이 처리 중인 uid (stale 콜백 방지)
  const currentFetchUidRef = useRef<string | null>(null);

  /**
   * Firestore 문서를 StudentData로 변환
   */
  const convertToStudentData = (
    docSnap: QueryDocumentSnapshot<DocumentData>
  ): StudentData => {
    const data = docSnap.data();
    return {
      uid: docSnap.id,
      name: data.name || undefined,
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
      currentActivity: data.currentActivity || undefined,
      profileRabbitId: data.profileRabbitId ?? undefined,
      feedbackCount: data.feedbackCount || 0,
      createdAt: data.createdAt?.toDate?.() || new Date(),
      lastActiveAt: data.lastActiveAt?.toDate?.() || new Date(0),
    };
  };

  /**
   * 학생 목록 실시간 구독 (onSnapshot) + radarNorm 구독
   */
  const subscribeStudents = useCallback((courseId: string) => {
    // 기존 구독 해제
    if (unsubRef.current) unsubRef.current();

    // 과목 전환 추적
    _activeCourseId = courseId;

    // 캐시 즉시 복원 — 스피너 없이 이전 데이터 즉시 표시
    const cachedList = _studentsListCacheMap.get(courseId);
    if (cachedList && cachedList.length > 0) {
      setStudents(cachedList);
      hasLoadedRef.current = true;
      setLoading(false);
    } else {
      // 다른 과목 → 이전 학생 목록 즉시 제거 + 스피너
      setStudents([]);
      setLoading(true);
    }
    setError(null);

    // sessionStorage에서 radarNorm 캐시 즉시 복원
    if (!_radarNormMap.has(courseId)) {
      const { data: cached } = readRadarNormCache(courseId);
      if (cached) {
        _radarNormMap.set(courseId, cached);
      }
    }

    // radarNorm/{courseId} onSnapshot 구독 (이미 구독 중이면 스킵)
    if (!_radarNormUnsubMap.has(courseId)) {
      const normDocRef = doc(db, 'radarNorm', courseId);
      const normUnsub = onSnapshot(
        normDocRef,
        (snapshot) => {
          if (snapshot.exists()) {
            const data = snapshot.data() as RadarNormData;
            _radarNormMap.set(courseId, data);
            writeRadarNormCache(courseId, data);
          }
        },
        (err) => {
          console.error('radarNorm 구독 실패:', err);
        },
      );
      _radarNormUnsubMap.set(courseId, normUnsub);
    }

    // orderBy 제거: 학생 정렬은 클라이언트에서 studentId 순으로 수행
    // orderBy('lastActiveAt', 'desc')가 있으면 학생마다 하트비트 쓰기 시 Firestore가
    // 정렬 순서 재평가 → onSnapshot 트리거 빈도 폭증
    const usersRef = collection(db, 'users');
    const q = query(
      usersRef,
      where('role', '==', 'student'),
      where('courseId', '==', courseId),
    );

    // docChanges() 활용: 변경된 문서만 증분 업데이트
    const studentsMap = new Map<string, ReturnType<typeof convertToStudentData>>();

    unsubRef.current = onSnapshot(
      q,
      (snapshot) => {
        const changes = snapshot.docChanges();

        if (changes.length === 0 && studentsMap.size > 0) return;

        // 첫 스냅샷이면 전체 로드 (docChanges가 전부 'added')
        if (!hasLoadedRef.current) {
          snapshot.docs.forEach(d => studentsMap.set(d.id, convertToStudentData(d)));
        } else {
          // 증분 업데이트: 변경된 문서만 처리
          let hasNonActivityChange = false;
          for (const change of changes) {
            if (change.type === 'removed') {
              studentsMap.delete(change.doc.id);
              hasNonActivityChange = true;
            } else {
              const newData = convertToStudentData(change.doc);
              const existing = studentsMap.get(change.doc.id);
              studentsMap.set(change.doc.id, newData);

              // lastActiveAt/currentActivity만 변경된 경우 리렌더 스킵
              if (existing && change.type === 'modified') {
                const isPresenceOnly =
                  existing.nickname === newData.nickname &&
                  existing.classId === newData.classId &&
                  existing.experience === newData.experience &&
                  existing.quizStats.totalAttempts === newData.quizStats.totalAttempts &&
                  existing.quizStats.averageScore === newData.quizStats.averageScore &&
                  existing.feedbackCount === newData.feedbackCount;
                if (!isPresenceOnly) hasNonActivityChange = true;
              } else {
                hasNonActivityChange = true;
              }
            }
          }

          // 접속 상태만 변경된 경우 setStudents 호출 스킵 (리렌더 방지)
          if (!hasNonActivityChange) return;
        }

        const studentsList = Array.from(studentsMap.values());
        setStudents(studentsList);
        hasLoadedRef.current = true;
        setLoading(false);

        // 모듈 레벨 캐시 갱신
        _studentsListCacheMap.set(courseId, studentsList);
      },
      (err) => {
        console.error('학생 목록 실시간 구독 실패:', err);
        setError('학생 목록을 불러오는데 실패했습니다.');
        setLoading(false);
      },
    );
  }, []);

  // 컴포넌트 언마운트 시 구독 해제
  useEffect(() => {
    return () => {
      if (unsubRef.current) unsubRef.current();
    };
  }, []);

  /**
   * 캐시에서 동기적으로 즉시 StudentDetail 반환 (쿼리 0개, 0ms)
   * 모달 열기 전에 호출하여 레이더 + 학업 성취 데이터를 즉시 표시
   */
  const getInstantDetail = useCallback((uid: string): StudentDetail | null => {
    const courseId = _activeCourseId;
    if (!courseId) return null;

    const norm = _radarNormMap.get(courseId);

    // 1순위: 상세 캐시 (재클릭 시 전체 데이터 즉시)
    const cached = _studentDetailCacheMap.get(`${courseId}_${uid}`);
    if (cached && Date.now() - cached.ts < DETAIL_CACHE_TTL) {
      if (norm) {
        return {
          ...cached.detail,
          radarMetrics: computeRadarFromNorm(
            uid, norm, cached.detail.quizStats.averageScore,
            norm.expByUid[uid] ?? cached.detail.experience,
          ),
          weightedScore: norm.weightedScoreByUid[uid],
          classWeightedScores: buildClassWeightedScores(norm),
        };
      }
      return cached.detail;
    }

    // 2순위: 목록 캐시 + norm → 레이더 + 학업 성취만 즉시
    const students = _studentsListCacheMap.get(courseId);
    const student = students?.find(s => s.uid === uid);
    if (student && norm) {
      const totalExp = norm.expByUid[uid] ?? student.experience;
      return {
        ...student,
        recentQuizzes: [],
        recentFeedbacks: [],
        radarMetrics: computeRadarFromNorm(uid, norm, student.quizStats.averageScore, totalExp),
        weightedScore: norm.weightedScoreByUid[uid],
        classWeightedScores: buildClassWeightedScores(norm),
      };
    }

    return null;
  }, []);

  /**
   * 학생 상세 정보 조회 (비동기 — 보충 데이터만)
   * 레이더/학업 성취는 getInstantDetail()에서 이미 즉시 제공됨
   * 여기서는 recentQuizzes, recentFeedbacks만 가져옴
   */
  const fetchStudentDetail = useCallback(async (uid: string): Promise<StudentDetail | null> => {
    currentFetchUidRef.current = uid;
    try {
      const courseId = _activeCourseId || '';
      const cachedStudents = courseId ? _studentsListCacheMap.get(courseId) : null;
      const baseData = cachedStudents?.find(s => s.uid === uid);
      if (!baseData) return null;

      // 경량 쿼리: 최근 5개만 (limit)
      const [quizResultsSnap, feedbacksSnap] = await Promise.all([
        courseId
          ? getDocs(query(
              collection(db, 'quizResults'),
              where('userId', '==', uid),
              where('courseId', '==', courseId),
              orderBy('createdAt', 'desc'),
              limit(5),
            )).catch(() => null)
          : Promise.resolve(null),
        getDocs(query(
          collection(db, 'feedbacks'),
          where('userId', '==', uid),
          orderBy('createdAt', 'desc'),
          limit(5),
        )).catch(() => null),
      ]);

      const recentQuizzes = (quizResultsSnap?.docs ?? []).map(d => {
        const data = d.data();
        return {
          quizId: data.quizId || '',
          quizTitle: data.quizTitle || '퀴즈',
          score: data.score || 0,
          totalQuestions: data.totalQuestions || 0,
          completedAt: data.completedAt?.toDate?.() || data.createdAt?.toDate?.() || new Date(),
        };
      });

      const recentFeedbacks = (feedbacksSnap?.docs ?? []).map(d => {
        const data = d.data();
        return {
          feedbackId: d.id,
          quizTitle: data.quizTitle || '퀴즈',
          content: data.content || '',
          createdAt: data.createdAt?.toDate?.() || new Date(),
        };
      });

      // radarNorm에서 레이더 계산 (있으면)
      const norm = courseId ? _radarNormMap.get(courseId) : null;
      const radarMetrics = norm
        ? computeRadarFromNorm(uid, norm, baseData.quizStats.averageScore, norm.expByUid[uid] ?? baseData.experience)
        : undefined;

      const detail: StudentDetail = {
        ...baseData,
        recentQuizzes,
        recentFeedbacks,
        radarMetrics,
        weightedScore: norm?.weightedScoreByUid[uid],
        classWeightedScores: norm ? buildClassWeightedScores(norm) : undefined,
      };

      // 캐시 저장
      if (courseId) {
        _studentDetailCacheMap.set(`${courseId}_${uid}`, { detail, ts: Date.now() });
      }

      return detail;
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
    subscribeStudents,
    getInstantDetail,
    fetchStudentDetail,
    getClassStats,
    clearError,
  };
}
