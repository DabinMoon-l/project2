/**
 * 학습 통계 수집
 *
 * 퀴즈 정답률, 챕터별 before/after, 퀴즈별 상세, 복습, 피드백
 * 원칙: raw 숫자 수집, 분석은 Claude에게
 */

import { getFirestore } from "firebase-admin/firestore";
import { CollectContext, LearningStats, QuizDetail } from "./types";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const courseChapters = require("../shared/courseChapters.json");

const PROF_TYPES = new Set(["midterm", "final", "past", "professor", "professor-ai", "independent"]);
const AI_TYPES = new Set(["ai-generated"]);
const FEEDBACK_SCORES: Record<string, number> = {
  praise: 2, wantmore: 1, other: 0, typo: -1, unclear: -1, wrong: -2,
};

export async function collectLearning(ctx: CollectContext): Promise<LearningStats> {
  const db = getFirestore();
  const { courseId, startTs, endTs, studentIds, totalStudents } = ctx;

  // ── 주간 신규 퀴즈 ──
  const quizzesSnap = await db.collection("quizzes")
    .where("courseId", "==", courseId)
    .where("createdAt", ">=", startTs)
    .where("createdAt", "<", endTs)
    .get();

  const typeDistribution: Record<string, number> = {};
  quizzesSnap.docs.forEach(d => {
    const t = d.data().type || "unknown";
    typeDistribution[t] = (typeDistribution[t] || 0) + 1;
  });

  // ── 전체 퀴즈 메타 (타입+제목+챕터 매핑) ──
  const allQuizzesSnap = await db.collection("quizzes")
    .where("courseId", "==", courseId)
    .select("type", "title", "questions")
    .get();

  const quizMeta = new Map<string, { type: string; title: string; chapterIds: string[] }>();
  allQuizzesSnap.docs.forEach(d => {
    const data = d.data();
    const questions = data.questions as Array<{ chapterId?: string }> | undefined;
    const chapters = questions
      ? [...new Set(questions.map(q => q.chapterId || "").filter(Boolean))]
      : [];
    quizMeta.set(d.id, {
      type: data.type || "",
      title: data.title || "",
      chapterIds: chapters,
    });
  });

  // ── 주간 퀴즈 결과 ──
  const weekResultsSnap = await db.collection("quizResults")
    .where("courseId", "==", courseId)
    .where("createdAt", ">=", startTs)
    .where("createdAt", "<", endTs)
    .get();

  let totalCorrect = 0, totalQuestions = 0;
  let reviewCount = 0;
  const quizSolveUsers = new Set<string>();
  const reviewUsers = new Set<string>();
  let profCorrect = 0, profTotal = 0;
  let aiCorrect = 0, aiTotal = 0;

  // 퀴즈별 상세 집계
  const quizStats: Record<string, {
    solveUsers: Set<string>; correct: number; total: number;
    questionWrong: Record<number, { wrong: number; total: number }>;
  }> = {};

  // 챕터별 정답률 (첫시도 vs 복습)
  const chapterFirst: Record<string, { correct: number; total: number }> = {};
  const chapterReview: Record<string, { correct: number; total: number }> = {};

  weekResultsSnap.docs.forEach(d => {
    const r = d.data();
    const uid = r.userId as string;
    const qid = r.quizId as string;
    const correct = r.correctCount || 0;
    const total = r.totalCount || 0;
    const meta = quizMeta.get(qid);
    const qType = meta?.type || "";
    const isReview = r.isReview || r.isUpdate;

    totalCorrect += correct;
    totalQuestions += total;

    if (isReview) {
      reviewCount++;
      if (uid) reviewUsers.add(uid);
    } else {
      if (uid) quizSolveUsers.add(uid);
    }

    // 교수 vs AI
    if (PROF_TYPES.has(qType)) { profCorrect += correct; profTotal += total; }
    else if (AI_TYPES.has(qType)) { aiCorrect += correct; aiTotal += total; }

    // 퀴즈별 상세
    if (!quizStats[qid]) {
      quizStats[qid] = { solveUsers: new Set(), correct: 0, total: 0, questionWrong: {} };
    }
    quizStats[qid].solveUsers.add(uid);
    quizStats[qid].correct += correct;
    quizStats[qid].total += total;

    // 문제별 오답 (questionScores 필드)
    const scores = r.questionScores as Record<string, { isCorrect?: boolean }> | undefined;
    if (scores) {
      for (const [qKey, score] of Object.entries(scores)) {
        const idx = parseInt(qKey.replace("q", "")) - 1;
        if (isNaN(idx)) continue;
        if (!quizStats[qid].questionWrong[idx]) quizStats[qid].questionWrong[idx] = { wrong: 0, total: 0 };
        quizStats[qid].questionWrong[idx].total++;
        if (!score.isCorrect) quizStats[qid].questionWrong[idx].wrong++;
      }
    }

    // 챕터별 정답률
    if (meta?.chapterIds) {
      for (const chId of meta.chapterIds) {
        const target = isReview ? chapterReview : chapterFirst;
        if (!target[chId]) target[chId] = { correct: 0, total: 0 };
        target[chId].correct += correct;
        target[chId].total += total;
      }
    }
  });

  // 퀴즈별 상세 변환
  const quizDetails: QuizDetail[] = [];
  // 피드백 전체 조회
  const fbSnap = await db.collection("questionFeedbacks")
    .where("courseId", "==", courseId)
    .where("createdAt", ">=", startTs)
    .where("createdAt", "<", endTs)
    .get();

  // 퀴즈별 피드백 집계
  const quizFeedbacks: Record<string, Record<string, number>> = {};
  fbSnap.docs.forEach(d => {
    const data = d.data();
    const qid = data.quizId as string;
    const fType = data.type as string;
    if (!quizFeedbacks[qid]) quizFeedbacks[qid] = {};
    quizFeedbacks[qid][fType] = (quizFeedbacks[qid][fType] || 0) + 1;
  });

  for (const [qid, stats] of Object.entries(quizStats)) {
    const meta = quizMeta.get(qid);
    if (!meta) continue;
    const rate = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;

    // 오답 TOP 3
    const wrongList = Object.entries(stats.questionWrong)
      .map(([idx, { wrong, total }]) => ({
        index: parseInt(idx) + 1,
        wrongRate: total > 0 ? Math.round((wrong / total) * 100) : 0,
      }))
      .filter(q => q.wrongRate > 0)
      .sort((a, b) => b.wrongRate - a.wrongRate)
      .slice(0, 3);

    const fb = quizFeedbacks[qid] || {};
    const fbCount = Object.values(fb).reduce((a, b) => a + b, 0);

    quizDetails.push({
      quizId: qid,
      title: meta.title,
      type: meta.type,
      solveCount: stats.solveUsers.size,
      correctRate: rate,
      topWrongQuestions: wrongList,
      feedbackCount: fbCount,
      feedbackByType: fb,
    });
  }

  // 풀이 수 내림차순 정렬, 상위 15개
  quizDetails.sort((a, b) => b.solveCount - a.solveCount);
  const topQuizDetails = quizDetails.slice(0, 15);

  // 챕터별 before/after
  // 과목별 챕터 인덱스에서 이름 매핑
  interface ChapterInfo { id: string; name: string; shortName?: string }
  const courseData = courseChapters[courseId] as { chapters?: ChapterInfo[] } | undefined;
  const chapterList = courseData?.chapters || [];
  const chapterNameMap = new Map<string, string>();
  chapterList.forEach((ch: ChapterInfo) => chapterNameMap.set(ch.id, ch.shortName || ch.name));

  const chapterCorrectRates: Record<string, { firstAttempt: number; afterReview: number; attempts: number }> = {};

  // chapterId (예: "micro_4") 기반 집계
  const allChapterIds = new Set([...Object.keys(chapterFirst), ...Object.keys(chapterReview)]);
  for (const chId of allChapterIds) {
    const first = chapterFirst[chId];
    const review = chapterReview[chId];
    const firstRate = first && first.total > 0 ? Math.round((first.correct / first.total) * 100) : -1;
    const reviewRate = review && review.total > 0 ? Math.round((review.correct / review.total) * 100) : -1;
    if (firstRate >= 0 || reviewRate >= 0) {
      const name = chapterNameMap.get(chId) || chId;
      chapterCorrectRates[name] = {
        firstAttempt: firstRate >= 0 ? firstRate : 0,
        afterReview: reviewRate >= 0 ? reviewRate : 0,
        attempts: (first?.total || 0) + (review?.total || 0),
      };
    }
  }

  // 전체 평균
  const avgCorrectRate = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;
  const profQuizCorrectRate = profTotal > 0 ? Math.round((profCorrect / profTotal) * 100) : 0;
  const aiQuizCorrectRate = aiTotal > 0 ? Math.round((aiCorrect / aiTotal) * 100) : 0;

  // 완료율
  const quizUserSets: Record<string, Set<string>> = {};
  weekResultsSnap.docs.forEach(d => {
    const r = d.data();
    if (r.isUpdate || r.isReview) return;
    const qid = r.quizId as string, uid = r.userId as string;
    if (qid && uid) {
      if (!quizUserSets[qid]) quizUserSets[qid] = new Set();
      quizUserSets[qid].add(uid);
    }
  });
  let avgCompletionRate = 0;
  if (totalStudents > 0) {
    const rates = Object.values(quizUserSets).map(s => (s.size / totalStudents) * 100);
    if (rates.length > 0) avgCompletionRate = Math.round(rates.reduce((a, b) => a + b, 0) / rates.length);
  }

  const reviewConversionRate = quizSolveUsers.size > 0
    ? Math.round((reviewUsers.size / quizSolveUsers.size) * 100) : 0;

  // 피드백 전체
  const fbByType: Record<string, number> = {};
  let fbScoreSum = 0;
  fbSnap.docs.forEach(d => {
    const t = d.data().type as string;
    fbByType[t] = (fbByType[t] || 0) + 1;
    fbScoreSum += FEEDBACK_SCORES[t] ?? 0;
  });

  // 군집
  const allResultsSnap = await db.collection("quizResults")
    .where("courseId", "==", courseId)
    .select("userId", "quizId", "correctCount", "totalCount", "isUpdate")
    .get();

  const profQuizIds = new Set<string>();
  allQuizzesSnap.docs.forEach(d => {
    if (PROF_TYPES.has(d.data().type || "")) profQuizIds.add(d.id);
  });

  const studentStats: Record<string, { correct: number; attempted: number }> = {};
  allResultsSnap.docs.forEach(d => {
    const r = d.data();
    if (r.isUpdate) return;
    if (!profQuizIds.has(r.quizId)) return;
    const uid = r.userId as string;
    if (!studentIds.has(uid)) return;
    if (!studentStats[uid]) studentStats[uid] = { correct: 0, attempted: 0 };
    studentStats[uid].correct += r.correctCount || 0;
    studentStats[uid].attempted += r.totalCount || 0;
  });

  const usersSnap = await db.collection("users")
    .where("courseId", "==", courseId)
    .where("role", "==", "student")
    .get();

  const exps: number[] = [], rates2: number[] = [];
  let totalExpSum = 0, totalMilestones = 0;

  usersSnap.docs.forEach(d => {
    const data = d.data();
    if (data.role === "professor") return;
    const exp = data.totalExp || 0;
    const stat = studentStats[d.id];
    const rate = stat && stat.attempted > 0 ? (stat.correct / stat.attempted) * 100 : 0;
    exps.push(exp); rates2.push(rate);
    totalExpSum += exp;
    totalMilestones += Math.floor((data.lastGachaExp || 0) / 50);
  });

  exps.sort((a, b) => a - b); rates2.sort((a, b) => a - b);
  const medianExp = exps.length > 0 ? exps[Math.floor(exps.length / 2)] : 0;
  const medianRate = rates2.length > 0 ? rates2[Math.floor(rates2.length / 2)] : 0;

  let passionate = 0, hardworking = 0, efficient = 0, atRisk = 0;
  usersSnap.docs.forEach(d => {
    const data = d.data();
    if (data.role === "professor") return;
    const exp = data.totalExp || 0;
    const stat = studentStats[d.id];
    const rate = stat && stat.attempted > 0 ? (stat.correct / stat.attempted) * 100 : 0;
    if (exp >= medianExp && rate >= medianRate) passionate++;
    else if (exp >= medianExp) hardworking++;
    else if (rate >= medianRate) efficient++;
    else atRisk++;
  });

  return {
    quiz: {
      newCount: quizzesSnap.size, typeDistribution, avgCorrectRate, avgCompletionRate,
      topWrongQuestions: [], profQuizCorrectRate, aiQuizCorrectRate,
    },
    quizDetails: topQuizDetails,
    chapterCorrectRates,
    feedback: {
      total: fbSnap.size, byType: fbByType,
      avgScore: fbSnap.size > 0 ? Math.round((fbScoreSum / fbSnap.size) * 100) / 100 : 0,
    },
    review: { completedCount: reviewCount, reviewConversionRate },
    clusterCounts: { passionate, hardworking, efficient, atRisk },
    avgExp: totalStudents > 0 ? Math.round(totalExpSum / totalStudents) : 0,
    milestoneCount: totalMilestones,
  };
}
