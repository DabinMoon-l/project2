/**
 * 철권퀴즈 Cloud Functions (v2 — 순발력 리워크)
 *
 * 실시간 1v1 토끼 배틀 시스템
 * - joinMatchmaking: 매칭 큐 참가
 * - cancelMatchmaking: 큐에서 나가기
 * - matchWithBot: 봇 매칭
 * - submitAnswer: 답변 제출 (먼저 푼 사람이 라운드 결정)
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
  calcSelfDamage,
  calcBattleXp,
  getTotalRemainingHp,
  BATTLE_CONFIG,
} from "./utils/tekkenDamage";
import { createBotProfile } from "./utils/tekkenBot";
import { getBaseStats } from "./utils/rabbitStats";

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

// ============================================
// 문제 생성 (기존 퀴즈 참고 → Gemini 변형)
// ============================================

interface GeneratedQuestion {
  text: string;
  type: "multiple";
  choices: string[];
  correctAnswer: number;
}

const COURSE_NAMES: Record<string, string> = {
  biology: "생물학",
  pathophysiology: "병태생리학",
  microbiology: "미생물학",
};

/**
 * 기존 퀴즈에서 객관식 랜덤 추출 (참고 자료용)
 */
async function fetchExistingQuestions(
  courseId: string,
  count: number = 25
): Promise<GeneratedQuestion[]> {
  const db = getFirestore();
  const snapshot = await db
    .collection("quizzes")
    .where("courseId", "==", courseId)
    .where("type", "in", ["midterm", "final", "past", "professor"])
    .limit(30)
    .get();

  const allQuestions: GeneratedQuestion[] = [];

  for (const doc of snapshot.docs) {
    const quiz = doc.data();
    const questions = quiz.questions || [];
    for (const q of questions) {
      if (
        q.type === "multiple" &&
        Array.isArray(q.choices) &&
        q.correctAnswer !== undefined
      ) {
        allQuestions.push({
          text: q.text || q.question || "",
          type: "multiple",
          choices: q.choices.map((c: { text?: string } | string) =>
            typeof c === "string" ? c : c.text || ""
          ),
          correctAnswer: q.correctAnswer,
        });
      }
    }
  }

  // 셔플 후 반환
  for (let i = allQuestions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allQuestions[i], allQuestions[j]] = [allQuestions[j], allQuestions[i]];
  }

  return allQuestions.slice(0, count);
}

/**
 * 교수님이 설정한 배틀 범위 키워드 조회
 */
async function getTekkenKeywords(courseId: string): Promise<string[]> {
  try {
    const db = getFirestore();
    const doc = await db
      .collection("settings")
      .doc("tekken")
      .collection("courses")
      .doc(courseId)
      .get();
    if (doc.exists) {
      return doc.data()?.keywords || [];
    }
  } catch {
    // 설정 없으면 빈 배열
  }
  return [];
}

/**
 * Gemini로 기존 문제를 참고하여 변형 문제 생성
 * count: 10 (7라운드 내 종료 + 여유분)
 */
async function generateBattleQuestions(
  courseId: string,
  apiKey: string,
  count: number = 10
): Promise<GeneratedQuestion[]> {
  const courseName = COURSE_NAMES[courseId] || "생물학";

  const [existingQuestions, keywords] = await Promise.all([
    fetchExistingQuestions(courseId, 15),
    getTekkenKeywords(courseId),
  ]);

  const hasReference = existingQuestions.length >= 3;
  const referenceBlock = hasReference
    ? existingQuestions
        .slice(0, 10)
        .map(
          (q, i) =>
            `${i + 1}. [객관식] ${q.text}` +
            ` (선지: ${q.choices.join(", ")} / 정답: ${q.choices[q.correctAnswer]})`
        )
        .join("\n")
    : "";

  const keywordBlock =
    keywords.length > 0
      ? `\n출제 범위 키워드: ${keywords.join(", ")}\n이 키워드와 관련된 주제를 우선적으로 출제하세요.`
      : "";

  // 챕터 1~4 범위 + 다양성 지시
  const chapterScope = "\n출제 범위: 챕터 1, 2, 3, 4 내용으로만 출제하세요.";
  const diversityInstruction = `
추가 지시:
- 각 문제는 서로 다른 주제/개념에서 출제하세요
- 같은 키워드나 개념을 2번 이상 반복하지 마세요
- 다양한 인지 수준(기억, 이해, 적용)을 섞어 출제하세요`;

  const prompt = hasReference
    ? `
아래는 대학교 ${courseName} 과목의 기존 퀴즈 문제입니다:

${referenceBlock}
${keywordBlock}
${chapterScope}

위 문제들을 **참고**하여 비슷하지만 새로운 문제 ${count}개를 만들어주세요.

변형 방법 (다양하게 섞어서):
- 같은 주제의 다른 측면을 묻기 (예: "A는 B이다" → "B의 기능은 무엇인가?")
- 객관식 선지를 바꾸거나 오답 선지를 비슷한 용어로 교체
- 같은 개념을 다른 표현으로 물어보기
- 원본과 완전히 똑같은 문제는 절대 금지
${diversityInstruction}

요구사항:
- 5지선다 객관식 ${count}개 (OX 문제 금지)
- 적절한 중간 난이도: 수업을 들은 학생이라면 20초 안에 풀 수 있지만, 단순 암기가 아닌 이해를 요구하는 수준
- 오답 선지는 그럴듯하게 (명백히 틀린 보기 금지)
- 간결한 문제 (1~2문장)
- choices 5개, correctAnswer는 0~4

반드시 아래 JSON 형식만 출력 (다른 텍스트 없이):
[
  {"text": "문제 내용", "type": "multiple", "choices": ["선지1", "선지2", "선지3", "선지4", "선지5"], "correctAnswer": 2}
]`
    : `
대학교 ${courseName} 과목의 배틀 퀴즈 문제 ${count}개를 만들어주세요.
${keywordBlock}
${chapterScope}
${diversityInstruction}

요구사항:
- 5지선다 객관식 ${count}개 (OX 문제 금지)
- 적절한 중간 난이도: 수업을 들은 학생이라면 20초 안에 풀 수 있지만, 단순 암기가 아닌 이해를 요구하는 수준
- 오답 선지는 그럴듯하게 (명백히 틀린 보기 금지)
- 간결한 문제 (1~2문장)
- choices 5개, correctAnswer는 0~4

반드시 아래 JSON 형식만 출력 (다른 텍스트 없이):
[
  {"text": "문제 내용", "type": "multiple", "choices": ["선지1", "선지2", "선지3", "선지4", "선지5"], "correctAnswer": 2}
]`;

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

    console.log(`Gemini 유효 문제 ${valid.length}개 — 기존 퀴즈 원본 폴백`);
  } catch (error) {
    console.error("Gemini 변형 문제 생성 실패:", error);
  }

  if (existingQuestions.length >= 5) {
    console.log("기존 퀴즈 원본으로 폴백");
    return existingQuestions.slice(0, count);
  }

  return [];
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
  const rabbits = [];

  for (const eq of equippedRabbits) {
    const holdingId = `${eq.courseId}_${eq.rabbitId}`;
    const holdingDoc = await db
      .collection("users")
      .doc(userId)
      .collection("rabbitHoldings")
      .doc(holdingId)
      .get();

    if (holdingDoc.exists) {
      const data = holdingDoc.data()!;
      const stats = data.stats || getBaseStats(eq.rabbitId);
      rabbits.push({
        rabbitId: eq.rabbitId,
        maxHp: stats.hp,
        currentHp: stats.hp,
        atk: stats.atk,
        def: stats.def,
      });
    } else {
      const base = getBaseStats(eq.rabbitId);
      rabbits.push({
        rabbitId: eq.rabbitId,
        maxHp: base.hp,
        currentHp: base.hp,
        atk: base.atk,
        def: base.def,
      });
    }
  }

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

  // 플레이어 스탯 조회
  const p1Rabbits = player1.isBot
    ? (player1 as any).rabbits || []
    : await getPlayerBattleRabbits(player1.userId, player1.equippedRabbits);
  const p2Rabbits = player2.isBot
    ? (player2 as any).rabbits || []
    : await getPlayerBattleRabbits(player2.userId, player2.equippedRabbits);

  // 즉시 loading 상태로 배틀 생성 (문제 없이)
  const battleData = {
    status: "loading",
    courseId,
    createdAt: now,
    endsAt: 0, // 문제 생성 완료 후 설정
    currentRound: 0,
    totalRounds: 0,
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
 */
async function populateBattleQuestions(
  battleId: string,
  courseId: string,
  apiKey: string
): Promise<void> {
  const rtdb = getDatabase();
  const battleRef = rtdb.ref(`tekken/battles/${battleId}`);

  let questions = await generateBattleQuestions(courseId, apiKey);
  if (questions.length < 5) {
    questions = getEmergencyQuestions();
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
  await battleRef.update({
    status: "countdown",
    rounds,
    totalRounds: questions.length,
    endsAt: now + BATTLE_CONFIG.BATTLE_DURATION + 5000,
  });

  // 정답을 별도 경로에 저장
  await rtdb.ref(`tekken/battleAnswers/${battleId}`).set(battleAnswersData);
}

/**
 * 비상용 기본 문제 (폴백의 폴백)
 */
function getEmergencyQuestions(): GeneratedQuestion[] {
  return [
    { text: "세포막의 주요 구성 성분으로 유동 모자이크 모델의 기반이 되는 것은?", type: "multiple", choices: ["인지질 이중층", "콜레스테롤", "당단백질", "셀룰로스", "케라틴"], correctAnswer: 0 },
    { text: "미토콘드리아에서 ATP가 가장 많이 생성되는 단계는?", type: "multiple", choices: ["해당과정", "시트르산 회로", "산화적 인산화", "발효", "베타 산화"], correctAnswer: 2 },
    { text: "DNA 복제 시 선도 가닥(leading strand)의 합성 방향은?", type: "multiple", choices: ["5'→3' 연속 합성", "3'→5' 연속 합성", "5'→3' 불연속 합성", "3'→5' 불연속 합성", "양방향 동시 합성"], correctAnswer: 0 },
    { text: "광합성의 명반응이 일어나는 장소는?", type: "multiple", choices: ["스트로마", "틸라코이드 막", "세포질", "내막", "크리스타"], correctAnswer: 1 },
    { text: "성숙한 적혈구에 없는 세포 소기관은?", type: "multiple", choices: ["세포막", "헤모글로빈", "핵", "세포질", "탄산탈수효소"], correctAnswer: 2 },
    { text: "인체에서 가장 넓은 면적을 차지하는 장기는?", type: "multiple", choices: ["간", "폐", "피부", "소장", "뇌"], correctAnswer: 2 },
    { text: "효소의 활성 부위에 기질이 결합하는 모델 중, 결합 시 효소 구조가 변하는 모델은?", type: "multiple", choices: ["자물쇠-열쇠 모델", "유도적합 모델", "경쟁적 억제 모델", "알로스테릭 모델", "피드백 모델"], correctAnswer: 1 },
    { text: "ABO 혈액형에서 만능 수혈자(모든 혈액형에 수혈 가능)는?", type: "multiple", choices: ["A형", "B형", "AB형", "O형", "Rh+ 형"], correctAnswer: 3 },
    { text: "리보솜에서 mRNA의 코돈을 읽어 아미노산을 운반하는 RNA는?", type: "multiple", choices: ["mRNA", "tRNA", "rRNA", "snRNA", "miRNA"], correctAnswer: 1 },
    { text: "인슐린이 분비되는 곳은?", type: "multiple", choices: ["부신 피질", "갑상선", "이자의 베타 세포", "뇌하수체 전엽", "간세포"], correctAnswer: 2 },
  ];
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
// startRound — 라운드 시작 (내부 헬퍼)
// ============================================
async function startRound(battleId: string, roundIndex: number) {
  const rtdb = getDatabase();
  const now = Date.now();

  await rtdb.ref(`tekken/battles/${battleId}`).update({
    status: "question",
    currentRound: roundIndex,
    [`rounds/${roundIndex}/startedAt`]: now,
    [`rounds/${roundIndex}/timeoutAt`]: now + BATTLE_CONFIG.QUESTION_TIMEOUT,
  });
}

// ============================================
// submitAnswer — 순발력 방식 (먼저 푼 사람이 라운드 결정)
// Transaction으로 동시 답변 Race Condition 방지
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

    const rtdb = getDatabase();
    const battleRef = rtdb.ref(`tekken/battles/${battleId}`);

    // 원자적 라운드 소유권 획득 (Race Condition 방지)
    const lockRef = battleRef.child(`rounds/${roundIndex}/answeredBy`);
    const txResult = await lockRef.transaction((current) => {
      if (current !== null) return; // 이미 누가 답변 → abort
      return userId;
    });

    if (!txResult.committed) {
      throw new HttpsError("failed-precondition", "라운드가 이미 종료되었습니다.");
    }

    // 배틀 데이터 읽기 (lock 획득 후)
    const battleSnap = await battleRef.once("value");
    const battle = battleSnap.val();

    if (!battle) {
      throw new HttpsError("not-found", "배틀을 찾을 수 없습니다.");
    }

    const round = battle.rounds?.[roundIndex];
    if (!round) {
      throw new HttpsError("not-found", "라운드를 찾을 수 없습니다.");
    }

    const now = Date.now();

    // 답변 기록
    await battleRef.child(`rounds/${roundIndex}/answers/${userId}`).set({
      answer,
      answeredAt: now,
    });

    // 정답 확인
    const correctAnswerSnap = await rtdb
      .ref(`tekken/battleAnswers/${battleId}/${roundIndex}`)
      .once("value");
    const correctAnswer = correctAnswerSnap.val();
    const isCorrect = answer === correctAnswer;

    // 플레이어 정보
    const players = battle.players;
    const playerIds = Object.keys(players);
    const opponentId = playerIds.find((id) => id !== userId)!;
    const myPlayer = players[userId];
    const opponent = players[opponentId];

    const myActiveRabbit = myPlayer.rabbits[myPlayer.activeRabbitIndex];
    const opActiveRabbit = opponent.rabbits[opponent.activeRabbitIndex];

    let damage = 0;
    let isCriticalHit = false;
    let selfDamage = 0;

    if (isCorrect) {
      // 정답 → 상대에게 데미지
      const dmgResult = calcDamage(
        myActiveRabbit.atk,
        opActiveRabbit.def,
        now,
        round.startedAt
      );
      damage = dmgResult.damage;
      isCriticalHit = dmgResult.isCritical;
    } else {
      // 오답 → 범실 셀프데미지 (기본 데미지의 1.5배, 고의 오답 방지)
      selfDamage = calcSelfDamage(myActiveRabbit.atk, opActiveRabbit.def);
    }

    // 결과 기록
    await battleRef.child(`rounds/${roundIndex}/result/${userId}`).set({
      isCorrect,
      damage,
      isCritical: isCriticalHit,
      selfDamage,
    });

    // firstAnswerer 설정
    await battleRef.child(`rounds/${roundIndex}/firstAnswerer`).set(userId);

    // HP 업데이트
    if (damage > 0) {
      const newHp = Math.max(0, opActiveRabbit.currentHp - damage);
      await battleRef
        .child(`players/${opponentId}/rabbits/${opponent.activeRabbitIndex}/currentHp`)
        .set(newHp);
    }
    if (selfDamage > 0) {
      const newHp = Math.max(0, myActiveRabbit.currentHp - selfDamage);
      await battleRef
        .child(`players/${userId}/rabbits/${myPlayer.activeRabbitIndex}/currentHp`)
        .set(newHp);
    }

    // 연타 미니게임 트리거
    const mashId = `mash_${roundIndex}_${Date.now()}`;
    const mashNow = Date.now();
    await battleRef.child("mash").set({
      mashId,
      startedAt: mashNow,
      endsAt: mashNow + BATTLE_CONFIG.MASH_TIMEOUT,
      taps: {},
    });
    await battleRef.child("status").set("mash");

    return {
      isCorrect,
      damage,
      isCritical: isCriticalHit,
      selfDamage,
      mashTriggered: true,
      mashId,
    };
  }
);

// ============================================
// submitTimeout — 아무도 안 풀었을 때 타임아웃 처리
// Transaction으로 이중 호출 방지
// ============================================
export const submitTimeout = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const { battleId, roundIndex } = request.data as {
      battleId: string;
      roundIndex: number;
    };

    const rtdb = getDatabase();
    const battleRef = rtdb.ref(`tekken/battles/${battleId}`);

    // 원자적 타임아웃 소유권 획득 (이중 호출 방지)
    const lockRef = battleRef.child(`rounds/${roundIndex}/answeredBy`);
    const txResult = await lockRef.transaction((current) => {
      if (current !== null) return; // 이미 누가 처리 → abort
      return "timeout";
    });

    if (!txResult.committed) {
      return { success: false };
    }

    const battleSnap = await battleRef.once("value");
    const battle = battleSnap.val();

    if (!battle) {
      return { success: false };
    }

    // 양쪽 범실 데미지 (스탯 기반)
    const playerIds = Object.keys(battle.players);
    for (let i = 0; i < playerIds.length; i++) {
      const pid = playerIds[i];
      const opPid = playerIds[i === 0 ? 1 : 0];
      const player = battle.players[pid];
      const opPlayer = battle.players[opPid];
      const rabbit = player.rabbits[player.activeRabbitIndex];
      const opRabbit = opPlayer.rabbits[opPlayer.activeRabbitIndex];
      const sd = calcSelfDamage(rabbit.atk, opRabbit.def);
      const newHp = Math.max(0, rabbit.currentHp - sd);
      await battleRef
        .child(`players/${pid}/rabbits/${player.activeRabbitIndex}/currentHp`)
        .set(newHp);

      await battleRef.child(`rounds/${roundIndex}/result/${pid}`).set({
        isCorrect: false,
        damage: 0,
        isCritical: false,
        selfDamage: sd,
      });
    }

    // 연타 미니게임 진입
    const mashId = `mash_${roundIndex}_${Date.now()}`;
    const mashNow = Date.now();
    await battleRef.child("mash").set({
      mashId,
      startedAt: mashNow,
      endsAt: mashNow + BATTLE_CONFIG.MASH_TIMEOUT,
      taps: {},
    });
    await battleRef.child("status").set("mash");

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

  // 활성 토끼가 쓰러졌으면 교체
  for (const pid of playerIds) {
    const player = battle.players[pid];
    const activeRabbit = player.rabbits[player.activeRabbitIndex];
    if (activeRabbit.currentHp <= 0) {
      const otherIndex = player.activeRabbitIndex === 0 ? 1 : 0;
      const otherRabbit = player.rabbits[otherIndex];
      if (otherRabbit && otherRabbit.currentHp > 0) {
        await battleRef
          .child(`players/${pid}/activeRabbitIndex`)
          .set(otherIndex);
      }
    }
  }

  // 다음 라운드 or 종료 조건
  const nextRound = (battle.currentRound || 0) + 1;
  const totalRounds = battle.totalRounds || 10;

  // 문제 소진 or 시간 초과 → HP 비교
  if (nextRound >= totalRounds || Date.now() >= battle.endsAt) {
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

  // 다음 라운드 준비 — 클라이언트가 2초 후 startBattleRound 호출
  await battleRef.update({
    status: "roundResult",
    nextRound,
  });
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

  const battleSnap = await battleRef.once("value");
  const battle = battleSnap.val();

  if (battle?.result?.xpGranted === true) return;

  await battleRef.update({
    status: "finished",
    "result/winnerId": winnerId,
    "result/loserId": loserId,
    "result/isDraw": isDraw,
    "result/endReason": endReason,
    "result/xpGranted": true,
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

  await batch.commit();
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

    await battleRef.child(`mash/taps/${userId}`).set(validTaps);

    // 봇 처리
    const players = battle.players;
    const playerIds = Object.keys(players);
    const opponentId = playerIds.find((id) => id !== userId)!;
    const opponent = players[opponentId];

    if (opponent.isBot) {
      const botTaps = Math.floor(validTaps * (0.6 + Math.random() * 0.3));
      await battleRef.child(`mash/taps/${opponentId}`).set(botTaps);
    }

    // 양쪽 탭 수 확인
    const updatedSnap = await battleRef.child("mash/taps").once("value");
    const allTaps = updatedSnap.val() || {};

    // 봇이 아닌 상대의 탭이 없고 타임아웃이 아니면 대기
    const mashEndsAt = battle.mash.endsAt || 0;
    const isMashTimedOut = mashEndsAt > 0 && Date.now() >= mashEndsAt;
    if (Object.keys(allTaps).length < 2 && !opponent.isBot && !isMashTimedOut) {
      return { waiting: true };
    }

    // 원자적 연타 결과 처리 (이중 처리 방지)
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

    const myTaps = allTaps[userId] || 0;
    const opTaps = allTaps[opponentId] || 0;

    const mashWinnerId = myTaps > opTaps ? userId : myTaps < opTaps ? opponentId : userId;
    const mashLoserId = mashWinnerId === userId ? opponentId : userId;

    // 스탯 기반 연타 데미지
    const winner = players[mashWinnerId];
    const loser = players[mashLoserId];
    const winnerRabbit = winner.rabbits[winner.activeRabbitIndex];
    const loserRabbit = loser.rabbits[loser.activeRabbitIndex];
    const bonusDamage = calcBaseDamage(winnerRabbit.atk, loserRabbit.def);

    await battleRef.child("mash/result").set({ winnerId: mashWinnerId, bonusDamage });

    // 패자에게 보너스 데미지
    const loserHpSnap = await battleRef
      .child(`players/${mashLoserId}/rabbits/${loser.activeRabbitIndex}/currentHp`)
      .once("value");
    const currentLoserHp = loserHpSnap.val() ?? loserRabbit.currentHp;
    const newHp = Math.max(0, currentLoserHp - bonusDamage);
    await battleRef
      .child(`players/${mashLoserId}/rabbits/${loser.activeRabbitIndex}/currentHp`)
      .set(newHp);

    // 라운드 종료 처리
    const updatedBattle = (await battleRef.once("value")).val();
    const currentRound = updatedBattle.currentRound || 0;
    await processRoundEnd(battleId, currentRound, updatedBattle);

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
    const battleSnap = await rtdb
      .ref(`tekken/battles/${battleId}`)
      .once("value");
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

    await startRound(battleId, roundIndex);
    return { success: true };
  }
);
