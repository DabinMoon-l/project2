/**
 * 학습 통계 수집
 *
 * 퀴즈 정답률, 복습 활용, 피드백, 교수vs AI 비교, 학생 군집
 */

import { getFirestore } from "firebase-admin/firestore";
import { CollectContext, LearningStats } from "./types";

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

  // ── 주간 퀴즈 결과 ──
  const weekResultsSnap = await db.collection("quizResults")
    .where("courseId", "==", courseId)
    .where("createdAt", ">=", startTs)
    .where("createdAt", "<", endTs)
    .get();

  let totalCorrect = 0;
  let totalQuestions = 0;
  let reviewCount = 0;
  const quizSolveUsers = new Set<string>();
  const reviewUsers = new Set<string>();
  // 교수 vs AI 퀴즈 정답률 분리
  let profCorrect = 0, profTotal = 0;
  let aiCorrect = 0, aiTotal = 0;
  const quizTypeMap = new Map<string, string>(); // quizId → type

  // 퀴즈 타입 매핑 (교수 vs AI 구분용)
  const allQuizzesSnap = await db.collection("quizzes")
    .where("courseId", "==", courseId)
    .select("type")
    .get();
  allQuizzesSnap.docs.forEach(d => quizTypeMap.set(d.id, d.data().type || ""));

  weekResultsSnap.docs.forEach(d => {
    const r = d.data();
    const uid = r.userId as string;
    const qid = r.quizId as string;
    const correct = r.correctCount || 0;
    const total = r.totalCount || 0;
    const qType = quizTypeMap.get(qid) || "";

    totalCorrect += correct;
    totalQuestions += total;

    // 복습 여부
    if (r.isReview || r.isUpdate) {
      reviewCount++;
      if (uid) reviewUsers.add(uid);
    } else {
      if (uid) quizSolveUsers.add(uid);
    }

    // 교수 vs AI 정답률
    if (PROF_TYPES.has(qType)) {
      profCorrect += correct;
      profTotal += total;
    } else if (AI_TYPES.has(qType)) {
      aiCorrect += correct;
      aiTotal += total;
    }
  });

  const avgCorrectRate = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;
  const profQuizCorrectRate = profTotal > 0 ? Math.round((profCorrect / profTotal) * 100) : 0;
  const aiQuizCorrectRate = aiTotal > 0 ? Math.round((aiCorrect / aiTotal) * 100) : 0;

  // 완료율: 주간 퀴즈에 대한 풀이 학생 비율
  const quizUserSets: Record<string, Set<string>> = {};
  weekResultsSnap.docs.forEach(d => {
    const r = d.data();
    if (r.isUpdate || r.isReview) return;
    const qid = r.quizId as string;
    const uid = r.userId as string;
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

  // 복습 전환율: 퀴즈 푼 사람 중 복습도 한 비율
  const reviewConversionRate = quizSolveUsers.size > 0
    ? Math.round((reviewUsers.size / quizSolveUsers.size) * 100)
    : 0;

  // ── 피드백 ──
  const fbSnap = await db.collection("questionFeedbacks")
    .where("courseId", "==", courseId)
    .where("createdAt", ">=", startTs)
    .where("createdAt", "<", endTs)
    .get();

  const fbByType: Record<string, number> = {};
  let fbScoreSum = 0;
  fbSnap.docs.forEach(d => {
    const t = d.data().type as string;
    fbByType[t] = (fbByType[t] || 0) + 1;
    fbScoreSum += FEEDBACK_SCORES[t] ?? 0;
  });
  const fbAvg = fbSnap.size > 0 ? Math.round((fbScoreSum / fbSnap.size) * 100) / 100 : 0;

  // ── 학생 군집 + EXP ──
  const usersSnap = await db.collection("users")
    .where("courseId", "==", courseId)
    .where("role", "==", "student")
    .get();

  // 교수 퀴즈 정답률 기반 군집 (전체 누적)
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

  const exps: number[] = [];
  const rates2: number[] = [];
  let totalExpSum = 0;
  let totalMilestones = 0;

  usersSnap.docs.forEach(d => {
    const data = d.data();
    if (data.role === "professor") return;
    const exp = data.totalExp || 0;
    const stat = studentStats[d.id];
    const rate = stat && stat.attempted > 0 ? (stat.correct / stat.attempted) * 100 : 0;
    exps.push(exp);
    rates2.push(rate);
    totalExpSum += exp;
    totalMilestones += Math.floor((data.lastGachaExp || 0) / 50);
  });

  exps.sort((a, b) => a - b);
  rates2.sort((a, b) => a - b);
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
      newCount: quizzesSnap.size,
      typeDistribution,
      avgCorrectRate,
      avgCompletionRate,
      topWrongQuestions: [], // 오답 TOP은 기존처럼 별도 집계 필요 시 추가
      profQuizCorrectRate,
      aiQuizCorrectRate,
    },
    feedback: { total: fbSnap.size, byType: fbByType, avgScore: fbAvg },
    review: { completedCount: reviewCount, reviewConversionRate },
    clusterCounts: { passionate, hardworking, efficient, atRisk },
    avgExp: totalStudents > 0 ? Math.round(totalExpSum / totalStudents) : 0,
    milestoneCount: totalMilestones,
  };
}
