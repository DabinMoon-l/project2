/**
 * 기존 교수 퀴즈에 대해 Gemini 분석을 실행하는 일회성 백필 스크립트
 *
 * 사용법: node tests/load/backfill-analysis.js
 */

const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const fs = require("fs");
const path = require("path");

const SA_PATH = path.resolve(__dirname, "../../serviceAccountKey.json");
const sa = JSON.parse(fs.readFileSync(SA_PATH, "utf8"));
const app = initializeApp({ credential: cert(sa) });
const db = getFirestore(app);

// Firebase Secret에서 가져온 Gemini API 키
// 실행 전: firebase functions:secrets:access GEMINI_API_KEY
const GEMINI_API_KEY = process.env.GEMINI_KEY || "AIzaSyAdVWhX7hBaPdWG8voloUASuzJk95Zkm8Y";

const PROF_TYPES = ["midterm", "final", "past", "independent", "professor"];

// --- robustParseJson (CF에서 복사) ---
function robustParseJson(rawText) {
  let text = rawText;
  const codeBlockMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) text = codeBlockMatch[1].trim();
  try { return JSON.parse(text); } catch {}
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch {}
    try {
      const fixed = objMatch[0].replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
      return JSON.parse(fixed);
    } catch {}
  }
  return {};
}

async function callGemini(prompt, maxTokens = 4096, temp = 0.3) {
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: temp, maxOutputTokens: maxTokens },
      }),
    }
  );
  if (!resp.ok) throw new Error(`Gemini API: ${resp.status}`);
  const result = await resp.json();
  return result.candidates?.[0]?.content?.parts?.filter(p => p.text).map(p => p.text).join("") || "";
}

function normalizeQuestions(questions) {
  return questions.map(q => {
    const stem = q.text || q.stem || "";
    let choices = [];
    let choiceStrings = [];
    if (Array.isArray(q.choices) && q.choices.length > 0) {
      if (typeof q.choices[0] === "string") {
        choiceStrings = q.choices;
        choices = choiceStrings.map((c, i) => ({ label: String(i + 1), text: c }));
      } else {
        choices = q.choices;
        choiceStrings = q.choices.map(c => c.text || "");
      }
    }
    return {
      stem, type: q.type || "multiple", choices, choiceStrings,
      correctAnswer: typeof q.answer === "number" ? q.answer : undefined,
    };
  }).filter(q => q.stem.length > 0);
}

async function analyzeQuiz(normalized, subjectHint) {
  const questionsText = normalized.map((q, i) => {
    let text = `[문제 ${i + 1}]\n${q.stem}`;
    if (q.choices.length > 0) text += "\n" + q.choices.map(c => `${c.label}. ${c.text}`).join("\n");
    return text;
  }).join("\n\n---\n\n");

  const stylePrompt = `당신은 대학 교수의 시험 출제 스타일을 분석하는 전문가입니다.
아래 교수가 실제로 출제한 문제들을 정밀하게 분석하여, AI가 이 교수처럼 문제를 생성할 수 있도록 구체적 패턴을 추출하세요.

## 분석할 문제들
${questionsText}

## 분석 과제

### 1. styleDescription (교수 출제 스타일 자연어 요약, 3-5문장)
- 발문의 길이, 구조, 특징적인 표현 방식
- 선지 구성 방식, 자주 사용하는 질문 방식
- 추상적 서술 금지 — 구체적으로

### 2. questionPatterns (발문 패턴, 3-8개)
- 구체적 템플릿 형태 + 실제 발문 예시

### 3. distractorStrategies (오답 전략, 2-5개)
- 실제 문제 근거로 서술

### 4. topicEmphasis (주제별 비중)
- topic + weight(1-10)

## 출력 (JSON만)
{"styleDescription": "...", "questionPatterns": [{"pattern": "...", "examples": ["..."]}], "distractorStrategies": ["..."], "topicEmphasis": [{"topic": "...", "weight": 8}]}`;

  const kwText = normalized.map((q, i) => {
    let t = `[문제 ${i + 1}] ${q.stem}`;
    if (q.choices.length > 0) t += "\n" + q.choices.map(c => `${c.label}. ${c.text}`).join(" / ");
    return t;
  }).join("\n");

  const kwPrompt = `당신은 ${subjectHint} 시험 분석 전문가입니다.
아래 교수가 실제로 출제한 시험 문제에서 핵심 학술 용어와 출제 토픽을 추출하세요.

## 시험 문제
${kwText.slice(0, 8000)}

## 추출 규칙
### coreTerms (핵심 학술 용어, 최대 25개)
- 실제 사용된 학술/의학 용어만
### examTopics (출제 토픽, 최대 10개)
- 대주제 + 세부주제

## 출력 (JSON만)
{"coreTerms": [{"korean": "용어", "english": "term", "context": "맥락"}], "examTopics": [{"topic": "대주제", "subtopics": ["세부1"]}]}`;

  const [styleRaw, kwRaw] = await Promise.all([
    callGemini(stylePrompt, 8192, 0.3),
    callGemini(kwPrompt, 8192, 0.2),
  ]);

  const sp = robustParseJson(styleRaw);
  const kw = robustParseJson(kwRaw);

  return {
    analysis: {
      styleDescription: sp.styleDescription || "",
      questionPatterns: (sp.questionPatterns || []).filter(p => p.pattern).map(p => ({
        pattern: p.pattern, examples: (p.examples || []).filter(e => typeof e === "string").slice(0, 3),
      })),
      distractorStrategies: (sp.distractorStrategies || []).filter(s => typeof s === "string").slice(0, 5),
      topicEmphasis: (sp.topicEmphasis || []).filter(t => t.topic && typeof t.weight === "number").map(t => ({ topic: t.topic, weight: t.weight })).slice(0, 10),
    },
    keywords: {
      coreTerms: (kw.coreTerms || []).filter(t => t.korean).map(t => ({
        korean: t.korean, english: t.english || undefined, context: t.context || "",
      })).slice(0, 25),
      examTopics: (kw.examTopics || []).filter(t => t.topic).map(t => ({
        topic: t.topic, subtopics: (t.subtopics || []).filter(s => typeof s === "string"),
      })).slice(0, 10),
    },
  };
}

async function main() {
  console.log("=== 기존 교수 퀴즈 Gemini 분석 백필 ===\n");

  const quizzesSnap = await db.collection("quizzes").where("isPublic", "==", true).get();
  const quizzesByCourse = {};

  for (const doc of quizzesSnap.docs) {
    const data = doc.data();
    if (data.isLoadTest) continue;
    if (!PROF_TYPES.includes(data.type)) continue;
    if (!data.questions || data.questions.length === 0) continue;
    const courseId = data.courseId || "unknown";
    if (!quizzesByCourse[courseId]) quizzesByCourse[courseId] = [];
    quizzesByCourse[courseId].push({ id: doc.id, data });
  }

  for (const [courseId, quizzes] of Object.entries(quizzesByCourse)) {
    const subjectHint = courseId.includes("micro") ? "미생물학" : courseId.includes("patho") ? "병태생리학" : "생물학";
    console.log(`--- ${courseId} (${subjectHint}, ${quizzes.length}개 퀴즈) ---`);

    let mergedStyle = null;
    let mergedKeywords = null;

    for (const quiz of quizzes) {
      const normalized = normalizeQuestions(quiz.data.questions || []);
      console.log(`  분석 중: ${quiz.id} (${quiz.data.title || ""}, ${normalized.length}문제)`);

      try {
        const { analysis, keywords } = await analyzeQuiz(normalized, subjectHint);
        console.log(`    스타일: ${analysis.questionPatterns.length}패턴, ${analysis.distractorStrategies.length}전략`);
        console.log(`    키워드: ${keywords.coreTerms.length}용어, ${keywords.examTopics.length}토픽`);

        // 스타일 병합
        if (!mergedStyle) {
          mergedStyle = {
            courseId, courseName: subjectHint, lastUpdated: FieldValue.serverTimestamp(),
            analyzedQuizCount: 1, analyzedQuestionCount: normalized.length,
            styleDescription: analysis.styleDescription,
            questionPatterns: analysis.questionPatterns.map(p => ({ ...p, frequency: 1 })),
            distractorStrategies: analysis.distractorStrategies,
            topicEmphasis: analysis.topicEmphasis,
          };
        } else {
          mergedStyle.analyzedQuizCount += 1;
          mergedStyle.analyzedQuestionCount += normalized.length;
          mergedStyle.styleDescription = analysis.styleDescription || mergedStyle.styleDescription;
          const pMap = new Map(mergedStyle.questionPatterns.map(p => [p.pattern, { ...p }]));
          for (const p of analysis.questionPatterns) {
            const ex = pMap.get(p.pattern);
            if (ex) ex.frequency += 1;
            else pMap.set(p.pattern, { ...p, frequency: 1 });
          }
          mergedStyle.questionPatterns = [...pMap.values()].sort((a, b) => b.frequency - a.frequency).slice(0, 15);
          const sSet = new Set(mergedStyle.distractorStrategies);
          for (const s of analysis.distractorStrategies) sSet.add(s);
          mergedStyle.distractorStrategies = [...sSet].slice(0, 10);
        }

        // 키워드 병합
        if (!mergedKeywords) {
          mergedKeywords = {
            courseId, lastUpdated: FieldValue.serverTimestamp(),
            coreTerms: keywords.coreTerms.map(t => ({ ...t, frequency: 1 })),
            examTopics: keywords.examTopics.map(t => ({ ...t, questionCount: 1 })),
          };
        } else {
          const tMap = new Map(mergedKeywords.coreTerms.map(t => [t.korean, { ...t }]));
          for (const t of keywords.coreTerms) {
            const ex = tMap.get(t.korean);
            if (ex) ex.frequency += 1;
            else tMap.set(t.korean, { ...t, frequency: 1 });
          }
          mergedKeywords.coreTerms = [...tMap.values()].sort((a, b) => b.frequency - a.frequency).slice(0, 50);
          const topMap = new Map(mergedKeywords.examTopics.map(t => [t.topic, { ...t, subtopics: [...t.subtopics] }]));
          for (const t of keywords.examTopics) {
            const ex = topMap.get(t.topic);
            if (ex) { ex.questionCount += 1; for (const s of t.subtopics) if (!ex.subtopics.includes(s)) ex.subtopics.push(s); }
            else topMap.set(t.topic, { ...t, questionCount: 1 });
          }
          mergedKeywords.examTopics = [...topMap.values()].sort((a, b) => b.questionCount - a.questionCount).slice(0, 20);
        }

        // raw 저장
        const rawRef = db.collection("professorQuizAnalysis").doc(courseId).collection("raw").doc(quiz.id);
        await rawRef.set({
          quizId: quiz.id, courseId,
          createdAt: FieldValue.serverTimestamp(),
          analysis, keywords,
          originalQuestions: normalized.map(q => ({ stem: q.stem, choices: q.choiceStrings })),
        });

      } catch (err) {
        console.error(`    Gemini 분석 실패: ${err.message}`);
      }
    }

    // Firestore 저장
    const analysisRef = db.collection("professorQuizAnalysis").doc(courseId);
    const dataRef = analysisRef.collection("data");

    if (mergedStyle) {
      await dataRef.doc("styleProfile").set(mergedStyle);
      console.log(`  ✓ styleProfile (${mergedStyle.analyzedQuizCount}퀴즈, ${mergedStyle.analyzedQuestionCount}문제)`);
    }
    if (mergedKeywords) {
      await dataRef.doc("keywords").set(mergedKeywords);
      console.log(`  ✓ keywords (${mergedKeywords.coreTerms.length}용어, ${mergedKeywords.examTopics.length}토픽)`);
    }

    await analysisRef.set({ courseId, courseName: subjectHint, lastAnalyzedAt: FieldValue.serverTimestamp(), totalQuizCount: quizzes.length }, { merge: true });
    console.log("");
  }

  console.log("=== 백필 완료! ===");
}

main().catch(e => { console.error("실패:", e); process.exit(1); });
