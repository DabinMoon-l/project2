/**
 * 기능별 사용 패턴 통계
 *
 * pageViews 기반: 기능별 순위, 체류시간, 세션 깊이, 바운스율
 * 유저 분류: 둘러보기 vs 능동 유저
 */

import { getFirestore } from "firebase-admin/firestore";
import { CollectContext, FeatureUsageStats, KST_OFFSET } from "./types";

/** 유저 행동 세그먼트 */
export interface UserSegmentation {
  /** 세그먼트별 인원 수 */
  segments: Record<string, number>;
  /** 유령 유저: 가입만 하고 접속 안 함 */
  ghostUsers: number;
  /** 유저별 사용 기능 수 평균 */
  avgFeaturesUsed: number;
  /** 가장 많이 사용하는 기능 조합 TOP 5 */
  topFeatureCombos: string[];
}

// 기능별 카테고리 그룹
const QUIZ_CATS = new Set(["quiz_solve", "quiz_result", "quiz_feedback", "quiz_exp"]);
const REVIEW_CATS = new Set(["review_detail", "review_practice"]);
const BOARD_CATS = new Set(["board_detail", "board_list"]);
const CREATE_CATS = new Set(["quiz_create"]);

/**
 * 유저를 행동 패턴으로 세그먼트 분류
 *
 * - 올라운더: 퀴즈+복습+게시판 모두 사용
 * - 퀴즈집중형: 퀴즈만 주로 사용
 * - 복습러: 복습 기능 적극 사용
 * - 소통형: 게시판/콩콩이 위주
 * - 창작자: 퀴즈 만들기 활발
 * - 가벼운접속: 홈만 보고 나감
 */
function classifyUser(cats: Set<string>): string {
  const usesQuiz = [...cats].some(c => QUIZ_CATS.has(c));
  const usesReview = [...cats].some(c => REVIEW_CATS.has(c));
  const usesBoard = [...cats].some(c => BOARD_CATS.has(c));
  const usesCreate = [...cats].some(c => CREATE_CATS.has(c));

  if (usesQuiz && usesReview && usesBoard) return "올라운더";
  if (usesCreate) return "창작자";
  if (usesReview && usesQuiz) return "복습러";
  if (usesQuiz && !usesReview && !usesBoard) return "퀴즈집중형";
  if (usesBoard && !usesQuiz) return "소통형";
  if (usesQuiz && usesBoard) return "퀴즈+소통형";
  if (cats.size <= 2) return "가벼운접속";
  return "기타";
}

export async function collectFeatureUsage(
  ctx: CollectContext,
): Promise<{ featureUsage: FeatureUsageStats; segmentation: UserSegmentation }> {
  const db = getFirestore();
  const { courseId, startTs, endTs, studentIds, totalStudents } = ctx;

  const pvSnap = await db.collection("pageViews")
    .where("courseId", "==", courseId)
    .where("timestamp", ">=", startTs)
    .where("timestamp", "<", endTs)
    .get();

  const byCategory: Record<string, number> = {};
  const uniqueUsers = new Set<string>();
  const sessionViews: Record<string, number> = {};
  const hourCounts: Record<number, number> = {};
  const durationByCategory: Record<string, { total: number; count: number }> = {};
  const sessionDurations: Record<string, number> = {};

  // 유저별 사용 기능 카테고리 추적
  const userCategories: Record<string, Set<string>> = {};

  pvSnap.docs.forEach(d => {
    const data = d.data();
    const cat = (data.category || "other") as string;
    const uid = data.userId as string;
    const sid = data.sessionId as string;

    byCategory[cat] = (byCategory[cat] || 0) + 1;
    if (uid) {
      uniqueUsers.add(uid);
      // 유저별 카테고리 추적
      if (studentIds.has(uid)) {
        if (!userCategories[uid]) userCategories[uid] = new Set();
        userCategories[uid].add(cat);
      }
    }
    if (sid) sessionViews[sid] = (sessionViews[sid] || 0) + 1;

    // 체류시간
    const dur = data.durationMs as number | undefined;
    if (dur && dur > 0 && dur < 30 * 60 * 1000) {
      if (!durationByCategory[cat]) durationByCategory[cat] = { total: 0, count: 0 };
      durationByCategory[cat].total += dur;
      durationByCategory[cat].count += 1;
      if (sid) sessionDurations[sid] = (sessionDurations[sid] || 0) + dur;
    }

    // 시간대
    if (data.timestamp?.toDate) {
      const kstHour = new Date(data.timestamp.toDate().getTime() + KST_OFFSET).getUTCHours();
      hourCounts[kstHour] = (hourCounts[kstHour] || 0) + 1;
    }
  });

  // 세션 깊이 분석
  const sessionCounts = Object.values(sessionViews);
  const totalSessions = sessionCounts.length;
  const bounceSessions = sessionCounts.filter(c => c === 1).length;
  const deepSessions = sessionCounts.filter(c => c >= 3).length;
  const bounceRate = totalSessions > 0 ? Math.round((bounceSessions / totalSessions) * 100) : 0;
  const deepSessionRate = totalSessions > 0 ? Math.round((deepSessions / totalSessions) * 100) : 0;

  const avgSessionViews = totalSessions > 0
    ? Math.round((sessionCounts.reduce((a, b) => a + b, 0) / totalSessions) * 10) / 10
    : 0;

  // 피크 시간대 TOP 3
  const peakHours = Object.entries(hourCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([h]) => Number(h));

  // 세션당 평균 체류시간
  const sessionDurVals = Object.values(sessionDurations);
  const avgSessionDurationMs = sessionDurVals.length > 0
    ? Math.round(sessionDurVals.reduce((a, b) => a + b, 0) / sessionDurVals.length)
    : 0;

  // byCategory를 내림차순 정렬
  const sortedByCategory = Object.fromEntries(
    Object.entries(byCategory).sort((a, b) => b[1] - a[1])
  );

  // 유저 세그멘테이션
  const accessedUserIds = new Set(Object.keys(userCategories));
  const segments: Record<string, number> = {};
  const featureCounts: number[] = [];
  const comboCounts: Record<string, number> = {};
  const coreCats = new Set([...QUIZ_CATS, ...REVIEW_CATS, ...BOARD_CATS, ...CREATE_CATS]);

  for (const [, cats] of Object.entries(userCategories)) {
    featureCounts.push(cats.size);
    const segment = classifyUser(cats);
    segments[segment] = (segments[segment] || 0) + 1;
    // 기능 조합
    const sorted = [...cats].filter(c => coreCats.has(c)).sort().join("+");
    if (sorted) comboCounts[sorted] = (comboCounts[sorted] || 0) + 1;
  }

  const ghostUsers = Math.max(0, totalStudents - accessedUserIds.size);
  const avgFeaturesUsed = featureCounts.length > 0
    ? Math.round((featureCounts.reduce((a, b) => a + b, 0) / featureCounts.length) * 10) / 10
    : 0;

  const topFeatureCombos = Object.entries(comboCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([combo, count]) => `${combo} (${count}명)`);

  return {
    featureUsage: {
      totalViews: pvSnap.size,
      uniqueUsers: uniqueUsers.size,
      byCategory: sortedByCategory,
      avgDurationByCategory: Object.fromEntries(
        Object.entries(durationByCategory).map(([cat, { total, count }]) => [cat, Math.round(total / count)])
      ),
      avgSessionViews,
      avgSessionDurationMs,
      peakHours,
      bounceRate,
      deepSessionRate,
    },
    segmentation: {
      segments,
      ghostUsers,
      avgFeaturesUsed,
      topFeatureCombos,
    },
  };
}
