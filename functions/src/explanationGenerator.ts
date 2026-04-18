/**
 * 자체제작 퀴즈 자동 해설 생성 Cloud Function
 *
 * 학생이 퀴즈 만들기 "확인" 단계에서 "자동 해설 생성" 버튼을 누르면
 * 각 문제의 본문/선지/정답/제시문/이미지를 분석해서 해설을 자동 생성.
 *
 * - Gemini 2.5 Flash 사용
 * - 과목 SCOPE + FocusGuide 참조 (챕터별 필터링)
 * - 배치 요청 1회 (비용 절감)
 * - 사용자별 일일 한도 (20회)
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import fetch from "node-fetch";
import { loadScopeForAI } from "./courseScope";
import { getFocusGuide } from "./styledQuizGenerator";

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

// 사용자별 일일 한도 (자동 해설)
const DAILY_USER_LIMIT = 20;

// ============================================================
// 타입 정의
// ============================================================

export interface ExplanationSubQuestionInput {
  id: string;
  text: string;
  type: string;
  choices?: string[];
  answerIndex?: number;
  answerIndices?: number[];
  answerText?: string;
  answerTexts?: string[];
  passageText?: string;
  bogiText?: string;
  chapterId?: string;
}

export interface ExplanationQuestionInput {
  id: string;
  text: string;
  type: string;
  choices?: string[];
  answerIndex?: number;
  answerIndices?: number[];
  answerText?: string;
  answerTexts?: string[];
  passageText?: string;
  bogiText?: string;
  imageBase64?: string; // 문제 이미지 (data URL 또는 순수 base64)
  chapterId?: string;
  subQuestions?: ExplanationSubQuestionInput[]; // 결합형
}

interface ExplanationResult {
  id: string;
  explanation: string;
  choiceExplanations?: string[];
  subExplanations?: Array<{
    id: string;
    explanation: string;
    choiceExplanations?: string[];
  }>;
}

// ============================================================
// 사용량 관리
// ============================================================

function getDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function getUserDailyUsage(userId: string): Promise<number> {
  const db = getFirestore();
  const today = getDateString();
  const doc = await db
    .collection("geminiExplanationUsage")
    .doc("users")
    .collection(userId)
    .doc(today)
    .get();
  if (!doc.exists) return 0;
  return doc.data()?.count || 0;
}

async function incrementUsage(userId: string): Promise<void> {
  const db = getFirestore();
  const today = getDateString();
  const ref = db
    .collection("geminiExplanationUsage")
    .doc("users")
    .collection(userId)
    .doc(today);
  await ref.set(
    {
      count: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

// ============================================================
// 유틸: 정답 텍스트 포매팅
// ============================================================

function formatAnswer(q: ExplanationQuestionInput | ExplanationSubQuestionInput): string {
  const type = q.type;
  if (type === "ox") {
    return q.answerIndex === 0 ? "O (참)" : "X (거짓)";
  }
  if (type === "multipleChoice") {
    if (Array.isArray(q.answerIndices) && q.answerIndices.length > 0) {
      return q.answerIndices
        .map((i) => `${i + 1}번: ${q.choices?.[i] ?? ""}`)
        .join(" / ");
    }
    if (typeof q.answerIndex === "number" && q.answerIndex >= 0) {
      return `${q.answerIndex + 1}번: ${q.choices?.[q.answerIndex] ?? ""}`;
    }
    return "(정답 미지정)";
  }
  if (type === "shortAnswer") {
    if (Array.isArray(q.answerTexts) && q.answerTexts.length > 0) {
      return q.answerTexts.join(" 또는 ");
    }
    return q.answerText || "(정답 미지정)";
  }
  if (type === "essay") {
    return q.answerText || "(서술형 — 모범답안 자동 생성)";
  }
  return "(정답 정보 없음)";
}

// ============================================================
// 프롬프트 빌드
// ============================================================

function buildQuestionBlock(
  index: number,
  q: ExplanationQuestionInput | ExplanationSubQuestionInput,
  prefix = ""
): string {
  const lines: string[] = [];
  const id = `${prefix}${index + 1}`;
  lines.push(`[문제 ${id}] (id: ${q.id})`);
  lines.push(`유형: ${q.type}`);
  if (q.passageText) {
    lines.push(`제시문: ${q.passageText}`);
  }
  if (q.bogiText) {
    lines.push(`<보기>: ${q.bogiText}`);
  }
  lines.push(`문제: ${q.text}`);
  if (q.choices && q.choices.length > 0) {
    lines.push("선지:");
    q.choices.forEach((c, i) => {
      lines.push(`  ${i + 1}) ${c}`);
    });
  }
  lines.push(`정답: ${formatAnswer(q)}`);
  return lines.join("\n");
}

function buildPrompt(
  questions: ExplanationQuestionInput[],
  scopeContent: string | null,
  focusGuide: string | null
): string {
  const sections: string[] = [];

  sections.push(`당신은 대학 교수입니다. 학생이 직접 만든 퀴즈의 **해설**을 작성해주세요.

**해설 작성 원칙**
1. 한국어로 3~5문장, 자연스러운 설명체 (존댓말 금지, 중립 서술형)
2. 정답의 근거를 교과서 개념 기반으로 명확히 제시
3. 오답 선지는 왜 틀렸는지 짧게 짚어주기 (선지별 해설이 있을 때)
4. 제시문/이미지/보기가 있으면 그 내용을 연결해서 설명
5. 학생이 직접 낸 문제이므로 **엄격한 팩트 검증**: 틀린 정답이 보이면 해설에 "정답 확인 필요" 플래그 대신 올바른 해설을 쓰되 교재 근거 우선
6. 이모지 사용 금지, 마크다운 헤더(#) 사용 금지
7. 단순 반복 금지 — 선지가 "A" / "B" / "C" / "D"면 각각 왜 맞고 틀린지 구체 근거`);

  if (scopeContent) {
    sections.push(`\n**참고: 과목 SCOPE (교재 내용)**\n${scopeContent}`);
  }

  if (focusGuide) {
    sections.push(`\n**참고: 과목 필수 출제 포인트**\n${focusGuide}`);
  }

  sections.push("\n**해설을 작성할 문제 목록:**\n");

  questions.forEach((q, idx) => {
    sections.push(buildQuestionBlock(idx, q));
    if (q.type === "combined" && q.subQuestions && q.subQuestions.length > 0) {
      q.subQuestions.forEach((sq, sqIdx) => {
        sections.push(buildQuestionBlock(sqIdx, sq, `${idx + 1}-`));
      });
    }
    sections.push("");
  });

  sections.push(`**응답 형식 (JSON만, 다른 텍스트 금지):**
{
  "explanations": [
    {
      "id": "문제 id",
      "explanation": "전체 해설 (3~5문장)",
      "choiceExplanations": ["1번 선지 해설", "2번 선지 해설", ...],
      "subExplanations": [
        { "id": "하위문제 id", "explanation": "...", "choiceExplanations": [...] }
      ]
    }
  ]
}

- choiceExplanations는 객관식/OX에만 포함 (선지 수와 동일한 길이)
- subExplanations는 결합형(combined)에만 포함
- 단답형/서술형은 explanation만
- 각 선지 해설은 1~2문장, "이 선지는 옳다(O)/틀리다(X). 근거: ~" 형태`);

  return sections.join("\n");
}

// ============================================================
// Gemini API 호출
// ============================================================

async function callGeminiApi(
  prompt: string,
  images: Array<{ base64: string; mimeType: string }>,
  apiKey: string
): Promise<ExplanationResult[]> {
  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

  // 이미지 파트 먼저
  for (const img of images) {
    parts.push({
      inlineData: {
        mimeType: img.mimeType,
        data: img.base64,
      },
    });
  }
  parts.push({ text: prompt });

  const requestBody = {
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.4,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 8192 + 4096, // thinking(8192) + 응답(4096)
      thinkingConfig: { thinkingBudget: 8192 },
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);

  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      }
    );
  } catch (err: unknown) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("해설 생성 시간 초과 (90초)");
    }
    throw err;
  }
  clearTimeout(timer);

  if (!response.ok) {
    const errText = await response.text();
    console.error("Gemini API 오류 (explanation):", response.status, errText);
    if (response.status === 429) {
      throw new Error("AI 호출 한도 초과. 잠시 후 다시 시도해주세요.");
    }
    throw new Error(`Gemini API 오류: ${response.status}`);
  }

  interface GeminiResponse {
    candidates?: Array<{
      content?: { parts: Array<{ text?: string }> };
    }>;
  }

  const result = (await response.json()) as GeminiResponse;

  if (!result.candidates || !result.candidates[0]?.content) {
    console.error("Gemini 응답 형식 오류:", JSON.stringify(result).slice(0, 500));
    throw new Error("AI 응답을 받지 못했습니다.");
  }

  const text = result.candidates[0].content.parts
    .filter((p) => p.text)
    .map((p) => p.text)
    .join("");

  // JSON 파싱
  let jsonText = text;
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonText = codeBlockMatch[1].trim();
  } else {
    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch) jsonText = objectMatch[0];
  }

  try {
    const parsed = JSON.parse(jsonText);
    if (!parsed.explanations || !Array.isArray(parsed.explanations)) {
      throw new Error("explanations 배열이 없습니다.");
    }
    return parsed.explanations as ExplanationResult[];
  } catch (parseError) {
    console.error("해설 JSON 파싱 실패:", parseError, "원본 head:", jsonText.slice(0, 500));
    throw new Error("AI 응답을 파싱할 수 없습니다. 다시 시도해주세요.");
  }
}

// ============================================================
// Cloud Function
// ============================================================

/**
 * 자동 해설 생성 (Callable Function)
 *
 * @param data.courseId - 과목 ID (SCOPE/FocusGuide 참조용)
 * @param data.questions - 해설 생성할 문제 목록
 */
export const generateCustomExplanations = onCall(
  {
    region: "asia-northeast3",
    secrets: [GEMINI_API_KEY],
    memory: "1GiB",
    timeoutSeconds: 120,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const userId = request.auth.uid;
    const { courseId, questions } = request.data as {
      courseId: string;
      questions: ExplanationQuestionInput[];
    };

    if (!courseId) {
      throw new HttpsError("invalid-argument", "courseId가 필요합니다.");
    }
    if (!Array.isArray(questions) || questions.length === 0) {
      throw new HttpsError("invalid-argument", "문제 목록이 비어있습니다.");
    }
    if (questions.length > 20) {
      throw new HttpsError(
        "invalid-argument",
        "한 번에 최대 20문제까지만 해설을 생성할 수 있습니다."
      );
    }

    const apiKey = GEMINI_API_KEY.value();
    if (!apiKey) {
      throw new HttpsError("failed-precondition", "AI 서비스가 설정되지 않았습니다.");
    }

    // 사용량 확인
    const used = await getUserDailyUsage(userId);
    if (used >= DAILY_USER_LIMIT) {
      throw new HttpsError(
        "resource-exhausted",
        `오늘의 자동 해설 생성 횟수(${DAILY_USER_LIMIT}회)를 모두 사용했습니다.`
      );
    }

    // 챕터 ID에서 번호 추출 (예: "micro_3" → "3")
    // 결합형 하위 문제의 챕터 ID도 수집
    const chapterNumbers = new Set<string>();
    for (const q of questions) {
      if (q.chapterId) {
        const num = q.chapterId.replace(/^[a-z]+_?/i, "").trim();
        if (num) chapterNumbers.add(num);
      }
      if (Array.isArray(q.subQuestions)) {
        for (const sq of q.subQuestions) {
          if (sq.chapterId) {
            const num = sq.chapterId.replace(/^[a-z]+_?/i, "").trim();
            if (num) chapterNumbers.add(num);
          }
        }
      }
    }

    // SCOPE 로드 (챕터 필터링, 최대 8000자)
    let scopeContent: string | null = null;
    try {
      const scope = await loadScopeForAI(
        courseId,
        chapterNumbers.size > 0 ? Array.from(chapterNumbers) : undefined,
        8000
      );
      if (scope) {
        scopeContent = scope.content;
      }
    } catch (err) {
      console.warn("SCOPE 로드 실패 (계속 진행):", err);
    }

    // FocusGuide 로드
    let focusGuide: string | null = null;
    try {
      focusGuide = getFocusGuide(
        courseId,
        chapterNumbers.size > 0 ? Array.from(chapterNumbers) : undefined
      );
    } catch (err) {
      console.warn("FocusGuide 로드 실패 (계속 진행):", err);
    }

    // 이미지 수집 (data URL만 지원, 최대 5장으로 제한)
    const images: Array<{ base64: string; mimeType: string }> = [];
    for (const q of questions) {
      if (images.length >= 5) break;
      if (!q.imageBase64) continue;
      // data URL 파싱
      const match = q.imageBase64.match(/^data:(image\/(?:jpeg|png|gif|webp));base64,(.+)$/);
      if (match) {
        images.push({ mimeType: match[1], base64: match[2] });
      }
    }

    // 프롬프트 생성
    const prompt = buildPrompt(questions, scopeContent, focusGuide);

    try {
      const explanations = await callGeminiApi(prompt, images, apiKey);

      await incrementUsage(userId);

      console.log(
        `해설 생성 완료 (user=${userId}, questions=${questions.length}, scope=${!!scopeContent}, focus=${!!focusGuide}, images=${images.length})`
      );

      return {
        success: true,
        explanations,
        usage: {
          userUsed: used + 1,
          userLimit: DAILY_USER_LIMIT,
          userRemaining: DAILY_USER_LIMIT - used - 1,
        },
      };
    } catch (error) {
      console.error("해설 생성 오류:", error);
      throw new HttpsError(
        "internal",
        error instanceof Error ? error.message : "해설 생성 중 오류가 발생했습니다."
      );
    }
  }
);
