/**
 * 랭킹 사전 계산 Cloud Function
 *
 * rankings/{courseId} 문서에 개인/팀 랭킹 결과를 저장.
 * 클라이언트는 이 문서 1개만 읽으면 됨.
 *
 * - 스케줄: 5분마다 자동 실행 (모든 courseId)
 * - Callable: 강제 갱신 (특정 courseId)
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// ── 랭킹 계산 유틸 (클라이언트 ranking.ts와 동일 로직) ──

/**
 * 개인 랭킹 점수 = 퀴즈점수(정답률×응시율) × 4 + totalExp × 0.6
 *
 * 퀴즈점수 = 평균정답률(0~100) × 0.5 + 응시율(0~100) × 0.5
 * → 많이 풀고(응시율↑) 잘 풀어야(정답률↑) 높은 점수
 */
function computeRankScore(
  correctRate: number,
  completionRate: number,
  totalExp: number
): number {
  const quizScore = correctRate * 0.5 + completionRate * 0.5;
  return quizScore * 4 + totalExp * 0.6;
}

function computeTeamScore(normalizedAvgExp: number, avgCorrectRate: number, avgCompletionRate: number): number {
  return normalizedAvgExp * 0.4 + avgCorrectRate * 0.4 + avgCompletionRate * 0.2;
}

/**
 * 이번 주 월요일 00:00 KST를 UTC Date로 반환
 */
function getWeekStartUTC(): Date {
  const KST_OFFSET = 9 * 60 * 60 * 1000;
  const now = new Date();
  const kstNow = new Date(now.getTime() + KST_OFFSET);
  const day = kstNow.getUTCDay(); // 0=일, 1=월, ...
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  const mondayKST = new Date(kstNow);
  mondayKST.setUTCHours(0, 0, 0, 0);
  mondayKST.setUTCDate(mondayKST.getUTCDate() - daysSinceMonday);
  // KST 월요일 00:00 → UTC로 변환
  return new Date(mondayKST.getTime() - KST_OFFSET);
}

/**
 * 오늘 00:00 KST를 UTC Date로 반환
 */
function getTodayStartUTC(): Date {
  const KST_OFFSET = 9 * 60 * 60 * 1000;
  const now = new Date();
  const kstNow = new Date(now.getTime() + KST_OFFSET);
  kstNow.setUTCHours(0, 0, 0, 0);
  return new Date(kstNow.getTime() - KST_OFFSET);
}

// ── 랭킹 계산 핵심 로직 ──

interface RankedUserDoc {
  id: string;
  nickname: string;
  name?: string;
  classType: string;
  totalExp: number;
  dailyExp?: number | null;
  weeklyExp?: number | null;
  dailyRankScore?: number | null;
  weeklyRankScore?: number | null;
  profCorrectCount: number;
  rankScore: number;
  profileRabbitId: number | null;
  equippedRabbitNames: string;
  equippedRabbits: Array<{ rabbitId: number; courseId?: string; discoveryOrder?: number }>;
  firstEquippedRabbitId: number | null;
  firstEquippedRabbitName: string | null;
  rank: number;
}

interface TeamRankEntry {
  classId: string;
  score: number;
  rank: number;
}

interface UserDoc {
  id: string;
  role?: string;
  nickname?: string;
  name?: string;
  classId?: string;
  totalExp?: number;
  profileRabbitId?: number | null;
  equippedRabbits?: Array<{ rabbitId: number; courseId?: string }>;
  professorQuizzesCompleted?: number;
  lastActiveAt?: { toDate?: () => Date };
}

async function computeRankingsForCourse(courseId: string) {
  const db = getFirestore();

  // ── 1단계: users 쿼리 ──
  const usersSnap = await db.collection("users").where("courseId", "==", courseId).get();
  const allUsers: UserDoc[] = usersSnap.docs.map(d => ({ id: d.id, ...d.data() } as UserDoc));

  // 테스트 계정 닉네임 (랭킹에서만 제외, 기능은 정상 사용)
  const testAccountNicknames: Record<string, string[]> = {
    biology: ["빠샤"],
    microbiology: ["test"],
  };
  const excludedNicknames = testAccountNicknames[courseId] || [];

  const students = allUsers.filter((u) =>
    u.role !== "professor" && !excludedNicknames.includes(u.nickname || "")
  );
  const professorUids = allUsers.filter((u) => u.role === "professor").map((u) => u.id);

  if (students.length === 0) {
    return { rankedUsers: [], teamRanks: [], totalStudents: 0, weeklyParticipationRate: 0 };
  }

  // 장착 토끼 ID 수집
  const rabbitDocIds = new Set<string>();
  students.forEach((u) => {
    const equipped = u.equippedRabbits || [];
    equipped.forEach((r) => {
      if (r.rabbitId > 0 && r.courseId) {
        rabbitDocIds.add(`${r.courseId}_${r.rabbitId}`);
      }
    });
  });

  // 장착 토끼의 discoveryOrder 수집 (유저별 rabbitHoldings 조회)
  // key: "userId_courseId_rabbitId" → discoveryOrder
  const holdingPairs: Array<{ userId: string; docId: string }> = [];
  students.forEach((u) => {
    const equipped = u.equippedRabbits || [];
    equipped.forEach((r) => {
      if (r.courseId) {
        holdingPairs.push({ userId: u.id, docId: `${r.courseId}_${r.rabbitId}` });
      }
    });
  });

  // ── 2단계: quizzes + quizResults + rabbits + holdings + expHistory 병렬 조회 ──
  const todayStartUTC = getTodayStartUTC();
  const weekStartUTC = getWeekStartUTC();

  const [quizResult, resultsResult, rabbitResult, holdingsResult, expHistoryResult] = await Promise.allSettled([
    professorUids.length > 0
      ? db.collection("quizzes").where("courseId", "==", courseId)
          .select("creatorId", "creatorUid").get()
      : Promise.resolve(null),
    db.collection("quizResults").where("courseId", "==", courseId)
        .select("userId", "quizCreatorId", "quizId", "correctCount", "totalCount", "isUpdate", "completedAt", "createdAt").get(),
    (async () => {
      const names: Record<string, string | null> = {};
      const ids = Array.from(rabbitDocIds);
      for (let i = 0; i < ids.length; i += 10) {
        const batch = ids.slice(i, i + 10);
        const snaps = await Promise.all(
          batch.map(docId => db.collection("rabbits").doc(docId).get())
        );
        snaps.forEach((snap, idx) => {
          if (snap.exists) {
            names[batch[idx]] = snap.data()?.name || null;
          }
        });
      }
      return names;
    })(),
    // 각 유저의 장착 토끼 discoveryOrder 로드
    (async () => {
      const orders: Record<string, number> = {};
      for (let i = 0; i < holdingPairs.length; i += 10) {
        const batch = holdingPairs.slice(i, i + 10);
        const snaps = await Promise.all(
          batch.map(p => db.collection("users").doc(p.userId)
            .collection("rabbitHoldings").doc(p.docId).get())
        );
        snaps.forEach((snap, idx) => {
          if (snap.exists) {
            const key = `${batch[idx].userId}_${batch[idx].docId}`;
            orders[key] = snap.data()?.discoveryOrder || 1;
          }
        });
      }
      return orders;
    })(),
    // 각 학생의 expHistory에서 오늘/이번 주 EXP 합산
    (async () => {
      const dailyExp: Record<string, number> = {};
      const weeklyExp: Record<string, number> = {};
      // 학생 10명씩 배치 쿼리
      for (let i = 0; i < students.length; i += 10) {
        const batch = students.slice(i, i + 10);
        const snaps = await Promise.all(
          batch.map(u =>
            db.collection("users").doc(u.id)
              .collection("expHistory")
              .where("createdAt", ">=", weekStartUTC)
              .select("amount", "createdAt")
              .get()
          )
        );
        snaps.forEach((snap, idx) => {
          const uid = batch[idx].id;
          if (snap.empty) return; // expHistory 기록 없으면 스킵 (접속 안 한 유저)
          let daily = 0;
          let weekly = 0;
          let hasDailyRecord = false;
          snap.docs.forEach(d => {
            const data = d.data();
            const amount = (data.amount as number) || 0;
            const ts = data.createdAt?.toDate?.();
            if (ts) {
              weekly += amount;
              if (ts >= todayStartUTC) {
                daily += amount;
                hasDailyRecord = true;
              }
            }
          });
          // 이번 주 활동자
          weeklyExp[uid] = weekly;
          // 오늘 활동자만 dailyExp 설정
          if (hasDailyRecord) dailyExp[uid] = daily;
        });
      }
      return { dailyExp, weeklyExp };
    })(),
  ]);

  if (resultsResult.status === "rejected") {
    console.error("quizResults 조회 실패:", resultsResult.reason);
    return { rankedUsers: [], teamRanks: [], totalStudents: students.length, weeklyParticipationRate: 0 };
  }

  const quizSnap = quizResult.status === "fulfilled" ? quizResult.value : null;
  const resultsSnap = resultsResult.value;
  const rabbitNames: Record<string, string | null> = rabbitResult.status === "fulfilled" ? rabbitResult.value : {};
  const holdingOrders: Record<string, number> = holdingsResult.status === "fulfilled" ? holdingsResult.value : {};
  const { dailyExp: dailyExpMap, weeklyExp: weeklyExpMap } = expHistoryResult.status === "fulfilled"
    ? expHistoryResult.value : { dailyExp: {} as Record<string, number>, weeklyExp: {} as Record<string, number> };

  // 교수 퀴즈 ID 수집
  const profQuizIds = new Set<string>();
  let totalProfQuizzes = 0;
  if (quizSnap) {
    quizSnap.docs.forEach(d => {
      const data = d.data();
      if (professorUids.includes(data.creatorId) || professorUids.includes(data.creatorUid)) {
        profQuizIds.add(d.id);
      }
    });
    totalProfQuizzes = profQuizIds.size;
  }

  // quizResults 집계 (전체 + 주간 + 일간)
  type ProfStats = { correct: number; attempted: number; quizzesTaken: Set<string> };
  const newStats = (): ProfStats => ({ correct: 0, attempted: 0, quizzesTaken: new Set() });

  const studentProfStats: Record<string, ProfStats> = {};
  const studentWeeklyStats: Record<string, ProfStats> = {};
  const studentDailyStats: Record<string, ProfStats> = {};

  resultsSnap.docs.forEach(d => {
    const r = d.data();
    if (r.isUpdate) return;
    const isProfQuiz = professorUids.includes(r.quizCreatorId) || profQuizIds.has(r.quizId);
    if (!isProfQuiz) return;
    const uid = r.userId as string;
    const correct = r.correctCount || 0;
    const attempted = r.totalCount || 0;
    const quizId = r.quizId as string;
    const ts = r.completedAt?.toDate?.() || r.createdAt?.toDate?.();

    // 전체 (누적)
    if (!studentProfStats[uid]) studentProfStats[uid] = newStats();
    studentProfStats[uid].correct += correct;
    studentProfStats[uid].attempted += attempted;
    if (quizId) studentProfStats[uid].quizzesTaken.add(quizId);

    // 기간별
    if (ts) {
      if (ts >= weekStartUTC) {
        if (!studentWeeklyStats[uid]) studentWeeklyStats[uid] = newStats();
        studentWeeklyStats[uid].correct += correct;
        studentWeeklyStats[uid].attempted += attempted;
        if (quizId) studentWeeklyStats[uid].quizzesTaken.add(quizId);
      }
      if (ts >= todayStartUTC) {
        if (!studentDailyStats[uid]) studentDailyStats[uid] = newStats();
        studentDailyStats[uid].correct += correct;
        studentDailyStats[uid].attempted += attempted;
        if (quizId) studentDailyStats[uid].quizzesTaken.add(quizId);
      }
    }
  });

  // ── 개인 랭킹 ──

  const rankedUsers: RankedUserDoc[] = students.map((u) => {
    const exp = u.totalExp || 0;
    const lastActive = u.lastActiveAt?.toDate?.() || null;
    const profStat = studentProfStats[u.id] || { correct: 0, attempted: 0, quizzesTaken: new Set<string>() };
    // 평균 정답률 (0~100)
    const correctRate = profStat.attempted > 0 ? (profStat.correct / profStat.attempted) * 100 : 0;
    // 응시율 (0~100) — 풀은 퀴즈 수 / 전체 교수 퀴즈 수
    const completionRate = totalProfQuizzes > 0 ? Math.min((profStat.quizzesTaken.size / totalProfQuizzes) * 100, 100) : 0;
    const rankScore = computeRankScore(correctRate, completionRate, exp);

    // 기간별 rankScore (같은 공식, 기간별 데이터)
    const calcPeriodScore = (stats: ProfStats | undefined, periodExp: number | null): number | null => {
      if (periodExp == null) return null;
      if (!stats) return computeRankScore(0, 0, periodExp);
      const cr = stats.attempted > 0 ? (stats.correct / stats.attempted) * 100 : 0;
      const cmr = totalProfQuizzes > 0 ? Math.min((stats.quizzesTaken.size / totalProfQuizzes) * 100, 100) : 0;
      return computeRankScore(cr, cmr, periodExp);
    };
    const dailyRankScore = calcPeriodScore(studentDailyStats[u.id], dailyExpMap[u.id] ?? null);
    const weeklyRankScore = calcPeriodScore(studentWeeklyStats[u.id], weeklyExpMap[u.id] ?? null);

    // 장착 토끼 이름 (discoveryOrder 반영 — "뭉치 2세" 등)
    const allEquipped = u.equippedRabbits || [];
    const names = allEquipped.map((r) => {
      if (r.rabbitId === 0) return "토끼";
      const key = `${r.courseId}_${r.rabbitId}`;
      const baseName = rabbitNames[key] || `토끼 #${r.rabbitId + 1}`;
      const orderKey = `${u.id}_${key}`;
      const order = holdingOrders[orderKey] || 1;
      return order > 1 ? `${baseName} ${order}세` : baseName;
    });
    const equippedRabbitNames = names.length > 0 ? names.join(" & ") : "";

    const firstSlot = allEquipped[0];
    const firstEquippedRabbitId = firstSlot?.rabbitId ?? null;
    const firstKey = firstSlot ? `${firstSlot.courseId}_${firstSlot.rabbitId}` : null;
    const firstBaseName = firstSlot
      ? firstSlot.rabbitId === 0
        ? "토끼"
        : rabbitNames[firstKey!] || `토끼 #${firstSlot.rabbitId + 1}`
      : null;
    const firstOrder = firstSlot && firstKey
      ? holdingOrders[`${u.id}_${firstKey}`] || 1
      : 1;
    const firstEquippedRabbitName = firstBaseName
      ? (firstOrder > 1 ? `${firstBaseName} ${firstOrder}세` : firstBaseName)
      : null;

    return {
      id: u.id,
      nickname: u.nickname || "익명",
      name: u.name || undefined,
      classType: u.classId || "A",
      totalExp: exp,
      dailyExp: u.id in dailyExpMap ? dailyExpMap[u.id]
        : (lastActive && lastActive >= todayStartUTC ? 0 : null),
      weeklyExp: u.id in weeklyExpMap ? weeklyExpMap[u.id]
        : (lastActive && lastActive >= weekStartUTC ? 0 : null),
      dailyRankScore: dailyRankScore ?? (lastActive && lastActive >= todayStartUTC ? computeRankScore(0, 0, 0) : null),
      weeklyRankScore: weeklyRankScore ?? (lastActive && lastActive >= weekStartUTC ? computeRankScore(0, 0, 0) : null),
      profCorrectCount: profStat.correct,
      rankScore,
      profileRabbitId: u.profileRabbitId ?? null,
      equippedRabbitNames,
      equippedRabbits: allEquipped.map((r) => ({
        rabbitId: r.rabbitId,
        courseId: r.courseId,
        discoveryOrder: holdingOrders[`${u.id}_${r.courseId}_${r.rabbitId}`] || 1,
      })),
      firstEquippedRabbitId,
      firstEquippedRabbitName,
      rank: 0,
    };
  });

  // 동점자 공동순위 배정 (A 100점, B 100점, C 90점 → 1위, 1위, 3위)
  rankedUsers.sort((a, b) => b.rankScore - a.rankScore);
  let currentRank = 1;
  rankedUsers.forEach((user, idx) => {
    if (idx > 0 && user.rankScore < rankedUsers[idx - 1].rankScore) {
      currentRank = idx + 1;
    }
    user.rank = currentRank;
  });

  // ── 주간 참여율 (월~일, KST 기준) ──
  const studentIdSet = new Set(students.map((u) => u.id));
  const weeklyActiveIds = new Set<string>();
  resultsSnap.docs.forEach(d => {
    const r = d.data();
    const ts = r.completedAt?.toDate?.() || r.createdAt?.toDate?.();
    if (ts && ts >= weekStartUTC) {
      const uid = r.userId as string;
      if (studentIdSet.has(uid)) weeklyActiveIds.add(uid);
    }
  });
  const weeklyParticipationRate = students.length > 0
    ? Math.round((weeklyActiveIds.size / students.length) * 100)
    : 0;

  // ── 팀 랭킹 ──
  const classes = ["A", "B", "C", "D"];
  const maxExp = Math.max(...students.map((u) => u.totalExp || 0), 1);

  const teamRanks: TeamRankEntry[] = classes.map(cls => {
    const members = students.filter((u) => u.classId === cls);
    if (members.length === 0) return { classId: cls, score: 0, rank: 0 };

    const avgExp = members.reduce((s: number, u) => s + (u.totalExp || 0), 0) / members.length;
    const normalizedAvgExp = (avgExp / maxExp) * 100;

    // 미참여자는 0%로 포함 (전체 멤버 기준 평균)
    const correctRates = members.map((u) => {
      const stat = studentProfStats[u.id];
      if (!stat || stat.attempted === 0) return 0;
      return (stat.correct / stat.attempted) * 100;
    });
    const avgCorrectRate = correctRates.reduce((s, r) => s + r, 0) / members.length;

    let avgCompletionRate = 0;
    if (totalProfQuizzes > 0) {
      const completionRates = members.map((u) =>
        Math.min(((u.professorQuizzesCompleted || 0) / totalProfQuizzes) * 100, 100)
      );
      avgCompletionRate = completionRates.reduce((s, r) => s + r, 0) / completionRates.length;
    }

    return {
      classId: cls,
      score: computeTeamScore(normalizedAvgExp, avgCorrectRate, avgCompletionRate),
      rank: 0,
    };
  });

  // 팀 동점 처리
  teamRanks.sort((a, b) => b.score - a.score);
  let teamCurrentRank = 1;
  teamRanks.forEach((t, i) => {
    if (i > 0 && t.score < teamRanks[i - 1].score) {
      teamCurrentRank = i + 1;
    }
    t.rank = teamCurrentRank;
  });

  return { rankedUsers, teamRanks, totalStudents: students.length, weeklyParticipationRate };
}

// ── Callable: 특정 courseId 강제 갱신 ──

export const refreshRankings = onCall(
  { region: "asia-northeast3", concurrency: 10 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const { courseId } = request.data as { courseId: string };
    if (!courseId) {
      throw new HttpsError("invalid-argument", "courseId가 필요합니다.");
    }

    const db = getFirestore();

    // 최근 1분 이내 갱신 됐으면 스킵 (과도한 호출 방지)
    const existing = await db.collection("rankings").doc(courseId).get();
    if (existing.exists) {
      const updatedAt = existing.data()?.updatedAt?.toDate();
      if (updatedAt && Date.now() - updatedAt.getTime() < 60_000) {
        return { success: true, message: "최근 갱신됨, 스킵" };
      }
    }

    const result = await computeRankingsForCourse(courseId);

    await db.collection("rankings").doc(courseId).set({
      ...result,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { success: true, totalStudents: result.totalStudents };
  }
);

// ── Scheduled: 10분마다 모든 courseId 갱신 ──

export const computeRankingsScheduled = onSchedule(
  {
    schedule: "every 10 minutes",
    region: "asia-northeast3",
    timeZone: "Asia/Seoul",
    memory: "512MiB",
    timeoutSeconds: 120,
  },
  async () => {
    const db = getFirestore();

    // 활성 courseId 목록 수집 (settings/semester에서)
    const semesterDoc = await db.collection("settings").doc("semester").get();
    const courseIds: string[] = [];

    if (semesterDoc.exists) {
      const data = semesterDoc.data();
      if (data?.courseId) courseIds.push(data.courseId);
      // 여러 과목 지원 시
      if (data?.courseIds && Array.isArray(data.courseIds)) {
        courseIds.push(...data.courseIds);
      }
    }

    // settings에 courseId가 없으면 기본 과목 사용 (users 전체 스캔 방지)
    if (courseIds.length === 0) {
      // 학기별 기본 과목 (1학기: biology+microbiology, 2학기: pathophysiology)
      const now = new Date();
      const month = now.getMonth() + 1; // 1-12
      if (month >= 2 && month <= 8) {
        courseIds.push("biology", "microbiology");
      } else {
        courseIds.push("pathophysiology");
      }
    }

    const uniqueIds = [...new Set(courseIds)];
    console.log(`랭킹 계산 시작: ${uniqueIds.length}개 과목`);

    for (const courseId of uniqueIds) {
      try {
        const result = await computeRankingsForCourse(courseId);
        await db.collection("rankings").doc(courseId).set({
          ...result,
          updatedAt: FieldValue.serverTimestamp(),
        });
        console.log(`랭킹 계산 완료: ${courseId} (${result.totalStudents}명)`);
      } catch (error) {
        console.error(`랭킹 계산 실패: ${courseId}`, error);
      }
    }
  }
);
