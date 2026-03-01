/**
 * 주별 자동 수집 Scheduled Cloud Function
 *
 * 매주 월요일 00:00 KST에 실행되어
 * 퀴즈, 피드백, 학생, 게시판 데이터를 집계하여
 * weeklyStats/{courseId}/{year-Wxx} 문서에 저장
 */

import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import fetch from "node-fetch";

// ANTHROPIC_API_KEY 시크릿 (monthlyReport.ts와 공유)
const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

// ============================================================
// 타입
// ============================================================

interface WeeklyStats {
  // 메타
  courseId: string;
  weekStart: string; // ISO date
  weekEnd: string;   // ISO date
  weekLabel: string; // "2026-W08"
  createdAt: FirebaseFirestore.FieldValue;

  // 퀴즈
  quiz: {
    newCount: number;
    typeDistribution: Record<string, number>;
    avgCorrectRate: number;
    avgCompletionRate: number;
    topWrongQuestions: { quizId: string; questionIndex: number; wrongRate: number }[];
  };

  // 피드백
  feedback: {
    total: number;
    byType: Record<string, number>;
    avgScore: number;
  };

  // 학생
  student: {
    activeCount: number;
    totalCount: number;
    avgExpGain: number;
    milestoneCount: number;
    rabbitDiscoveries: number;
    clusterCounts: {
      passionate: number;
      hardworking: number;
      efficient: number;
      atRisk: number;
    };
  };

  // 게시판
  board: {
    postCount: number;
    commentCount: number;
    totalViews: number;
    classParticipationScores: Record<string, number>;
    keywords: { text: string; value: number }[];
  };
}

// ============================================================
// 유틸
// ============================================================

/** 해당 주의 월요일~일요일 범위 계산 (KST 기준, UTC Date 반환) */
function getLastWeekRange(): { start: Date; end: Date; label: string } {
  const KST_OFFSET = 9 * 60 * 60 * 1000;
  const now = new Date();
  // KST 기준 현재 시각
  const kstNow = new Date(now.getTime() + KST_OFFSET);
  const dayOfWeek = kstNow.getUTCDay(); // 0=일, 1=월, ...
  const daysToLastMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  // KST 기준 지난주 월요일 00:00
  const lastMondayKST = new Date(kstNow);
  lastMondayKST.setUTCDate(lastMondayKST.getUTCDate() - daysToLastMonday - 7);
  lastMondayKST.setUTCHours(0, 0, 0, 0);

  // KST 기준 지난주 일요일 24:00 (= 이번주 월요일 00:00)
  const lastSundayKST = new Date(lastMondayKST);
  lastSundayKST.setUTCDate(lastMondayKST.getUTCDate() + 7);

  // KST → UTC 변환
  const start = new Date(lastMondayKST.getTime() - KST_OFFSET);
  const end = new Date(lastSundayKST.getTime() - KST_OFFSET);

  // ISO 주 번호 계산 (KST 기준)
  const jan1 = new Date(Date.UTC(lastMondayKST.getUTCFullYear(), 0, 1));
  const daysSinceJan1 = Math.floor((lastMondayKST.getTime() - jan1.getTime()) / 86400000);
  const weekNum = Math.ceil((daysSinceJan1 + jan1.getUTCDay() + 1) / 7);
  const label = `${lastMondayKST.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;

  return { start, end, label };
}

/** 피드백 점수 매핑 */
const FEEDBACK_SCORES: Record<string, number> = {
  praise: 2,
  wantmore: 1,
  other: 0,
  typo: -1,
  unclear: -1,
  wrong: -2,
};

// ============================================================
// 과목 목록
// ============================================================

const COURSE_IDS = ["biology", "pathophysiology", "microbiology"];

// ============================================================
// Claude Haiku 키워드 추출
// ============================================================

/** Haiku API 호출하여 게시글 텍스트에서 키워드 추출 */
async function extractKeywordsWithHaiku(
  apiKey: string,
  texts: string[],
): Promise<{ text: string; value: number }[]> {
  if (texts.length === 0) return [];

  const combined = texts.join("\n---\n").slice(0, 4000); // 토큰 절약

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: `다음은 대학 수업 게시판의 게시글 제목과 본문입니다. 의미 있는 핵심 키워드를 추출해주세요.

규칙:
- 조사, 접속사, 대명사, 일반 동사 제외
- 1글자 단어 제외
- 빈도가 높은 순으로 최대 30개
- JSON 배열로만 응답: [{"text":"키워드","value":빈도수}]
- 다른 설명 없이 JSON만 출력

게시글:
${combined}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    console.error(`Haiku API 오류 (${response.status}):`, await response.text());
    return [];
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>;
  };

  const textBlock = data.content.find((c: { type: string }) => c.type === "text");
  if (!textBlock?.text) return [];

  try {
    // JSON 파싱 (마크다운 코드블록 제거)
    const cleaned = textBlock.text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item: { text?: string; value?: number }) => item.text && typeof item.value === "number")
        .slice(0, 30)
        .map((item: { text: string; value: number }) => ({ text: item.text, value: item.value }));
    }
  } catch (err) {
    console.error("키워드 JSON 파싱 실패:", err);
  }

  return [];
}

// ============================================================
// 수집 함수
// ============================================================

async function collectWeeklyStats(courseId: string, start: Date, end: Date, label: string, apiKey: string): Promise<WeeklyStats> {
  const db = getFirestore();
  const startTs = Timestamp.fromDate(start);
  const endTs = Timestamp.fromDate(end);

  // ── 퀴즈 데이터 ──
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

  // ── 피드백 데이터 ──
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

  // ── 학생 데이터 (퀴즈 완료율에 totalStudents 필요하므로 먼저 조회) ──
  const usersSnap = await db.collection("users")
    .where("courseId", "==", courseId)
    .where("role", "==", "student")
    .get();

  const totalStudents = usersSnap.size;

  // ── 퀴즈 결과에서 정답률/완료율 ──
  const quizIds = quizzesSnap.docs.map(d => d.id);
  let avgCorrectRate = 0;
  let avgCompletionRate = 0;
  const wrongQuestions: { quizId: string; questionIndex: number; wrongRate: number }[] = [];

  if (quizIds.length > 0) {
    // Bug fix: 변수를 루프 밖으로 이동 (청크별 리셋 방지)
    let totalCorrect = 0;
    let totalQuestions = 0;
    // 완료율 계산용: 퀴즈별 유니크 userId
    const quizUserSets: Record<string, Set<string>> = {};

    for (let i = 0; i < quizIds.length; i += 30) {
      const chunk = quizIds.slice(i, i + 30);
      const resultsSnap = await db.collection("quizResults")
        .where("quizId", "in", chunk)
        .get();

      resultsSnap.docs.forEach(d => {
        const rData = d.data();
        totalCorrect += rData.correctCount || 0;
        // Bug fix: totalQuestions → totalCount (quizResults 실제 필드명)
        totalQuestions += rData.totalCount || 0;
        // 완료율 집계
        const qid = rData.quizId as string;
        const uid = rData.userId as string;
        if (qid && uid) {
          if (!quizUserSets[qid]) quizUserSets[qid] = new Set();
          quizUserSets[qid].add(uid);
        }
      });
    }

    if (totalQuestions > 0) {
      avgCorrectRate = Math.round((totalCorrect / totalQuestions) * 100);
    }

    // Bug fix: 완료율 계산 (기존에는 항상 0)
    if (totalStudents > 0) {
      const compRates = Object.values(quizUserSets).map(s => (s.size / totalStudents) * 100);
      if (compRates.length > 0) {
        avgCompletionRate = Math.round(compRates.reduce((a, b) => a + b, 0) / compRates.length);
      }
    }
  }
  const studentIdSet = new Set(usersSnap.docs.map(d => d.id));
  // 활동 학생: 해당 주에 퀴즈 결과 또는 게시글을 작성한 학생
  const activeStudentIds = new Set<string>();
  // 누적 EXP 합계 (주간 획득량이 아닌 스냅샷 — expHistory 쿼리는 비용 과다)
  let totalExpSum = 0;
  // 전체 마일스톤 달성 스냅샷 (주간 아닌 누적값)
  let totalMilestones = 0;
  // 미구현: rabbitDiscoveries는 rabbitHoldings 서브컬렉션 주간 쿼리 필요 (비용 과다)
  const rabbitDiscoveries = 0;
  let passionate = 0, hardworking = 0, efficient = 0, atRisk = 0;

  // ── 교수 퀴즈 정답률 계산 (quizResults에서 직접 집계) ──
  // users 문서에는 profCorrectCount 필드가 없으므로 quizResults에서 계산
  const allQuizzesSnap = await db.collection("quizzes")
    .where("courseId", "==", courseId)
    .select("creatorId", "type")
    .get();

  const PROF_TYPES = new Set(["midterm", "final", "past", "professor", "professor-ai"]);
  const profQuizIds = new Set<string>();
  const professorUids = new Set<string>();
  usersSnap.docs.forEach(d => {
    if (d.data().role === "professor") professorUids.add(d.id);
  });
  allQuizzesSnap.docs.forEach(d => {
    const data = d.data();
    if (PROF_TYPES.has(data.type || "") || professorUids.has(data.creatorId)) {
      profQuizIds.add(d.id);
    }
  });

  // 교수 퀴즈에 대한 학생별 정답률 집계 (첫 시도만)
  const allResultsSnap = await db.collection("quizResults")
    .where("courseId", "==", courseId)
    .select("userId", "quizId", "correctCount", "totalCount", "isUpdate")
    .get();

  const studentProfStats: Record<string, { correct: number; attempted: number }> = {};
  allResultsSnap.docs.forEach(d => {
    const r = d.data();
    if (r.isUpdate) return;
    if (!profQuizIds.has(r.quizId)) return;
    const uid = r.userId as string;
    if (!studentIdSet.has(uid)) return;
    if (!studentProfStats[uid]) studentProfStats[uid] = { correct: 0, attempted: 0 };
    studentProfStats[uid].correct += r.correctCount || 0;
    studentProfStats[uid].attempted += r.totalCount || 0;
  });

  // 중위값 계산을 위한 배열
  const exps: number[] = [];
  const rates: number[] = [];

  usersSnap.docs.forEach(d => {
    const data = d.data();
    if (data.role === "professor") return;
    const exp = data.totalExp || 0;
    const stat = studentProfStats[d.id];
    const correctRate = stat && stat.attempted > 0
      ? (stat.correct / stat.attempted) * 100
      : 0;
    exps.push(exp);
    rates.push(correctRate);
    totalExpSum += exp;
    totalMilestones += Math.floor((data.lastGachaExp || 0) / 50);
  });

  exps.sort((a, b) => a - b);
  rates.sort((a, b) => a - b);
  const medianExp = exps.length > 0 ? exps[Math.floor(exps.length / 2)] : 0;
  const medianRate = rates.length > 0 ? rates[Math.floor(rates.length / 2)] : 0;

  usersSnap.docs.forEach(d => {
    const data = d.data();
    if (data.role === "professor") return;
    const exp = data.totalExp || 0;
    const stat = studentProfStats[d.id];
    const rate = stat && stat.attempted > 0
      ? (stat.correct / stat.attempted) * 100
      : 0;

    if (exp >= medianExp && rate >= medianRate) passionate++;
    else if (exp >= medianExp) hardworking++;
    else if (rate >= medianRate) efficient++;
    else atRisk++;
  });

  // ── 활동 학생 집계: 기간 내 퀴즈 결과 userId ──
  const weekResultsSnap = await db.collection("quizResults")
    .where("courseId", "==", courseId)
    .where("createdAt", ">=", startTs)
    .where("createdAt", "<", endTs)
    .get();
  weekResultsSnap.docs.forEach(d => {
    const uid = d.data().userId as string;
    if (studentIdSet.has(uid)) activeStudentIds.add(uid);
  });

  // ── 게시판 데이터 ──
  const postsSnap = await db.collection("posts")
    .where("courseId", "==", courseId)
    .where("createdAt", ">=", startTs)
    .where("createdAt", "<", endTs)
    .get();

  let totalViews = 0;
  const classPostCounts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
  const postTexts: string[] = [];
  postsSnap.docs.forEach(d => {
    const data = d.data();
    totalViews += data.viewCount || 0;
    const cls = data.authorClassType;
    if (cls && classPostCounts[cls] !== undefined) classPostCounts[cls]++;
    // 게시글 작성자도 활동 학생에 포함
    const authorId = data.authorId as string;
    if (authorId && studentIdSet.has(authorId)) activeStudentIds.add(authorId);
    // 키워드 추출용 텍스트 수집
    const title = data.title || "";
    const content = data.content || "";
    if (title || content) postTexts.push(`${title} ${content}`);
  });

  const postIds = postsSnap.docs.map(d => d.id);
  let commentCount = 0;
  for (let i = 0; i < postIds.length; i += 30) {
    const chunk = postIds.slice(i, i + 30);
    const commSnap = await db.collection("comments")
      .where("postId", "in", chunk)
      .get();
    commentCount += commSnap.size;
  }

  // ── Haiku 키워드 추출 ──
  let keywords: { text: string; value: number }[] = [];
  if (postTexts.length > 0 && apiKey) {
    try {
      keywords = await extractKeywordsWithHaiku(apiKey, postTexts);
      console.log(`[${courseId}] 키워드 ${keywords.length}개 추출 완료`);
    } catch (err) {
      console.error(`[${courseId}] 키워드 추출 실패:`, err);
    }
  }

  return {
    courseId,
    weekStart: start.toISOString(),
    weekEnd: end.toISOString(),
    weekLabel: label,
    createdAt: FieldValue.serverTimestamp(),
    quiz: {
      newCount: quizzesSnap.size,
      typeDistribution,
      avgCorrectRate,
      avgCompletionRate,
      topWrongQuestions: wrongQuestions.slice(0, 5),
    },
    feedback: {
      total: fbSnap.size,
      byType: fbByType,
      avgScore: fbAvg,
    },
    student: {
      activeCount: activeStudentIds.size,
      totalCount: totalStudents,
      // 학생 평균 누적 EXP 스냅샷 (주간 획득량이 아닌 현재 시점 평균)
      avgExpGain: totalStudents > 0 ? Math.round(totalExpSum / totalStudents) : 0,
      // 전체 마일스톤 달성 수 스냅샷 (누적값)
      milestoneCount: totalMilestones,
      rabbitDiscoveries,
      clusterCounts: { passionate, hardworking, efficient, atRisk },
    },
    board: {
      postCount: postsSnap.size,
      commentCount,
      totalViews,
      classParticipationScores: classPostCounts,
      keywords,
    },
  };
}

// ============================================================
// Scheduled Function
// ============================================================

/**
 * 매주 월요일 00:00 KST 실행
 * 모든 과목에 대해 지난 주 데이터 수집
 */
export const collectWeeklyStatsScheduled = onSchedule(
  {
    schedule: "every monday 00:00",
    region: "asia-northeast3",
    timeZone: "Asia/Seoul",
    timeoutSeconds: 540,
    memory: "512MiB",
    secrets: [ANTHROPIC_API_KEY],
  },
  async () => {
    const db = getFirestore();
    const { start, end, label } = getLastWeekRange();
    const apiKey = ANTHROPIC_API_KEY.value();

    console.log(`주별 통계 수집 시작: ${label} (${start.toISOString()} ~ ${end.toISOString()})`);

    for (const courseId of COURSE_IDS) {
      try {
        const stats = await collectWeeklyStats(courseId, start, end, label, apiKey);

        // weeklyStats/{courseId}/{year-Wxx}
        await db.collection("weeklyStats")
          .doc(courseId)
          .collection("weeks")
          .doc(label)
          .set(stats);

        console.log(`[${courseId}] 주별 통계 저장 완료`);
      } catch (err) {
        console.error(`[${courseId}] 주별 통계 수집 실패:`, err);
      }
    }

    console.log("주별 통계 수집 완료");
  }
);
