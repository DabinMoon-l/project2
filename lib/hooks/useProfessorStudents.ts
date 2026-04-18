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
  db,
  type QueryDocumentSnapshot,
  type DocumentData,
} from '@/lib/repositories';
import type { Unsubscribe } from '@/lib/repositories';
import { rankingRepo } from '@/lib/repositories';
import { ref as rtdbRef, onValue, off as rtdbOff } from 'firebase/database';
import { getRtdb } from '@/lib/firebase';
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
  totalExp: number;

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

  // 종합 역량 레이더 메트릭 (5축, 전부 백분위 0~100)
  radarMetrics?: {
    quizScore: number;      // 퀴즈 성적 (가중 석차 백분위)
    battle: number;         // 배틀 (승수 백분위)
    quizCreation: number;   // 출제력 (백분위)
    community: number;      // 소통 (백분위)
    activity: number;       // 활동량 (백분위)
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

/** radarNorm 데이터 (과목별) — 2시간마다 스케줄러 갱신이라 getDoc 1회 로드로 충분 */
const _radarNormMap = new Map<string, RadarNormData>();
/** radarNorm 마지막 fetch 시각 (과목별) — 재방문 시 TTL 기반 재사용 */
const _radarNormFetchedAtMap = new Map<string, number>();
/** radarNorm TTL (10분) — 스케줄러 2h 주기 대비 충분히 신선함 */
const RADAR_NORM_TTL = 10 * 60 * 1000;

/**
 * RTDB presence 데이터 (과목별) — 학생 uid → { lastActiveAt, currentActivity }
 * useActivityTracker가 RTDB `presence/{courseId}/{uid}`에 120초마다 쓰고, onDisconnect로 정리.
 * 교수 화면은 이 맵을 Firestore users 데이터에 덮어써서 온라인/활동 UI를 렌더.
 */
interface PresenceEntry { lastActiveAt: Date; currentActivity?: string }
const _presenceMap = new Map<string, Map<string, PresenceEntry>>();
/** RTDB presence 구독 해제 함수 (과목별) */
const _presenceUnsubMap = new Map<string, () => void>();

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
  totalExp: number,
): NonNullable<StudentDetail['radarMetrics']> {
  return {
    quizScore: norm.weightedScoreByUid[uid] ?? 0, // 교수 퀴즈 평균 점수 (원점수 0~100)
    battle: rankPercentile(norm.battleByUid?.[uid] ?? 0, norm.battleValues ?? []),
    quizCreation: rankPercentile(norm.quizCreationByUid[uid] ?? 0, norm.quizCreationCounts),
    community: rankPercentile(norm.communityByUid[uid] ?? 0, norm.communityScores),
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
  // presence-only 변경 시 30초 간격 flush (온라인 정렬 갱신용)
  const lastPresenceFlushRef = useRef(0);

  // 현재 fetchStudentDetail이 처리 중인 uid (stale 콜백 방지)
  const currentFetchUidRef = useRef<string | null>(null);

  /**
   * Firestore 문서 → StudentData 변환. presence(lastActiveAt/currentActivity)는
   * RTDB `presence/{courseId}/{uid}`가 권위 소스이므로 있으면 덮어씀.
   * presence가 없으면(오프라인) Firestore의 legacy 값 또는 new Date(0) 폴백.
   */
  const convertToStudentData = (
    docSnap: QueryDocumentSnapshot<DocumentData>,
    courseId: string,
  ): StudentData => {
    const data = docSnap.data();
    const presence = _presenceMap.get(courseId)?.get(docSnap.id);
    return {
      uid: docSnap.id,
      name: data.name || undefined,
      nickname: data.nickname || '익명',
      studentId: data.studentId || '',
      classId: data.classId || 'A',
      level: data.level || 1,
      totalExp: data.totalExp || 0,
      quizStats: {
        totalAttempts: data.quizStats?.totalAttempts || 0,
        totalCorrect: data.quizStats?.totalCorrect || 0,
        averageScore: data.quizStats?.averageScore || 0,
        lastAttemptAt: data.quizStats?.lastAttemptAt?.toDate?.() || undefined,
      },
      currentActivity: presence?.currentActivity ?? (data.currentActivity || undefined),
      profileRabbitId: data.profileRabbitId ?? undefined,
      feedbackCount: data.feedbackCount || 0,
      createdAt: data.createdAt?.toDate?.() || new Date(),
      lastActiveAt: presence?.lastActiveAt ?? (data.lastActiveAt?.toDate?.() || new Date(0)),
    };
  };

  /**
   * 학생 목록 실시간 구독 (onSnapshot) + radarNorm 구독
   */
  const subscribeStudents = useCallback((courseId: string) => {
    // 기존 구독 해제
    if (unsubRef.current) unsubRef.current();

    // 이전 과목 presence 리스너 정리 (현재 과목 제외)
    _presenceUnsubMap.forEach((unsub, prevCourseId) => {
      if (prevCourseId !== courseId) {
        unsub();
        _presenceUnsubMap.delete(prevCourseId);
        _presenceMap.delete(prevCourseId);
      }
    });

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

    // radarNorm — 2시간마다 스케줄러가 갱신하므로 실시간 리스너 불필요.
    // TTL(10분) 지났거나 캐시 없으면 1회 fetch (Feature flag → Firestore/Supabase).
    const lastFetched = _radarNormFetchedAtMap.get(courseId) ?? 0;
    if (Date.now() - lastFetched > RADAR_NORM_TTL) {
      _radarNormFetchedAtMap.set(courseId, Date.now());
      rankingRepo.getRadarNorm(courseId)
        .then((data) => {
          if (data) {
            const typed = data as unknown as RadarNormData;
            _radarNormMap.set(courseId, typed);
            writeRadarNormCache(courseId, typed);
          }
        })
        .catch((err) => {
          console.error('radarNorm 로드 실패:', err);
        });
    }

    // orderBy 제거: 학생 정렬은 클라이언트에서 studentId 순으로 수행.
    // 또한 presence(lastActiveAt/currentActivity)는 RTDB로 분리되어
    // 학생 heartbeat가 더 이상 Firestore users 문서를 변경하지 않음 →
    // onSnapshot 트리거가 실제 의미 있는 변경(닉네임/반/EXP/퀴즈통계)에만 발동.
    const usersRef = collection(db, 'users');
    const q = query(
      usersRef,
      where('role', '==', 'student'),
      where('courseId', '==', courseId),
    );

    // docChanges() 활용: 변경된 문서만 증분 업데이트
    const studentsMap = new Map<string, ReturnType<typeof convertToStudentData>>();

    /** presence(RTDB) 변경 시 studentsMap을 재병합해 setStudents 트리거 */
    const applyPresenceOverlay = () => {
      const presenceForCourse = _presenceMap.get(courseId);
      if (!presenceForCourse) return;
      for (const [uid, entry] of studentsMap.entries()) {
        const p = presenceForCourse.get(uid);
        studentsMap.set(uid, {
          ...entry,
          lastActiveAt: p?.lastActiveAt ?? entry.lastActiveAt,
          currentActivity: p?.currentActivity ?? entry.currentActivity,
        });
      }
      const studentsList = Array.from(studentsMap.values());
      setStudents(studentsList);
      _studentsListCacheMap.set(courseId, studentsList);
    };

    // RTDB presence 구독 (과목별 1개 유지) — heartbeat를 Firestore 트리거 없이 실시간 수신
    if (!_presenceUnsubMap.has(courseId)) {
      const presenceRootRef = rtdbRef(getRtdb(), `presence/${courseId}`);
      const listener = onValue(
        presenceRootRef,
        (snap) => {
          const val = snap.val() as Record<string, { lastActiveAt?: number; currentActivity?: string }> | null;
          const next = new Map<string, PresenceEntry>();
          if (val) {
            for (const [uid, entry] of Object.entries(val)) {
              next.set(uid, {
                lastActiveAt: entry?.lastActiveAt ? new Date(entry.lastActiveAt) : new Date(0),
                currentActivity: entry?.currentActivity,
              });
            }
          }
          _presenceMap.set(courseId, next);
          // 30초 throttle — 너무 자주 setStudents 안 하도록
          const now = Date.now();
          if (now - lastPresenceFlushRef.current < 30_000) return;
          lastPresenceFlushRef.current = now;
          if (hasLoadedRef.current) applyPresenceOverlay();
        },
        (err) => {
          console.error('presence 구독 실패:', err);
        },
      );
      _presenceUnsubMap.set(courseId, () => {
        rtdbOff(presenceRootRef, 'value', listener);
      });
    } else if (hasLoadedRef.current) {
      // 이미 구독 중이면 기존 맵으로 초기 오버레이 적용
      applyPresenceOverlay();
    }

    unsubRef.current = onSnapshot(
      q,
      (snapshot) => {
        const changes = snapshot.docChanges();

        if (changes.length === 0 && studentsMap.size > 0) return;

        // 첫 스냅샷이면 전체 로드 (docChanges가 전부 'added')
        if (!hasLoadedRef.current) {
          snapshot.docs.forEach(d => studentsMap.set(d.id, convertToStudentData(d, courseId)));
        } else {
          // 증분 업데이트: 변경된 문서만 처리
          for (const change of changes) {
            if (change.type === 'removed') {
              studentsMap.delete(change.doc.id);
            } else {
              studentsMap.set(change.doc.id, convertToStudentData(change.doc, courseId));
            }
          }
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
            uid, norm, norm.expByUid[uid] ?? cached.detail.totalExp,
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
      const totalExp = norm.expByUid[uid] ?? student.totalExp;
      return {
        ...student,
        recentQuizzes: [],
        recentFeedbacks: [],
        radarMetrics: computeRadarFromNorm(uid, norm, totalExp),
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

      // 전체 퀴즈 결과 가져오기 (중복 제출 대비 quizId 기준 중복 제거)
      const [quizResultsSnap, feedbacksSnap] = await Promise.all([
        courseId
          ? getDocs(query(
              collection(db, 'quizResults'),
              where('userId', '==', uid),
              where('courseId', '==', courseId),
              orderBy('createdAt', 'desc'),
            )).catch(() => null)
          : Promise.resolve(null),
        getDocs(query(
          collection(db, 'feedbacks'),
          where('userId', '==', uid),
          orderBy('createdAt', 'desc'),
          limit(5),
        )).catch(() => null),
      ]);

      // quizId 기준 중복 제거 (최신 1건만 유지, createdAt desc이므로 첫 등장이 최신)
      const seenQuizIds = new Set<string>();
      const recentQuizzes: { quizId: string; quizTitle: string; score: number; totalQuestions: number; completedAt: Date }[] = [];
      for (const d of (quizResultsSnap?.docs ?? [])) {
        const data = d.data();
        const qid = data.quizId || '';
        if (seenQuizIds.has(qid)) continue;
        seenQuizIds.add(qid);
        recentQuizzes.push({
          quizId: qid,
          quizTitle: data.quizTitle || '퀴즈',
          score: data.score || 0,
          totalQuestions: data.totalQuestions || 0,
          completedAt: data.completedAt?.toDate?.() || data.createdAt?.toDate?.() || new Date(),
        });
      }

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
        ? computeRadarFromNorm(uid, norm, norm.expByUid[uid] ?? baseData.totalExp)
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
