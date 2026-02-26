'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
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

  // 게시판 활동
  boardPostCount: number;
  boardCommentCount: number;
  boardPosts: { title: string; createdAt: Date }[];
  boardCommentsList: { content: string; createdAt: Date }[];
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
  fetchStudentDetail: (uid: string, onProgress?: (partial: StudentDetail) => void) => Promise<StudentDetail | null>;
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
/** 과목 전체 정규화 데이터 캐시 (학생 클릭마다 재조회 방지) */
interface CourseNormCache {
  courseId: string;
  fetchedAt: number;
  quizCreationCounts: number[];    // 정렬 배열 (백분위용)
  communityScores: number[];
  activeReviewCounts: number[];
  expValues: number[];
  quizCreationByUid: Map<string, number>;   // uid별 lookup
  communityByUid: Map<string, number>;
  activeReviewByUid: Map<string, number>;
  studentClassMap: Map<string, ClassType>;  // uid → classId
}

/** 가중 석차 점수 캐시 (quizResults 대량 쿼리 — 별도 관리) */
interface WeightedScoreCache {
  courseId: string;
  fetchedAt: number;
  weightedScoreByUid: Map<string, number>;
}

const NORM_CACHE_TTL = 5 * 60 * 1000; // 5분


// ============================================================
// 모듈 레벨 캐시 — 과목별 Map (페이지 이동·과목 전환에도 유지)
// ============================================================
const _normCacheMap = new Map<string, CourseNormCache>();
const _weightedCacheMap = new Map<string, WeightedScoreCache>();
const _normBuildPromiseMap = new Map<string, Promise<void>>();
const _studentsSnapshotMap = new Map<string, { uid: string; totalExp: number; classId: ClassType; feedbackCount: number }[]>();
const _studentsListCacheMap = new Map<string, StudentData[]>();
/** 현재 활성 과목 */
let _activeCourseId: string | null = null;
/** 사전 빌드 디바운스 타이머 */
let _preBuildTimer: ReturnType<typeof setTimeout> | null = null;

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
      lastActiveAt: data.lastActiveAt?.toDate?.() || new Date(),
    };
  };

  /**
   * norm 캐시 보장 (과목 변경 시 사전 빌드 / 학생 클릭 시 대기)
   * 댓글 배치 쿼리 제거 → 소통 = 글×3 + 피드백×1
   */
  const ensureNormCache = useCallback(async (courseId: string): Promise<void> => {
    const existing = _normCacheMap.get(courseId);
    const isFresh = existing && Date.now() - existing.fetchedAt <= NORM_CACHE_TTL;

    // 캐시 최신 → 즉시 반환
    if (isFresh) return;

    // 이미 빌드 중 → stale 캐시 있으면 대기 안 함, 없으면 대기
    const building = _normBuildPromiseMap.get(courseId);
    if (building) {
      if (existing) return;
      await building;
      return;
    }

    // 새로 빌드
    const promise = (async () => {
      try {
        const snapshotStudents = _studentsSnapshotMap.get(courseId);

        const [allQuizzesSnap, allPostsSnap, allReviewsSnap, allQuizResultsSnap] = await Promise.all([
          getDocs(query(collection(db, 'quizzes'), where('courseId', '==', courseId))).catch(() => null),
          getDocs(query(collection(db, 'posts'), where('courseId', '==', courseId))).catch(() => null),
          getDocs(query(collection(db, 'reviews'), where('courseId', '==', courseId))).catch(() => null),
          getDocs(query(collection(db, 'quizResults'), where('courseId', '==', courseId))).catch(() => null),
        ]);

        // 학생 데이터 (onSnapshot 또는 fallback)
        let studentUids: Set<string>;
        let expMap: Map<string, number>;
        let fbCountFromDoc: Map<string, number>;
        let studentClassMap: Map<string, ClassType>;

        if (snapshotStudents) {
          studentUids = new Set(snapshotStudents.map(s => s.uid));
          expMap = new Map(snapshotStudents.map(s => [s.uid, s.totalExp]));
          fbCountFromDoc = new Map(snapshotStudents.map(s => [s.uid, s.feedbackCount]));
          studentClassMap = new Map(snapshotStudents.map(s => [s.uid, s.classId]));
        } else {
          const snap = await getDocs(
            query(collection(db, 'users'), where('role', '==', 'student'), where('courseId', '==', courseId))
          ).catch(() => null);
          const docs = snap?.docs ?? [];
          studentUids = new Set(docs.map(d => d.id));
          expMap = new Map(docs.map(d => [d.id, d.data().totalExp || 0]));
          fbCountFromDoc = new Map(docs.map(d => [d.id, d.data().feedbackCount || 0]));
          studentClassMap = new Map(docs.map(d => [d.id, (d.data().classId || 'A') as ClassType]));
        }

        // 출제력
        const quizCreationMap = new Map<string, number>();
        (allQuizzesSnap?.docs ?? []).forEach(d => {
          const creatorId = d.data().creatorId as string;
          if (creatorId && studentUids.has(creatorId))
            quizCreationMap.set(creatorId, (quizCreationMap.get(creatorId) ?? 0) + 1);
        });

        // 소통
        const postCountMap = new Map<string, number>();
        (allPostsSnap?.docs ?? []).forEach(d => {
          const authorId = d.data().authorId as string;
          if (authorId && studentUids.has(authorId))
            postCountMap.set(authorId, (postCountMap.get(authorId) ?? 0) + 1);
        });
        const communityMap = new Map<string, number>();
        studentUids.forEach(suid => {
          communityMap.set(suid, (postCountMap.get(suid) ?? 0) * 3 + (fbCountFromDoc.get(suid) ?? 0));
        });

        // 복습력
        const activeReviewMap = new Map<string, number>();
        (allReviewsSnap?.docs ?? []).forEach(d => {
          const data = d.data();
          const userId = data.userId as string;
          if (userId && studentUids.has(userId) && (data.reviewCount ?? 0) > 0)
            activeReviewMap.set(userId, (activeReviewMap.get(userId) ?? 0) + 1);
        });

        // 백분위 배열
        const quizCreationCounts = Array.from(studentUids).map(s => quizCreationMap.get(s) ?? 0).sort((a, b) => a - b);
        const communityScores = Array.from(communityMap.values()).sort((a, b) => a - b);
        const activeReviewCounts = Array.from(studentUids).map(s => activeReviewMap.get(s) ?? 0).sort((a, b) => a - b);
        const expValues = Array.from(expMap.values()).sort((a, b) => a - b);

        _normCacheMap.set(courseId, {
          courseId, fetchedAt: Date.now(),
          quizCreationCounts, communityScores, activeReviewCounts, expValues,
          quizCreationByUid: quizCreationMap, communityByUid: communityMap,
          activeReviewByUid: activeReviewMap, studentClassMap,
        });

        // 가중 석차 점수
        const PROF_TYPES = new Set(['midterm', 'final', 'past', 'professor', 'professor-ai']);
        const quizTypeMap = new Map<string, boolean>();
        (allQuizzesSnap?.docs ?? []).forEach(d => quizTypeMap.set(d.id, PROF_TYPES.has(d.data().type || '')));

        const completionsByQuiz = new Map<string, { userId: string; score: number }[]>();
        (allQuizResultsSnap?.docs ?? []).forEach(d => {
          const qr = d.data();
          if (!studentUids.has(qr.userId)) return;
          const qid = qr.quizId as string;
          if (!qid) return;
          const arr = completionsByQuiz.get(qid) ?? [];
          arr.push({ userId: qr.userId, score: qr.score ?? 0 });
          completionsByQuiz.set(qid, arr);
        });

        const studentScorePairs = new Map<string, { rankScore: number; weight: number }[]>();
        completionsByQuiz.forEach((participants, quizId) => {
          const N = participants.length;
          if (N === 0) return;
          const weight = (quizTypeMap.get(quizId) ?? false) ? 6 : 4;
          const sorted = [...participants].sort((a, b) => b.score - a.score);
          let rank = 1;
          sorted.forEach((p, idx) => {
            if (idx > 0 && sorted[idx].score < sorted[idx - 1].score) rank = idx + 1;
            const rankScore = N === 1 ? 100 : ((N - rank + 1) / N) * 100;
            const pairs = studentScorePairs.get(p.userId) ?? [];
            pairs.push({ rankScore, weight });
            studentScorePairs.set(p.userId, pairs);
          });
        });

        const weightedScoreByUid = new Map<string, number>();
        studentUids.forEach(suid => {
          const pairs = studentScorePairs.get(suid);
          if (!pairs || pairs.length === 0) { weightedScoreByUid.set(suid, 0); return; }
          const tw = pairs.reduce((s, p) => s + p.weight, 0);
          const tws = pairs.reduce((s, p) => s + p.rankScore * p.weight, 0);
          weightedScoreByUid.set(suid, Math.round((tws / tw) * 100) / 100);
        });
        _weightedCacheMap.set(courseId, { courseId, fetchedAt: Date.now(), weightedScoreByUid });
      } catch (err) {
        console.error('Norm cache build failed:', err);
      } finally {
        _normBuildPromiseMap.delete(courseId);
      }
    })();

    _normBuildPromiseMap.set(courseId, promise);

    // stale 캐시 있으면 대기 없이 반환
    if (existing) return;

    // 없으면 빌드 완료 대기
    await promise;
  }, []);

  /**
   * 학생 목록 실시간 구독 (onSnapshot) — courseId 클라이언트 필터
   */
  const subscribeStudents = useCallback((courseId: string) => {
    // 기존 구독 해제
    if (unsubRef.current) unsubRef.current();

    // 과목 전환 추적 — stale 빌드 방지
    _activeCourseId = courseId;

    // 대기 중인 사전 빌드 취소
    if (_preBuildTimer) {
      clearTimeout(_preBuildTimer);
      _preBuildTimer = null;
    }

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

    const usersRef = collection(db, 'users');
    const q = query(
      usersRef,
      where('role', '==', 'student'),
      where('courseId', '==', courseId),
      orderBy('lastActiveAt', 'desc'),
    );

    unsubRef.current = onSnapshot(
      q,
      (snapshot) => {
        const studentsList = snapshot.docs.map(convertToStudentData);
        setStudents(studentsList);
        hasLoadedRef.current = true;
        setLoading(false);

        // 모듈 레벨 캐시 갱신
        _studentsListCacheMap.set(courseId, studentsList);

        // norm 캐시용 학생 데이터 스냅샷 저장 (users 쿼리 대체)
        _studentsSnapshotMap.set(courseId, snapshot.docs.map(d => {
          const raw = d.data();
          return {
            uid: d.id,
            totalExp: raw.totalExp || 0,
            classId: (raw.classId || 'A') as ClassType,
            feedbackCount: raw.feedbackCount || 0,
          };
        }));

        // norm 캐시 사전 빌드 — 1초 디바운스 (빠른 과목 전환 시 마지막만)
        if (_preBuildTimer) clearTimeout(_preBuildTimer);
        _preBuildTimer = setTimeout(() => {
          if (_activeCourseId === courseId) {
            ensureNormCache(courseId);
          }
        }, 1000);
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
   * 학생 상세 정보 조회
   */
  const fetchStudentDetail = useCallback(async (uid: string, onProgress?: (partial: StudentDetail) => void): Promise<StudentDetail | null> => {
    currentFetchUidRef.current = uid;
    try {
      // ── Phase 0: 캐시에서 레이더 즉시 계산 (쿼리 0개, 0초) ──
      const cachedCourseId = _activeCourseId;
      const cachedStudents = cachedCourseId ? _studentsListCacheMap.get(cachedCourseId) : null;
      const cachedStudent = cachedStudents?.find(s => s.uid === uid);
      const cachedNorm = cachedCourseId ? _normCacheMap.get(cachedCourseId) : null;
      const normReady = !!(cachedStudent && cachedNorm && cachedCourseId);

      if (normReady && onProgress) {
        const snapshotEntries = _studentsSnapshotMap.get(cachedCourseId!);
        const snapshotEntry = snapshotEntries?.find(s => s.uid === uid);
        const totalExp = snapshotEntry?.totalExp ?? cachedStudent!.experience;

        const earlyRadar = {
          quizScore: cachedStudent!.quizStats.averageScore,
          growth: 50, // 성장세는 per-student 쿼리 후 업데이트
          quizCreation: rankPercentile(cachedNorm!.quizCreationByUid.get(uid) ?? 0, cachedNorm!.quizCreationCounts),
          community: rankPercentile(cachedNorm!.communityByUid.get(uid) ?? 0, cachedNorm!.communityScores),
          review: rankPercentile(cachedNorm!.activeReviewByUid.get(uid) ?? 0, cachedNorm!.activeReviewCounts),
          activity: rankPercentile(totalExp, cachedNorm!.expValues),
        };

        const wc = cachedCourseId ? _weightedCacheMap.get(cachedCourseId) : null;
        onProgress({
          ...cachedStudent!,
          recentQuizzes: [],
          recentFeedbacks: [],
          radarMetrics: earlyRadar,
          weightedScore: wc?.weightedScoreByUid.get(uid),
          classWeightedScores: (wc && cachedNorm)
            ? Array.from(wc.weightedScoreByUid.entries()).map(([suid, score]) => ({
                uid: suid,
                classId: cachedNorm!.studentClassMap.get(suid) ?? ('A' as ClassType),
                score,
              }))
            : undefined,
          boardPostCount: 0,
          boardCommentCount: 0,
          boardPosts: [],
          boardCommentsList: [],
        });
      }

      // ── Phase 1: user doc + 학생별 쿼리 병렬 (느리지만 정확한 데이터) ──
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
        currentActivity: userData.currentActivity || undefined,
        profileRabbitId: userData.profileRabbitId ?? undefined,
        feedbackCount: userData.feedbackCount || 0,
        createdAt: userData.createdAt?.toDate?.() || new Date(),
        lastActiveAt: userData.lastActiveAt?.toDate?.() || new Date(),
      };

      const courseId = userData.courseId as string;

      // ── 학생별 쿼리 병렬 실행 (권한 없는 컬렉션 방어) ──
      const [quizResultsSnap, feedbacksSnap, studentFbSnap, studentPostsSnap, studentReviewsSnap, studentCommentsSnap] = await Promise.all([
        getDocs(query(collection(db, 'quizResults'), where('userId', '==', uid))).catch(() => null),
        getDocs(query(collection(db, 'feedbacks'), where('userId', '==', uid))).catch(() => null),
        courseId ? getDocs(query(collection(db, 'questionFeedbacks'), where('userId', '==', uid))).catch(() => null) : Promise.resolve(null),
        courseId ? getDocs(query(collection(db, 'posts'), where('authorId', '==', uid))).catch(() => null) : Promise.resolve(null),
        courseId ? getDocs(query(collection(db, 'reviews'), where('userId', '==', uid))).catch(() => null) : Promise.resolve(null),
        getDocs(query(collection(db, 'comments'), where('authorId', '==', uid))).catch(() => null),
      ]);

      // 최근 퀴즈 기록 (클라이언트 정렬)
      const recentQuizzes = (quizResultsSnap?.docs ?? [])
        .map(doc => {
          const data = doc.data();
          return {
            quizId: data.quizId || '',
            quizTitle: data.quizTitle || '퀴즈',
            score: data.score || 0,
            totalQuestions: data.totalQuestions || 0,
            completedAt: data.completedAt?.toDate?.() || data.createdAt?.toDate?.() || new Date(),
          };
        })
        .sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime())
        .slice(0, 5);

      // 최근 피드백 (클라이언트 정렬)
      const recentFeedbacks = (feedbacksSnap?.docs ?? [])
        .map(doc => {
          const data = doc.data();
          return {
            feedbackId: doc.id,
            quizTitle: data.quizTitle || '퀴즈',
            content: data.content || '',
            createdAt: data.createdAt?.toDate?.() || new Date(),
          };
        })
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 5);

      // ── 게시판 활동 (per-student 데이터) ──
      const filteredPosts = courseId
        ? (studentPostsSnap?.docs ?? []).filter(d => d.data().courseId === courseId)
        : (studentPostsSnap?.docs ?? []);
      const boardPostCount = filteredPosts.length;
      const boardCommentCount = studentCommentsSnap?.size ?? 0;

      const boardPosts = filteredPosts
        .map(d => {
          const data = d.data();
          return {
            title: data.title || '',
            createdAt: data.createdAt?.toDate?.() || new Date(),
          };
        })
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 20);

      const boardCommentsList = (studentCommentsSnap?.docs ?? [])
        .map(d => {
          const data = d.data();
          return {
            content: data.content || '',
            createdAt: data.createdAt?.toDate?.() || new Date(),
          };
        })
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 20);

      // ── 성장세 (per-student 데이터만 사용 — norm 캐시 불필요) ──
      let growth = 50;
      if (courseId) {
        try {
          // Tier 1: 재시도 개선율
          const courseResults = (quizResultsSnap?.docs ?? []).filter(d => d.data().courseId === courseId);
          const byQuiz = new Map<string, { first: number; retry: number }>();
          courseResults.forEach(d => {
            const data = d.data();
            const qid = data.quizId as string;
            if (!qid) return;
            const score = data.score as number ?? 0;
            const isUpdate = data.isUpdate === true;
            const existing = byQuiz.get(qid);
            if (!existing) {
              byQuiz.set(qid, { first: isUpdate ? -1 : score, retry: isUpdate ? score : -1 });
            } else {
              if (isUpdate) existing.retry = Math.max(existing.retry, score);
              else if (existing.first < 0) existing.first = score;
            }
          });

          const improvements: number[] = [];
          byQuiz.forEach(({ first, retry }) => {
            if (first >= 0 && retry >= 0) {
              improvements.push(retry - first);
            }
          });

          let tier1 = 50;
          if (improvements.length > 0) {
            const avgImprovement = improvements.reduce((s, v) => s + v, 0) / improvements.length;
            tier1 = Math.max(0, Math.min(100, 50 + avgImprovement / 2));
          }

          // Tier 2: 챕터별 오답 극복률
          const studentReviews = (studentReviewsSnap?.docs ?? []).filter(d => d.data().courseId === courseId);
          const wrongByChapter = new Map<string, { reviewed: boolean; questionId: string }[]>();
          const solvedCorrectQuestions = new Set<string>();

          studentReviews.forEach(d => {
            const data = d.data();
            const reviewType = data.reviewType as string;
            const chapterId = (data.chapterId || data.tags?.[0] || 'unknown') as string;
            const questionId = data.questionId as string;

            if (reviewType === 'wrong') {
              const arr = wrongByChapter.get(chapterId) ?? [];
              arr.push({ reviewed: (data.reviewCount ?? 0) > 0, questionId });
              wrongByChapter.set(chapterId, arr);
            } else if (reviewType === 'solved' && data.isCorrect === true) {
              solvedCorrectQuestions.add(questionId);
            }
          });

          let tier2 = -1;
          let totalWrongReviewed = 0;
          let overcomeCount = 0;
          wrongByChapter.forEach(wrongs => {
            wrongs.forEach(w => {
              if (w.reviewed) {
                totalWrongReviewed++;
                if (solvedCorrectQuestions.has(w.questionId)) {
                  overcomeCount++;
                }
              }
            });
          });

          if (totalWrongReviewed >= 3) {
            tier2 = Math.round((overcomeCount / totalWrongReviewed) * 100);
          }

          if (tier2 >= 0) {
            growth = Math.round(tier1 * 0.4 + tier2 * 0.6);
          } else if (improvements.length > 0) {
            growth = Math.round(tier1);
          }
        } catch {
          // 성장세 계산 실패 → 기준선 유지
        }
      }

      // ── Phase 1 완료: 실제 growth로 레이더 재계산 + 상세 데이터 emit ──
      let radarMetrics: StudentDetail['radarMetrics'] = undefined;
      const existingNorm = courseId ? _normCacheMap.get(courseId) : null;
      const normAvailable = !!(courseId && existingNorm);

      if (normAvailable && existingNorm) {
        radarMetrics = {
          quizScore: baseData.quizStats.averageScore,
          growth,
          quizCreation: rankPercentile(existingNorm.quizCreationByUid.get(uid) ?? 0, existingNorm.quizCreationCounts),
          community: rankPercentile(existingNorm.communityByUid.get(uid) ?? 0, existingNorm.communityScores),
          review: rankPercentile(existingNorm.activeReviewByUid.get(uid) ?? 0, existingNorm.activeReviewCounts),
          activity: rankPercentile(userData.totalExp || 0, existingNorm.expValues),
        };
      }

      // 가중 석차 점수 (캐시에서)
      const existingWeighted = courseId ? _weightedCacheMap.get(courseId) : null;
      let weightedScore = existingWeighted?.weightedScoreByUid.get(uid);
      let classWeightedScores: StudentDetail['classWeightedScores'] = undefined;
      if (existingWeighted && existingNorm) {
        classWeightedScores = Array.from(existingWeighted.weightedScoreByUid.entries()).map(([suid, score]) => ({
          uid: suid,
          classId: existingNorm.studentClassMap.get(suid) ?? ('A' as ClassType),
          score,
        }));
      }

      // Phase 1 emit: 즉시 표시 가능한 데이터 (활동, 퀴즈 기록, 게시판 탭)
      const phase1Detail: StudentDetail = {
        ...baseData,
        recentQuizzes,
        recentFeedbacks,
        radarMetrics,
        weightedScore,
        classWeightedScores,
        boardPostCount,
        boardCommentCount,
        boardPosts,
        boardCommentsList,
      };

      if (onProgress) onProgress(phase1Detail);

      // 캐시 있으면 → 이미 완전한 데이터이므로 즉시 반환 (백그라운드 갱신은 ensureNormCache 내부에서)
      if (normAvailable && radarMetrics) {
        // stale이면 백그라운드 갱신 트리거 (대기 없음)
        ensureNormCache(courseId);
        return phase1Detail;
      }

      // ── Phase 2: 캐시 없을 때만 — 빌드 완료 후 자동 업데이트 ──
      if (courseId && onProgress) {
        ensureNormCache(courseId).then(() => {
          // 다른 학생이 선택됐으면 무시
          if (currentFetchUidRef.current !== uid) return;

          const norm = _normCacheMap.get(courseId);
          if (!norm) return;

          const fullRadar = {
            quizScore: baseData.quizStats.averageScore,
            growth,
            quizCreation: rankPercentile(norm.quizCreationByUid.get(uid) ?? 0, norm.quizCreationCounts),
            community: rankPercentile(norm.communityByUid.get(uid) ?? 0, norm.communityScores),
            review: rankPercentile(norm.activeReviewByUid.get(uid) ?? 0, norm.activeReviewCounts),
            activity: rankPercentile(userData.totalExp || 0, norm.expValues),
          };

          // 가중 석차 점수 재조회
          const wc = _weightedCacheMap.get(courseId);
          const ws = wc?.weightedScoreByUid.get(uid);
          const cws = (wc && norm)
            ? Array.from(wc.weightedScoreByUid.entries()).map(([suid, score]) => ({
                uid: suid,
                classId: norm.studentClassMap.get(suid) ?? ('A' as ClassType),
                score,
              }))
            : undefined;

          onProgress({
            ...phase1Detail,
            radarMetrics: fullRadar,
            weightedScore: ws,
            classWeightedScores: cws,
          });
        }).catch(() => {});
      }

      return phase1Detail;
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
    fetchStudentDetail,
    getClassStats,
    clearError,
  };
}
