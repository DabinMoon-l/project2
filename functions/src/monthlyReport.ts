/**
 * 월별 Claude Sonnet 리포트 생성 Callable Cloud Function
 *
 * 교수님이 수동 트리거. 해당 월의 weeklyStats를 Claude Sonnet에 전달하여
 * 인사이트 리포트를 생성하고 monthlyReports/{courseId}/{year-MM}에 저장.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import fetch from "node-fetch";

// 기존 ANTHROPIC_API_KEY 시크릿 재사용
const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

// ============================================================
// 과목 이름 매핑
// ============================================================

const COURSE_NAMES: Record<string, string> = {
  biology: "생물학",
  pathophysiology: "병태생리학",
  microbiology: "미생물학",
};

// ============================================================
// 타입
// ============================================================

interface MonthlyReport {
  courseId: string;
  year: number;
  month: number;
  monthLabel: string; // "2026-03"
  weeklyStatsUsed: string[]; // 사용된 주 라벨 목록
  insight: string; // Claude 생성 인사이트
  createdAt: FirebaseFirestore.FieldValue;
}

// ============================================================
// Claude Sonnet API 호출
// ============================================================

async function callClaudeSonnet(apiKey: string, prompt: string): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API 오류 (${response.status}): ${errorText}`);
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>;
  };

  const textBlock = data.content.find((c: { type: string }) => c.type === "text");
  return textBlock?.text || "";
}

// ============================================================
// Callable Function
// ============================================================

/**
 * 월별 리포트 생성 (교수님 전용)
 *
 * @param data.courseId - 과목 ID
 * @param data.year - 년도
 * @param data.month - 월 (1-12)
 * @param data.deleteWeeklyStats - 리포트 생성 후 주별 통계 삭제 여부 (선택)
 */
export const generateMonthlyReport = onCall(
  {
    region: "asia-northeast3",
    secrets: [ANTHROPIC_API_KEY],
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async (request) => {
    // 인증 확인
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const db = getFirestore();

    // 교수님 권한 확인
    const userDoc = await db.collection("users").doc(request.auth.uid).get();
    if (!userDoc.exists || userDoc.data()?.role !== "professor") {
      throw new HttpsError("permission-denied", "교수님만 리포트를 생성할 수 있습니다.");
    }

    const { courseId, year, month, deleteWeeklyStats = false } = request.data as {
      courseId: string;
      year: number;
      month: number;
      deleteWeeklyStats?: boolean;
    };

    if (!courseId || !year || !month) {
      throw new HttpsError("invalid-argument", "courseId, year, month가 필요합니다.");
    }

    const monthLabel = `${year}-${String(month).padStart(2, "0")}`;
    const courseName = COURSE_NAMES[courseId] || courseId;

    // 기존 리포트 확인
    const existingDoc = await db.collection("monthlyReports")
      .doc(courseId)
      .collection("months")
      .doc(monthLabel)
      .get();

    if (existingDoc.exists) {
      throw new HttpsError("already-exists", `${monthLabel} 리포트가 이미 존재합니다.`);
    }

    // 해당 월의 주별 통계 조회
    // 주 라벨 패턴: 2026-W01 ~ 2026-W52
    const weeksSnap = await db.collection("weeklyStats")
      .doc(courseId)
      .collection("weeks")
      .where("weekStart", ">=", `${year}-${String(month).padStart(2, "0")}-01`)
      .where("weekStart", "<", month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`)
      .orderBy("weekStart")
      .get();

    if (weeksSnap.empty) {
      throw new HttpsError("not-found", `${monthLabel}에 해당하는 주별 통계가 없습니다.`);
    }

    const weeklyData = weeksSnap.docs.map(d => ({
      label: d.id,
      ...d.data(),
    }));
    const weekLabels = weeksSnap.docs.map(d => d.id);

    // Claude Sonnet 프롬프트 생성
    const prompt = `당신은 대학 수업 보조 앱 "RabbiTory"의 데이터 분석가입니다.
게이미피케이션(EXP, 토끼 수집, 마일스톤)과 AI 문제 생성을 활용한
${courseName} 수업의 ${year}년 ${month}월 월간 데이터를 분석해주세요.

## 주별 수집 데이터

${JSON.stringify(weeklyData, null, 2)}

## 분석 항목

다음 항목들을 포함하여 분석해주세요:

1. **핵심 요약** (3줄 이내)
2. **긍정적 변화** — 학생 참여도, 성취도 등의 개선 사항
3. **주의가 필요한 부분** — 하락 추세, 이상 징후
4. **이탈 위험 학생 분석** — 낮은 참여 + 낮은 성취 군집 규모와 추이
5. **게이미피케이션 효과** — EXP/토끼/마일스톤과 학업 성취 상관관계
6. **AI 문제 활용도 분석** — AI 생성 문제 vs 교수 출제 문제 비교
7. **피드백 분석** — 문제 품질 추이, AI vs 교수 비교
8. **통계적 신뢰도** — 효과 크기(Cohen's d), 상관계수, 신뢰구간 등 가능한 범위에서 제시
9. **다음 달 제안사항** — 구체적인 액션 아이템

한국어로 작성해주세요. 마크다운 형식을 사용하세요.`;

    // Claude API 호출
    const apiKey = ANTHROPIC_API_KEY.value();
    if (!apiKey) {
      throw new HttpsError("internal", "ANTHROPIC_API_KEY가 설정되지 않았습니다.");
    }

    let insight: string;
    try {
      insight = await callClaudeSonnet(apiKey, prompt);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Claude API 호출 실패";
      console.error("Claude API 호출 실패:", err);
      throw new HttpsError("internal", errMsg);
    }

    // 리포트 저장
    const report: MonthlyReport = {
      courseId,
      year,
      month,
      monthLabel,
      weeklyStatsUsed: weekLabels,
      insight,
      createdAt: FieldValue.serverTimestamp(),
    };

    await db.collection("monthlyReports")
      .doc(courseId)
      .collection("months")
      .doc(monthLabel)
      .set(report);

    // 주별 통계 삭제 (옵션)
    if (deleteWeeklyStats) {
      const batch = db.batch();
      weeksSnap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      console.log(`${weekLabels.length}개 주별 통계 삭제 완료`);
    }

    console.log(`월별 리포트 생성 완료: ${courseId}/${monthLabel}`);

    return {
      success: true,
      monthLabel,
      insight,
      weeklyStatsUsed: weekLabels,
    };
  }
);
