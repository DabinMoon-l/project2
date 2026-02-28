/**
 * Gemini AI 문제 생성 Cloud Function
 *
 * Google Gemini API를 사용하여 교재 사진에서 객관식 문제를 생성합니다.
 * 무료 한도: 1일 1,500건 (전체), 사용자당 10건/일
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import fetch from "node-fetch";
// import { loadScopeForAI, inferChaptersFromText } from "./courseScope"; // 키워드 추출 최적화로 제거

// Gemini API 키 (Firebase Secrets)
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

// 사용자별 일일 한도
const DAILY_USER_LIMIT = 10;

// 전체 일일 한도 (Gemini 무료 한도 기준)
const DAILY_TOTAL_LIMIT = 1500;

/**
 * 사용자별 일일 사용량 조회
 */
async function getUserDailyUsage(userId: string): Promise<number> {
  const db = getFirestore();
  const today = getDateString();

  const usageDoc = await db
    .collection("geminiUsage")
    .doc("users")
    .collection(userId)
    .doc(today)
    .get();

  if (!usageDoc.exists) {
    return 0;
  }

  return usageDoc.data()?.count || 0;
}

/**
 * 전체 일일 사용량 조회
 */
async function getTotalDailyUsage(): Promise<number> {
  const db = getFirestore();
  const today = getDateString();

  const usageDoc = await db.collection("geminiUsage").doc(today).get();

  if (!usageDoc.exists) {
    return 0;
  }

  return usageDoc.data()?.count || 0;
}

/**
 * 사용량 증가
 */
async function incrementUsage(userId: string): Promise<void> {
  const db = getFirestore();
  const today = getDateString();

  // 사용자별 사용량 증가
  const userUsageRef = db
    .collection("geminiUsage")
    .doc("users")
    .collection(userId)
    .doc(today);

  await userUsageRef.set(
    {
      count: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  // 전체 사용량 증가
  const totalUsageRef = db.collection("geminiUsage").doc(today);

  await totalUsageRef.set(
    {
      count: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * 오늘 날짜 문자열 반환 (YYYY-MM-DD)
 */
function getDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * 생성된 문제 인터페이스
 */
interface GeneratedQuestion {
  text: string;
  choices: string[];
  answer: number | number[]; // 복수정답 지원
  explanation: string;
  choiceExplanations?: string[]; // 선지별 해설 (AI 생성 문제용)
}

/**
 * Gemini API 호출하여 문제 생성
 */
async function callGeminiApi(
  imageBase64: string,
  apiKey: string,
  difficulty: "easy" | "medium" | "hard",
  questionCount: number = 5
): Promise<GeneratedQuestion[]> {
  // base64 데이터 URL에서 실제 데이터만 추출
  const base64Data = imageBase64.includes(",")
    ? imageBase64.split(",")[1]
    : imageBase64;

  // MIME 타입 추출
  let mimeType = "image/jpeg";
  if (imageBase64.startsWith("data:image/png")) {
    mimeType = "image/png";
  } else if (imageBase64.startsWith("data:image/gif")) {
    mimeType = "image/gif";
  } else if (imageBase64.startsWith("data:image/webp")) {
    mimeType = "image/webp";
  }

  const difficultyKorean = {
    easy: "쉬움 (기본 개념 이해 확인)",
    medium: "보통 (응용 및 이해력 테스트)",
    hard: "어려움 (심화 분석 및 추론 필요)",
  };

  const prompt = `당신은 대학 교수입니다. 이 교재/강의자료 이미지를 분석하여 학생들의 학습을 돕기 위한 객관식 문제 ${questionCount}개를 만들어주세요.

난이도: ${difficultyKorean[difficulty]}

요구사항:
1. 이미지에 보이는 내용을 기반으로 문제를 만들어주세요
2. 정확히 ${questionCount}개의 문제를 만들어주세요
3. 각 문제는 4개의 선지를 가져야 합니다
4. 문제는 핵심 개념을 테스트해야 합니다
5. 한국어로 작성해주세요

**중요: 문제 생성 규칙 (반드시 따르세요)**

[선지 구성 원칙]
- "옳은 것은?" 문제: 반드시 1개의 참(O) 선지 + 3개의 거짓(X) 선지로 구성
- "옳지 않은 것은?" 문제: 반드시 3개의 참(O) 선지 + 1개의 거짓(X) 선지로 구성
- 모든 선지가 참이거나 모든 선지가 거짓인 문제는 절대 만들지 마세요!
- 정답이 없는 문제는 절대 만들지 마세요!

[문제 생성 순서]
STEP 1. 먼저 각 선지에 대한 사실 여부를 판단합니다.
  - 교재 내용을 근거로 각 선지가 참(O)인지 거짓(X)인지 명확히 판단
  - 모호하거나 해석에 따라 달라지는 선지는 사용 금지
  - 확실히 틀린 내용을 하나 이상 포함해야 함

STEP 2. 문제 유형에 맞게 정답을 결정합니다.
  - "옳은 것은?" → 참(O)인 선지가 정답
  - "옳지 않은 것은?" → 거짓(X)인 선지가 정답

STEP 3. 자체 검증 (필수)
  ✓ 정답으로 지정한 선지의 O/X가 문제 유형과 일치하는지 확인
  ✓ "옳지 않은 것은?" 정답 선지 → 반드시 X(거짓)이어야 함
  ✓ "옳은 것은?" 정답 선지 → 반드시 O(참)이어야 함
  ✗ 모든 선지가 O거나 모든 선지가 X면 문제 재작성 필요

반드시 아래 JSON 형식으로만 응답해주세요. 다른 텍스트는 포함하지 마세요:
{
  "questions": [
    {
      "text": "문제 내용",
      "choices": ["선지1", "선지2", "선지3", "선지4"],
      "answer": 0,
      "explanation": "정답 요약 해설 (1-2문장)",
      "choiceExplanations": [
        "1번 선지에 대한 상세 해설 (O/X 여부와 이유)",
        "2번 선지에 대한 상세 해설 (O/X 여부와 이유)",
        "3번 선지에 대한 상세 해설 (O/X 여부와 이유)",
        "4번 선지에 대한 상세 해설 (O/X 여부와 이유)"
      ]
    }
  ]
}

- answer는 0부터 시작하는 인덱스입니다 (0=첫 번째 선지)
- explanation은 정답에 대한 간략한 요약 해설입니다
- choiceExplanations는 각 선지별 상세 해설 배열입니다 (choices와 같은 순서, 같은 개수)
  - 각 해설에 해당 선지가 참(O)인지 거짓(X)인지 명시하세요
  - 예: "이 선지는 옳습니다(O). ~이기 때문입니다." 또는 "이 선지는 틀립니다(X). ~가 아니라 ~이기 때문입니다."`;

  const requestBody = {
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType,
              data: base64Data,
            },
          },
          {
            text: prompt,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.7,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 4096,
    },
  };

  // Gemini 2.0 Flash 사용 (최신 무료 모델)
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      }
    );
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === "AbortError") {
      throw new Error("Gemini API 요청 시간 초과 (60초)");
    }
    throw err;
  }
  clearTimeout(timeout);

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Gemini API 오류:", response.status, errorText);

    if (response.status === 429) {
      throw new Error("API 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.");
    }

    throw new Error(`Gemini API 오류: ${response.status}`);
  }

  const result = await response.json() as any;

  // 응답 파싱
  if (
    !result.candidates ||
    result.candidates.length === 0 ||
    !result.candidates[0].content
  ) {
    console.error("Gemini 응답 형식 오류:", JSON.stringify(result, null, 2));
    throw new Error("AI 응답을 받지 못했습니다.");
  }

  const textContent = result.candidates[0].content.parts
    .filter((p: any) => p.text)
    .map((p: any) => p.text)
    .join("");

  console.log("Gemini 응답 텍스트:", textContent);

  // JSON 추출 (```json ... ``` 또는 순수 JSON)
  let jsonText = textContent;

  // 코드 블록에서 JSON 추출
  const jsonMatch = textContent.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonText = jsonMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonText);

    if (!parsed.questions || !Array.isArray(parsed.questions)) {
      throw new Error("questions 배열이 없습니다.");
    }

    // 문제 유효성 검사
    const validQuestions: GeneratedQuestion[] = [];
    for (const q of parsed.questions) {
      // 정답 유효성 검사 (단일 정답 또는 복수 정답)
      let isValidAnswer = false;
      if (typeof q.answer === "number") {
        isValidAnswer = q.answer >= 0 && q.answer < q.choices.length;
      } else if (Array.isArray(q.answer)) {
        isValidAnswer = q.answer.length > 0 &&
          q.answer.every((a: number) =>
            typeof a === "number" && a >= 0 && a < q.choices.length
          );
      }

      if (
        q.text &&
        Array.isArray(q.choices) &&
        q.choices.length >= 2 &&
        isValidAnswer
      ) {
        // 선지별 해설 유효성 검사 및 추출
      let choiceExplanations: string[] | undefined;
      if (Array.isArray(q.choiceExplanations) && q.choiceExplanations.length === q.choices.length) {
        choiceExplanations = q.choiceExplanations.map((exp: unknown) =>
          typeof exp === "string" ? exp : ""
        );
      }

        validQuestions.push({
          text: q.text,
          choices: q.choices,
          answer: q.answer,
          explanation: q.explanation || "",
          choiceExplanations,
        });
      }
    }

    if (validQuestions.length === 0) {
      throw new Error("유효한 문제가 없습니다.");
    }

    return validQuestions;
  } catch (parseError) {
    console.error("JSON 파싱 오류:", parseError, "원본:", jsonText);
    throw new Error("AI 응답을 파싱할 수 없습니다. 다시 시도해주세요.");
  }
}

/**
 * Gemini 사용량 조회 (Callable Function)
 */
export const getGeminiUsage = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const userId = request.auth.uid;
    const userUsage = await getUserDailyUsage(userId);
    const totalUsage = await getTotalDailyUsage();

    return {
      userUsed: userUsage,
      userLimit: DAILY_USER_LIMIT,
      userRemaining: Math.max(0, DAILY_USER_LIMIT - userUsage),
      totalUsed: totalUsage,
      totalLimit: DAILY_TOTAL_LIMIT,
      totalRemaining: Math.max(0, DAILY_TOTAL_LIMIT - totalUsage),
    };
  }
);

/**
 * Gemini AI 문제 생성 (Callable Function)
 *
 * @param data.image - base64 인코딩된 이미지 데이터
 * @param data.difficulty - 난이도 (easy, medium, hard)
 * @returns 생성된 문제 배열
 */
export const generateQuizWithGemini = onCall(
  {
    region: "asia-northeast3",
    secrets: [GEMINI_API_KEY],
    memory: "512MiB",
    timeoutSeconds: 120,
  },
  async (request) => {
    // 인증 확인
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const userId = request.auth.uid;
    const { image, difficulty = "medium", questionCount = 5 } = request.data as {
      image: string;
      difficulty?: "easy" | "medium" | "hard";
      questionCount?: number;
    };

    if (!image) {
      throw new HttpsError("invalid-argument", "이미지 데이터가 필요합니다.");
    }

    // API 키 확인
    const apiKey = GEMINI_API_KEY.value();

    if (!apiKey) {
      console.error("Gemini API 키가 설정되지 않았습니다.");
      throw new HttpsError(
        "failed-precondition",
        "AI 서비스가 설정되지 않았습니다. 관리자에게 문의하세요."
      );
    }

    // 사용자별 사용량 확인
    const userUsage = await getUserDailyUsage(userId);
    if (userUsage >= DAILY_USER_LIMIT) {
      throw new HttpsError(
        "resource-exhausted",
        `오늘의 AI 문제 생성 횟수(${DAILY_USER_LIMIT}회)를 모두 사용했습니다. 내일 다시 시도해주세요.`
      );
    }

    // 전체 사용량 확인
    const totalUsage = await getTotalDailyUsage();
    if (totalUsage >= DAILY_TOTAL_LIMIT) {
      throw new HttpsError(
        "resource-exhausted",
        "오늘의 전체 AI 사용량을 초과했습니다. 내일 다시 시도해주세요."
      );
    }

    try {
      // questionCount 유효성 검사 (5~10)
      const validQuestionCount = Math.min(Math.max(questionCount, 5), 10);

      // Gemini API 호출
      const questions = await callGeminiApi(image, apiKey, difficulty, validQuestionCount);

      // 사용량 증가
      await incrementUsage(userId);

      const newUserUsage = userUsage + 1;

      console.log(
        `Gemini 문제 생성 완료 (사용자: ${userId}, 사용량: ${newUserUsage}/${DAILY_USER_LIMIT})`
      );

      return {
        success: true,
        questions,
        usage: {
          userUsed: newUserUsage,
          userLimit: DAILY_USER_LIMIT,
          userRemaining: DAILY_USER_LIMIT - newUserUsage,
        },
      };
    } catch (error) {
      console.error("Gemini 처리 오류:", error);
      throw new HttpsError(
        "internal",
        error instanceof Error
          ? error.message
          : "AI 문제 생성 중 오류가 발생했습니다."
      );
    }
  }
);

/**
 * 키워드 추출 결과 타입
 */
interface ExtractedKeywords {
  mainConcepts: string[];
  caseTriggers: string[];
}

/**
 * 과목 타입
 */
type SubjectType = "biology" | "pathophysiology" | "microbiology";

/**
 * 키워드 수 계산 결과 타입
 */
interface KeywordCounts {
  mainConcepts: number;
  caseTriggers: number;
}

/**
 * 텍스트 볼륨 기반 동적 키워드 수 계산
 *
 * 학습 자료가 많으면 더 많은 키워드를 추출하여 누락 방지
 * - 기본값: 문제 수 또는 8개 중 큰 값
 * - 1500자당 +3개 보너스 (더 많은 키워드 추출)
 * - mainConcepts 최대 35개, caseTriggers 최대 25개
 */
function calculateKeywordCounts(
  textLength: number,
  questionCount: number
): KeywordCounts {
  const baseCount = Math.max(questionCount, 8); // 최소 8개 보장

  // 1500자당 +3개 보너스 (최대 20개 보너스) - 더 많은 키워드 추출
  const volumeBonus = Math.min(Math.floor(textLength / 1500) * 3, 20);

  return {
    mainConcepts: Math.min(baseCount + volumeBonus, 35), // 최대 35개
    caseTriggers: Math.min(Math.max(baseCount + volumeBonus - 2, 5), 25), // 최대 25개
  };
}

/**
 * 과목별 키워드 추출 프롬프트 생성 (간소화 버전)
 *
 * 학습 자료에서만 키워드를 추출 (scope/focusGuide 참조 제거로 속도 개선)
 */
function buildKeywordExtractionPrompt(
  text: string,
  questionCount: number,
  subject: SubjectType
): string {
  // 텍스트 볼륨 기반 동적 키워드 수 계산
  const keywordCounts = calculateKeywordCounts(text.length, questionCount);

  // 과목별 간단한 가이드
  const subjectGuide: Record<SubjectType, string> = {
    biology: "이론/메커니즘 → mainConcepts, 실험/예시 → caseTriggers",
    pathophysiology: "질병/메커니즘 → mainConcepts, 증상/검사소견 → caseTriggers",
    microbiology: "병원체/감염질환 → mainConcepts, 증상/검사소견 → caseTriggers",
  };

  // 간소화된 프롬프트 (토큰 절약)
  return `시험 키워드 추출 (${subject})

규칙:
- mainConcepts (최대 ${keywordCounts.mainConcepts}개): 문제 제목이 될 핵심 개념
- caseTriggers (최대 ${keywordCounts.caseTriggers}개): 문제 상황 설정용 단서
- ${subjectGuide[subject]}
- 조사 포함 금지 (세포는❌), 단독 일반명사 금지 (세포❌)
- 학습 자료에 없는 내용 추출 금지

JSON만 출력:
{"mainConcepts":["..."],"caseTriggers":["..."]}

학습 자료:
${text.slice(0, 6000)}`;
}

/**
 * Gemini API 호출하여 시험 키워드 추출 (과목별 정책 적용)
 *
 * @param text - OCR 추출된 텍스트
 * @param apiKey - Gemini API 키
 * @param questionCount - 생성할 문제 수
 * @param subject - 과목 (biology, pathophysiology, microbiology)
 */
async function extractKeywordsWithGeminiApi(
  text: string,
  apiKey: string,
  questionCount: number,
  subject: SubjectType = "biology"
): Promise<ExtractedKeywords> {
  const prompt = buildKeywordExtractionPrompt(text, questionCount, subject);

  const requestBody = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.3,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 1024,
    },
  };

  const controller2 = new AbortController();
  const timeout2 = setTimeout(() => controller2.abort(), 30_000);
  let response2: Awaited<ReturnType<typeof fetch>>;
  try {
    response2 = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller2.signal,
      }
    );
  } catch (err: any) {
    clearTimeout(timeout2);
    if (err.name === "AbortError") {
      throw new Error("Gemini API 키워드 추출 시간 초과 (30초)");
    }
    throw err;
  }
  clearTimeout(timeout2);

  if (!response2.ok) {
    const errorText = await response2.text();
    console.error("Gemini API 오류:", response2.status, errorText);
    throw new Error(`Gemini API 오류: ${response2.status}`);
  }

  const result = (await response2.json()) as any;

  if (
    !result.candidates ||
    result.candidates.length === 0 ||
    !result.candidates[0].content
  ) {
    throw new Error("AI 응답을 받지 못했습니다.");
  }

  const textContent = result.candidates[0].content.parts
    .filter((p: any) => p.text)
    .map((p: any) => p.text)
    .join("");

  console.log("Gemini 키워드 응답:", textContent);

  // JSON 추출
  let jsonText = textContent;
  const jsonMatch = textContent.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonText = jsonMatch[1].trim();
  }

  // 객체 부분만 추출
  const objectMatch = jsonText.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    jsonText = objectMatch[0];
  }

  try {
    const parsed = JSON.parse(jsonText);

    // 동적 키워드 수 계산
    const keywordCounts = calculateKeywordCounts(text.length, questionCount);

    // 유효성 검사 및 필터링
    const filterKeywords = (arr: unknown, maxCount: number): string[] => {
      if (!Array.isArray(arr)) return [];
      return arr
        .filter(
          (k: unknown) =>
            typeof k === "string" && k.length >= 2 && k.length <= 50
        )
        .slice(0, maxCount);
    };

    const extracted: ExtractedKeywords = {
      mainConcepts: filterKeywords(parsed.mainConcepts, keywordCounts.mainConcepts),
      caseTriggers: filterKeywords(parsed.caseTriggers, keywordCounts.caseTriggers),
    };

    console.log(
      `키워드 추출 (텍스트 ${text.length}자): mainConcepts=${extracted.mainConcepts.length}/${keywordCounts.mainConcepts}, caseTriggers=${extracted.caseTriggers.length}/${keywordCounts.caseTriggers}`
    );

    return extracted;
  } catch (parseError) {
    console.error("JSON 파싱 오류:", parseError, "원본:", jsonText);
    throw new Error("키워드를 파싱할 수 없습니다.");
  }
}

/**
 * Gemini 키워드 추출 (Callable Function)
 *
 * @param data.text - OCR 추출된 텍스트
 * @param data.questionCount - 생성할 문제 수 (기본값: 10)
 * @param data.subject - 과목 (biology, pathophysiology, microbiology)
 * @param data.courseId - 과목 ID (scope 참조용, 선택)
 * @returns 추출된 키워드 (mainConcepts, caseTriggers)
 */
export const extractKeywords = onCall(
  {
    region: "asia-northeast3",
    secrets: [GEMINI_API_KEY],
    memory: "512MiB",
    timeoutSeconds: 90,
  },
  async (request) => {
    // 인증 확인
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const { text, questionCount = 10, subject = "biology" } = request.data as {
      text: string;
      questionCount?: number;
      subject?: SubjectType;
    };

    if (!text || text.trim().length < 50) {
      throw new HttpsError(
        "invalid-argument",
        "텍스트가 너무 짧습니다. 더 많은 내용이 필요합니다."
      );
    }

    // 과목 유효성 검사
    const validSubjects: SubjectType[] = [
      "biology",
      "pathophysiology",
      "microbiology",
    ];
    const validatedSubject: SubjectType = validSubjects.includes(
      subject as SubjectType
    )
      ? (subject as SubjectType)
      : "biology";

    // API 키 확인
    const apiKey = GEMINI_API_KEY.value();
    if (!apiKey) {
      throw new HttpsError(
        "failed-precondition",
        "AI 서비스가 설정되지 않았습니다."
      );
    }

    try {
      // 키워드 추출은 학습 자료에서만 수행 (scope 로딩 제거로 속도 개선)
      const keywords = await extractKeywordsWithGeminiApi(
        text,
        apiKey,
        questionCount,
        validatedSubject
      );

      console.log(
        `키워드 추출 완료 [${validatedSubject}]: mainConcepts=${keywords.mainConcepts.length}, caseTriggers=${keywords.caseTriggers.length}`
      );

      return {
        success: true,
        subject: validatedSubject,
        ...keywords,
      };
    } catch (error) {
      console.error("키워드 추출 오류:", error);
      throw new HttpsError(
        "internal",
        error instanceof Error
          ? error.message
          : "키워드 추출 중 오류가 발생했습니다."
      );
    }
  }
);
