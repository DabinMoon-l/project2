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
      battleByUid: {},
      expByUid: {},
      weightedScoreByUid: {},
      studentClassMap: {},
      quizCreationCounts: [],
      communityScores: [],
      battleValues: [],
      expValues: [],
      weightedScoreValues: [],
      totalStudents: 0,
    };
  }

  const studentUids = new Set<string>();
  const expByUid: Record<string, number> = {};
  const fbCountByUid: Record<string, number> = {};
  const battleByUid: Record<string, number> = {};
  const studentClassMap: Record<string, string> = {};

  usersSnap.docs.forEach(d => {
    const data = d.data();
    studentUids.add(d.id);
    expByUid[d.id] = data.totalExp || 0;
    fbCountByUid[d.id] = data.feedbackCount || 0;
    battleByUid[d.id] = data.tekkenWins || 0;
    studentClassMap[d.id] = data.classId || "A";
  });

  // 2. 3개 병렬 쿼리 (select로 필요한 필드만 — 메모리 절약)
  // quizResults는 courseId 필터 대신, 해당 과목 학생 uid로 필터 (이전 데이터 courseId 누락 대응)
  const studentUidArray = Array.from(studentUids);
  const quizResultBatches: Promise<FirebaseFirestore.QuerySnapshot>[] = [];
  for (let i = 0; i < studentUidArray.length; i += 30) {
    const batch = studentUidArray.slice(i, i + 30);
    quizResultBatches.push(
      db.collection("quizResults").where("userId", "in", batch).select("userId", "quizId", "score", "isUpdate").get()
    );
  }

  const [quizzesResult, postsResult, commentsResult, ...quizResultBatchResults] = await Promise.allSettled([
    db.collection("quizzes").where("courseId", "==", courseId).select("creatorId", "type").get(),
    db.collection("posts").where("courseId", "==", courseId).select("authorId").get(),
    db.collection("comments").where("courseId", "==", courseId).select("authorId").get(),
    ...quizResultBatches,
  ]);

  if (quizzesResult.status === "rejected") console.error(`quizzes 쿼리 실패 (${courseId}):`, quizzesResult.reason);
  if (postsResult.status === "rejected") console.error(`posts 쿼리 실패 (${courseId}):`, postsResult.reason);

  const quizzesDocs = quizzesResult.status === "fulfilled" ? quizzesResult.value.docs : [];
  const postsDocs = postsResult.status === "fulfilled" ? postsResult.value.docs : [];
  const commentsDocs = commentsResult.status === "fulfilled" ? commentsResult.value.docs : [];
  // quizResults 배치 결과 합치기
  const quizResultsDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  quizResultBatchResults.forEach(r => {
    if (r.status === "fulfilled") quizResultsDocs.push(...r.value.docs);
    else console.error(`quizResults 배치 쿼리 실패 (${courseId}):`, r.reason);
  });

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

  // 댓글 수 집계
  const commentCountByUid: Record<string, number> = {};
  commentsDocs.forEach(d => {
    const authorId = d.data().authorId as string;
    if (authorId && studentUids.has(authorId)) {
      commentCountByUid[authorId] = (commentCountByUid[authorId] ?? 0) + 1;
    }
  });

  const communityByUid: Record<string, number> = {};
  studentUids.forEach(uid => {
    communityByUid[uid] = (postCountByUid[uid] ?? 0) * 3 + (commentCountByUid[uid] ?? 0) * 2 + (fbCountByUid[uid] ?? 0);
  });

  // 5. 퀴즈 축 — 교수 퀴즈 평균 점수 (원점수, 0~100)
  const PROF_TYPES = new Set(["midterm", "final", "past", "professor", "professor-ai", "independent"]);
  const courseQuizIds = new Set<string>();
  const profQuizIds = new Set<string>();
  quizzesDocs.forEach(d => {
    courseQuizIds.add(d.id);
    if (PROF_TYPES.has(d.data().type || "")) profQuizIds.add(d.id);
  });

  // 교수 퀴즈 결과만 수집 (첫 시도만)
  const profScoresByUid = new Map<string, number[]>();
  quizResultsDocs.forEach(d => {
    const qr = d.data();
    if (!studentUids.has(qr.userId)) return;
    const qid = qr.quizId as string;
    if (!qid || !profQuizIds.has(qid)) return; // 교수 퀴즈만
    if (qr.isUpdate === true) return;
    const arr = profScoresByUid.get(qr.userId) ?? [];
    arr.push(qr.score ?? 0);
    profScoresByUid.set(qr.userId, arr);
  });

  // 학생별 교수 퀴즈 평균 점수
  const weightedScoreByUid: Record<string, number> = {};
  studentUids.forEach(uid => {
    const scores = profScoresByUid.get(uid);
    if (!scores || scores.length === 0) { weightedScoreByUid[uid] = 0; return; }
    const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
    weightedScoreByUid[uid] = Math.round(avg * 100) / 100;
  });

  // 6. 백분위 배열 (오름차순 정렬) — 5축 전부 백분위
  const uids = Array.from(studentUids);
  const quizCreationCounts = uids.map(u => quizCreationByUid[u] ?? 0).sort((a, b) => a - b);
  const communityScores = uids.map(u => communityByUid[u] ?? 0).sort((a, b) => a - b);
  const battleValues = uids.map(u => battleByUid[u] ?? 0).sort((a, b) => a - b);
  const expValues = uids.map(u => expByUid[u] ?? 0).sort((a, b) => a - b);
  const weightedScoreValues = uids.map(u => weightedScoreByUid[u] ?? 0).sort((a, b) => a - b);

  // 진단 로그
  const nonZeroBattle = Object.values(battleByUid).filter(v => v > 0).length;
  const nonZeroQuiz = Object.values(weightedScoreByUid).filter(v => v > 0).length;
  console.log(`[${courseId}] 학생: ${studentUids.size}명, 퀴즈결과: ${quizResultsDocs.length}건(과목퀴즈: ${courseQuizIds.size}개), 퀴즈축>0: ${nonZeroQuiz}명, 배틀축>0: ${nonZeroBattle}명`);

  return {
    quizCreationByUid,
    communityByUid,
    battleByUid,
    expByUid,
    weightedScoreByUid,
    studentClassMap,
    quizCreationCounts,
    communityScores,
    battleValues,
    expValues,
    weightedScoreValues,
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

// ── Scheduled: 10분마다 모든 courseId 갱신 ──

export const computeRadarNormScheduled = onSchedule(
  {
    schedule: "every 10 minutes",
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
