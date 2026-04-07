/**
 * 기능별 사용 패턴 — raw 데이터 수집
 *
 * 원칙: 수집은 구체적 숫자, 분석은 Claude에게
 * - 일별 기능 접속자 수 + 전체 접속 대비 비율
 * - 기능별 체류시간 분포
 * - 세션 깊이 분포
 * - 기능 간 동시 사용률
 */

import { getFirestore } from "firebase-admin/firestore";
import { CollectContext, FeatureUsageStats, UserJourneyStats, KST_OFFSET } from "./types";

export async function collectFeatureUsage(
  ctx: CollectContext,
): Promise<FeatureUsageStats> {
  const db = getFirestore();
  const { courseId, startTs, endTs, studentIds, totalStudents } = ctx;

  const pvSnap = await db.collection("pageViews")
    .where("courseId", "==", courseId)
    .where("timestamp", ">=", startTs)
    .where("timestamp", "<", endTs)
    .get();

  // 기본 집계
  const byCategory: Record<string, number> = {};
  const uniqueUsers = new Set<string>();
  const sessionViews: Record<string, number> = {};
  const hourCounts: Record<number, number> = {};
  const durationByCategory: Record<string, { total: number; count: number }> = {};
  const sessionDurations: Record<string, number> = {};

  // 일별 기능 접속자 추적 (월=0 ~ 일=6)
  const dailyFeatureUsers: Record<number, Record<string, Set<string>>> = {};
  const dailyTotalUsers: Record<number, Set<string>> = {};
  for (let i = 0; i < 7; i++) {
    dailyFeatureUsers[i] = {};
    dailyTotalUsers[i] = new Set();
  }

  // 유저별 사용 기능 추적 (동시 사용률 계산용)
  const userFeatures: Record<string, Set<string>> = {};

  pvSnap.docs.forEach(d => {
    const data = d.data();
    const cat = (data.category || "other") as string;
    const uid = data.userId as string;
    const sid = data.sessionId as string;

    byCategory[cat] = (byCategory[cat] || 0) + 1;
    if (uid) {
      uniqueUsers.add(uid);
      // 유저별 기능 추적
      if (studentIds.has(uid)) {
        if (!userFeatures[uid]) userFeatures[uid] = new Set();
        userFeatures[uid].add(cat);
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

    // 시간대 + 일별 기능 접속자
    const ts = data.timestamp?.toDate?.();
    if (ts) {
      const kstTime = new Date(ts.getTime() + KST_OFFSET);
      const kstHour = kstTime.getUTCHours();
      hourCounts[kstHour] = (hourCounts[kstHour] || 0) + 1;

      const kstDay = kstTime.getUTCDay();
      const dayIdx = kstDay === 0 ? 6 : kstDay - 1;
      if (uid && studentIds.has(uid)) {
        dailyTotalUsers[dayIdx].add(uid);
        if (!dailyFeatureUsers[dayIdx][cat]) dailyFeatureUsers[dayIdx][cat] = new Set();
        dailyFeatureUsers[dayIdx][cat].add(uid);
      }
    }
  });

  // 일별 기능별 접속률 (%) — Claude가 요일별 패턴 분석
  const dailyFeatureRates: Record<string, Record<string, number>> = {};
  const dayNames = ["월", "화", "수", "목", "금", "토", "일"];
  for (let i = 0; i < 7; i++) {
    const total = dailyTotalUsers[i].size;
    if (total === 0) continue;
    const rates: Record<string, number> = { 접속자: total };
    for (const [cat, users] of Object.entries(dailyFeatureUsers[i])) {
      rates[cat] = Math.round((users.size / total) * 100);
    }
    dailyFeatureRates[dayNames[i]] = rates;
  }

  // 기능 동시 사용률 — "퀴즈 사용자 중 복습도 한 비율" 등
  const totalAccessedStudents = Object.keys(userFeatures).length;
  const featurePenetration: Record<string, string> = {};
  const keyFeatures = ["quiz_solve", "review_detail", "board_detail", "quiz_create", "quiz_result"];
  for (const feat of keyFeatures) {
    const users = Object.values(userFeatures).filter(s => s.has(feat)).length;
    if (totalAccessedStudents > 0) {
      featurePenetration[feat] = `${users}명/${totalAccessedStudents}명 (${Math.round((users / totalAccessedStudents) * 100)}%)`;
    }
  }

  // 세션 깊이 분포 — 1페이지/2페이지/3-5/6-10/11+
  const sessionCounts = Object.values(sessionViews);
  const depthDist = { "1페이지": 0, "2페이지": 0, "3~5": 0, "6~10": 0, "11+": 0 };
  sessionCounts.forEach(c => {
    if (c === 1) depthDist["1페이지"]++;
    else if (c === 2) depthDist["2페이지"]++;
    else if (c <= 5) depthDist["3~5"]++;
    else if (c <= 10) depthDist["6~10"]++;
    else depthDist["11+"]++;
  });

  const totalSessions = sessionCounts.length;
  const bounceRate = totalSessions > 0 ? Math.round((depthDist["1페이지"] / totalSessions) * 100) : 0;
  const deepSessionRate = totalSessions > 0
    ? Math.round(((depthDist["6~10"] + depthDist["11+"]) / totalSessions) * 100) : 0;

  const avgSessionViews = totalSessions > 0
    ? Math.round((sessionCounts.reduce((a, b) => a + b, 0) / totalSessions) * 10) / 10
    : 0;

  const peakHours = Object.entries(hourCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([h]) => Number(h));

  const sessionDurVals = Object.values(sessionDurations);
  const avgSessionDurationMs = sessionDurVals.length > 0
    ? Math.round(sessionDurVals.reduce((a, b) => a + b, 0) / sessionDurVals.length)
    : 0;

  // byCategory 내림차순
  const sortedByCategory = Object.fromEntries(
    Object.entries(byCategory).sort((a, b) => b[1] - a[1])
  );

  // 체류시간 기반 "실제 사용" vs "스쳐감" (30초 기준)
  const realUsageVsBrowse: Record<string, { realUsers: number; browseUsers: number }> = {};
  // 유저별 기능별 체류시간 모음
  const userCatDurations: Record<string, Record<string, number[]>> = {};

  pvSnap.docs.forEach(d => {
    const data = d.data();
    const uid = data.userId as string;
    const cat = (data.category || "other") as string;
    const dur = data.durationMs as number | undefined;
    if (!uid || !studentIds.has(uid) || !dur || dur <= 0 || dur >= 30 * 60 * 1000) return;
    if (!userCatDurations[uid]) userCatDurations[uid] = {};
    if (!userCatDurations[uid][cat]) userCatDurations[uid][cat] = [];
    userCatDurations[uid][cat].push(dur);
  });

  // 기능별 실제 사용 vs 스쳐감
  const coreCats = ["quiz_solve", "quiz_result", "quiz_feedback", "review_detail",
    "board_detail", "quiz_create", "home", "review_practice"];
  for (const cat of coreCats) {
    let real = 0, browse = 0;
    for (const durations of Object.values(userCatDurations)) {
      const catDurs = durations[cat];
      if (!catDurs) continue;
      const avgDur = catDurs.reduce((a, b) => a + b, 0) / catDurs.length;
      if (avgDur >= 30000) real++; // 30초+ → 실제 사용
      else browse++;
    }
    if (real > 0 || browse > 0) {
      realUsageVsBrowse[cat] = { realUsers: real, browseUsers: browse };
    }
  }

  // 기능별 평균 체류시간 (실제 사용자만)
  const avgQuizSolveDur = durationByCategory["quiz_solve"];
  const avgReviewDur = durationByCategory["review_detail"];
  const avgBoardDur = durationByCategory["board_detail"];

  // 짧은/긴 세션 비율
  const quickVisits = sessionDurVals.filter(d => d < 60000).length;
  const longSessions = sessionDurVals.filter(d => d >= 600000).length;
  const quickVisitRate = sessionDurVals.length > 0 ? Math.round((quickVisits / sessionDurVals.length) * 100) : 0;
  const longSessionRate = sessionDurVals.length > 0 ? Math.round((longSessions / sessionDurVals.length) * 100) : 0;

  // 세션 흐름 (페이지 이동 순서) TOP 5
  const sessionFlows: Record<string, string[]> = {};
  pvSnap.docs.forEach(d => {
    const data = d.data();
    const sid = data.sessionId as string;
    const cat = (data.category || "other") as string;
    const ts = data.timestamp?.toDate?.()?.getTime() || 0;
    if (!sid) return;
    if (!sessionFlows[sid]) sessionFlows[sid] = [];
    sessionFlows[sid].push(`${ts}:${cat}`);
  });

  const flowCounts: Record<string, number> = {};
  for (const pages of Object.values(sessionFlows)) {
    if (pages.length < 2) continue;
    // 시간순 정렬 → 카테고리만 추출 → 연속 중복 제거
    const sorted = pages.sort().map(p => p.split(":")[1]);
    const deduped: string[] = [];
    sorted.forEach(c => { if (deduped[deduped.length - 1] !== c) deduped.push(c); });
    if (deduped.length < 2) continue;
    const flow = deduped.slice(0, 4).join("→"); // 최대 4단계
    flowCounts[flow] = (flowCounts[flow] || 0) + 1;
  }

  const topSessionFlows = Object.entries(flowCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([flow, count]) => `${flow} (${count}회)`);

  const userJourneyStats: UserJourneyStats = {
    realUsageVsBrowse,
    avgQuizSolveDurationMs: avgQuizSolveDur ? Math.round(avgQuizSolveDur.total / avgQuizSolveDur.count) : 0,
    avgReviewDurationMs: avgReviewDur ? Math.round(avgReviewDur.total / avgReviewDur.count) : 0,
    avgBoardReadDurationMs: avgBoardDur ? Math.round(avgBoardDur.total / avgBoardDur.count) : 0,
    quickVisitRate,
    longSessionRate,
    topSessionFlows,
  };

  return {
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
    dailyFeatureRates,
    featurePenetration,
    sessionDepthDist: depthDist,
    accessedStudents: totalAccessedStudents,
    ghostStudents: Math.max(0, totalStudents - totalAccessedStudents),
    userJourneyStats,
  };
}
