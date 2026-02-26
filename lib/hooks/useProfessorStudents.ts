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

  subscribeStudents: () => void;
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
}

const NORM_CACHE_TTL = 5 * 60 * 1000; // 5분

export function useProfessorStudents(): UseProfessorStudentsReturn {
  const [students, setStudents] = useState<StudentData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // onSnapshot 구독 해제용
  const unsubRef = useRef<Unsubscribe | null>(null);

  // 과목 전체 정규화 데이터 캐시 (5분 TTL)
  const normCacheRef = useRef<CourseNormCache | null>(null);

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
   * 학생 목록 실시간 구독 (onSnapshot)
   */
  const subscribeStudents = useCallback(() => {
    // 기존 구독 해제
    if (unsubRef.current) unsubRef.current();

    setLoading(true);
    setError(null);

    const usersRef = collection(db, 'users');
    const q = query(
      usersRef,
      where('role', '==', 'student'),
      orderBy('lastActiveAt', 'desc'),
    );

    unsubRef.current = onSnapshot(
      q,
      (snapshot) => {
        const studentsList = snapshot.docs.map(convertToStudentData);
        setStudents(studentsList);
        setLoading(false);
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

      // ── 레이더 메트릭 (과목 전체 데이터는 5분 캐시) ──
      let radarMetrics: StudentDetail['radarMetrics'] = undefined;
      try {
        if (courseId) {
          // 캐시 유효성 확인 (같은 과목 + TTL 이내)
          let norm = normCacheRef.current;
          if (!norm || norm.courseId !== courseId || Date.now() - norm.fetchedAt > NORM_CACHE_TTL) {
            // 과목 전체 정규화 데이터 병렬 조회
            const [allStudentsSnap, allQuizzesSnap, allPostsSnap, allFbSnap, allReviewsSnap] = await Promise.all([
              getDocs(query(collection(db, 'users'), where('role', '==', 'student'))).catch(() => null),
              getDocs(query(collection(db, 'quizzes'), where('courseId', '==', courseId))).catch(() => null),
              getDocs(query(collection(db, 'posts'), where('courseId', '==', courseId))).catch(() => null),
              getDocs(query(collection(db, 'questionFeedbacks'), where('courseId', '==', courseId))).catch(() => null),
              getDocs(query(collection(db, 'reviews'), where('courseId', '==', courseId))).catch(() => null),
            ]);

            const courseStudentDocs = (allStudentsSnap?.docs ?? []).filter(d => d.data().courseId === courseId);
            const studentUids = new Set(courseStudentDocs.map(d => d.id));

            // 출제력: 학생이 만든 퀴즈 수 (creatorId가 학생 uid인 것)
            const quizCreationMap = new Map<string, number>();
            (allQuizzesSnap?.docs ?? []).forEach(d => {
              const creatorId = d.data().creatorId as string;
              if (creatorId && studentUids.has(creatorId)) {
                quizCreationMap.set(creatorId, (quizCreationMap.get(creatorId) ?? 0) + 1);
              }
            });

            // 소통: 글×3 + 댓글×2 + 피드백×1
            const postCountMap = new Map<string, number>();
            const postIds: string[] = [];
            (allPostsSnap?.docs ?? []).forEach(d => {
              const authorId = d.data().authorId as string;
              if (authorId && studentUids.has(authorId)) {
                postCountMap.set(authorId, (postCountMap.get(authorId) ?? 0) + 1);
              }
              postIds.push(d.id);
            });

            // 댓글 배치 조회 (10개씩 — Firestore in 제한)
            const commentCountMap = new Map<string, number>();
            if (postIds.length > 0) {
              const commentBatches = [];
              for (let i = 0; i < postIds.length; i += 10) {
                commentBatches.push(postIds.slice(i, i + 10));
              }
              const commentResults = await Promise.all(
                commentBatches.map(batch =>
                  getDocs(query(collection(db, 'comments'), where('postId', 'in', batch))).catch(() => null)
                )
              );
              commentResults.forEach(snap => {
                (snap?.docs ?? []).forEach(d => {
                  const authorId = d.data().authorId as string;
                  if (authorId && studentUids.has(authorId)) {
                    commentCountMap.set(authorId, (commentCountMap.get(authorId) ?? 0) + 1);
                  }
                });
              });
            }

            const fbCountMap = new Map<string, number>();
            (allFbSnap?.docs ?? []).forEach(d => {
              const userId = d.data().userId as string;
              if (userId && studentUids.has(userId)) {
                fbCountMap.set(userId, (fbCountMap.get(userId) ?? 0) + 1);
              }
            });

            // 소통 점수 합산
            const communityMap = new Map<string, number>();
            studentUids.forEach(suid => {
              const score = (postCountMap.get(suid) ?? 0) * 3
                + (commentCountMap.get(suid) ?? 0) * 2
                + (fbCountMap.get(suid) ?? 0) * 1;
              communityMap.set(suid, score);
            });

            // 복습력: reviewCount > 0인 복습 수
            const activeReviewMap = new Map<string, number>();
            (allReviewsSnap?.docs ?? []).forEach(d => {
              const data = d.data();
              const userId = data.userId as string;
              if (userId && studentUids.has(userId) && (data.reviewCount ?? 0) > 0) {
                activeReviewMap.set(userId, (activeReviewMap.get(userId) ?? 0) + 1);
              }
            });

            // EXP 값 수집
            const expMap = new Map<string, number>();
            courseStudentDocs.forEach(d => {
              expMap.set(d.id, d.data().totalExp || 0);
            });

            // 정렬 배열 생성 (백분위용)
            const quizCreationCounts = Array.from(studentUids).map(s => quizCreationMap.get(s) ?? 0).sort((a, b) => a - b);
            const communityScores = Array.from(communityMap.values()).sort((a, b) => a - b);
            const activeReviewCounts = Array.from(studentUids).map(s => activeReviewMap.get(s) ?? 0).sort((a, b) => a - b);
            const expValues = Array.from(expMap.values()).sort((a, b) => a - b);

            norm = {
              courseId,
              fetchedAt: Date.now(),
              quizCreationCounts,
              communityScores,
              activeReviewCounts,
              expValues,
              quizCreationByUid: quizCreationMap,
              communityByUid: communityMap,
              activeReviewByUid: activeReviewMap,
            };
            normCacheRef.current = norm;
          }

          // ── 성장세 (Tier1: 재시도 개선율 + Tier2: 오답 극복률) ──
          let growth = 50; // 기준선
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
              // [-100, +100] → [0, 100]
              tier1 = Math.max(0, Math.min(100, 50 + avgImprovement / 2));
            }

            // Tier 2: 챕터별 오답 극복률 (reviews 활용)
            const studentReviews = (studentReviewsSnap?.docs ?? []).filter(d => d.data().courseId === courseId);

            // 오답 복습(wrong type)에서 reviewCount > 0인 것 → 복습 시도함
            // 같은 chapterId의 solved 중 isCorrect=true → 극복
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

            let tier2 = -1; // -1 = 데이터 부족
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

            // 결합
            if (tier2 >= 0) {
              growth = Math.round(tier1 * 0.4 + tier2 * 0.6);
            } else if (improvements.length > 0) {
              growth = Math.round(tier1);
            }
            // 둘 다 없으면 50 유지
          } catch {
            // 성장세 계산 실패 → 기준선 유지
          }

          // ── 나머지 4축: 백분위 lookup ──
          const quizCreation = rankPercentile(norm.quizCreationByUid.get(uid) ?? 0, norm.quizCreationCounts);
          const community = rankPercentile(norm.communityByUid.get(uid) ?? 0, norm.communityScores);
          const review = rankPercentile(norm.activeReviewByUid.get(uid) ?? 0, norm.activeReviewCounts);
          const activity = rankPercentile(userData.totalExp || 0, norm.expValues);

          radarMetrics = {
            quizScore: baseData.quizStats.averageScore,
            growth,
            quizCreation,
            community,
            review,
            activity,
          };
        }
      } catch (radarErr) {
        console.error('레이더 메트릭 수집 실패:', radarErr);
      }

      // 게시판 활동
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

      return {
        ...baseData,
        recentQuizzes,
        recentFeedbacks,
        radarMetrics,
        boardPostCount,
        boardCommentCount,
        boardPosts,
        boardCommentsList,
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
    subscribeStudents,
    fetchStudentDetail,
    getClassStats,
    clearError,
  };
}
