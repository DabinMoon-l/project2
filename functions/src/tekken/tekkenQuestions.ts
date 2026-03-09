/**
 * 철권퀴즈 문제 생성 — Gemini API 호출, 비상 문제, 사전 캐싱
 */

import { getDatabase } from "firebase-admin/database";
import { getFirestore } from "firebase-admin/firestore";
import fetch from "node-fetch";
import { loadScopeForAI } from "../courseScope";
import { getFocusGuide } from "../styledQuizGenerator";
import type { StyleProfile, KeywordStore, QuestionBank, SampleQuestion } from "../professorQuizAnalysis";
import type { GeneratedQuestion, PregenCache, TekkenDifficulty } from "./tekkenTypes";
import { COURSE_NAMES } from "./tekkenTypes";

/**
 * 교수님이 설정한 배틀 출제 챕터 조회
 */
export async function getTekkenChapters(courseId: string): Promise<string[]> {
  // 과목별 기본 전 챕터
  const DEFAULT_CHAPTERS: Record<string, string[]> = {
    biology: ["1", "2", "3", "4", "5", "6"],
    pathophysiology: ["3", "4", "5", "7", "8", "9", "10", "11"],
    microbiology: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"],
  };
  const defaultChapters = DEFAULT_CHAPTERS[courseId] || ["2", "3", "4"];

  try {
    const db = getFirestore();
    const doc = await db
      .collection("settings")
      .doc("tekken")
      .collection("courses")
      .doc(courseId)
      .get();
    if (doc.exists) {
      return doc.data()?.chapters || defaultChapters;
    }
  } catch {
    // 설정 없으면 기본값
  }
  return defaultChapters;
}

/**
 * JSON 문자열 자동 수정 — 다양한 Gemini 응답 오류 패턴 대응
 */
function sanitizeJsonText(raw: string): string {
  let text = raw;

  // 코드블록 제거
  text = text.replace(/```json?\n?/g, "").replace(/```/g, "");

  // Gemini가 가끔 추가하는 선행 텍스트 제거 ("Here are..." 등)
  const firstBracket = text.indexOf("[");
  if (firstBracket > 0 && firstBracket < 200) {
    text = text.slice(firstBracket);
  }

  // trailing comma 수정
  text = text.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");

  // 줄바꿈이 문자열 내부에 있으면 이스케이프 처리 (JSON은 리터럴 줄바꿈 허용 안 함)
  // "key": "value에\n줄바꿈" → "key": "value에\\n줄바꿈"
  text = text.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (match) => {
    return match.replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
  });

  // 작은따옴표를 큰따옴표로 변환 (JSON 키에 작은따옴표 사용하는 경우)
  // 안전하게: 문자열 밖의 키에만 적용
  text = text.replace(/([{,]\s*)'([^']+)'(\s*:)/g, '$1"$2"$3');

  return text.trim();
}

/**
 * 불완전한 객체 JSON 문자열을 복구 시도
 * 잘린 문자열/배열/객체를 닫아줌
 */
function tryRepairObject(objStr: string): string | null {
  let s = objStr.trim();

  // 이미 유효한지 먼저 체크
  try { JSON.parse(s); return s; } catch {}

  // trailing comma 제거
  s = s.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
  try { JSON.parse(s); return s; } catch {}

  // 닫히지 않은 문자열 닫기
  let inStr = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    if (escaped) { escaped = false; continue; }
    if (s[i] === "\\") { escaped = true; continue; }
    if (s[i] === '"') inStr = !inStr;
  }
  if (inStr) s += '"';

  // 닫히지 않은 배열/객체 닫기
  const opens: string[] = [];
  inStr = false;
  escaped = false;
  for (let i = 0; i < s.length; i++) {
    if (escaped) { escaped = false; continue; }
    if (s[i] === "\\") { escaped = true; continue; }
    if (s[i] === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (s[i] === "[") opens.push("]");
    else if (s[i] === "{") opens.push("}");
    else if (s[i] === "]" || s[i] === "}") opens.pop();
  }
  // trailing comma before close
  s = s.replace(/,\s*$/, "");
  // 역순으로 닫아주기
  while (opens.length > 0) s += opens.pop();

  try { JSON.parse(s); return s; } catch {}
  return null;
}

/**
 * 개별 객체가 유효한 문제인지 검증
 */
function isValidQuestion(q: any): q is GeneratedQuestion {
  return (
    q &&
    typeof q.text === "string" && q.text.length > 0 &&
    Array.isArray(q.choices) && q.choices.length >= 4 &&
    q.choices.every((c: any) => typeof c === "string") &&
    typeof q.correctAnswer === "number" &&
    q.correctAnswer >= 0 &&
    q.correctAnswer < q.choices.length
  );
}

/**
 * Gemini 응답에서 문제 배열을 안전하게 추출
 * 5단계 복구로 파싱 성공률 100% 목표
 *
 * 1단계: 직접 JSON.parse
 * 2단계: 텍스트 정제 후 JSON.parse
 * 3단계: 배열 추출 + 수정 후 파싱
 * 4단계: 개별 객체 단위 추출 (truncated JSON 복구 포함)
 * 5단계: 정규식 기반 필드 추출 (최후 수단)
 */
function robustParseQuestionArray(rawText: string): GeneratedQuestion[] {
  if (!rawText || rawText.trim().length === 0) return [];

  // 1단계: 직접 파싱
  try {
    const parsed = JSON.parse(rawText);
    if (Array.isArray(parsed)) return parsed;
    if (parsed.questions && Array.isArray(parsed.questions)) return parsed.questions;
  } catch {}

  // 2단계: 텍스트 정제 후 파싱
  const text = sanitizeJsonText(rawText);
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (parsed.questions && Array.isArray(parsed.questions)) return parsed.questions;
  } catch {}

  // 3단계: 배열 부분만 추출 후 파싱
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0]);
    } catch {}

    // 배열이 잘렸을 수 있음 → 닫아주기
    const repaired = tryRepairObject(arrayMatch[0]);
    if (repaired) {
      try {
        const parsed = JSON.parse(repaired);
        if (Array.isArray(parsed)) return parsed;
      } catch {}
    }
  }

  // 배열 시작은 있는데 끝이 없는 경우 (truncated)
  const arrayStart = text.indexOf("[");
  if (arrayStart >= 0 && !arrayMatch) {
    const truncated = text.slice(arrayStart);
    const repaired = tryRepairObject(truncated);
    if (repaired) {
      try {
        const parsed = JSON.parse(repaired);
        if (Array.isArray(parsed)) return parsed;
      } catch {}
    }
  }

  // 4단계: 개별 객체 단위 추출 (가장 강력한 복구)
  const questions: GeneratedQuestion[] = [];
  let depth = 0;
  let objStart = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }

    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && objStart !== -1) {
        const objStr = text.slice(objStart, i + 1);
        // 직접 파싱 시도
        try {
          const q = JSON.parse(objStr);
          if (isValidQuestion(q)) questions.push(q);
        } catch {
          // 수리 후 재시도
          const repaired = tryRepairObject(objStr);
          if (repaired) {
            try {
              const q = JSON.parse(repaired);
              if (isValidQuestion(q)) questions.push(q);
            } catch {}
          }
        }
        objStart = -1;
      }
    }
  }

  // 마지막 객체가 잘린 경우 (depth > 0) → 수리 시도
  if (depth > 0 && objStart !== -1) {
    const truncatedObj = text.slice(objStart);
    const repaired = tryRepairObject(truncatedObj);
    if (repaired) {
      try {
        const q = JSON.parse(repaired);
        if (isValidQuestion(q)) questions.push(q);
      } catch {}
    }
  }

  if (questions.length > 0) {
    console.log(`JSON 복구 성공 (4단계): ${questions.length}개 문제 추출`);
    return questions;
  }

  // 5단계: 정규식 기반 필드 추출 (최후 수단)
  // "text": "..." + "choices": [...] + "correctAnswer": N 패턴을 직접 찾기
  const textPattern = /"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  const choicesPattern = /"choices"\s*:\s*\[((?:[^\]\\]|\\.)*)\]/g;
  const answerPattern = /"correctAnswer"\s*:\s*(\d+)/g;

  const texts: string[] = [];
  const choicesArr: string[][] = [];
  const answers: number[] = [];

  let m: RegExpExecArray | null;
  while ((m = textPattern.exec(text)) !== null) texts.push(m[1]);
  while ((m = choicesPattern.exec(text)) !== null) {
    // "선지1", "선지2", ... 파싱
    const raw = m[1];
    const cs: string[] = [];
    const cPattern = /"((?:[^"\\]|\\.)*)"/g;
    let cm: RegExpExecArray | null;
    while ((cm = cPattern.exec(raw)) !== null) cs.push(cm[1]);
    choicesArr.push(cs);
  }
  while ((m = answerPattern.exec(text)) !== null) answers.push(parseInt(m[1], 10));

  const minLen = Math.min(texts.length, choicesArr.length, answers.length);
  for (let i = 0; i < minLen; i++) {
    if (choicesArr[i].length >= 4 && answers[i] >= 0 && answers[i] < choicesArr[i].length) {
      questions.push({
        text: texts[i].replace(/\\"/g, '"').replace(/\\n/g, " "),
        type: "multiple",
        choices: choicesArr[i].map(c => c.replace(/\\"/g, '"').replace(/\\n/g, " ")),
        correctAnswer: answers[i],
      });
    }
  }

  if (questions.length > 0) {
    console.log(`JSON 복구 성공 (5단계 정규식): ${questions.length}개 문제 추출`);
  } else {
    console.error(`JSON 파싱 완전 실패. 원본 길이: ${rawText.length}, 앞 200자: ${rawText.slice(0, 200)}`);
  }

  return questions;
}

/**
 * 교수 스타일/키워드/문제뱅크 데이터를 Firestore에서 병렬 로드
 */
async function loadProfessorStyle(courseId: string): Promise<{
  profile: StyleProfile | null;
  keywords: KeywordStore | null;
  questionBank: SampleQuestion[];
}> {
  try {
    const db = getFirestore();
    const analysisRef = db.collection("professorQuizAnalysis").doc(courseId).collection("data");
    const [profileDoc, keywordsDoc, bankDoc] = await Promise.all([
      analysisRef.doc("styleProfile").get(),
      analysisRef.doc("keywords").get(),
      analysisRef.doc("questionBank").get(),
    ]);

    // 문제 뱅크에서 랜덤 10개 추출 (few-shot용)
    let questionBank: SampleQuestion[] = [];
    if (bankDoc.exists) {
      const bank = bankDoc.data() as QuestionBank;
      if (bank.questions && bank.questions.length > 0) {
        // Fisher-Yates Top-K (10개만 셔플 — 전체 O(n) → O(k))
        const copy = [...bank.questions];
        const k = Math.min(10, copy.length);
        for (let i = 0; i < k; i++) {
          const j = i + Math.floor(Math.random() * (copy.length - i));
          [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        questionBank = copy.slice(0, k);
      }
    }

    return {
      profile: profileDoc.exists ? (profileDoc.data() as StyleProfile) : null,
      keywords: keywordsDoc.exists ? (keywordsDoc.data() as KeywordStore) : null,
      questionBank,
    };
  } catch {
    return { profile: null, keywords: null, questionBank: [] };
  }
}

/**
 * 난이도별 철권퀴즈 프롬프트 생성
 *
 * difficulty: "easy" | "medium" | "hard"
 * easy: 개념 확인, 명확한 선지, 소거 쉬움
 * medium: 중간 난이도, 유사 개념 섞임
 * hard: 문제는 보통처럼 보이지만 선지 소거 극도로 어려움
 */
function buildTekkenPrompt(
  courseName: string,
  focusGuide: string | null,
  scopeContent: string | null,
  focusCount: number,
  scopeCount: number,
  chapters: string[],
  profile: StyleProfile | null,
  keywords: KeywordStore | null,
  questionBank: SampleQuestion[],
  difficulty: TekkenDifficulty = "medium"
): string {
  const totalCount = focusCount + scopeCount;

  // 난이도별 설정 (easy + medium만 사용)
  const difficultyConfig: Record<string, {
    label: string;
    description: string;
    choiceRule: string;
    timeHint: string;
    choiceCount: number;
  }> = {
    easy: {
      label: "쉬움 (개념 확인)",
      description: "기본 개념 정의, 분류, 특징을 직접 확인하는 수준",
      choiceRule: "선지 간 차이가 분명하고, 수업을 들은 학생이라면 쉽게 소거 가능. 명백히 다른 개념을 선지로 배치.",
      timeHint: "20초 안에 풀 수 있는",
      choiceCount: 4,
    },
    medium: {
      label: "보통 (적용/비교)",
      description: "개념 간 비교, 기전 이해, 유사 개념 구분이 필요한 수준",
      choiceRule: "비슷하지만 다른 용어, 과정 순서, 기전 연결을 섞어 출제. 소거에 약간의 사고가 필요.",
      timeHint: "20초 안에 풀 수 있는",
      choiceCount: 4,
    },
  };

  const config = difficultyConfig[difficulty] || difficultyConfig["medium"];

  let prompt = `대학교 ${courseName} 과목 배틀 퀴즈 문제 ${totalCount}개를 만들어주세요.\n\n`;

  prompt += `대상: 간호학과 대학생\n`;
  // 1장은 비중 최소화 (역사/개론 챕터는 출제 가치 낮음)
  const mainChapters = chapters.filter(c => c !== "1");
  const hasChapter1 = chapters.includes("1");
  if (mainChapters.length > 0) {
    prompt += `출제 범위: ${mainChapters.join(", ")}장을 중심으로 골고루 다루세요\n`;
    if (hasChapter1) {
      if (courseName.includes("미생물")) {
        prompt += `⚠️ 1장(미생물학 역사)은 0~1문제만 출제하세요. 1장 문제를 낼 경우 반드시 코흐(Koch)의 가설/실험만 다루세요.\n`;
      } else {
        prompt += `⚠️ 1장은 0~1문제만 출제하세요 (개론/역사 챕터이므로 중요도 낮음).\n`;
      }
    }
  } else {
    prompt += `출제 범위: ${chapters.join(", ")}장\n`;
  }
  prompt += `난이도: ${config.label} — ${config.description}\n`;
  prompt += `⚠️ 문제 길이 제한: 문제는 반드시 1~2문장 이내 (최대 80자). 긴 지문/설명/사례 금지.\n\n`;

  prompt += `## 선지 구성 규칙 (${difficulty.toUpperCase()})\n`;
  prompt += `${config.choiceRule}\n\n`;

  // 교수님 출제 스타일 참고 (v2: 구체적 패턴 기반)
  if (profile) {
    // 스타일 요약
    if (profile.styleDescription) {
      prompt += `[교수님 출제 스타일]\n${profile.styleDescription}\n\n`;
    }

    // 발문 패턴 (실제 문장 구조 템플릿)
    if (profile.questionPatterns && profile.questionPatterns.length > 0) {
      prompt += `[교수님이 자주 사용하는 발문 패턴]\n`;
      const topPatterns = profile.questionPatterns.slice(0, 5);
      for (const p of topPatterns) {
        prompt += `- "${p.pattern}"`;
        if (p.examples && p.examples.length > 0) {
          prompt += ` — 예: "${p.examples[0]}"`;
        }
        prompt += `\n`;
      }
      prompt += `위 패턴을 참고하여 비슷한 구조로 발문을 작성하세요.\n\n`;
    }

    // 오답 구성 전략 (구체적 방법)
    if (profile.distractorStrategies && profile.distractorStrategies.length > 0 && difficulty !== "easy") {
      prompt += `[교수님의 오답 선지 구성 방식]\n`;
      for (const s of profile.distractorStrategies.slice(0, 3)) {
        prompt += `- ${s}\n`;
      }
      prompt += `\n`;
    }

  }

  // ★ 원본 문제 few-shot (가장 중요한 스타일 컨텍스트)
  // questionBank에서 랜덤 추출된 문제 — 매번 다른 조합
  if (questionBank.length > 0) {
    prompt += `[교수님이 실제로 낸 문제 — 이 스타일을 따라하세요]\n`;
    for (const q of questionBank.slice(0, 5)) {
      prompt += `Q. ${q.stem}\n`;
      q.choices.forEach((c, i) => {
        prompt += `  ${i + 1}. ${c}\n`;
      });
      prompt += `\n`;
    }
  }

  // 교수님의 핵심 학술 용어 + 출제 토픽 (v2)
  if (keywords) {
    // 핵심 학술 용어
    if (keywords.coreTerms && keywords.coreTerms.length > 0) {
      const topTerms = keywords.coreTerms.slice(0, 15);
      const termsList = topTerms.map(t => t.english ? `${t.korean}(${t.english})` : t.korean).join(", ");
      prompt += `[교수님이 강조하는 핵심 용어]\n${termsList}\n\n`;
    }

    // 출제 토픽 (대주제 → 세부주제)
    if (keywords.examTopics && keywords.examTopics.length > 0 && difficulty !== "easy") {
      prompt += `[교수님의 주요 출제 토픽]\n`;
      for (const t of keywords.examTopics.slice(0, 5)) {
        prompt += `- ${t.topic}: ${t.subtopics.slice(0, 5).join(", ")}\n`;
      }
      prompt += `\n`;
    }
  }

  // focusGuide 기반 문제
  if (focusGuide && focusCount > 0) {
    prompt += `[파트 A — ${focusCount}문제]\n`;
    prompt += `아래 "출제 포커스" 내용에서만 ${focusCount}문제를 출제하세요.\n`;
    prompt += `출제 포커스에 명시된 개념, 비교, 매칭 유형을 그대로 활용하세요.\n\n`;
    prompt += `<출제 포커스>\n${focusGuide}\n</출제 포커스>\n\n`;
  }

  // scope 기반 문제
  if (scopeContent && scopeCount > 0) {
    prompt += `[파트 B — ${scopeCount}문제]\n`;
    prompt += `아래 "학습 범위" 내용에서만 ${scopeCount}문제를 출제하세요.\n`;
    prompt += `학습 범위에 나온 내용만 사용하고, 범위 밖 내용은 절대 금지입니다.\n\n`;
    prompt += `<학습 범위>\n${scopeContent}\n</학습 범위>\n\n`;
  }

  // 둘 다 없으면 generic (비상)
  if (!focusGuide && !scopeContent) {
    prompt += `${chapters.join(", ")}장 범위에서 ${totalCount}문제를 출제하세요.\n\n`;
  }

  // 미생물학 임상 중심 규칙
  if (courseName.includes("미생물")) {
    prompt += `[미생물학 특별 규칙]\n`;
    prompt += `- 간호학과 학생 대상이므로 임상에서 실제로 접하는 병원성 미생물(MRSA, VRE, 결핵균, HIV, HBV, 칸디다 등)을 우선 다루세요\n\n`;
  }

  prompt += `## 공통 규칙
- ${config.choiceCount}지선다 순수 객관식만 (OX 문제 금지)
- 문제 하나로 완결 (별도 지문/제시문/보기표/그림/표 참조 금지)
- "다음 중", "위의 내용에서" 같은 외부 참조 표현 금지
- 각 문제는 서로 다른 주제/개념 (같은 개념 2번 이상 금지)
- ⚠️ 문제는 반드시 1~2문장, 최대 80자 이내 (배틀 퀴즈이므로 빠르게 읽을 수 있어야 함)
- 선지도 간결하게 (각 선지 최대 30자)
- 오답 선지는 그럴듯하게 (명백히 틀린 보기 금지)
- choices ${config.choiceCount}개, correctAnswer는 0~${config.choiceCount - 1}
- 매번 다른 문제를 생성 — 이전에 생성한 문제와 겹치지 않도록 창의적으로 출제
- ${chapters.length}개 챕터를 골고루 커버 (특정 챕터에 편중 금지)
- ⚠️ 1장 문제는 절대 2문제 이상 금지 — 0~1문제만 허용

## 해설 규칙
- explanation: 정답이 왜 맞는지 1~2문장으로 설명 (최대 100자)
- choiceExplanations: 각 선지마다 왜 맞/틀린지 1문장 설명 (각 최대 50자)
- chapterId: 해당 문제의 챕터 번호 (예: "3", "5")

## 검토 규칙 (반드시 준수)
- correctAnswer가 실제 정답 선지의 인덱스(0부터)와 일치하는지 반드시 재확인
- explanation이 정답 선지와 일치하는지 확인
- 오답 선지가 정답과 혼동되지 않도록 명확히 구분 가능한지 확인
- choiceExplanations[correctAnswer]에 "정답" 표현이 포함되어야 함

반드시 아래 JSON 형식만 출력 (다른 텍스트 없이):
[
  {"text": "문제 내용", "type": "multiple", "choices": [${Array.from({length: config.choiceCount}, (_, i) => `"선지${i+1}"`).join(", ")}], "correctAnswer": 2, "difficulty": "${difficulty}", "explanation": "정답 해설", "choiceExplanations": [${Array.from({length: config.choiceCount}, (_, i) => `"선지${i+1} 해설"`).join(", ")}], "chapterId": "3"}
]`;

  return prompt;
}

/**
 * Gemini로 scope + focusGuide 기반 배틀 문제 생성
 * count: 문제 개수, difficulty: 난이도
 */
export async function generateBattleQuestions(
  courseId: string,
  apiKey: string,
  count: number = 10,
  chapters?: string[],
  difficulty: TekkenDifficulty = "medium"
): Promise<GeneratedQuestion[]> {
  const targetChapters = chapters || await getTekkenChapters(courseId);
  const courseName = COURSE_NAMES[courseId] || "생물학";

  // scope + focusGuide + 교수 스타일/키워드 병렬 로드
  const [scopeData, focusGuide, profStyle] = await Promise.all([
    loadScopeForAI(courseId, targetChapters, 8000),
    Promise.resolve(getFocusGuide(courseId, targetChapters)),
    loadProfessorStyle(courseId),
  ]);

  const hasFocusGuide = !!focusGuide;
  const hasScope = !!scopeData?.content;

  // 5:5 비율 결정
  const focusCount = hasFocusGuide ? (hasScope ? Math.ceil(count / 2) : count) : 0;
  const scopeCount = count - focusCount;

  const prompt = buildTekkenPrompt(
    courseName,
    focusGuide,
    scopeData?.content || null,
    focusCount,
    scopeCount,
    targetChapters,
    profStyle.profile,
    profStyle.keywords,
    profStyle.questionBank,
    difficulty
  );

  // Gemini 구조화 출력 스키마 (해설+선지별해설+챕터태그 포함)
  const responseSchema = {
    type: "ARRAY",
    items: {
      type: "OBJECT",
      properties: {
        text: { type: "STRING" },
        type: { type: "STRING" },
        choices: { type: "ARRAY", items: { type: "STRING" } },
        correctAnswer: { type: "INTEGER" },
        difficulty: { type: "STRING" },
        explanation: { type: "STRING" },
        choiceExplanations: { type: "ARRAY", items: { type: "STRING" } },
        chapterId: { type: "STRING" },
      },
      required: ["text", "type", "choices", "correctAnswer", "explanation", "choiceExplanations", "chapterId"],
    },
  };

  // 최대 3회 시도 (1차: 구조화 출력, 2차: 구조화 + 간단 프롬프트, 3차: 자유형 + robust 파싱)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const isSimplified = attempt >= 1;
      const isFreeform = attempt >= 2;

      const currentPrompt = isSimplified
        ? `대학교 ${courseName} 과목 ${difficulty === "easy" ? "쉬운" : difficulty === "hard" ? "어려운" : "보통"} 4지선다 객관식 문제 ${count}개.
범위: ${targetChapters.join(", ")}장
JSON 배열로 출력: [{"text":"문제","type":"multiple","choices":["선지1","선지2","선지3","선지4"],"correctAnswer":0,"difficulty":"${difficulty}"}]`
        : prompt;

      const generationConfig: any = {
        temperature: isSimplified ? 0.7 : (difficulty === "hard" ? 0.8 : 0.9),
        maxOutputTokens: isSimplified ? 4096 : 8192,
      };

      // 구조화 출력 강제 (3차 시도에서만 자유형)
      if (!isFreeform) {
        generationConfig.responseMimeType = "application/json";
        generationConfig.responseSchema = responseSchema;
      }

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: currentPrompt }] }],
            generationConfig,
          }),
        }
      );

      const data = (await response.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
          finishReason?: string;
        }>;
      };
      const responseText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const finishReason = data?.candidates?.[0]?.finishReason || "";

      if (!responseText) {
        console.log(`Gemini 빈 응답 (${difficulty}, 시도 ${attempt + 1}, finishReason: ${finishReason})`);
        continue;
      }

      // 구조화 출력이면 직접 파싱, 아니면 robust 파싱
      const questions = robustParseQuestionArray(responseText);

      const valid = questions.filter(isValidQuestion).map(q => ({
        ...q,
        type: "multiple" as const,
        difficulty,
      }));

      if (valid.length >= Math.min(3, count)) {
        if (attempt > 0) console.log(`재시도 ${attempt + 1}차 성공: ${valid.length}개 (${difficulty})`);
        return valid.slice(0, count);
      }

      console.log(`Gemini 유효 문제 ${valid.length}개 (${difficulty}, 시도 ${attempt + 1}) — 재시도`);
    } catch (error) {
      console.error(`Gemini 배틀 문제 생성 실패 (${difficulty}, 시도 ${attempt + 1}):`, error);
    }
  }

  console.error(`3회 시도 모두 실패 (${difficulty}) — 빈 배열 반환`);
  return [];
}

/**
 * 매칭 대기 중 문제 사전 생성 (fire-and-forget)
 */
export async function pregenBattleQuestions(
  courseId: string,
  userId: string,
  apiKey: string
): Promise<void> {
  const rtdb = getDatabase();
  const cacheRef = rtdb.ref(`tekken/pregenQuestions/${courseId}_${userId}`);

  // 이미 유효한 캐시가 있으면 스킵 (5분 이내)
  const existing = await cacheRef.once("value");
  const existingData = existing.val() as PregenCache | null;
  if (existingData?.createdAt && existingData.createdAt > Date.now() - 5 * 60 * 1000) return;

  const chapters = await getTekkenChapters(courseId);
  const questions = await generateBattleQuestions(courseId, apiKey, 10, chapters);

  if (questions.length >= 5) {
    await cacheRef.set({
      questions,
      createdAt: Date.now(),
      chapters,
    });
  }
}

/**
 * 비상용 기본 문제 (폴백의 폴백) — 과목별
 */
export function getEmergencyQuestions(courseId: string = "biology"): GeneratedQuestion[] {
  switch (courseId) {
    case "pathophysiology":
      return [
        { text: "세포가 자극에 적응하여 크기가 커지는 현상은?", type: "multiple", choices: ["비대", "증식", "화생", "이형성"], correctAnswer: 0 },
        { text: "괴사(necrosis)와 세포자멸사(apoptosis)의 차이로 옳은 것은?", type: "multiple", choices: ["괴사는 염증을 동반한다", "세포자멸사는 염증을 동반한다", "괴사는 ATP가 필요하다", "세포자멸사는 세포막이 먼저 파괴된다"], correctAnswer: 0 },
        { text: "급성 염증의 5대 징후에 해당하지 않는 것은?", type: "multiple", choices: ["발적", "종창", "섬유화", "동통"], correctAnswer: 2 },
        { text: "혈전 형성의 3대 요인(Virchow's triad)에 해당하지 않는 것은?", type: "multiple", choices: ["혈류 정체", "혈관 내피 손상", "혈소판 감소", "과응고 상태"], correctAnswer: 2 },
        { text: "제1형 과민반응을 매개하는 면역글로불린은?", type: "multiple", choices: ["IgA", "IgG", "IgE", "IgM"], correctAnswer: 2 },
        { text: "양성 종양과 악성 종양의 차이로 옳은 것은?", type: "multiple", choices: ["양성은 전이된다", "악성은 피막이 있다", "악성은 침윤성 성장을 한다", "양성은 분화가 나쁘다"], correctAnswer: 2 },
        { text: "색전증(embolism)의 가장 흔한 원인은?", type: "multiple", choices: ["공기", "지방", "혈전", "양수"], correctAnswer: 2 },
        { text: "쇼크의 초기 보상기에 나타나는 반응은?", type: "multiple", choices: ["혈압 상승", "서맥", "심박출량 증가", "빈맥"], correctAnswer: 3 },
        { text: "만성 염증에서 주로 관찰되는 세포는?", type: "multiple", choices: ["호중구", "대식세포", "호산구", "비만세포"], correctAnswer: 1 },
        { text: "상처 치유 시 육아조직(granulation tissue)의 주요 구성 요소는?", type: "multiple", choices: ["신경 섬유", "모세혈관과 섬유아세포", "성숙한 콜라겐", "탄성 섬유"], correctAnswer: 1 },
      ];
    case "microbiology":
      return [
        { text: "그람 염색에서 그람양성균이 보라색을 유지하는 이유는?", type: "multiple", choices: ["외막이 있어서", "펩티도글리칸 층이 두꺼워서", "리포다당류가 있어서", "편모가 있어서"], correctAnswer: 1 },
        { text: "세균의 내독소(endotoxin)의 주요 성분은?", type: "multiple", choices: ["단백질", "펩티도글리칸", "리포다당류(LPS)", "핵산"], correctAnswer: 2 },
        { text: "아포(endospore)를 형성하는 세균은?", type: "multiple", choices: ["대장균", "포도상구균", "클로스트리듐", "연쇄상구균"], correctAnswer: 2 },
        { text: "후천면역 중 항체가 관여하는 면역은?", type: "multiple", choices: ["세포매개 면역", "체액성 면역", "선천면역", "보체 활성화"], correctAnswer: 1 },
        { text: "결핵을 일으키는 원인균은?", type: "multiple", choices: ["Staphylococcus aureus", "Mycobacterium tuberculosis", "Streptococcus pyogenes", "Escherichia coli"], correctAnswer: 1 },
        { text: "바이러스가 숙주세포 안에서만 증식하는 이유는?", type: "multiple", choices: ["크기가 작아서", "자체 대사 기구가 없어서", "DNA가 없어서", "세포벽이 없어서"], correctAnswer: 1 },
        { text: "감염병의 전파 경로 중 비말감염에 해당하는 것은?", type: "multiple", choices: ["인플루엔자", "말라리아", "B형 간염", "파상풍"], correctAnswer: 0 },
        { text: "페니실린의 작용 기전은?", type: "multiple", choices: ["단백질 합성 억제", "세포벽 합성 억제", "핵산 합성 억제", "세포막 파괴"], correctAnswer: 1 },
        { text: "칸디다증을 일으키는 미생물의 종류는?", type: "multiple", choices: ["세균", "바이러스", "진균", "원충"], correctAnswer: 2 },
        { text: "말라리아를 매개하는 곤충은?", type: "multiple", choices: ["파리", "모기", "벼룩", "이"], correctAnswer: 1 },
      ];
    default: // biology
      return [
        { text: "세포막의 주요 구성 성분으로 유동 모자이크 모델의 기반이 되는 것은?", type: "multiple", choices: ["인지질 이중층", "콜레스테롤", "당단백질", "셀룰로스"], correctAnswer: 0 },
        { text: "미토콘드리아에서 ATP가 가장 많이 생성되는 단계는?", type: "multiple", choices: ["해당과정", "시트르산 회로", "산화적 인산화", "발효"], correctAnswer: 2 },
        { text: "DNA 복제 시 선도 가닥(leading strand)의 합성 방향은?", type: "multiple", choices: ["5'→3' 연속 합성", "3'→5' 연속 합성", "5'→3' 불연속 합성", "3'→5' 불연속 합성"], correctAnswer: 0 },
        { text: "광합성의 명반응이 일어나는 장소는?", type: "multiple", choices: ["스트로마", "틸라코이드 막", "세포질", "크리스타"], correctAnswer: 1 },
        { text: "성숙한 적혈구에 없는 세포 소기관은?", type: "multiple", choices: ["세포막", "헤모글로빈", "핵", "탄산탈수효소"], correctAnswer: 2 },
        { text: "인체에서 가장 넓은 면적을 차지하는 장기는?", type: "multiple", choices: ["간", "폐", "피부", "소장"], correctAnswer: 2 },
        { text: "효소의 활성 부위에 기질이 결합하는 모델 중, 결합 시 효소 구조가 변하는 모델은?", type: "multiple", choices: ["자물쇠-열쇠 모델", "유도적합 모델", "경쟁적 억제 모델", "알로스테릭 모델"], correctAnswer: 1 },
        { text: "ABO 혈액형에서 만능 수혈자(모든 혈액형에 수혈 가능)는?", type: "multiple", choices: ["A형", "B형", "AB형", "O형"], correctAnswer: 3 },
        { text: "리보솜에서 mRNA의 코돈을 읽어 아미노산을 운반하는 RNA는?", type: "multiple", choices: ["mRNA", "tRNA", "rRNA", "snRNA"], correctAnswer: 1 },
        { text: "인슐린이 분비되는 곳은?", type: "multiple", choices: ["부신 피질", "갑상선", "이자의 베타 세포", "뇌하수체 전엽"], correctAnswer: 2 },
      ];
  }
}
