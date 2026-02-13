/**
 * 교수 퀴즈 분석 Cloud Function
 *
 * 교수가 퀴즈를 생성하면 자동으로:
 * 1. 문제 스타일 분석 (유형, 함정 패턴, 톤)
 * 2. 키워드 추출 (mainConcepts, caseTriggers)
 * 3. 과목별 스타일 프로필 업데이트
 *
 * AI 문제 생성 시 이 데이터를 활용하여 교수 스타일에 맞는 문제 생성
 */

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import fetch from "node-fetch";

// Gemini API 키
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

// ============================================================
// 타입 정의
// ============================================================

/** 문제 유형 */
type QuestionType =
  | "NEGATIVE"          // 옳지 않은 것 찾기
  | "DEFINITION_MATCH"  // 정의-개념 매칭
  | "MECHANISM"         // 기전/원리
  | "MULTI_SELECT"      // 모두 고르기
  | "CLASSIFICATION"    // 분류
  | "CLINICAL_CASE"     // 임상 케이스
  | "FILL_IN_BLANK"     // 빈칸 채우기
  | "COMPARISON"        // 비교
  | "OTHER";            // 기타

/** 분석된 문제 태그 */
interface TaggedQuestion {
  questionIndex: number;
  stem: string;
  types: QuestionType[];
  difficulty: "EASY" | "MEDIUM" | "HARD";
  trapPatterns: string[];      // 함정 유형
  keyTerms: string[];          // 핵심 용어
  cognitiveLevel: "기억" | "이해" | "적용" | "분석" | "평가";
}

/** 스타일 프로필 */
export interface StyleProfile {
  courseId: string;
  courseName: string;
  lastUpdated: FirebaseFirestore.Timestamp;
  analyzedQuizCount: number;
  analyzedQuestionCount: number;

  // 문제 유형 분포
  typeDistribution: Record<QuestionType, number>;

  // 난이도별 유형 분포
  difficultyTypeMap: {
    EASY: QuestionType[];
    MEDIUM: QuestionType[];
    HARD: QuestionType[];
  };

  // 함정 패턴
  trapPatterns: {
    pattern: string;
    frequency: number;
    examples: string[];
  }[];

  // 출제 톤/스타일
  toneCharacteristics: {
    usesNegative: boolean;      // "옳지 않은 것" 사용 빈도
    usesMultiSelect: boolean;   // "모두 고르기" 사용 빈도
    hasEnglishTerms: boolean;   // 영문 병기 여부
    hasClinicalCases: boolean;  // 임상 케이스 포함 여부
    preferredStemLength: "short" | "medium" | "long";
  };

  // 인지 수준 분포
  cognitiveLevelDistribution: Record<string, number>;
}

/** 키워드 저장소 */
export interface KeywordStore {
  courseId: string;
  lastUpdated: FirebaseFirestore.Timestamp;
  mainConcepts: {
    term: string;
    frequency: number;
    relatedQuizIds: string[];
  }[];
  caseTriggers: {
    term: string;
    frequency: number;
    relatedQuizIds: string[];
  }[];
}

/** 퀴즈 분석 원본 저장 */
interface RawAnalysis {
  quizId: string;
  courseId: string;
  createdAt: FirebaseFirestore.Timestamp;
  questions: TaggedQuestion[];
  keywords: {
    mainConcepts: string[];
    caseTriggers: string[];
  };
}

// ============================================================
// Gemini API 호출
// ============================================================

/**
 * Gemini로 문제 스타일 분석
 */
async function analyzeQuestionsWithGemini(
  questions: Array<{
    stem: string;
    choices?: Array<{ label: string; text: string }>;
    type: string;
  }>,
  apiKey: string
): Promise<TaggedQuestion[]> {
  const questionsText = questions
    .map((q, i) => {
      let text = `[문제 ${i + 1}]\n${q.stem}`;
      if (q.choices && q.choices.length > 0) {
        text += "\n선지:\n" + q.choices.map((c) => `${c.label}. ${c.text}`).join("\n");
      }
      return text;
    })
    .join("\n\n---\n\n");

  const prompt = `당신은 대학 시험 분석 전문가입니다. 다음 문제들을 분석하여 출제 스타일을 파악해주세요.

## 분석할 문제들
${questionsText}

## 분석 항목

각 문제에 대해 다음을 분석하세요:

1. **types** (문제 유형, 복수 가능):
   - NEGATIVE: "옳지 않은 것", "틀린 것" 찾기
   - DEFINITION_MATCH: 정의-개념 매칭
   - MECHANISM: 기전, 원리, 경로 설명
   - MULTI_SELECT: "모두 고르면", 복수 선택
   - CLASSIFICATION: 분류, 유형 구분
   - CLINICAL_CASE: 환자/증상 시나리오
   - FILL_IN_BLANK: 빈칸 채우기
   - COMPARISON: 비교, 차이점
   - OTHER: 위에 해당하지 않음

2. **difficulty**: EASY(기억/이해), MEDIUM(적용/분석), HARD(분석/평가+함정)

3. **trapPatterns** (함정 패턴):
   - "정상비정상_뒤집기": 정상/비정상 판단 혼동
   - "수치방향_뒤집기": 증가/감소, 상승/하강 뒤집기
   - "유사용어_혼동": 비슷한 용어 섞기
   - "시간순서_교란": 급성/만성, 선후관계
   - "부분전체_혼동": 일부를 전체처럼 서술
   - "예외_강조": 대표적 특징의 예외 출제

4. **keyTerms**: 문제의 핵심 용어 (2-5개)

5. **cognitiveLevel**: 기억, 이해, 적용, 분석, 평가

## 출력 형식
반드시 아래 JSON 형식으로만 응답하세요:
{
  "questions": [
    {
      "questionIndex": 0,
      "stem": "문제 발문 요약",
      "types": ["NEGATIVE", "MECHANISM"],
      "difficulty": "MEDIUM",
      "trapPatterns": ["유사용어_혼동"],
      "keyTerms": ["세포자멸사", "괴사"],
      "cognitiveLevel": "분석"
    }
  ]
}`;

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 4096,
    },
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
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

  // JSON 추출
  let jsonText = textContent;
  const jsonMatch = textContent.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonText = jsonMatch[1].trim();
  }
  const objectMatch = jsonText.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    jsonText = objectMatch[0];
  }

  try {
    const parsed = JSON.parse(jsonText);
    return parsed.questions || [];
  } catch (parseError) {
    console.error("JSON 파싱 오류:", parseError);
    throw new Error("스타일 분석 결과를 파싱할 수 없습니다.");
  }
}

/**
 * Gemini로 문제에서 키워드 추출
 */
async function extractKeywordsFromQuestions(
  questions: Array<{ stem: string; choices?: Array<{ text: string }> }>,
  courseId: string,
  apiKey: string
): Promise<{ mainConcepts: string[]; caseTriggers: string[] }> {
  const fullText = questions
    .map((q) => {
      let text = q.stem;
      if (q.choices) {
        text += " " + q.choices.map((c) => c.text).join(" ");
      }
      return text;
    })
    .join("\n");

  // 과목별 프롬프트 조정
  const subjectHint = courseId.includes("patho")
    ? "병태생리학"
    : courseId.includes("micro")
    ? "미생물학"
    : "생물학";

  const prompt = `당신은 ${subjectHint} 시험 분석 전문가입니다.

다음 시험 문제들에서 핵심 개념과 임상 단서를 추출하세요.

## 시험 문제 텍스트
${fullText.slice(0, 8000)}

## 추출 규칙

### mainConcepts (핵심 개념) - 최대 20개
- 문제의 주제가 되는 핵심 개념/메커니즘/질병명
- 예: "세포자멸사", "쇼크의 병태생리", "패혈증", "보체 활성화"

### caseTriggers (임상 단서) - 최대 15개
- 문제 시나리오에 등장하는 증상/검사 소견
- 예: "38도 이상 발열", "백혈구 증가", "의식 저하"

## 주의사항
- 조사 포함 금지: "세포는", "면역의" ❌
- 단독 일반 명사 금지: "세포", "면역" ❌
- 2단어 이상 조합 권장: "세포자멸사 기전" ✓

## 출력 형식
{
  "mainConcepts": ["개념1", "개념2", ...],
  "caseTriggers": ["단서1", "단서2", ...]
}`;

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 1024,
    },
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
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

  let jsonText = textContent;
  const jsonMatch = textContent.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) jsonText = jsonMatch[1].trim();
  const objectMatch = jsonText.match(/\{[\s\S]*\}/);
  if (objectMatch) jsonText = objectMatch[0];

  try {
    const parsed = JSON.parse(jsonText);
    return {
      mainConcepts: Array.isArray(parsed.mainConcepts)
        ? parsed.mainConcepts.filter((k: unknown) => typeof k === "string").slice(0, 20)
        : [],
      caseTriggers: Array.isArray(parsed.caseTriggers)
        ? parsed.caseTriggers.filter((k: unknown) => typeof k === "string").slice(0, 15)
        : [],
    };
  } catch {
    console.error("키워드 파싱 오류");
    return { mainConcepts: [], caseTriggers: [] };
  }
}

// ============================================================
// 스타일 프로필 업데이트
// ============================================================

/**
 * 새 분석 결과를 기존 스타일 프로필에 병합
 */
function mergeStyleProfile(
  existing: StyleProfile | null,
  newAnalysis: TaggedQuestion[],
  courseId: string,
  courseName: string
): StyleProfile {
  const now = FieldValue.serverTimestamp() as unknown as FirebaseFirestore.Timestamp;

  // 기존 프로필이 없으면 새로 생성
  if (!existing) {
    const profile: StyleProfile = {
      courseId,
      courseName,
      lastUpdated: now,
      analyzedQuizCount: 1,
      analyzedQuestionCount: newAnalysis.length,
      typeDistribution: {} as Record<QuestionType, number>,
      difficultyTypeMap: { EASY: [], MEDIUM: [], HARD: [] },
      trapPatterns: [],
      toneCharacteristics: {
        usesNegative: false,
        usesMultiSelect: false,
        hasEnglishTerms: false,
        hasClinicalCases: false,
        preferredStemLength: "medium",
      },
      cognitiveLevelDistribution: {},
    };

    // 분석 결과 반영
    updateProfileFromAnalysis(profile, newAnalysis);
    return profile;
  }

  // 기존 프로필 업데이트
  const profile = { ...existing };
  profile.lastUpdated = now;
  profile.analyzedQuizCount += 1;
  profile.analyzedQuestionCount += newAnalysis.length;

  updateProfileFromAnalysis(profile, newAnalysis);
  return profile;
}

/**
 * 분석 결과를 프로필에 반영
 */
function updateProfileFromAnalysis(
  profile: StyleProfile,
  analysis: TaggedQuestion[]
): void {
  // 유형 분포 업데이트
  for (const q of analysis) {
    for (const type of q.types) {
      profile.typeDistribution[type] = (profile.typeDistribution[type] || 0) + 1;
    }

    // 난이도별 유형 매핑
    const diffTypes = profile.difficultyTypeMap[q.difficulty] || [];
    for (const type of q.types) {
      if (!diffTypes.includes(type)) {
        diffTypes.push(type);
      }
    }
    profile.difficultyTypeMap[q.difficulty] = diffTypes;

    // 인지 수준 분포
    profile.cognitiveLevelDistribution[q.cognitiveLevel] =
      (profile.cognitiveLevelDistribution[q.cognitiveLevel] || 0) + 1;

    // 함정 패턴 업데이트
    for (const trap of q.trapPatterns) {
      const existing = profile.trapPatterns.find((t) => t.pattern === trap);
      if (existing) {
        existing.frequency += 1;
        if (existing.examples.length < 3) {
          existing.examples.push(q.stem.substring(0, 50));
        }
      } else {
        profile.trapPatterns.push({
          pattern: trap,
          frequency: 1,
          examples: [q.stem.substring(0, 50)],
        });
      }
    }
  }

  // 톤 특성 업데이트
  const hasNegative = analysis.some((q) => q.types.includes("NEGATIVE"));
  const hasMultiSelect = analysis.some((q) => q.types.includes("MULTI_SELECT"));
  const hasClinical = analysis.some((q) => q.types.includes("CLINICAL_CASE"));

  if (hasNegative) profile.toneCharacteristics.usesNegative = true;
  if (hasMultiSelect) profile.toneCharacteristics.usesMultiSelect = true;
  if (hasClinical) profile.toneCharacteristics.hasClinicalCases = true;

  // 평균 발문 길이 계산
  const avgStemLength =
    analysis.reduce((sum, q) => sum + q.stem.length, 0) / analysis.length;
  if (avgStemLength < 50) {
    profile.toneCharacteristics.preferredStemLength = "short";
  } else if (avgStemLength > 150) {
    profile.toneCharacteristics.preferredStemLength = "long";
  } else {
    profile.toneCharacteristics.preferredStemLength = "medium";
  }
}

/**
 * 키워드 저장소 업데이트 (문제에서 추출한 키워드)
 */
function mergeKeywordStore(
  existing: KeywordStore | null,
  newKeywords: { mainConcepts: string[]; caseTriggers: string[] },
  courseId: string,
  quizId: string
): KeywordStore {
  const now = FieldValue.serverTimestamp() as unknown as FirebaseFirestore.Timestamp;

  if (!existing) {
    return {
      courseId,
      lastUpdated: now,
      mainConcepts: newKeywords.mainConcepts.map((term) => ({
        term,
        frequency: 1,
        relatedQuizIds: [quizId],
      })),
      caseTriggers: newKeywords.caseTriggers.map((term) => ({
        term,
        frequency: 1,
        relatedQuizIds: [quizId],
      })),
    };
  }

  const store = { ...existing, lastUpdated: now };

  // mainConcepts 병합
  for (const term of newKeywords.mainConcepts) {
    const existingTerm = store.mainConcepts.find((t) => t.term === term);
    if (existingTerm) {
      existingTerm.frequency += 1;
      if (!existingTerm.relatedQuizIds.includes(quizId)) {
        existingTerm.relatedQuizIds.push(quizId);
      }
    } else {
      store.mainConcepts.push({ term, frequency: 1, relatedQuizIds: [quizId] });
    }
  }

  // caseTriggers 병합
  for (const term of newKeywords.caseTriggers) {
    const existingTerm = store.caseTriggers.find((t) => t.term === term);
    if (existingTerm) {
      existingTerm.frequency += 1;
      if (!existingTerm.relatedQuizIds.includes(quizId)) {
        existingTerm.relatedQuizIds.push(quizId);
      }
    } else {
      store.caseTriggers.push({ term, frequency: 1, relatedQuizIds: [quizId] });
    }
  }

  // 빈도순 정렬
  store.mainConcepts.sort((a, b) => b.frequency - a.frequency);
  store.caseTriggers.sort((a, b) => b.frequency - a.frequency);

  return store;
}


// ============================================================
// Cloud Function
// ============================================================

/**
 * 교수 퀴즈 생성 시 자동 분석
 *
 * 트리거: quizzes/{quizId} 문서 생성
 * 조건: 생성자가 교수 (role: 'professor')
 *
 * 분석 내용:
 * 1. 문제 스타일 분석 (유형, 함정 패턴)
 * 2. 문제에서 키워드 추출 (누적 저장)
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
        stem: string;
        type: string;
        choices?: Array<{ label: string; text: string }>;
      }>;
    };

    const db = getFirestore();

    // 1. 생성자가 교수인지 확인
    const userDoc = await db.collection("users").doc(quizData.creatorId).get();
    if (!userDoc.exists || userDoc.data()?.role !== "professor") {
      console.log(`[분석 스킵] 교수가 아닌 사용자의 퀴즈: ${quizId}`);
      return;
    }

    // 2. 문제 목록 확인
    const questions = quizData.questions;
    if (!questions || questions.length === 0) {
      console.log(`[분석 스킵] 문제가 없는 퀴즈: ${quizId}`);
      return;
    }

    // 3. 과목 ID 확인
    const courseId = quizData.courseId || "general";
    const courseName = quizData.courseName || "일반";

    console.log(`[교수 퀴즈 분석 시작] ${quizId}, 과목: ${courseName}, 문제 수: ${questions.length}`);

    // API 키 확인
    const apiKey = GEMINI_API_KEY.value();
    if (!apiKey) {
      console.error("[분석 실패] Gemini API 키가 없습니다.");
      return;
    }

    try {
      // 4. Gemini로 문제 스타일 분석
      const taggedQuestions = await analyzeQuestionsWithGemini(questions, apiKey);
      console.log(`[스타일 분석 완료] ${taggedQuestions.length}개 문제 분석됨`);

      // 5. Gemini로 문제에서 키워드 추출
      const keywords = await extractKeywordsFromQuestions(questions, courseId, apiKey);
      console.log(`[키워드 추출 완료] mainConcepts: ${keywords.mainConcepts.length}, caseTriggers: ${keywords.caseTriggers.length}`);

      // 6. Firestore에 저장
      const analysisRef = db.collection("professorQuizAnalysis").doc(courseId);

      // 6a. raw 분석 결과 저장
      const rawRef = analysisRef.collection("raw").doc(quizId);
      await rawRef.set({
        quizId,
        courseId,
        createdAt: FieldValue.serverTimestamp(),
        questions: taggedQuestions,
        keywords,
      } as RawAnalysis);

      // 6b. 스타일 프로필 업데이트
      const styleRef = analysisRef.collection("data").doc("styleProfile");
      const existingStyle = (await styleRef.get()).data() as StyleProfile | undefined;
      const updatedStyle = mergeStyleProfile(
        existingStyle || null,
        taggedQuestions,
        courseId,
        courseName
      );
      await styleRef.set(updatedStyle);

      // 6c. 키워드 저장소 업데이트 (누적)
      const keywordsRef = analysisRef.collection("data").doc("keywords");
      const existingKeywords = (await keywordsRef.get()).data() as KeywordStore | undefined;
      const updatedKeywords = mergeKeywordStore(
        existingKeywords || null,
        keywords,
        courseId,
        quizId
      );
      await keywordsRef.set(updatedKeywords);

      // 6d. 메타데이터 업데이트
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

      console.log(`[교수 퀴즈 분석 완료] ${quizId}`);
    } catch (error) {
      console.error(`[교수 퀴즈 분석 실패] ${quizId}:`, error);
      // 분석 실패해도 퀴즈 생성은 성공한 것이므로 에러를 throw하지 않음
    }
  }
);
