/**
 * 철권퀴즈 Cloud Functions (v3 — 양쪽 독립 답변)
 *
 * 실시간 1v1 토끼 배틀 시스템
 * - joinMatchmaking: 매칭 큐 참가
 * - cancelMatchmaking: 큐에서 나가기
 * - matchWithBot: 봇 매칭
 * - submitAnswer: 답변 제출 (양쪽 독립 답변, 둘 다 제출 후 채점)
 * - submitTimeout: 타임아웃 처리 (미답변 = 오답)
 * - swapRabbit: 토끼 교체
 * - submitMashResult: 연타 줄다리기 결과 제출
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getDatabase } from "firebase-admin/database";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import fetch from "node-fetch";
import {
  calcDamage,
  calcBaseDamage,
  calcBattleXp,
  getTotalRemainingHp,
  BATTLE_CONFIG,
  MUTUAL_DAMAGE,
} from "./utils/tekkenDamage";
import { createBotProfile, generateBotAnswer } from "./utils/tekkenBot";
import { getBaseStats } from "./utils/rabbitStats";
import { loadScopeForAI } from "./courseScope";
import { getFocusGuide } from "./styledQuizGenerator";
import { drawQuestionsFromPool } from "./tekkenQuestionPool";

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

// ============================================
// 문제 생성 (기존 퀴즈 참고 → Gemini 변형)
// ============================================

export interface GeneratedQuestion {
  text: string;
  type: "multiple";
  choices: string[];
  correctAnswer: number;
}

export const COURSE_NAMES: Record<string, string> = {
  biology: "생물학",
  pathophysiology: "병태생리학",
  microbiology: "미생물학",
};

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
      return doc.data()?.chapters || ["1", "2", "3"];
    }
  } catch {
    // 설정 없으면 기본값
  }
  return ["1", "2", "3"];
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
  // focusGuide 없으면 → scope count문제
  // scope 없으면 → focusGuide count문제 (또는 generic)
  // 둘 다 있으면 → 5:5
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

// ============================================
// 사전 캐싱 시스템
// ============================================

interface PregenCache {
  questions: GeneratedQuestion[];
  createdAt: number;
  chapters: string[];
}

/**
 * 매칭 대기 중 문제 사전 생성 (fire-and-forget)
 */
async function pregenBattleQuestions(
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

// ============================================
// 배틀 생성 (비동기 문제 생성)
// ============================================

interface PlayerSetup {
  userId: string;
  nickname: string;
  profileRabbitId: number;
  isBot: boolean;
  equippedRabbits: Array<{ rabbitId: number; courseId: string }>;
}

/**
 * 플레이어 스탯 조회
 */
async function getPlayerBattleRabbits(
  userId: string,
  equippedRabbits: Array<{ rabbitId: number; courseId: string }>
) {
  const db = getFirestore();

  // 병렬 조회 (홀딩 + 토끼 이름)
  const rabbits = await Promise.all(
    equippedRabbits.map(async (eq) => {
      const holdingId = `${eq.courseId}_${eq.rabbitId}`;
      const [holdingDoc, rabbitDoc] = await Promise.all([
        db.collection("users").doc(userId)
          .collection("rabbitHoldings").doc(holdingId).get(),
        db.collection("rabbits").doc(holdingId).get(),
      ]);

      const holdingData = holdingDoc.exists ? holdingDoc.data()! : null;
      const stats = holdingData?.stats || getBaseStats(eq.rabbitId);
      const rabbitName = rabbitDoc.exists ? (rabbitDoc.data()?.name || null) : null;
      const discoveryOrder = holdingData?.discoveryOrder || 1;

      return {
        rabbitId: eq.rabbitId,
        name: rabbitName || "토끼",
        discoveryOrder,
        maxHp: stats.hp,
        currentHp: stats.hp,
        atk: stats.atk,
        def: stats.def,
      };
    })
  );

  return rabbits;
}

/**
 * 배틀 룸 생성 — 즉시 loading 상태로 생성, 문제 생성은 비동기
 */
async function createBattle(
  courseId: string,
  player1: PlayerSetup,
  player2: PlayerSetup,
  apiKey: string
): Promise<string> {
  const rtdb = getDatabase();
  const battleId = rtdb.ref("tekken/battles").push().key!;
  const now = Date.now();

  // 플레이어 스탯 병렬 조회
  const [p1Rabbits, p2Rabbits] = await Promise.all([
    player1.isBot
      ? Promise.resolve((player1 as any).rabbits || [])
      : getPlayerBattleRabbits(player1.userId, player1.equippedRabbits),
    player2.isBot
      ? Promise.resolve((player2 as any).rabbits || [])
      : getPlayerBattleRabbits(player2.userId, player2.equippedRabbits),
  ]);

  // 즉시 loading 상태로 배틀 생성 (문제 없이)
  const battleData = {
    status: "loading",
    courseId,
    createdAt: now,
    endsAt: 0, // 문제 생성 완료 후 설정
    currentRound: 0,
    totalRounds: 0,
    colorAssignment: {
      [player1.userId]: "red",
      [player2.userId]: "blue",
    },
    players: {
      [player1.userId]: {
        nickname: player1.nickname,
        profileRabbitId: player1.profileRabbitId,
        isBot: player1.isBot,
        rabbits: p1Rabbits,
        activeRabbitIndex: 0,
        connected: true,
      },
      [player2.userId]: {
        nickname: player2.nickname,
        profileRabbitId: player2.profileRabbitId,
        isBot: player2.isBot,
        rabbits: p2Rabbits,
        activeRabbitIndex: 0,
        connected: true,
      },
    },
  };

  await rtdb.ref(`tekken/battles/${battleId}`).set(battleData);

  // 비동기 문제 생성 (실패 시 에러 상태로 전환)
  populateBattleQuestions(battleId, courseId, apiKey).catch(async (err) => {
    console.error("문제 생성 실패:", err);
    try {
      await rtdb.ref(`tekken/battles/${battleId}`).update({
        status: "error",
        errorMessage: "문제 생성에 실패했습니다.",
      });
    } catch (updateErr) {
      console.error("에러 상태 업데이트 실패:", updateErr);
    }
  });

  return battleId;
}

/**
 * 비동기 문제 생성 → 완료 시 countdown 전환
 *
 * 우선순위:
 * 1. Firestore 문제 풀 (사전 생성된 문제, 중복 방지)
 * 2. RTDB per-user 사전 캐시
 * 3. Gemini 실시간 호출
 * 4. 비상 문제
 */
async function populateBattleQuestions(
  battleId: string,
  courseId: string,
  apiKey: string
): Promise<void> {
  const rtdb = getDatabase();
  const battleRef = rtdb.ref(`tekken/battles/${battleId}`);
  const QUESTION_COUNT = 10;

  // 배틀 참가자 확인
  const battleSnap = await battleRef.once("value");
  const battle = battleSnap.val();
  const playerIds = battle?.players ? Object.keys(battle.players) : [];
  const humanPlayerIds = playerIds.filter(pid => !battle?.players?.[pid]?.isBot);

  let questions: GeneratedQuestion[] | null = null;

  // 1. Firestore 문제 풀에서 추출 (중복 방지 포함)
  if (humanPlayerIds.length > 0) {
    try {
      const poolQuestions = await drawQuestionsFromPool(courseId, humanPlayerIds, QUESTION_COUNT);
      if (poolQuestions && poolQuestions.length >= 5) {
        questions = poolQuestions.slice(0, QUESTION_COUNT);
        console.log(`문제 풀 사용 (${courseId}): ${questions.length}문제`);
      }
    } catch (err) {
      console.error("문제 풀 조회 실패, 폴백 진행:", err);
    }
  }

  // 2. RTDB 사전 캐시 확인 (양쪽 플레이어)
  if (!questions) {
    for (const pid of playerIds) {
      if (battle?.players?.[pid]?.isBot) continue;
      const cacheRef = rtdb.ref(`tekken/pregenQuestions/${courseId}_${pid}`);
      const cacheSnap = await cacheRef.once("value");
      const cache = cacheSnap.val() as PregenCache | null;

      if (cache?.questions && cache.questions.length >= 5 &&
          cache.createdAt > Date.now() - 5 * 60 * 1000) {
        questions = cache.questions.slice(0, QUESTION_COUNT);
        await cacheRef.remove();
        console.log(`사전 캐시 사용 (${pid})`);
        break;
      }
    }
  }

  // 3. Gemini 실시간 호출
  if (!questions) {
    const generated = await generateBattleQuestions(courseId, apiKey, QUESTION_COUNT);
    if (generated.length >= 5) {
      questions = generated.slice(0, QUESTION_COUNT);
    }
  }

  // 4. 비상 문제
  if (!questions || questions.length < 5) {
    questions = getEmergencyQuestions(courseId);
  }

  // 라운드 데이터 구성
  const rounds: Record<string, any> = {};
  const battleAnswersData: Record<string, number> = {};
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    rounds[i] = {
      questionData: {
        text: q.text,
        type: q.type,
        choices: q.choices,
      },
      startedAt: 0,
      timeoutAt: 0,
    };
    battleAnswersData[i] = q.correctAnswer;
  }

  const now = Date.now();

  // RTDB 병렬 쓰기
  await Promise.all([
    battleRef.update({
      status: "countdown",
      rounds,
      totalRounds: questions.length,
      countdownStartedAt: now,
      endsAt: now + BATTLE_CONFIG.BATTLE_DURATION + 5000,
    }),
    rtdb.ref(`tekken/battleAnswers/${battleId}`).set(battleAnswersData),
  ]);

  // 남은 캐시 정리 (사용하지 않은 상대방 캐시)
  for (const pid of playerIds) {
    if (battle?.players?.[pid]?.isBot) continue;
    rtdb.ref(`tekken/pregenQuestions/${courseId}_${pid}`).remove().catch(() => {});
  }
}

/**
 * 비상용 기본 문제 (폴백의 폴백) — 과목별
 */
function getEmergencyQuestions(courseId: string = "biology"): GeneratedQuestion[] {
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

// ============================================
// joinMatchmaking
// ============================================
export const joinMatchmaking = onCall(
  {
    region: "asia-northeast3",
    secrets: [GEMINI_API_KEY],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const userId = request.auth.uid;
    const { courseId } = request.data as { courseId: string };

    if (!courseId) {
      throw new HttpsError("invalid-argument", "courseId가 필요합니다.");
    }

    const rtdb = getDatabase();
    const fsDb = getFirestore();

    const userDoc = await fsDb.collection("users").doc(userId).get();
    if (!userDoc.exists) {
      throw new HttpsError("not-found", "사용자를 찾을 수 없습니다.");
    }
    const userData = userDoc.data()!;
    const equippedRabbits = userData.equippedRabbits || [];
    if (equippedRabbits.length === 0) {
      throw new HttpsError(
        "failed-precondition",
        "장착된 토끼가 없습니다."
      );
    }

    const queueEntry = {
      userId,
      nickname: userData.nickname || "플레이어",
      profileRabbitId: equippedRabbits[0]?.rabbitId || 0,
      equippedRabbits,
      joinedAt: Date.now(),
    };

    // 트랜잭션으로 원자적 매칭
    const queueRef = rtdb.ref(`tekken/matchmaking/${courseId}`);
    let matchedOpponentId: string | null = null;
    let matchedOpponentData: any = null;

    const txResult = await queueRef.transaction((currentData) => {
      matchedOpponentId = null;
      matchedOpponentData = null;

      if (!currentData) {
        return { [userId]: queueEntry };
      }

      delete currentData[userId];

      const opponentIds = Object.keys(currentData);
      if (opponentIds.length > 0) {
        matchedOpponentId = opponentIds[0];
        matchedOpponentData = JSON.parse(JSON.stringify(currentData[matchedOpponentId]));
        delete currentData[matchedOpponentId];
        return Object.keys(currentData).length === 0 ? null : currentData;
      }

      currentData[userId] = queueEntry;
      return currentData;
    });

    if (!txResult.committed) {
      throw new HttpsError("aborted", "매칭 처리 실패, 다시 시도해주세요.");
    }

    if (matchedOpponentId && matchedOpponentData) {
      const player1: PlayerSetup = {
        userId,
        nickname: userData.nickname || "플레이어",
        profileRabbitId: equippedRabbits[0]?.rabbitId || 0,
        isBot: false,
        equippedRabbits,
      };

      const player2: PlayerSetup = {
        userId: matchedOpponentId,
        nickname: matchedOpponentData.nickname || "상대방",
        profileRabbitId: matchedOpponentData.profileRabbitId || 0,
        isBot: false,
        equippedRabbits: matchedOpponentData.equippedRabbits || [],
      };

      // createBattle은 즉시 반환 (문제 생성은 비동기)
      const battleId = await createBattle(
        courseId,
        player1,
        player2,
        GEMINI_API_KEY.value()
      );

      await rtdb.ref(`tekken/matchResults/${matchedOpponentId}`).set({
        battleId,
        matchedAt: Date.now(),
      });

      return { status: "matched", battleId };
    }

    // 매칭 대기 중 → 문제 사전 생성 (fire-and-forget)
    pregenBattleQuestions(courseId, userId, GEMINI_API_KEY.value()).catch((err) => {
      console.error("사전 캐싱 실패 (무시):", err);
    });

    return { status: "waiting" };
  }
);

// ============================================
// cancelMatchmaking
// ============================================
export const cancelMatchmaking = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const userId = request.auth.uid;
    const { courseId } = request.data as { courseId: string };

    const rtdb = getDatabase();
    await rtdb.ref(`tekken/matchmaking/${courseId}/${userId}`).remove();

    // 사전 캐시도 정리
    rtdb.ref(`tekken/pregenQuestions/${courseId}_${userId}`).remove().catch(() => {});

    return { success: true };
  }
);

// ============================================
// matchWithBot
// ============================================
export const matchWithBot = onCall(
  {
    region: "asia-northeast3",
    secrets: [GEMINI_API_KEY],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const userId = request.auth.uid;
    const { courseId } = request.data as { courseId: string };

    const rtdb = getDatabase();
    const fsDb = getFirestore();

    await rtdb.ref(`tekken/matchmaking/${courseId}/${userId}`).remove();

    const userDoc = await fsDb.collection("users").doc(userId).get();
    if (!userDoc.exists) {
      throw new HttpsError("not-found", "사용자를 찾을 수 없습니다.");
    }
    const userData = userDoc.data()!;
    const equippedRabbits = userData.equippedRabbits || [];
    if (equippedRabbits.length === 0) {
      throw new HttpsError("failed-precondition", "장착된 토끼가 없습니다.");
    }

    const botProfile = createBotProfile();
    const botUserId = `bot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const player1: PlayerSetup = {
      userId,
      nickname: userData.nickname || "플레이어",
      profileRabbitId: equippedRabbits[0]?.rabbitId || 0,
      isBot: false,
      equippedRabbits,
    };

    const player2 = {
      userId: botUserId,
      nickname: botProfile.nickname,
      profileRabbitId: botProfile.profileRabbitId,
      isBot: true,
      equippedRabbits: [] as Array<{ rabbitId: number; courseId: string }>,
      rabbits: botProfile.rabbits,
    };

    const battleId = await createBattle(
      courseId,
      player1,
      player2 as any,
      GEMINI_API_KEY.value()
    );

    return { status: "matched", battleId };
  }
);

// ============================================
// submitAnswer — 양쪽 독립 답변 → 둘 다 제출 후 채점
// scored transaction lock으로 이중 채점 방지
// ============================================
export const submitAnswer = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const userId = request.auth.uid;
    const { battleId, roundIndex, answer } = request.data as {
      battleId: string;
      roundIndex: number;
      answer: number;
    };

    if (typeof roundIndex !== "number" || roundIndex < 0) {
      throw new HttpsError("invalid-argument", "유효하지 않은 라운드입니다.");
    }

    const rtdb = getDatabase();
    const battleRef = rtdb.ref(`tekken/battles/${battleId}`);

    // 배틀 데이터 읽기
    const battleSnap = await battleRef.once("value");
    const battle = battleSnap.val();

    if (!battle) {
      throw new HttpsError("not-found", "배틀을 찾을 수 없습니다.");
    }

    // 참가자 검증
    if (!battle.players?.[userId]) {
      throw new HttpsError("permission-denied", "이 배틀의 참가자가 아닙니다.");
    }

    // 상태 검증: question 상태에서만 답변 가능
    if (battle.status !== "question") {
      throw new HttpsError("failed-precondition", "답변할 수 없는 상태입니다.");
    }

    // 현재 라운드 검증
    if (battle.currentRound !== roundIndex) {
      throw new HttpsError("failed-precondition", "현재 라운드가 아닙니다.");
    }

    const round = battle.rounds?.[roundIndex];
    if (!round) {
      throw new HttpsError("not-found", "라운드를 찾을 수 없습니다.");
    }

    // 이미 채점 완료된 라운드
    if (round.scored) {
      throw new HttpsError("failed-precondition", "라운드가 이미 종료되었습니다.");
    }

    const now = Date.now();

    // 답변 기록
    await battleRef.child(`rounds/${roundIndex}/answers/${userId}`).set({
      answer,
      answeredAt: now,
    });

    // 플레이어 정보
    const players = battle.players;
    const playerIds = Object.keys(players);
    const opponentId = playerIds.find((id) => id !== userId)!;
    const opponent = players[opponentId];

    // 봇이면 서버에서 봇 답변 즉시 생성
    const existingOpAnswer = round.answers?.[opponentId];
    if (opponent.isBot && !existingOpAnswer) {
      const correctAnswerSnap = await rtdb
        .ref(`tekken/battleAnswers/${battleId}/${roundIndex}`)
        .once("value");
      const correctAnswer = correctAnswerSnap.val();
      const questionData = round.questionData;
      const botResult = generateBotAnswer(correctAnswer, questionData.choices?.length || 4);
      const botAnsweredAt = now + botResult.delay;
      await battleRef.child(`rounds/${roundIndex}/answers/${opponentId}`).set({
        answer: botResult.answer,
        answeredAt: botAnsweredAt,
      });
    }

    // 다시 읽어서 양쪽 답변 확인
    const updatedRoundSnap = await battleRef.child(`rounds/${roundIndex}/answers`).once("value");
    const allAnswers = updatedRoundSnap.val() || {};

    // 상대가 아직 답변 안 함 → 대기
    if (!allAnswers[opponentId]) {
      return { status: "waiting" as const };
    }

    // 양쪽 다 답변 → scored transaction lock 획득
    const scoredRef = battleRef.child(`rounds/${roundIndex}/scored`);
    const txResult = await scoredRef.transaction((current) => {
      if (current) return; // 이미 채점됨 → abort
      return true;
    });

    if (!txResult.committed) {
      // 이미 상대가 채점 중 → 결과 쓰기 완료까지 대기 (최대 3초)
      let myResult = null;
      for (let i = 0; i < 15; i++) {
        const resultSnap = await battleRef.child(`rounds/${roundIndex}/result/${userId}`).once("value");
        myResult = resultSnap.val();
        if (myResult) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      // 폴링 타임아웃 시 결과가 없으면 waiting 반환 (RTDB 리스너에 맡김)
      if (!myResult) {
        return { status: "waiting" as const };
      }
      return {
        status: "scored" as const,
        isCorrect: myResult.isCorrect,
        damage: myResult.damage,
        isCritical: myResult.isCritical,
        damageReceived: myResult.damageReceived,
      };
    }

    // 채점 수행
    return await scoreRound(battleId, roundIndex, rtdb, battleRef, userId);
  }
);

/**
 * 라운드 채점 로직 (submitAnswer/submitTimeout 공용)
 */
async function scoreRound(
  battleId: string,
  roundIndex: number,
  rtdb: ReturnType<typeof getDatabase>,
  battleRef: ReturnType<ReturnType<typeof getDatabase>["ref"]>,
  callerId?: string, // 호출자 ID (submitAnswer에서 전달)
) {
  // 최신 배틀 데이터 읽기
  const battleSnap = await battleRef.once("value");
  const battle = battleSnap.val();
  const round = battle.rounds?.[roundIndex];

  const correctAnswerSnap = await rtdb
    .ref(`tekken/battleAnswers/${battleId}/${roundIndex}`)
    .once("value");
  const correctAnswer = correctAnswerSnap.val();

  const players = battle.players;
  const playerIds = Object.keys(players);
  const [p1Id, p2Id] = playerIds;
  const p1Answer = round.answers?.[p1Id];
  const p2Answer = round.answers?.[p2Id];

  const p1Correct = p1Answer ? p1Answer.answer === correctAnswer : false;
  const p2Correct = p2Answer ? p2Answer.answer === correctAnswer : false;

  const p1Player = players[p1Id];
  const p2Player = players[p2Id];
  const p1Rabbit = p1Player.rabbits[p1Player.activeRabbitIndex];
  const p2Rabbit = p2Player.rabbits[p2Player.activeRabbitIndex];

  // 정답 선지 텍스트
  const correctChoiceText = round.questionData?.choices?.[correctAnswer] || "";

  // 결과 초기화
  const p1Result = { isCorrect: p1Correct, damage: 0, isCritical: false, damageReceived: 0, correctChoiceText };
  const p2Result = { isCorrect: p2Correct, damage: 0, isCritical: false, damageReceived: 0, correctChoiceText };

  let mashTriggered = false;
  let mashId = "";

  // 원자적 업데이트를 위한 updates 객체
  const updates: Record<string, any> = {};

  if (p1Correct && p2Correct) {
    // 양쪽 정답 → 연타 미니게임
    mashTriggered = true;
  } else if (!p1Correct && !p2Correct) {
    // 양쪽 오답 → 상호 고정 데미지
    p1Result.damageReceived = MUTUAL_DAMAGE;
    p2Result.damageReceived = MUTUAL_DAMAGE;

    updates[`players/${p1Id}/rabbits/${p1Player.activeRabbitIndex}/currentHp`] =
      Math.max(0, p1Rabbit.currentHp - MUTUAL_DAMAGE);
    updates[`players/${p2Id}/rabbits/${p2Player.activeRabbitIndex}/currentHp`] =
      Math.max(0, p2Rabbit.currentHp - MUTUAL_DAMAGE);
  } else {
    // 한쪽만 정답
    const loserId = p1Correct ? p2Id : p1Id;
    const winnerAnswer = p1Correct ? p1Answer : p2Answer;
    const winnerRabbit = p1Correct ? p1Rabbit : p2Rabbit;
    const loserRabbit = p1Correct ? p2Rabbit : p1Rabbit;
    const loserPlayer = p1Correct ? p2Player : p1Player;
    const winnerResult = p1Correct ? p1Result : p2Result;
    const loserResult = p1Correct ? p2Result : p1Result;

    const dmgResult = calcDamage(
      winnerRabbit.atk,
      loserRabbit.def,
      winnerAnswer?.answeredAt || round.startedAt,
      round.startedAt
    );
    winnerResult.damage = dmgResult.damage;
    winnerResult.isCritical = dmgResult.isCritical;
    loserResult.damageReceived = dmgResult.damage;

    updates[`players/${loserId}/rabbits/${loserPlayer.activeRabbitIndex}/currentHp`] =
      Math.max(0, loserRabbit.currentHp - dmgResult.damage);
  }

  // 결과 + HP + mash/status를 단일 update로 원자적 기록
  updates[`rounds/${roundIndex}/result/${p1Id}`] = p1Result;
  updates[`rounds/${roundIndex}/result/${p2Id}`] = p2Result;

  if (mashTriggered) {
    mashId = `mash_${roundIndex}_${Date.now()}`;
    const mashNow = Date.now();
    updates["mash"] = {
      mashId,
      startedAt: mashNow,
      endsAt: mashNow + BATTLE_CONFIG.MASH_TIMEOUT,
      taps: {},
    };
    updates["status"] = "mash";
  }

  await battleRef.update(updates);

  if (!mashTriggered) {
    // 라운드 종료 처리
    const updatedBattle = (await battleRef.once("value")).val();
    await processRoundEnd(battleId, roundIndex, updatedBattle);
  }

  // 호출자에게 결과 반환
  const callerResult = callerId === p1Id ? p1Result : callerId === p2Id ? p2Result : null;
  return {
    status: "scored" as const,
    isCorrect: callerResult?.isCorrect,
    damage: callerResult?.damage,
    isCritical: callerResult?.isCritical,
    damageReceived: callerResult?.damageReceived,
    mashTriggered,
    mashId: mashTriggered ? mashId : undefined,
  };
}

// ============================================
// submitTimeout — 타임아웃 처리 (미답변 = 오답)
// scored transaction lock으로 이중 채점 방지
// ============================================
export const submitTimeout = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const userId = request.auth.uid;
    const { battleId, roundIndex } = request.data as {
      battleId: string;
      roundIndex: number;
    };

    if (typeof roundIndex !== "number" || roundIndex < 0) {
      throw new HttpsError("invalid-argument", "유효하지 않은 라운드입니다.");
    }

    const rtdb = getDatabase();
    const battleRef = rtdb.ref(`tekken/battles/${battleId}`);

    // 배틀 상태 + 참가자 검증
    const battleSnap = await battleRef.once("value");
    const battle = battleSnap.val();
    if (!battle) {
      throw new HttpsError("not-found", "배틀을 찾을 수 없습니다.");
    }
    if (!battle.players?.[userId]) {
      throw new HttpsError("permission-denied", "이 배틀의 참가자가 아닙니다.");
    }
    if (battle.status !== "question") {
      return { success: false };
    }
    if (battle.currentRound !== roundIndex) {
      return { success: false };
    }

    // 서버 시간 기준 타임아웃 검증 (2초 여유)
    const round = battle.rounds?.[roundIndex];
    if (round?.timeoutAt && Date.now() < round.timeoutAt - 2000) {
      throw new HttpsError(
        "failed-precondition",
        "아직 타임아웃 시간이 아닙니다."
      );
    }

    // scored transaction lock 획득
    const scoredRef = battleRef.child(`rounds/${roundIndex}/scored`);
    const txResult = await scoredRef.transaction((current) => {
      if (current) return; // 이미 채점됨 → abort
      return true;
    });

    if (!txResult.committed) {
      return { success: false };
    }

    // 채점 수행
    await scoreRound(battleId, roundIndex, rtdb, battleRef);

    return { success: true };
  }
);

// ============================================
// 라운드 종료 처리 (HP 기반, 라운드 제한 없음)
// setTimeout 제거 → 클라이언트가 roundResult 감지 후 startBattleRound 호출
// 양쪽 동시 KO 시 무승부 처리
// ============================================
async function processRoundEnd(
  battleId: string,
  _roundIndex: number,
  battle: any
) {
  const rtdb = getDatabase();
  const battleRef = rtdb.ref(`tekken/battles/${battleId}`);

  const playerIds = Object.keys(battle.players);

  // KO 체크 — 양쪽 모든 토끼 HP 확인 (동시 KO 대응)
  const koPlayers: string[] = [];
  for (const pid of playerIds) {
    const player = battle.players[pid];
    const allDead = player.rabbits.every(
      (r: { currentHp: number }) => r.currentHp <= 0
    );
    if (allDead) koPlayers.push(pid);
  }

  if (koPlayers.length >= 2) {
    // 양쪽 동시 KO → 무승부
    await endBattle(battleId, null, null, true, "ko");
    return;
  } else if (koPlayers.length === 1) {
    // 한쪽 KO → 상대 승리
    const loserId = koPlayers[0];
    const winnerId = playerIds.find((id) => id !== loserId)!;
    await endBattle(battleId, winnerId, loserId, false, "ko");
    return;
  }

  // 다음 라운드 or 종료 조건
  const nextRound = (battle.currentRound || 0) + 1;
  const totalRounds = battle.totalRounds || 10;

  // 문제 소진 → HP 비교 (시간제한 없음)
  if (nextRound >= totalRounds) {
    const p1 = playerIds[0];
    const p2 = playerIds[1];
    const p1Hp = getTotalRemainingHp(battle.players[p1].rabbits);
    const p2Hp = getTotalRemainingHp(battle.players[p2].rabbits);

    if (p1Hp > p2Hp) {
      await endBattle(battleId, p1, p2, false, "timeout");
    } else if (p2Hp > p1Hp) {
      await endBattle(battleId, p2, p1, false, "timeout");
    } else {
      await endBattle(battleId, null, null, true, "timeout");
    }
    return;
  }

  // 토끼 교체 + roundResult 전환을 단일 update로 원자적 기록
  // mash 데이터 정리 (taps/processed 등 제거, result만 보존)
  const roundEndUpdates: Record<string, any> = {
    status: "roundResult",
    nextRound,
    "mash/taps": null,
    "mash/processed": null,
    "mash/startedAt": null,
    "mash/endsAt": null,
    "mash/mashId": null,
  };

  for (const pid of playerIds) {
    const player = battle.players[pid];
    const activeRabbit = player.rabbits[player.activeRabbitIndex];
    if (activeRabbit.currentHp <= 0) {
      const otherIndex = player.activeRabbitIndex === 0 ? 1 : 0;
      const otherRabbit = player.rabbits[otherIndex];
      if (otherRabbit && otherRabbit.currentHp > 0) {
        roundEndUpdates[`players/${pid}/activeRabbitIndex`] = otherIndex;
      }
    }
  }

  await battleRef.update(roundEndUpdates);
}

// ============================================
// 배틀 종료 + XP 지급
// ============================================
async function endBattle(
  battleId: string,
  winnerId: string | null,
  loserId: string | null,
  isDraw: boolean,
  endReason: string
) {
  const rtdb = getDatabase();
  const fsDb = getFirestore();
  const battleRef = rtdb.ref(`tekken/battles/${battleId}`);

  // 원자적 xpGranted 체크 (이중 XP 지급 방지)
  const xpGrantedRef = battleRef.child("result/xpGranted");
  const xpTx = await xpGrantedRef.transaction((current) => {
    if (current === true) return; // 이미 지급됨 → abort
    return true;
  });

  if (!xpTx.committed) return; // 다른 호출이 이미 처리함

  const battleSnap = await battleRef.once("value");
  const battle = battleSnap.val();

  await battleRef.update({
    status: "finished",
    "result/winnerId": winnerId,
    "result/loserId": loserId,
    "result/isDraw": isDraw,
    "result/endReason": endReason,
    mash: null,
  });

  const players = battle?.players || {};
  const batch = fsDb.batch();

  for (const [uid, player] of Object.entries(players)) {
    const p = player as any;
    if (p.isBot) continue;

    const isWinner = uid === winnerId;

    // 연승 업데이트 (트랜잭션으로 race condition 방지)
    const streakRef = rtdb.ref(`tekken/streaks/${uid}`);
    const txResult = await streakRef.transaction((current: any) => {
      const streak = current || { currentStreak: 0, lastBattleAt: 0 };
      const newStreak = isWinner
        ? streak.currentStreak + 1
        : isDraw
          ? streak.currentStreak
          : 0;
      return { currentStreak: newStreak, lastBattleAt: Date.now() };
    });
    const newStreak = txResult.snapshot.val()?.currentStreak ?? 0;
    const xp = calcBattleXp(isWinner, newStreak);

    // 결과에 XP 기록 (클라이언트 표시용)
    await battleRef.child(`result/xpByPlayer/${uid}`).set(xp);

    const userRef = fsDb.collection("users").doc(uid);
    batch.update(userRef, {
      totalExp: FieldValue.increment(xp),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const histRef = userRef.collection("expHistory").doc();
    batch.set(histRef, {
      type: "tekken_battle",
      amount: xp,
      reason: isWinner
        ? `배틀 승리 (${newStreak}연승)`
        : isDraw
          ? "배틀 무승부"
          : "배틀 패배",
      battleId,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  try {
    await batch.commit();
  } catch (err) {
    // Firestore batch 실패 → xpGranted 리셋 (재시도 가능)
    console.error("XP 지급 Firestore batch 실패, xpGranted 리셋:", err);
    await xpGrantedRef.set(false).catch(() => {});
  }
}

// ============================================
// swapRabbit
// ============================================
export const swapRabbit = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const userId = request.auth.uid;
    const { battleId } = request.data as { battleId: string };

    const rtdb = getDatabase();
    const battleRef = rtdb.ref(`tekken/battles/${battleId}`);
    const battleSnap = await battleRef.once("value");
    const battle = battleSnap.val();

    if (!battle || battle.status !== "question") {
      throw new HttpsError("failed-precondition", "교체할 수 없는 상태입니다.");
    }

    const player = battle.players?.[userId];
    if (!player) {
      throw new HttpsError("not-found", "플레이어를 찾을 수 없습니다.");
    }

    const currentRound = battle.currentRound || 0;
    if (battle.rounds?.[currentRound]?.answers?.[userId]) {
      throw new HttpsError("failed-precondition", "답변 후에는 교체할 수 없습니다.");
    }

    const currentIndex = player.activeRabbitIndex;
    const newIndex = currentIndex === 0 ? 1 : 0;
    const otherRabbit = player.rabbits?.[newIndex];

    if (!otherRabbit || otherRabbit.currentHp <= 0) {
      throw new HttpsError(
        "failed-precondition",
        "교체할 토끼가 없거나 HP가 0입니다."
      );
    }

    await battleRef.child(`players/${userId}/activeRabbitIndex`).set(newIndex);

    return { success: true, newIndex };
  }
);

// ============================================
// submitMashResult — 줄다리기 결과 (스탯 기반 데미지)
// Transaction으로 이중 처리 방지
// ============================================
export const submitMashResult = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const userId = request.auth.uid;
    const { battleId, taps } = request.data as {
      battleId: string;
      taps: number;
    };

    const rtdb = getDatabase();
    const battleRef = rtdb.ref(`tekken/battles/${battleId}`);
    const battleSnap = await battleRef.once("value");
    const battle = battleSnap.val();

    if (!battle?.mash) {
      throw new HttpsError("not-found", "연타 미니게임을 찾을 수 없습니다.");
    }

    // 이미 결과 처리 완료된 경우
    if (battle.mash.result) {
      return { winnerId: battle.mash.result.winnerId, bonusDamage: battle.mash.result.bonusDamage };
    }

    const MAX_TAPS = 200;
    const validTaps = Math.max(0, Math.min(Math.floor(taps), MAX_TAPS));

    // 내 탭 수 기록
    await battleRef.child(`mash/taps/${userId}`).set(validTaps);

    // 봇 처리
    const players = battle.players;
    const playerIds = Object.keys(players);
    const opponentId = playerIds.find((id) => id !== userId)!;
    const opponent = players[opponentId];

    if (opponent.isBot) {
      // 봇: 경과 시간 기반 탭 수 (3~5탭/초)
      const elapsed = Math.max(1000, Date.now() - (battle.mash.startedAt || Date.now()));
      const botTapsPerSec = 3 + Math.random() * 2;
      const botTaps = Math.floor((elapsed / 1000) * botTapsPerSec);
      await battleRef.child(`mash/taps/${opponentId}`).set(botTaps);
    }

    // 원자적 연타 결과 처리 (이중 처리 방지)
    // 게이지가 끝까지 찬 쪽이 먼저 호출 → 즉시 처리 (대기 없음)
    const processedRef = battleRef.child("mash/processed");
    const mashTx = await processedRef.transaction((current) => {
      if (current) return; // 이미 처리됨 → abort
      return true;
    });

    if (!mashTx.committed) {
      // 이미 처리됨 — 최신 결과 반환
      const latestSnap = await battleRef.child("mash/result").once("value");
      const latestResult = latestSnap.val();
      return { winnerId: latestResult?.winnerId, bonusDamage: latestResult?.bonusDamage };
    }

    // 최신 탭 수 읽기 (실시간 writeMashTap으로 기록된 값)
    const latestTapsSnap = await battleRef.child("mash/taps").once("value");
    const latestTaps = latestTapsSnap.val() || {};
    const myTaps = latestTaps[userId] || validTaps;
    const opTaps = latestTaps[opponentId] || 0;

    const mashWinnerId = myTaps > opTaps ? userId : myTaps < opTaps ? opponentId : userId;
    const mashLoserId = mashWinnerId === userId ? opponentId : userId;

    // 스탯 기반 연타 데미지
    const winner = players[mashWinnerId];
    const loser = players[mashLoserId];
    const winnerRabbit = winner.rabbits[winner.activeRabbitIndex];
    const loserRabbit = loser.rabbits[loser.activeRabbitIndex];
    const bonusDamage = calcBaseDamage(winnerRabbit.atk, loserRabbit.def);

    // 패자에게 보너스 데미지 — result + HP + 라운드 결과를 원자적으로 기록
    const loserHpSnap = await battleRef
      .child(`players/${mashLoserId}/rabbits/${loser.activeRabbitIndex}/currentHp`)
      .once("value");
    const currentLoserHp = loserHpSnap.val() ?? loserRabbit.currentHp;
    const newHp = Math.max(0, currentLoserHp - bonusDamage);
    const roundIdx = battle.currentRound || 0;
    await battleRef.update({
      "mash/result": { winnerId: mashWinnerId, bonusDamage },
      [`players/${mashLoserId}/rabbits/${loser.activeRabbitIndex}/currentHp`]: newHp,
      // 라운드 결과에 연타 데미지 반영 (클라이언트 데미지 팝업용)
      [`rounds/${roundIdx}/result/${mashWinnerId}/damage`]: bonusDamage,
      [`rounds/${roundIdx}/result/${mashLoserId}/damageReceived`]: bonusDamage,
    });

    // 라운드 종료 처리
    const updatedBattle = (await battleRef.once("value")).val();
    await processRoundEnd(battleId, roundIdx, updatedBattle);

    return { winnerId: mashWinnerId, bonusDamage };
  }
);

// ============================================
// startBattleRound — 카운트다운 후 / roundResult 후 라운드 시작
// 참가자 검증 포함
// ============================================
export const startBattleRound = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const userId = request.auth.uid;
    const { battleId, roundIndex } = request.data as {
      battleId: string;
      roundIndex: number;
    };

    const rtdb = getDatabase();
    const battleRef = rtdb.ref(`tekken/battles/${battleId}`);
    const battleSnap = await battleRef.once("value");
    const battle = battleSnap.val();

    if (!battle) {
      throw new HttpsError("not-found", "배틀을 찾을 수 없습니다.");
    }

    // 참가자 검증
    if (!battle.players?.[userId]) {
      throw new HttpsError("permission-denied", "이 배틀의 참가자가 아닙니다.");
    }

    if (battle.status === "finished") {
      throw new HttpsError("failed-precondition", "이미 종료된 배틀입니다.");
    }

    // question 상태에서 다시 시작 방지
    if (battle.status === "question") {
      return { success: true };
    }

    // 라운드별 started 플래그 트랜잭션 (이중 시작 방지)
    const startedRef = battleRef.child(`rounds/${roundIndex}/started`);
    const txResult = await startedRef.transaction((current) => {
      if (current) return; // 이미 시작됨 → abort
      return true;
    });

    if (!txResult.committed) {
      // 다른 클라이언트가 이미 시작함
      return { success: true };
    }

    // status + 라운드 데이터를 단일 update로 원자적 기록
    // (클라이언트 onValue에서 한 번에 수신 → race condition 방지)
    // mash 잔류 데이터 완전 정리 (이전 라운드 연타 결과)
    const now = Date.now();
    await battleRef.update({
      status: "question",
      currentRound: roundIndex,
      mash: null,
      [`rounds/${roundIndex}/startedAt`]: now,
      [`rounds/${roundIndex}/timeoutAt`]: now + BATTLE_CONFIG.QUESTION_TIMEOUT,
    });

    return { success: true };
  }
);
