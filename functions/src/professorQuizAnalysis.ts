/**
 * 교수 퀴즈 분석 Cloud Function (v2)
 *
 * 교수가 퀴즈를 생성하면 자동으로:
 * 1. 출제 스타일 분석 (발문 패턴, 오답 구성 전략, 주제 비중)
 * 2. 핵심 학술 용어 + 출제 토픽 추출
 * 3. 원본 문제 샘플 저장 (few-shot 예시용, 최대 20개 회전)
 * 4. 과목별 스타일 프로필 누적 업데이트
 *
 * 핵심 원칙: 원본 문제(발문+선지)를 직접 저장하여 few-shot으로 사용.
 * Gemini 분석은 보조 역할(스타일 요약, 패턴 정리).
 * 교수가 계속 문제를 올려도 sampleQuestions는 최근 20개만 유지 (FIFO 회전).
 */

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import fetch from "node-fetch";

// Gemini API 키
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

// 문제 뱅크 최대 보관 수 (1000문제 × ~500바이트 ≈ 500KB, Firestore 1MB 한도 내)
const MAX_QUESTION_BANK_SIZE = 1000;

// ============================================================
// 타입 정의 (v2)
// ============================================================

/** 교수 원본 문제 (few-shot 예시용) */
export interface SampleQuestion {
  stem: string;           // 발문 원문
  choices: string[];      // 선지 원문 (순서대로)
  correctAnswer?: number; // 정답 인덱스 (있으면)
  quizId: string;         // 출처 퀴즈 ID
  addedAt: number;        // 추가 타임스탬프
}

/**
 * 문제 뱅크 — 교수 원본 문제 전체 보관 (최대 300개)
 *
 * Firestore: professorQuizAnalysis/{courseId}/data/questionBank
 * 문제 생성 시 여기서 랜덤 10개 뽑아서 few-shot 예시로 사용.
 * 모든 문제가 확률적으로 활용됨.
 */
export interface QuestionBank {
  courseId: string;
  lastUpdated: FirebaseFirestore.Timestamp;
  totalCount: number;
  questions: SampleQuestion[];
}

/**
 * 스타일 프로필 (v2) — Gemini 분석 결과 (보조 역할)
 *
 * 핵심 few-shot은 QuestionBank에서 랜덤 추출.
 * 이 프로필은 전체 경향 요약 + 패턴 정리 (보조 컨텍스트).
 */
export interface StyleProfile {
  courseId: string;
  courseName: string;
  lastUpdated: FirebaseFirestore.Timestamp;
  analyzedQuizCount: number;
  analyzedQuestionCount: number;

  // 교수 출제 스타일 자연어 요약 (Gemini 분석)
  styleDescription: string;

  // 실제 발문 패턴 (보조)
  questionPatterns: {
    pattern: string;
    frequency: number;
    examples: string[];
  }[];

  // 선지 구성 전략 (보조)
  distractorStrategies: string[];

  // 주제별 출제 비중 (보조)
  topicEmphasis: {
    topic: string;
    weight: number;
  }[];
}

/**
 * 키워드 저장소 (v2) — 교수가 실제 시험에서 다루는 학술 용어와 토픽
 */
export interface KeywordStore {
  courseId: string;
  lastUpdated: FirebaseFirestore.Timestamp;

  // 핵심 학술 용어
  coreTerms: {
    korean: string;
    english?: string;
    frequency: number;
    context: string;
  }[];

  // 출제 토픽
  examTopics: {
    topic: string;
    subtopics: string[];
    questionCount: number;
  }[];
}

/** Gemini 분석 결과 (단일 퀴즈) */
interface QuizAnalysisResult {
  styleDescription: string;
  questionPatterns: { pattern: string; examples: string[] }[];
  distractorStrategies: string[];
  topicEmphasis: { topic: string; weight: number }[];
}

/** 키워드 추출 결과 (단일 퀴즈) */
interface KeywordExtractionResult {
  coreTerms: { korean: string; english?: string; context: string }[];
  examTopics: { topic: string; subtopics: string[] }[];
}

/** 퀴즈 분석 원본 저장 */
interface RawAnalysis {
  quizId: string;
  courseId: string;
  createdAt: FirebaseFirestore.Timestamp;
  analysis: QuizAnalysisResult;
  keywords: KeywordExtractionResult;
  // 원본 문제도 raw에 보관 (영구 아카이브)
  originalQuestions: Array<{ stem: string; choices: string[] }>;
}

// ============================================================
// Gemini API 호출
// ============================================================

/**
 * Gemini로 교수 출제 스타일 분석 (보조 역할)
 * 핵심 few-shot은 원본 문제에서 직접 가져오고,
 * 이 함수는 스타일 요약/패턴 정리만 담당
 */
async function analyzeQuestionsWithGemini(
  questions: Array<{
    stem: string;
    choices?: Array<{ label: string; text: string }>;
    type: string;
  }>,
  apiKey: string
): Promise<QuizAnalysisResult> {
  const questionsText = questions
    .map((q, i) => {
      let text = `[문제 ${i + 1}]\n${q.stem}`;
      if (q.choices && q.choices.length > 0) {
        text += "\n" + q.choices.map((c) => `${c.label}. ${c.text}`).join("\n");
      }
      return text;
    })
    .join("\n\n---\n\n");

  const prompt = `당신은 대학 교수의 시험 출제 스타일을 분석하는 전문가입니다.
아래 교수가 실제로 출제한 문제들을 정밀하게 분석하여, AI가 이 교수처럼 문제를 생성할 수 있도록 구체적 패턴을 추출하세요.

## 분석할 문제들
${questionsText}

## 분석 과제

### 1. styleDescription (교수 출제 스타일 자연어 요약)
이 교수가 문제를 어떻게 내는지 3-5문장으로 **구체적으로** 서술하세요.
- 발문의 길이, 구조, 특징적인 표현 방식
- 선지 구성 방식 (정답과 오답의 관계)
- 자주 사용하는 질문 방식 (부정형, 비교형, 정의형 등)
- 용어 사용 방식 (영문 병기 여부, 전문용어 수준)
- **추상적 서술 금지** — "주로 '~에 대한 설명으로 옳지 않은 것은?' 형태를 사용한다" 처럼 구체적으로

### 2. questionPatterns (발문 패턴)
이 교수가 실제로 사용하는 발문 구조를 추출하세요.
- "~에 대한 설명으로 옳은 것은?" 같은 구체적 템플릿 형태
- 각 패턴별 실제 발문 예시 1-2개 포함
- 최소 3개, 최대 8개

### 3. distractorStrategies (오답 선지 구성 전략)
이 교수가 오답을 어떻게 만드는지 **구체적으로** 분석하세요.
- **추상적 코드 금지**: "유사용어_혼동" ← 이런 식 금지
- 실제 문제 근거로 서술
  좋은 예: "그람양성균의 특징을 묻는 문제에서, 그람음성균의 특징(외막, LPS)을 선지에 섞어 구분 요구"
- 최소 2개, 최대 5개

### 4. topicEmphasis (주제별 출제 비중)
- topic: 학술적 주제명
- weight: 1(1문제) ~ 10(다수 문제)

## 출력 형식 (JSON만 출력, 다른 텍스트 없이)
{
  "styleDescription": "이 교수는...",
  "questionPatterns": [
    {"pattern": "~에 대한 설명으로 옳지 않은 것은?", "examples": ["실제 발문 1"]}
  ],
  "distractorStrategies": ["구체적 전략 1"],
  "topicEmphasis": [{"topic": "주제명", "weight": 8}]
}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 4096,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Gemini API 오류:", response.status, errorText);
    throw new Error(`Gemini API 오류: ${response.status}`);
  }

  const result = (await response.json()) as any;
  if (!result.candidates?.[0]?.content) {
    throw new Error("AI 응답을 받지 못했습니다.");
  }

  const textContent = result.candidates[0].content.parts
    .filter((p: any) => p.text)
    .map((p: any) => p.text)
    .join("");

  const parsed = robustParseJson(textContent);

  return {
    styleDescription: typeof parsed.styleDescription === "string" ? parsed.styleDescription : "",
    questionPatterns: Array.isArray(parsed.questionPatterns)
      ? parsed.questionPatterns
          .filter((p: any) => typeof p.pattern === "string")
          .map((p: any) => ({
            pattern: p.pattern,
            examples: Array.isArray(p.examples) ? p.examples.filter((e: any) => typeof e === "string").slice(0, 3) : [],
          }))
      : [],
    distractorStrategies: Array.isArray(parsed.distractorStrategies)
      ? parsed.distractorStrategies.filter((s: any) => typeof s === "string").slice(0, 5)
      : [],
    topicEmphasis: Array.isArray(parsed.topicEmphasis)
      ? parsed.topicEmphasis
          .filter((t: any) => typeof t.topic === "string" && typeof t.weight === "number")
          .slice(0, 10)
      : [],
  };
}

/**
 * Gemini로 핵심 학술 용어 + 출제 토픽 추출
 */
async function extractKeywordsFromQuestions(
  questions: Array<{ stem: string; choices?: Array<{ label: string; text: string }> }>,
  courseId: string,
  apiKey: string
): Promise<KeywordExtractionResult> {
  const questionsText = questions
    .map((q, i) => {
      let text = `[문제 ${i + 1}] ${q.stem}`;
      if (q.choices && q.choices.length > 0) {
        text += "\n" + q.choices.map(c => `${c.label}. ${c.text}`).join(" / ");
      }
      return text;
    })
    .join("\n");

  const subjectHint = courseId.includes("patho")
    ? "병태생리학"
    : courseId.includes("micro")
    ? "미생물학"
    : "생물학";

  const prompt = `당신은 ${subjectHint} 시험 분석 전문가입니다.
아래 교수가 실제로 출제한 시험 문제에서 핵심 학술 용어와 출제 토픽을 추출하세요.

## 시험 문제
${questionsText.slice(0, 8000)}

## 추출 규칙

### coreTerms (핵심 학술 용어) — 최대 25개
교수가 문제와 선지에서 **실제로 사용한** 학술/의학 용어만 추출하세요.

**좋은 예시:**
- {"korean": "그람양성균", "english": "Gram-positive bacteria", "context": "세균 분류 비교 문제"}
- {"korean": "펩티도글리칸", "english": "peptidoglycan", "context": "세포벽 구조 문제"}

**금지 예시:**
- "백신 개발자", "미생물학 아버지" ← 인물/수식어
- "세균 발견" ← 행위/사건
- "감염" ← 너무 일반적

**기준:** 학술 전문 용어만, 영문 병기 있으면 함께, 맥락 한 문장

### examTopics (출제 토픽) — 최대 10개
**대주제 + 세부주제**로 정리하세요.

**좋은 예시:**
- {"topic": "세균의 구조와 분류", "subtopics": ["그람염색", "펩티도글리칸", "외막", "LPS"]}
- {"topic": "항생제와 내성", "subtopics": ["페니실린", "MRSA", "VRE"]}

## 출력 형식 (JSON만 출력)
{
  "coreTerms": [{"korean": "용어", "english": "term", "context": "맥락"}],
  "examTopics": [{"topic": "대주제", "subtopics": ["세부1"]}]
}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Gemini API 오류: ${response.status}`);
  }

  const result = (await response.json()) as any;
  const textContent = result.candidates?.[0]?.content?.parts
    ?.filter((p: any) => p.text)
    ?.map((p: any) => p.text)
    ?.join("") || "";

  try {
    const parsed = robustParseJson(textContent);
    return {
      coreTerms: Array.isArray(parsed.coreTerms)
        ? parsed.coreTerms
            .filter((t: any) => typeof t.korean === "string" && t.korean.length > 0)
            .map((t: any) => ({
              korean: t.korean,
              english: typeof t.english === "string" ? t.english : undefined,
              context: typeof t.context === "string" ? t.context : "",
            }))
            .slice(0, 25)
        : [],
      examTopics: Array.isArray(parsed.examTopics)
        ? parsed.examTopics
            .filter((t: any) => typeof t.topic === "string")
            .map((t: any) => ({
              topic: t.topic,
              subtopics: Array.isArray(t.subtopics) ? t.subtopics.filter((s: any) => typeof s === "string") : [],
            }))
            .slice(0, 10)
        : [],
    };
  } catch {
    console.error("키워드 파싱 오류");
    return { coreTerms: [], examTopics: [] };
  }
}

// ============================================================
// JSON 파싱 유틸
// ============================================================

/**
 * Gemini 응답에서 JSON을 안전하게 추출
 */
function robustParseJson(rawText: string): any {
  let text = rawText;
  const codeBlockMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    text = codeBlockMatch[1].trim();
  }

  try { return JSON.parse(text); } catch {}

  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch {}
    try {
      const fixed = objMatch[0].replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
      return JSON.parse(fixed);
    } catch {}
  }

  console.error("JSON 파싱 최종 실패, 빈 객체 반환");
  return {};
}

// ============================================================
// 스타일 프로필 업데이트
// ============================================================

/**
 * 새 분석 결과를 기존 프로필에 병합
 */
function mergeStyleProfile(
  existing: StyleProfile | null,
  newAnalysis: QuizAnalysisResult,
  questionCount: number,
  courseId: string,
  courseName: string
): StyleProfile {
  const now = FieldValue.serverTimestamp() as unknown as FirebaseFirestore.Timestamp;

  // 기존 프로필이 없거나 v1 형식이면 새로 생성
  const isV1 = existing && ("typeDistribution" in existing);
  if (!existing || isV1) {
    return {
      courseId,
      courseName,
      lastUpdated: now,
      analyzedQuizCount: 1,
      analyzedQuestionCount: questionCount,
      styleDescription: newAnalysis.styleDescription,
      questionPatterns: newAnalysis.questionPatterns.map(p => ({
        pattern: p.pattern,
        frequency: 1,
        examples: p.examples.slice(0, 3),
      })),
      distractorStrategies: newAnalysis.distractorStrategies,
      topicEmphasis: newAnalysis.topicEmphasis,
    };
  }

  // 기존 v2 프로필 업데이트
  const profile: StyleProfile = {
    ...existing,
    lastUpdated: now,
    analyzedQuizCount: existing.analyzedQuizCount + 1,
    analyzedQuestionCount: existing.analyzedQuestionCount + questionCount,
    styleDescription: newAnalysis.styleDescription || existing.styleDescription,
  };

  // 발문 패턴 병합
  const patternMap = new Map<string, { frequency: number; examples: string[] }>();
  for (const p of (existing.questionPatterns || [])) {
    patternMap.set(p.pattern, { frequency: p.frequency, examples: [...p.examples] });
  }
  for (const p of newAnalysis.questionPatterns) {
    const ex = patternMap.get(p.pattern);
    if (ex) {
      ex.frequency += 1;
      for (const e of p.examples) {
        if (ex.examples.length < 3 && !ex.examples.includes(e)) {
          ex.examples.push(e);
        }
      }
    } else {
      patternMap.set(p.pattern, { frequency: 1, examples: p.examples.slice(0, 3) });
    }
  }
  profile.questionPatterns = Array.from(patternMap.entries())
    .map(([pattern, data]) => ({ pattern, ...data }))
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 15);

  // 오답 전략 병합
  const strategies = new Set(existing.distractorStrategies || []);
  for (const s of newAnalysis.distractorStrategies) {
    strategies.add(s);
  }
  profile.distractorStrategies = Array.from(strategies).slice(0, 10);

  // 주제 비중 병합
  const topicMap = new Map<string, number>();
  for (const t of (existing.topicEmphasis || [])) {
    topicMap.set(t.topic, t.weight);
  }
  for (const t of newAnalysis.topicEmphasis) {
    const prev = topicMap.get(t.topic) || 0;
    topicMap.set(t.topic, Math.max(prev, t.weight));
  }
  profile.topicEmphasis = Array.from(topicMap.entries())
    .map(([topic, weight]) => ({ topic, weight }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 15);

  return profile;
}

/**
 * 키워드 저장소 업데이트 (v2)
 */
function mergeKeywordStore(
  existing: KeywordStore | null,
  newKeywords: KeywordExtractionResult,
  courseId: string
): KeywordStore {
  const now = FieldValue.serverTimestamp() as unknown as FirebaseFirestore.Timestamp;

  const isV1 = existing && "mainConcepts" in existing;
  if (!existing || isV1) {
    return {
      courseId,
      lastUpdated: now,
      coreTerms: newKeywords.coreTerms.map(t => ({
        korean: t.korean,
        english: t.english,
        frequency: 1,
        context: t.context,
      })),
      examTopics: newKeywords.examTopics.map(t => ({
        topic: t.topic,
        subtopics: t.subtopics,
        questionCount: 1,
      })),
    };
  }

  const store: KeywordStore = { ...existing, lastUpdated: now };

  // coreTerms 병합
  const termMap = new Map<string, { english?: string; frequency: number; context: string }>();
  for (const t of existing.coreTerms) {
    termMap.set(t.korean, { english: t.english, frequency: t.frequency, context: t.context });
  }
  for (const t of newKeywords.coreTerms) {
    const ex = termMap.get(t.korean);
    if (ex) {
      ex.frequency += 1;
      if (t.english && !ex.english) ex.english = t.english;
      if (t.context) ex.context = t.context;
    } else {
      termMap.set(t.korean, { english: t.english, frequency: 1, context: t.context });
    }
  }
  store.coreTerms = Array.from(termMap.entries())
    .map(([korean, data]) => ({ korean, ...data }))
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 50);

  // examTopics 병합
  const topicMap = new Map<string, { subtopics: Set<string>; questionCount: number }>();
  for (const t of existing.examTopics) {
    topicMap.set(t.topic, { subtopics: new Set(t.subtopics), questionCount: t.questionCount });
  }
  for (const t of newKeywords.examTopics) {
    const ex = topicMap.get(t.topic);
    if (ex) {
      ex.questionCount += 1;
      for (const s of t.subtopics) ex.subtopics.add(s);
    } else {
      topicMap.set(t.topic, { subtopics: new Set(t.subtopics), questionCount: 1 });
    }
  }
  store.examTopics = Array.from(topicMap.entries())
    .map(([topic, data]) => ({ topic, subtopics: Array.from(data.subtopics), questionCount: data.questionCount }))
    .sort((a, b) => b.questionCount - a.questionCount)
    .slice(0, 20);

  return store;
}

/**
 * 문제 뱅크 업데이트: 새 문제 추가, 300개 초과 시 가장 오래된 것 제거
 */
function mergeQuestionBank(
  existing: QuestionBank | null,
  newQuestions: SampleQuestion[],
  courseId: string
): QuestionBank {
  const now = FieldValue.serverTimestamp() as unknown as FirebaseFirestore.Timestamp;

  if (!existing) {
    return {
      courseId,
      lastUpdated: now,
      totalCount: newQuestions.length,
      questions: newQuestions.slice(0, MAX_QUESTION_BANK_SIZE),
    };
  }

  // 새 문제를 앞에 추가 (최신순)
  const allQuestions = [...newQuestions, ...existing.questions];

  // 300개 초과 시 가장 오래된 것 제거 (FIFO)
  const trimmed = allQuestions.slice(0, MAX_QUESTION_BANK_SIZE);

  return {
    courseId,
    lastUpdated: now,
    totalCount: trimmed.length,
    questions: trimmed,
  };
}

// ============================================================
// Cloud Function
// ============================================================

/**
 * 교수 퀴즈 생성 시 자동 분석 (v2)
 *
 * 트리거: quizzes/{quizId} 문서 생성
 * 조건: 생성자가 교수 (role: 'professor')
 */
export const onProfessorQuizCreated = onDocumentCreated(
  {
    document: "quizzes/{quizId}",
    region: "asia-northeast3",
    secrets: [GEMINI_API_KEY],
    memory: "512MiB",
    timeoutSeconds: 120,
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;

    const quizId = event.params.quizId;
    const quizData = snapshot.data() as {
      creatorId: string;
      courseId?: string;
      courseName?: string;
      type?: string;
      questions?: Array<{
        text?: string;
        stem?: string;
        type: string;
        answer?: number;
        choices?: string[] | Array<{ label: string; text: string }>;
      }>;
    };

    const db = getFirestore();

    // 1. 생성자가 교수인지 확인
    const userDoc = await db.collection("users").doc(quizData.creatorId).get();
    if (!userDoc.exists || userDoc.data()?.role !== "professor") {
      return;
    }

    // 2. 문제 목록 확인
    const questions = quizData.questions;
    if (!questions || questions.length === 0) {
      return;
    }

    const courseId = quizData.courseId || "general";
    const courseName = quizData.courseName || "일반";

    console.log(`[교수 퀴즈 분석] ${quizId}, ${courseName}, ${questions.length}문제`);

    const apiKey = GEMINI_API_KEY.value();
    if (!apiKey) {
      console.error("[분석 실패] Gemini API 키 없음");
      return;
    }

    // 문제 데이터 정규화
    const normalizedQuestions = questions.map((q) => {
      const stem = q.text || q.stem || "";
      let choices: Array<{ label: string; text: string }> | undefined;
      let choiceStrings: string[] = [];

      if (Array.isArray(q.choices) && q.choices.length > 0) {
        if (typeof q.choices[0] === "string") {
          choiceStrings = q.choices as string[];
          choices = choiceStrings.map((c, i) => ({
            label: String(i + 1),
            text: c,
          }));
        } else {
          choices = q.choices as Array<{ label: string; text: string }>;
          choiceStrings = choices.map(c => c.text);
        }
      }

      return {
        stem,
        type: q.type,
        choices,
        choiceStrings,
        correctAnswer: typeof q.answer === "number" ? q.answer : undefined,
      };
    }).filter((q) => q.stem.length > 0);

    if (normalizedQuestions.length === 0) {
      return;
    }

    // ★ 원본 문제 → SampleQuestion 변환 (questionBank용)
    const now = Date.now();
    const newSamples: SampleQuestion[] = normalizedQuestions
      .filter(q => q.choiceStrings.length >= 2)
      .map(q => ({
        stem: q.stem,
        choices: q.choiceStrings,
        correctAnswer: q.correctAnswer,
        quizId,
        addedAt: now,
      }));

    try {
      // Gemini 분석 + 키워드 추출 병렬 실행
      const [analysis, keywords] = await Promise.all([
        analyzeQuestionsWithGemini(normalizedQuestions, apiKey),
        extractKeywordsFromQuestions(normalizedQuestions, courseId, apiKey),
      ]);

      console.log(`[분석 완료] 패턴 ${analysis.questionPatterns.length}개, 용어 ${keywords.coreTerms.length}개, 원본 ${newSamples.length}개`);

      // Firestore 저장
      const analysisRef = db.collection("professorQuizAnalysis").doc(courseId);

      // raw 저장 (영구 아카이브)
      await analysisRef.collection("raw").doc(quizId).set({
        quizId,
        courseId,
        createdAt: FieldValue.serverTimestamp(),
        analysis,
        keywords,
        originalQuestions: normalizedQuestions.map(q => ({
          stem: q.stem,
          choices: q.choiceStrings,
        })),
      } as RawAnalysis);

      // 스타일 프로필 업데이트
      const styleRef = analysisRef.collection("data").doc("styleProfile");
      const existingStyle = (await styleRef.get()).data() as StyleProfile | undefined;
      const updatedStyle = mergeStyleProfile(
        existingStyle || null,
        analysis,
        normalizedQuestions.length,
        courseId,
        courseName
      );
      await styleRef.set(updatedStyle);

      // ★ 문제 뱅크 업데이트 (원본 전체 누적, 최대 300개)
      const bankRef = analysisRef.collection("data").doc("questionBank");
      const existingBank = (await bankRef.get()).data() as QuestionBank | undefined;
      const updatedBank = mergeQuestionBank(existingBank || null, newSamples, courseId);
      await bankRef.set(updatedBank);

      // 키워드 업데이트
      const keywordsRef = analysisRef.collection("data").doc("keywords");
      const existingKeywords = (await keywordsRef.get()).data() as KeywordStore | undefined;
      const updatedKeywords = mergeKeywordStore(existingKeywords || null, keywords, courseId);
      await keywordsRef.set(updatedKeywords);

      // 메타데이터
      await analysisRef.set(
        {
          courseId,
          courseName,
          lastAnalyzedQuizId: quizId,
          lastAnalyzedAt: FieldValue.serverTimestamp(),
          totalQuizCount: FieldValue.increment(1),
          totalQuestionCount: FieldValue.increment(questions.length),
        },
        { merge: true }
      );

      console.log(`[교수 퀴즈 분석 완료] ${quizId}, 문제 뱅크 ${updatedBank.totalCount}개 보유`);
    } catch (error) {
      console.error(`[교수 퀴즈 분석 실패] ${quizId}:`, error);
    }
  }
);
