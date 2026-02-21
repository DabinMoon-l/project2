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

function computeRankScore(profCorrectCount: number, totalExp: number): number {
  return profCorrectCount * 4 + totalExp * 0.6;
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

// ── 랭킹 계산 핵심 로직 ──

interface RankedUserDoc {
  id: string;
  nickname: string;
  classType: string;
  totalExp: number;
  profCorrectCount: number;
  rankScore: number;
  profileRabbitId: number | null;
  equippedRabbitNames: string;
  firstEquippedRabbitId: number | null;
  firstEquippedRabbitName: string | null;
  rank: number;
}

interface TeamRankEntry {
  classId: string;
  score: number;
  rank: number;
}

async function computeRankingsForCourse(courseId: string) {
  const db = getFirestore();

  // ── 1단계: users 쿼리 ──
  const usersSnap = await db.collection("users").where("courseId", "==", courseId).get();
  const allUsers = usersSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

  const students = allUsers.filter((u: any) => u.role !== "professor");
  const professorUids = allUsers.filter((u: any) => u.role === "professor").map((u: any) => u.id);

  if (students.length === 0) {
    return { rankedUsers: [], teamRanks: [], totalStudents: 0, weeklyParticipationRate: 0 };
  }

  // 장착 토끼 ID 수집
  const rabbitDocIds = new Set<string>();
  students.forEach((u: any) => {
    const equipped = u.equippedRabbits || [];
    equipped.forEach((r: any) => {
      if (r.rabbitId > 0 && r.courseId) {
        rabbitDocIds.add(`${r.courseId}_${r.rabbitId}`);
      }
    });
  });

  // ── 2단계: quizzes + quizResults + rabbits 병렬 조회 ──
  const [quizSnap, resultsSnap, rabbitNames] = await Promise.all([
    professorUids.length > 0
      ? db.collection("quizzes").where("courseId", "==", courseId).get()
      : Promise.resolve(null),
    db.collection("quizResults").where("courseId", "==", courseId).get(),
    (async () => {
      const names: Record<string, string> = {};
      const ids = Array.from(rabbitDocIds);
      // 10개씩 배치 조회
      for (let i = 0; i < ids.length; i += 10) {
        const batch = ids.slice(i, i + 10);
        const snaps = await Promise.all(
          batch.map(docId => db.collection("rabbits").doc(docId).get())
        );
        snaps.forEach((snap, idx) => {
          if (snap.exists) {
            names[batch[idx]] = snap.data()?.name || `토끼 #${batch[idx].split("_")[1]}`;
          }
        });
      }
      return names;
    })(),
  ]);

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

  // quizResults 집계
  const studentProfStats: Record<string, { correct: number; attempted: number }> = {};
  resultsSnap.docs.forEach(d => {
    const r = d.data();
    if (r.isUpdate) return;
    const isProfQuiz = professorUids.includes(r.quizCreatorId) || profQuizIds.has(r.quizId);
    if (!isProfQuiz) return;
    const uid = r.userId as string;
    if (!studentProfStats[uid]) studentProfStats[uid] = { correct: 0, attempted: 0 };
    studentProfStats[uid].correct += r.correctCount || 0;
    studentProfStats[uid].attempted += r.totalCount || 0;
  });

  // ── 개인 랭킹 ──

  const rankedUsers: RankedUserDoc[] = students.map((u: any) => {
    const exp = u.totalExp || 0;
    const profStat = studentProfStats[u.id] || { correct: 0, attempted: 0 };
    const rankScore = computeRankScore(profStat.correct, exp);

    // 장착 토끼 이름
    const allEquipped = u.equippedRabbits || [];
    const names = allEquipped.map((r: any) => {
      if (r.rabbitId === 0) return "토끼";
      const key = `${r.courseId}_${r.rabbitId}`;
      return rabbitNames[key] || `토끼 #${r.rabbitId}`;
    });
    const equippedRabbitNames = names.length > 0 ? names.join(" & ") : "";

    const firstSlot = allEquipped[0];
    const firstEquippedRabbitId = firstSlot?.rabbitId ?? null;
    const firstEquippedRabbitName = firstSlot
      ? firstSlot.rabbitId === 0
        ? "토끼"
        : rabbitNames[`${firstSlot.courseId}_${firstSlot.rabbitId}`] || `토끼 #${firstSlot.rabbitId}`
      : null;

    return {
      id: u.id,
      nickname: u.nickname || "익명",
      classType: u.classId || "A",
      totalExp: exp,
      profCorrectCount: profStat.correct,
      rankScore,
      profileRabbitId: u.profileRabbitId ?? null,
      equippedRabbitNames,
      firstEquippedRabbitId,
      firstEquippedRabbitName,
      rank: 0,
    };
  });

  rankedUsers.sort((a, b) => b.rankScore - a.rankScore);
  rankedUsers.forEach((user, idx) => { user.rank = idx + 1; });

  // ── 주간 참여율 (월~일, KST 기준) ──
  const studentIdSet = new Set(students.map((u: any) => u.id));
  const weekStartUTC = getWeekStartUTC();
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
  const maxExp = Math.max(...students.map((u: any) => u.totalExp || 0), 1);

  const teamRanks: TeamRankEntry[] = classes.map(cls => {
    const members = students.filter((u: any) => u.classId === cls);
    if (members.length === 0) return { classId: cls, score: 0, rank: 0 };

    const avgExp = members.reduce((s: number, u: any) => s + (u.totalExp || 0), 0) / members.length;
    const normalizedAvgExp = (avgExp / maxExp) * 100;

    const correctRates = members.map((u: any) => {
      const stat = studentProfStats[u.id];
      if (!stat || stat.attempted === 0) return 0;
      return (stat.correct / stat.attempted) * 100;
    });
    const avgCorrectRate = correctRates.reduce((s, r) => s + r, 0) / correctRates.length;

    let avgCompletionRate = 0;
    if (totalProfQuizzes > 0) {
      const completionRates = members.map((u: any) =>
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

  teamRanks.sort((a, b) => b.score - a.score);
  teamRanks.forEach((t, i) => { t.rank = i + 1; });

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

// ── Scheduled: 5분마다 모든 courseId 갱신 ──

export const computeRankingsScheduled = onSchedule(
  {
    schedule: "every 5 minutes",
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

    // settings에 courseId가 없으면 users에서 수집
    if (courseIds.length === 0) {
      const usersSnap = await db.collection("users").limit(100).get();
      const ids = new Set<string>();
      usersSnap.docs.forEach(d => {
        const cid = d.data().courseId;
        if (cid) ids.add(cid);
      });
      courseIds.push(...ids);
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
