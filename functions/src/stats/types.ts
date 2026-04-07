/**
 * 주간 통계 타입 정의
 *
 * 도메인별 수집 함수가 반환하는 타입과
 * 최종 WeeklyStats 문서 스키마
 */

import { Timestamp } from "firebase-admin/firestore";

// ============================================================
// 공통
// ============================================================

/** 수집 함수에 전달되는 컨텍스트 */
export interface CollectContext {
  courseId: string;
  start: Date;
  end: Date;
  startTs: Timestamp;
  endTs: Timestamp;
  /** 해당 과목 학생 uid Set */
  studentIds: Set<string>;
  /** 전체 학생 수 */
  totalStudents: number;
}

export const KST_OFFSET = 9 * 60 * 60 * 1000;
export const COURSE_IDS = ["biology", "pathophysiology", "microbiology"];

/** KST 기준 요일 인덱스 (월=0 ~ 일=6) */
export function kstDayIndex(ts: Date): number {
  const kstDay = new Date(ts.getTime() + KST_OFFSET).getUTCDay(); // 0=일,1=월
  return kstDay === 0 ? 6 : kstDay - 1;
}

/** 주간 날짜 범위를 한국어로 포맷 (3/30~4/5) */
export function formatWeekRange(start: Date, end: Date): string {
  const s = new Date(start.getTime() + KST_OFFSET);
  const e = new Date(end.getTime() + KST_OFFSET - 86400000); // 종료일 -1일 (일요일)
  return `${s.getUTCMonth() + 1}/${s.getUTCDate()}~${e.getUTCMonth() + 1}/${e.getUTCDate()}`;
}

// ============================================================
// 도메인별 결과 타입
// ============================================================

export interface EngagementStats {
  activeCount: number;
  totalCount: number;
  newSignups: number;
  dauByDay: number[];
  dauAvg: number;
  dauMauRatio: number;
  retentionFromLastWeek: number;
  /** 코호트 리텐션: 가입 주차별 현재 주 활동률 */
  cohortRetention: CohortEntry[];
  /** pageViews 기반 활동 uid Set (다른 도메인에서 활용, 직렬화 안 됨) */
  activeUserIds: Set<string>;
}

export interface CohortEntry {
  /** 가입 주차 라벨 (예: "W10 (3/2~3/8)") */
  cohortWeek: string;
  /** 해당 코호트 총 가입자 수 */
  totalUsers: number;
  /** 이번 주에 활동한 수 */
  activeThisWeek: number;
  /** 활동률 (%) */
  retentionRate: number;
}

export interface FeatureUsageStats {
  totalViews: number;
  uniqueUsers: number;
  byCategory: Record<string, number>;
  avgDurationByCategory: Record<string, number>;
  avgSessionViews: number;
  avgSessionDurationMs: number;
  peakHours: number[];
  bounceRate: number;
  deepSessionRate: number;
  /** 일별(월~일) 기능별 접속률(%) — Claude가 요일 패턴 분석 */
  dailyFeatureRates: Record<string, Record<string, number>>;
  /** 핵심 기능별 침투율 — "quiz_solve: 89명/135명 (66%)" */
  featurePenetration: Record<string, string>;
  /** 세션 깊이 분포 — 1페이지/2/3~5/6~10/11+ */
  sessionDepthDist: Record<string, number>;
  /** 접속한 학생 수 */
  accessedStudents: number;
  /** 미접속 학생 수 */
  ghostStudents: number;
  /** 유저 행동 흐름: 평균 체류 패턴 */
  userJourneyStats: UserJourneyStats;
}

/** 유저 행동 흐름 통계 — 체류시간 기반 실제 사용 패턴 */
export interface UserJourneyStats {
  /** 기능별 "실제 사용자" 수 (30초+ 체류) vs "스쳐간" 수 (<30초) */
  realUsageVsBrowse: Record<string, { realUsers: number; browseUsers: number }>;
  /** 퀴즈 풀이 평균 체류시간 (문제당 소요 시간 추정) */
  avgQuizSolveDurationMs: number;
  /** 복습 평균 체류시간 */
  avgReviewDurationMs: number;
  /** 게시판 글 읽기 평균 체류시간 */
  avgBoardReadDurationMs: number;
  /** 짧은 접속(< 1분) 비율 (%) */
  quickVisitRate: number;
  /** 장시간 접속(10분+) 비율 (%) */
  longSessionRate: number;
  /** 세션 흐름 TOP 5: "home→quiz_solve→quiz_result (23회)" */
  topSessionFlows: string[];
}

export interface LearningStats {
  quiz: {
    newCount: number;
    typeDistribution: Record<string, number>;
    avgCorrectRate: number;
    avgCompletionRate: number;
    topWrongQuestions: { quizId: string; questionIndex: number; wrongRate: number }[];
    profQuizCorrectRate: number;
    aiQuizCorrectRate: number;
  };
  /** 퀴즈별 상세: 제목, 풀이수, 정답률, 오답TOP, 피드백 내역 */
  quizDetails: QuizDetail[];
  /** 챕터별 정답률: 첫시도 vs 복습후 (before/after) */
  chapterCorrectRates: Record<string, { firstAttempt: number; afterReview: number; attempts: number }>;
  feedback: {
    total: number;
    byType: Record<string, number>;
    avgScore: number;
  };
  review: {
    completedCount: number;
    reviewConversionRate: number;
  };
  clusterCounts: {
    passionate: number;
    hardworking: number;
    efficient: number;
    atRisk: number;
  };
  avgExp: number;
  milestoneCount: number;
}

export interface QuizDetail {
  quizId: string;
  title: string;
  type: string;
  /** 풀이 학생 수 */
  solveCount: number;
  /** 정답률 (%) */
  correctRate: number;
  /** 오답률 높은 문제 TOP 3 (문제번호, 오답률) */
  topWrongQuestions: { index: number; wrongRate: number }[];
  /** 피드백 수 + 유형별 */
  feedbackCount: number;
  feedbackByType: Record<string, number>;
}

export interface GamificationStats {
  /** 주간 뽑기 수 (gacha 기록) */
  gachaSpins: number;
  /** 주간 레벨업 수 */
  levelUps: number;
  /** 토끼 보유 수 평균 */
  avgRabbitsOwned: number;
  /** 배틀 횟수 */
  battleCount: number;
  /** 배틀 평균 승률 (%) */
  battleWinRate: number;
}

export interface SocialStats {
  board: {
    postCount: number;
    commentCount: number;
    totalViews: number;
    classParticipation: Record<string, number>;
  };
  kongi: {
    /** 학술 질문에 대한 콩콩이 답변 수 */
    academicReplies: number;
    /** 비공개(나만의 콩콩이) 대화 수 */
    privateChats: number;
    /** 대댓글(후속질문) 수 */
    followUpCount: number;
  };
  keywords: { text: string; value: number }[];
}

// ============================================================
// 최종 WeeklyStats 문서 스키마
// ============================================================

export interface WeeklyStats {
  courseId: string;
  weekStart: string;
  weekEnd: string;
  weekLabel: string;
  weekRangeKo: string; // "3/30~4/5"
  createdAt: FirebaseFirestore.FieldValue;
  engagement: EngagementStats;
  featureUsage: FeatureUsageStats;
  learning: LearningStats;
  gamification: GamificationStats;
  social: SocialStats;
}
