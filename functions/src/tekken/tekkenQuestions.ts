/**
 * 철권퀴즈 문제 생성 — Gemini API 호출, 비상 문제, 사전 캐싱
 */

import { getDatabase } from "firebase-admin/database";
import { getFirestore } from "firebase-admin/firestore";
import fetch from "node-fetch";
import { loadScopeForAI } from "../courseScope";
import { getFocusGuide } from "../styledQuizGenerator";
import type { GeneratedQuestion, PregenCache } from "./tekkenTypes";
import { COURSE_NAMES } from "./tekkenTypes";

/**
 * 교수님이 설정한 배틀 출제 챕터 조회
 */
export async function getTekkenChapters(courseId: string): Promise<string[]> {
  try {
    const db = getFirestore();
    const doc = await db
      .collection("settings")
      .doc("tekken")
      .collection("courses")
      .doc(courseId)
      .get();
    if (doc.exists) {
      return doc.data()?.chapters || ["2", "3", "4"];
    }
  } catch {
    // 설정 없으면 기본값
  }
  return ["2", "3", "4"];
}

/**
 * 철권퀴즈 프롬프트 생성
 *
 * - biology: scope + focusGuide 5:5 비율
 * - pathophysiology: scope 기반 (focusGuide 없으면 scope 전체)
 * - microbiology: scope/focusGuide 없음 → 간호사 국시 기반 별도 프롬프트
 */
function buildTekkenPrompt(
  courseName: string,
  courseId: string,
  focusGuide: string | null,
  scopeContent: string | null,
  focusCount: number,
  scopeCount: number,
  chapters: string[]
): string {
  const totalCount = focusCount + scopeCount;

  // 미생물학: scope/focusGuide 없음 → 간호사 국시 기반 전용 프롬프트
  if (courseId === "microbiology" && !focusGuide && !scopeContent) {
    return `간호학과 2학년 대상 미생물학 배틀 퀴즈 문제 ${totalCount}개를 만들어주세요.

범위: 미생물학 ${chapters.join(", ")}장
참고: 간호사 국가고시 미생물학 출제 범위를 참고하되, 간호학과 2학년 수준에 적합한 난이도로 출제하세요.

대상: 간호학과 2학년 대학생
난이도: 수업을 들은 학생이 20초 안에 풀 수 있는 중간 난이도

## 공통 규칙
- 4지선다 순수 객관식만 (OX 문제 금지)
- 문제 하나로 완결 (별도 지문/제시문/보기표/그림/표 참조 금지)
- "다음 중", "위의 내용에서" 같은 외부 참조 표현 금지
- 각 문제는 서로 다른 주제/개념 (같은 개념 2번 이상 금지)
- 간결한 문제 (1~2문장)
- 오답 선지는 그럴듯하게 (명백히 틀린 보기 금지)
- choices 4개, correctAnswer는 0~3
- 매번 다른 문제를 생성

반드시 아래 JSON 형식만 출력 (다른 텍스트 없이):
[
  {"text": "문제 내용", "type": "multiple", "choices": ["선지1", "선지2", "선지3", "선지4"], "correctAnswer": 2}
]`;
  }

  let prompt = `대학교 ${courseName} 과목 (${chapters.join(", ")}장) 배틀 퀴즈 문제 ${totalCount}개를 만들어주세요.\n\n`;

  prompt += `대상: 간호학과 대학생\n`;
  prompt += `난이도: 수업을 들은 학생이 20초 안에 풀 수 있는 중간 난이도\n\n`;

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

  prompt += `## 공통 규칙
- 4지선다 순수 객관식만 (OX 문제 금지)
- 문제 하나로 완결 (별도 지문/제시문/보기표/그림/표 참조 금지)
- "다음 중", "위의 내용에서" 같은 외부 참조 표현 금지
- 각 문제는 서로 다른 주제/개념 (같은 개념 2번 이상 금지)
- 간결한 문제 (1~2문장)
- 오답 선지는 그럴듯하게 (명백히 틀린 보기 금지)
- choices 4개, correctAnswer는 0~3
- 매번 다른 문제를 생성

반드시 아래 JSON 형식만 출력 (다른 텍스트 없이):
[
  {"text": "문제 내용", "type": "multiple", "choices": ["선지1", "선지2", "선지3", "선지4"], "correctAnswer": 2}
]`;

  return prompt;
}

/**
 * Gemini로 scope + focusGuide 기반 배틀 문제 생성
 * count: 10 (7라운드 내 종료 + 여유분)
 */
export async function generateBattleQuestions(
  courseId: string,
  apiKey: string,
  count: number = 10,
  chapters?: string[]
): Promise<GeneratedQuestion[]> {
  const targetChapters = chapters || await getTekkenChapters(courseId);
  const courseName = COURSE_NAMES[courseId] || "생물학";

  // scope + focusGuide 병렬 로드
  const [scopeData, focusGuide] = await Promise.all([
    loadScopeForAI(courseId, targetChapters, 8000),
    Promise.resolve(getFocusGuide(courseId, targetChapters)),
  ]);

  const hasFocusGuide = !!focusGuide;
  const hasScope = !!scopeData?.content;

  // 5:5 비율 결정
  const focusCount = hasFocusGuide ? (hasScope ? 5 : count) : 0;
  const scopeCount = count - focusCount;

  const prompt = buildTekkenPrompt(
    courseName,
    courseId,
    focusGuide,
    scopeData?.content || null,
    focusCount,
    scopeCount,
    targetChapters
  );

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.9,
            maxOutputTokens: 8192,
          },
        }),
      }
    );

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    const jsonStr = text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const questions: GeneratedQuestion[] = JSON.parse(jsonStr);

    const valid = questions.filter(
      (q) =>
        q.text &&
        q.type &&
        Array.isArray(q.choices) &&
        typeof q.correctAnswer === "number" &&
        q.correctAnswer >= 0 &&
        q.correctAnswer < q.choices.length
    );

    if (valid.length >= 5) {
      return valid.slice(0, count);
    }

    console.log(`Gemini 유효 문제 ${valid.length}개 — 비상 문제 폴백`);
  } catch (error) {
    console.error("Gemini 배틀 문제 생성 실패:", error);
  }

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
