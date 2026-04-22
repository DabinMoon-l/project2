/**
 * 주간 통계 수집 오케스트레이터
 *
 * 도메인별 수집 함수를 호출하고 WeeklyStats 문서로 조합
 */

import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { CollectContext, WeeklyStats, COURSE_IDS, KST_OFFSET, formatWeekRange } from "./types";
import { collectEngagement } from "./engagement";
import { collectFeatureUsage } from "./featureUsage";
import { collectLearning } from "./learning";
import { collectGamification } from "./gamification";
import { collectSocial } from "./social";

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

// ============================================================
// 컨텍스트 생성
// ============================================================

async function buildContext(courseId: string, start: Date, end: Date): Promise<CollectContext> {
  const db = getFirestore();
  const startTs = Timestamp.fromDate(start);
  const endTs = Timestamp.fromDate(end);

  const usersSnap = await db.collection("users")
    .where("courseId", "==", courseId)
    .where("role", "==", "student")
    .select()
    .get();

  const studentIds = new Set(usersSnap.docs.map(d => d.id));

  return { courseId, start, end, startTs, endTs, studentIds, totalStudents: studentIds.size };
}

// ============================================================
// 수집 + 조합
// ============================================================

async function collectWeeklyStats(
  courseId: string, start: Date, end: Date, label: string, apiKey: string
): Promise<WeeklyStats> {
  const ctx = await buildContext(courseId, start, end);

  // 병렬 실행 (독립적인 도메인)
  const [engagement, featureUsage, learning, gamification, social] = await Promise.all([
    collectEngagement(ctx),
    collectFeatureUsage(ctx),
    collectLearning(ctx),
    collectGamification(ctx),
    collectSocial(ctx, apiKey),
  ]);

  // activeUserIds는 직렬화 불가 → 제거
  const { activeUserIds, ...engagementData } = engagement;

  return {
    courseId,
    weekStart: start.toISOString(),
    weekEnd: end.toISOString(),
    weekLabel: label,
    weekRangeKo: formatWeekRange(start, end),
    createdAt: FieldValue.serverTimestamp(),
    engagement: engagementData as WeeklyStats["engagement"],
    featureUsage,
    learning,
    gamification,
    social,
  };
}

// ============================================================
// 유틸: 지난주 월~일 범위 (KST)
// ============================================================

function getLastWeekRange(): { start: Date; end: Date; label: string } {
  const now = new Date();
  const kstNow = new Date(now.getTime() + KST_OFFSET);
  const dayOfWeek = kstNow.getUTCDay();
  const daysToLastMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  const lastMondayKST = new Date(kstNow);
  lastMondayKST.setUTCDate(lastMondayKST.getUTCDate() - daysToLastMonday - 7);
  lastMondayKST.setUTCHours(0, 0, 0, 0);

  const lastSundayKST = new Date(lastMondayKST);
  lastSundayKST.setUTCDate(lastMondayKST.getUTCDate() + 7);

  const start = new Date(lastMondayKST.getTime() - KST_OFFSET);
  const end = new Date(lastSundayKST.getTime() - KST_OFFSET);

  const jan1 = new Date(Date.UTC(lastMondayKST.getUTCFullYear(), 0, 1));
  const daysSinceJan1 = Math.floor((lastMondayKST.getTime() - jan1.getTime()) / 86400000);
  const weekNum = Math.ceil((daysSinceJan1 + jan1.getUTCDay() + 1) / 7);
  const label = `${lastMondayKST.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;

  return { start, end, label };
}

// ============================================================
// Scheduled Function (매주 월요일 00:00 KST)
// ============================================================

export const collectWeeklyStatsScheduled = onSchedule(
  {
    schedule: "every monday 00:00",
    region: "asia-northeast3",
    timeZone: "Asia/Seoul",
    timeoutSeconds: 540,
    memory: "1GiB",
    secrets: [ANTHROPIC_API_KEY],
  },
  async () => {
    const db = getFirestore();
    const { start, end, label } = getLastWeekRange();
    const apiKey = ANTHROPIC_API_KEY.value();

    console.log(`주별 통계 수집 시작: ${label} (${formatWeekRange(start, end)})`);

    for (const courseId of COURSE_IDS) {
      try {
        const stats = await collectWeeklyStats(courseId, start, end, label, apiKey);
        await db.collection("weeklyStats").doc(courseId).collection("weeks").doc(label).set(stats);
        console.log(`[${courseId}] 주별 통계 저장 완료`);
      } catch (err) {
        console.error(`[${courseId}] 주별 통계 수집 실패:`, err);
      }
    }
  }
);

// ============================================================
// 백필 Callable
// ============================================================

export const backfillWeeklyStats = onCall(
  {
    region: "asia-northeast3",
    timeoutSeconds: 540,
    memory: "1GiB",
    secrets: [ANTHROPIC_API_KEY],
  },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "로그인 필요");

    const { startDate, endDate } = request.data as { startDate: string; endDate: string };
    if (!startDate || !endDate) throw new HttpsError("invalid-argument", "startDate, endDate 필요");

    const db = getFirestore();
    const apiKey = ANTHROPIC_API_KEY.value();

    const startKST = new Date(startDate + "T00:00:00+09:00");
    const endKST = new Date(endDate + "T23:59:59+09:00");
    const results: string[] = [];

    const current = new Date(startKST);
    const dayOfWeek = current.getDay();
    current.setDate(current.getDate() + (dayOfWeek === 0 ? -6 : 1 - dayOfWeek));

    while (current < endKST) {
      const mondayKST = new Date(current);
      mondayKST.setHours(0, 0, 0, 0);
      const sundayKST = new Date(mondayKST);
      sundayKST.setDate(mondayKST.getDate() + 7);

      const start = new Date(mondayKST.getTime() - KST_OFFSET);
      const end = new Date(sundayKST.getTime() - KST_OFFSET);

      const jan1 = new Date(mondayKST.getFullYear(), 0, 1);
      const daysSinceJan1 = Math.floor((mondayKST.getTime() - jan1.getTime()) / 86400000);
      const weekNum = Math.ceil((daysSinceJan1 + jan1.getDay() + 1) / 7);
      const label = `${mondayKST.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;

      for (const courseId of COURSE_IDS) {
        const existing = await db.collection("weeklyStats").doc(courseId).collection("weeks").doc(label).get();
        if (existing.exists) {
          results.push(`${courseId} ${label}: 이미 존재 (스킵)`);
          continue;
        }
        try {
          const stats = await collectWeeklyStats(courseId, start, end, label, apiKey);
          await db.collection("weeklyStats").doc(courseId).collection("weeks").doc(label).set(stats);
          results.push(`${courseId} ${label}: 생성 완료`);
        } catch (err) {
          results.push(`${courseId} ${label}: 실패 — ${err}`);
        }
      }
      current.setDate(current.getDate() + 7);
    }

    return { results };
  }
);
