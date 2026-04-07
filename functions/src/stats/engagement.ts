/**
 * 참여도 통계 수집
 *
 * DAU, 리텐션, 신규 가입, 활동 유저 집계
 */

import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { CollectContext, EngagementStats, CohortEntry, kstDayIndex, formatWeekRange } from "./types";

export async function collectEngagement(ctx: CollectContext): Promise<EngagementStats> {
  const db = getFirestore();
  const { courseId, startTs, endTs, studentIds, totalStudents, start } = ctx;

  const activeUserIds = new Set<string>();
  const dauSets: Set<string>[] = Array.from({ length: 7 }, () => new Set());

  // 주간 신규 가입자 (createdAt 기준)
  let newSignups = 0;
  const usersSnap = await db.collection("users")
    .where("courseId", "==", courseId)
    .where("role", "==", "student")
    .where("createdAt", ">=", startTs)
    .where("createdAt", "<", endTs)
    .select("createdAt")
    .get();
  newSignups = usersSnap.size;

  // 퀴즈 결과 기반 활동 + DAU
  const resultsSnap = await db.collection("quizResults")
    .where("courseId", "==", courseId)
    .where("createdAt", ">=", startTs)
    .where("createdAt", "<", endTs)
    .select("userId", "createdAt")
    .get();

  resultsSnap.docs.forEach(d => {
    const data = d.data();
    const uid = data.userId as string;
    if (!studentIds.has(uid)) return;
    activeUserIds.add(uid);
    const ts = data.createdAt?.toDate?.();
    if (ts) dauSets[kstDayIndex(ts)].add(uid);
  });

  // pageViews 기반 활동 보강 (퀴즈 안 풀고 게시판만 본 학생)
  const pvSnap = await db.collection("pageViews")
    .where("courseId", "==", courseId)
    .where("timestamp", ">=", startTs)
    .where("timestamp", "<", endTs)
    .select("userId", "timestamp")
    .get();

  pvSnap.docs.forEach(d => {
    const data = d.data();
    const uid = data.userId as string;
    if (!uid || !studentIds.has(uid)) return;
    activeUserIds.add(uid);
    const ts = data.timestamp?.toDate?.();
    if (ts) dauSets[kstDayIndex(ts)].add(uid);
  });

  // DAU 계산
  const dauByDay = dauSets.map(s => s.size);
  const activeDays = dauByDay.filter(d => d > 0).length;
  const dauAvg = activeDays > 0 ? Math.round(dauByDay.reduce((a, b) => a + b, 0) / activeDays) : 0;
  const dauMauRatio = totalStudents > 0 ? Math.round((dauAvg / totalStudents) * 100) : 0;

  // 리텐션: 직전 주 활동 유저 대비 이번 주 재방문율
  let retentionFromLastWeek = 0;
  try {
    const prevStart = new Date(start.getTime() - 7 * 86400000);
    const prevSnap = await db.collection("quizResults")
      .where("courseId", "==", courseId)
      .where("createdAt", ">=", Timestamp.fromDate(prevStart))
      .where("createdAt", "<", startTs)
      .select("userId")
      .get();

    const prevPvSnap = await db.collection("pageViews")
      .where("courseId", "==", courseId)
      .where("timestamp", ">=", Timestamp.fromDate(prevStart))
      .where("timestamp", "<", startTs)
      .select("userId")
      .get();

    const prevActiveIds = new Set<string>();
    prevSnap.docs.forEach(d => {
      const uid = d.data().userId as string;
      if (studentIds.has(uid)) prevActiveIds.add(uid);
    });
    prevPvSnap.docs.forEach(d => {
      const uid = d.data().userId as string;
      if (uid && studentIds.has(uid)) prevActiveIds.add(uid);
    });

    if (prevActiveIds.size > 0) {
      const retained = [...prevActiveIds].filter(uid => activeUserIds.has(uid)).length;
      retentionFromLastWeek = Math.round((retained / prevActiveIds.size) * 100);
    }
  } catch (err) {
    console.warn(`[${courseId}] 리텐션 계산 실패:`, err);
  }

  // 코호트 리텐션: 가입 주차별 이번 주 활동률
  const cohortRetention: CohortEntry[] = [];
  try {
    // 최근 8주간 가입자 코호트
    for (let w = 0; w < 8; w++) {
      const cohortStart = new Date(start.getTime() - w * 7 * 86400000);
      const cohortEnd = new Date(cohortStart.getTime() + 7 * 86400000);

      const cohortSnap = await db.collection("users")
        .where("courseId", "==", courseId)
        .where("role", "==", "student")
        .where("createdAt", ">=", Timestamp.fromDate(cohortStart))
        .where("createdAt", "<", Timestamp.fromDate(cohortEnd))
        .select()
        .get();

      if (cohortSnap.size === 0) continue;

      const cohortUids = new Set(cohortSnap.docs.map(d => d.id));
      const activeInCohort = [...cohortUids].filter(uid => activeUserIds.has(uid)).length;
      const weekLabel = formatWeekRange(cohortStart, cohortEnd);

      cohortRetention.push({
        cohortWeek: `W-${w} (${weekLabel})`,
        totalUsers: cohortUids.size,
        activeThisWeek: activeInCohort,
        retentionRate: Math.round((activeInCohort / cohortUids.size) * 100),
      });
    }
  } catch (err) {
    console.warn(`[${courseId}] 코호트 리텐션 계산 실패:`, err);
  }

  return {
    activeCount: activeUserIds.size,
    totalCount: totalStudents,
    newSignups,
    dauByDay,
    dauAvg,
    dauMauRatio,
    retentionFromLastWeek,
    cohortRetention,
    activeUserIds,
  };
}
