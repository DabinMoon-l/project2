/**
 * 레이더 정규화 데이터 사전 계산 Cloud Function
 *
 * radarNorm/{courseId} 문서에 학생별 출제력/소통/복습력/활동량/가중석차 데이터 저장.
 * 클라이언트(useProfessorStudents)는 이 문서 1개만 onSnapshot 구독하면 됨.
 *
 * - 스케줄: 5분마다 자동 실행 (모든 courseId)
 * - Callable: 강제 갱신 (특정 courseId, 60초 레이트리밋)
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// ── 핵심 로직 ──

async function computeRadarNormForCourse(courseId: string) {
  const db = getFirestore();

  // 1. 학생 목록 조회
  const usersSnap = await db.collection("users")
    .where("role", "==", "student")
    .where("courseId", "==", courseId)
    .get();

  if (usersSnap.empty) {
    return {
      quizCreationByUid: {},
      communityByUid: {},
      activeReviewByUid: {},
      expByUid: {},
      weightedScoreByUid: {},
      studentClassMap: {},
      quizCreationCounts: [],
      communityScores: [],
      activeReviewCounts: [],
      expValues: [],
      totalStudents: 0,
    };
  }

  const studentUids = new Set<string>();
  const expByUid: Record<string, number> = {};
  const fbCountByUid: Record<string, number> = {};
  const studentClassMap: Record<string, string> = {};

  usersSnap.docs.forEach(d => {
    const data = d.data();
    studentUids.add(d.id);
    expByUid[d.id] = data.totalExp || 0;
    fbCountByUid[d.id] = data.feedbackCount || 0;
    studentClassMap[d.id] = data.classId || "A";
  });

  // 2. 4개 병렬 쿼리 (select로 필요한 필드만 — 메모리 절약)
  const [quizzesResult, postsResult, reviewsResult, quizResultsResult] = await Promise.allSettled([
    db.collection("quizzes").where("courseId", "==", courseId).select("creatorId", "type").get(),
    db.collection("posts").where("courseId", "==", courseId).select("authorId").get(),
    db.collection("reviews").where("courseId", "==", courseId).select("userId", "reviewCount").get(),
    db.collection("quizResults").where("courseId", "==", courseId).select("userId", "quizId", "score", "isUpdate").get(),
  ]);

  const quizzesDocs = quizzesResult.status === "fulfilled" ? quizzesResult.value.docs : [];
  const postsDocs = postsResult.status === "fulfilled" ? postsResult.value.docs : [];
  const reviewsDocs = reviewsResult.status === "fulfilled" ? reviewsResult.value.docs : [];
  const quizResultsDocs = quizResultsResult.status === "fulfilled" ? quizResultsResult.value.docs : [];

  // 3. 출제력 (학생이 만든 퀴즈 수)
  const quizCreationByUid: Record<string, number> = {};
  quizzesDocs.forEach(d => {
    const creatorId = d.data().creatorId as string;
    if (creatorId && studentUids.has(creatorId)) {
      quizCreationByUid[creatorId] = (quizCreationByUid[creatorId] ?? 0) + 1;
    }
  });

  // 4. 소통 (글×3 + 피드백)
  const postCountByUid: Record<string, number> = {};
  postsDocs.forEach(d => {
    const authorId = d.data().authorId as string;
    if (authorId && studentUids.has(authorId)) {
      postCountByUid[authorId] = (postCountByUid[authorId] ?? 0) + 1;
    }
  });

  const communityByUid: Record<string, number> = {};
  studentUids.forEach(uid => {
    communityByUid[uid] = (postCountByUid[uid] ?? 0) * 3 + (fbCountByUid[uid] ?? 0);
  });

  // 5. 복습력 (리뷰 문서 수 — 퀴즈 완료 시 생성됨)
  // reviewCount 조건 제거: markAsReviewed가 library 타입에서 사일런트 실패하고
  // 퀴즈 재시도 시 reviewCount가 0으로 리셋되므로, 문서 존재 자체를 복습력으로 산정
  const activeReviewByUid: Record<string, number> = {};
  reviewsDocs.forEach(d => {
    const data = d.data();
    const userId = data.userId as string;
    if (userId && studentUids.has(userId)) {
      activeReviewByUid[userId] = (activeReviewByUid[userId] ?? 0) + 1;
    }
  });

  // 6. 백분위 배열 (오름차순 정렬)
  const uids = Array.from(studentUids);
  const quizCreationCounts = uids.map(u => quizCreationByUid[u] ?? 0).sort((a, b) => a - b);
  const communityScores = uids.map(u => communityByUid[u] ?? 0).sort((a, b) => a - b);
  const activeReviewCounts = uids.map(u => activeReviewByUid[u] ?? 0).sort((a, b) => a - b);
  const expValues = uids.map(u => expByUid[u] ?? 0).sort((a, b) => a - b);

  // 7. 가중 석차 점수 (첫 시도만 사용)
  const PROF_TYPES = new Set(["midterm", "final", "past", "professor", "professor-ai"]);
  const quizTypeMap = new Map<string, boolean>();
  quizzesDocs.forEach(d => quizTypeMap.set(d.id, PROF_TYPES.has(d.data().type || "")));

  // 첫 시도 / 재시도 분리 수집 (성장세 계산에도 사용)
  const completionsByQuiz = new Map<string, { userId: string; score: number }[]>();
  // 성장세용: 학생별 퀴즈별 { firstScore, bestRetryScore }
  const retryMap = new Map<string, Map<string, { first: number; retries: number[] }>>();

  quizResultsDocs.forEach(d => {
    const qr = d.data();
    if (!studentUids.has(qr.userId)) return;
    const qid = qr.quizId as string;
    if (!qid) return;
    const isRetry = qr.isUpdate === true;

    if (!isRetry) {
      // 첫 시도 → 가중 석차에 사용
      const arr = completionsByQuiz.get(qid) ?? [];
      arr.push({ userId: qr.userId, score: qr.score ?? 0 });
      completionsByQuiz.set(qid, arr);
    }

    // 성장세 데이터 수집 (첫 시도 + 재시도 모두)
    if (!retryMap.has(qr.userId)) retryMap.set(qr.userId, new Map());
    const userQuizMap = retryMap.get(qr.userId)!;
    if (!userQuizMap.has(qid)) userQuizMap.set(qid, { first: -1, retries: [] });
    const entry = userQuizMap.get(qid)!;
    if (!isRetry) {
      entry.first = qr.score ?? 0;
    } else {
      entry.retries.push(qr.score ?? 0);
    }
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
      // 참여자 5명 미만: 실제 점수 사용 (소수 참여 시 석차 부풀림 방지)
      // 참여자 5명 이상: 석차 기반 점수 사용
      const rankScore = N < 5
        ? (p.score ?? 0)
        : ((N - rank + 1) / N) * 100;
      const pairs = studentScorePairs.get(p.userId) ?? [];
      pairs.push({ rankScore, weight });
      studentScorePairs.set(p.userId, pairs);
    });
  });

  const weightedScoreByUid: Record<string, number> = {};
  studentUids.forEach(uid => {
    const pairs = studentScorePairs.get(uid);
    if (!pairs || pairs.length === 0) { weightedScoreByUid[uid] = 0; return; }
    const tw = pairs.reduce((s, p) => s + p.weight, 0);
    const tws = pairs.reduce((s, p) => s + p.rankScore * p.weight, 0);
    weightedScoreByUid[uid] = Math.round((tws / tw) * 100) / 100;
  });

  // 8. 성장세 (재시도 개선율)
  // 재시도가 있는 퀴즈에서 (최고 재시도 점수 - 첫 시도 점수)의 평균
  // 0~100 스케일, 50이 기준선(변화 없음), 100이 만점 개선
  const growthByUid: Record<string, number> = {};
  studentUids.forEach(uid => {
    const userQuizMap = retryMap.get(uid);
    if (!userQuizMap) { growthByUid[uid] = 50; return; }

    const improvements: number[] = [];
    userQuizMap.forEach(({ first, retries }) => {
      if (first < 0 || retries.length === 0) return;
      const bestRetry = Math.max(...retries);
      // 개선폭: (bestRetry - first) — -100 ~ +100 범위
      improvements.push(bestRetry - first);
    });

    if (improvements.length === 0) {
      growthByUid[uid] = 50; // 재시도 없음 → 기준선
    } else {
      const avgImprovement = improvements.reduce((s, v) => s + v, 0) / improvements.length;
      // -100~+100 → 0~100 스케일 (50이 기준선)
      growthByUid[uid] = Math.round(Math.max(0, Math.min(100, 50 + avgImprovement / 2)));
    }
  });
  const growthValues = uids.map(u => growthByUid[u] ?? 50).sort((a, b) => a - b);

  return {
    quizCreationByUid,
    communityByUid,
    activeReviewByUid,
    expByUid,
    weightedScoreByUid,
    growthByUid,
    studentClassMap,
    quizCreationCounts,
    communityScores,
    activeReviewCounts,
    expValues,
    growthValues,
    totalStudents: studentUids.size,
  };
}

// ── Callable: 특정 courseId 강제 갱신 (60초 레이트리밋) ──

export const refreshRadarNorm = onCall(
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

    // 60초 레이트리밋
    const existing = await db.collection("radarNorm").doc(courseId).get();
    if (existing.exists) {
      const updatedAt = existing.data()?.updatedAt?.toDate();
      if (updatedAt && Date.now() - updatedAt.getTime() < 60_000) {
        return { success: true, message: "최근 갱신됨, 스킵" };
      }
    }

    const result = await computeRadarNormForCourse(courseId);
    await db.collection("radarNorm").doc(courseId).set({
      ...result,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { success: true, totalStudents: result.totalStudents };
  }
);

// ── Scheduled: 5분마다 모든 courseId 갱신 ──

export const computeRadarNormScheduled = onSchedule(
  {
    schedule: "every 5 minutes",
    region: "asia-northeast3",
    timeZone: "Asia/Seoul",
    memory: "1GiB",
    timeoutSeconds: 120,
  },
  async () => {
    const db = getFirestore();

    // 활성 courseId 목록 수집
    const semesterDoc = await db.collection("settings").doc("semester").get();
    const courseIds: string[] = [];

    if (semesterDoc.exists) {
      const data = semesterDoc.data();
      if (data?.courseId) courseIds.push(data.courseId);
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
    console.log(`레이더 정규화 계산 시작: ${uniqueIds.length}개 과목`);

    for (const courseId of uniqueIds) {
      try {
        const result = await computeRadarNormForCourse(courseId);
        await db.collection("radarNorm").doc(courseId).set({
          ...result,
          updatedAt: FieldValue.serverTimestamp(),
        });
        console.log(`레이더 정규화 계산 완료: ${courseId} (${result.totalStudents}명)`);
      } catch (error) {
        console.error(`레이더 정규화 계산 실패: ${courseId}`, error);
      }
    }
  }
);
