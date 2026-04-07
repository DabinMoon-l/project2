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
  newSignups: number; // 주간 신규 가입자
  dauByDay: number[];
  dauAvg: number;
  dauMauRatio: number;
  retentionFromLastWeek: number;
  /** pageViews 기반 활동 uid Set (다른 도메인에서 활용) */
  activeUserIds: Set<string>;
}

export interface FeatureUsageStats {
  totalViews: number;
  uniqueUsers: number;
  /** 기능별 조회수 (내림차순) */
  byCategory: Record<string, number>;
  /** 기능별 평균 체류시간(ms) */
  avgDurationByCategory: Record<string, number>;
  avgSessionViews: number;
  avgSessionDurationMs: number;
  peakHours: number[];
  /** 세션 깊이: 1페이지만 본 비율 (%) */
  bounceRate: number;
  /** 세션 깊이: 3+ 페이지 본 비율 (%) */
  deepSessionRate: number;
}

export interface LearningStats {
  quiz: {
    newCount: number;
    typeDistribution: Record<string, number>;
    avgCorrectRate: number;
    avgCompletionRate: number;
    topWrongQuestions: { quizId: string; questionIndex: number; wrongRate: number }[];
    /** 교수 퀴즈 vs AI 퀴즈 정답률 비교 */
    profQuizCorrectRate: number;
    aiQuizCorrectRate: number;
  };
  feedback: {
    total: number;
    byType: Record<string, number>;
    avgScore: number;
  };
  review: {
    /** 복습 완료 수 (quizResults에서 isReview=true) */
    completedCount: number;
    /** 퀴즈 풀이 → 복습 전환율 (%) */
    reviewConversionRate: number;
  };
  /** 주간 정답률 추이를 위한 학생별 스냅샷 */
  clusterCounts: {
    passionate: number;
    hardworking: number;
    efficient: number;
    atRisk: number;
  };
  avgExp: number;
  milestoneCount: number;
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

export interface UserSegmentationStats {
  segments: Record<string, number>;
  ghostUsers: number;
  avgFeaturesUsed: number;
  topFeatureCombos: string[];
}

export interface WeeklyStats {
  courseId: string;
  weekStart: string;
  weekEnd: string;
  weekLabel: string;
  weekRangeKo: string; // "3/30~4/5"
  createdAt: FirebaseFirestore.FieldValue;
  engagement: EngagementStats;
  featureUsage: FeatureUsageStats;
  segmentation: UserSegmentationStats;
  learning: LearningStats;
  gamification: GamificationStats;
  social: SocialStats;
}
