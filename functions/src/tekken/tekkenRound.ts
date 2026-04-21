/**
 * 철권퀴즈 배틀 생성, 라운드 종료 처리, 배틀 종료 + XP 지급
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getDatabase } from "firebase-admin/database";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import {
  calcBattleXp,
  getTotalRemainingHp,
  BATTLE_CONFIG,
} from "../utils/tekkenDamage";
import { getBaseStats } from "../utils/rabbitStats";
import { drawQuestionsFromPool } from "../tekkenQuestionPool";
import { getEmergencyQuestions } from "./tekkenQuestions";
import type { GeneratedQuestion, PregenCache, PlayerSetup, BotPlayerSetup, BattleData, BattleRoundData, BattlePlayer } from "./tekkenTypes";
import {
  supabaseDualBatchUpsertReviews,
  type SupabaseReviewInput,
} from "../utils/supabase";

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
      const level = holdingData?.level || 1;

      return {
        rabbitId: eq.rabbitId,
        name: rabbitName || "토끼",
        discoveryOrder,
        level,
        maxHp: stats.hp,
        currentHp: stats.hp,
        atk: stats.atk,
        def: stats.def,
      };
    })
  );

  // 1마리만 장착 시 같은 토끼를 복제하여 2슬롯으로 (풀 HP 로테이션)
  if (rabbits.length === 1) {
    rabbits.push({ ...rabbits[0] });
  }

  return rabbits;
}

/**
 * 배틀 룸 생성 — 문제를 풀에서 동기적으로 뽑아 즉시 countdown 상태로 생성
 * "loading" 단계 없이 매칭 직후 바로 카운트다운 시작
 */
export async function createBattle(
  courseId: string,
  player1: PlayerSetup,
  player2: PlayerSetup,
  _apiKey: string,
  chapters?: string[]
): Promise<string> {
  const rtdb = getDatabase();
  const battleId = rtdb.ref("tekken/battles").push().key!;

  // 플레이어 스탯 + 문제 풀에서 동시에 로드
  const playerIds = [player1.userId, player2.userId];
  const humanPlayerIds = playerIds.filter((_, i) =>
    i === 0 ? !player1.isBot : !player2.isBot
  );

  const [p1Rabbits, p2Rabbits, poolQuestions] = await Promise.all([
    player1.isBot
      ? Promise.resolve((player1 as BotPlayerSetup).rabbits || [])
      : getPlayerBattleRabbits(player1.userId, player1.equippedRabbits),
    player2.isBot
      ? Promise.resolve((player2 as BotPlayerSetup).rabbits || [])
      : getPlayerBattleRabbits(player2.userId, player2.equippedRabbits),
    // 풀에서 문제 추출 (동기)
    humanPlayerIds.length > 0
      ? drawQuestionsFromPool(courseId, humanPlayerIds, 10, chapters).catch(() => null)
      : Promise.resolve(null),
  ]);

  // 풀 성공 → 풀 문제 사용, 실패 → 비상 문제 (Gemini 대기 없음)
  let questions: GeneratedQuestion[];
  if (poolQuestions && poolQuestions.length >= 5) {
    questions = poolQuestions.slice(0, 10);
    console.log(`배틀 문제 풀 사용 (${courseId}): ${questions.length}문제`);
  } else {
    // RTDB 사전 캐시 확인
    let cacheUsed = false;
    for (const pid of playerIds) {
      if ((pid === player1.userId && player1.isBot) ||
          (pid === player2.userId && player2.isBot)) continue;
      const cacheRef = rtdb.ref(`tekken/pregenQuestions/${courseId}_${pid}`);
      const cacheSnap = await cacheRef.once("value");
      const cache = cacheSnap.val() as PregenCache | null;
      // 챕터 일치 확인 (정렬 후 비교)
      const cacheChaptersKey = cache?.chapters ? [...cache.chapters].sort().join(",") : "";
      const requestChaptersKey = chapters ? [...chapters].sort().join(",") : "";
      const chaptersMatch = !chapters || cacheChaptersKey === requestChaptersKey;
      if (chaptersMatch && cache?.questions && cache.questions.length >= 5 &&
          cache.createdAt > Date.now() - 5 * 60 * 1000) {
        questions = cache.questions.slice(0, 10);
        await cacheRef.remove();
        console.log(`배틀 사전 캐시 사용 (${pid})`);
        cacheUsed = true;
        break;
      }
    }
    if (!cacheUsed) {
      const allEmergency = getEmergencyQuestions(courseId);
      // 선택 챕터 필터 적용 (chapterId에서 숫자 추출 후 비교)
      if (chapters && chapters.length > 0) {
        const chapSet = new Set(chapters);
        const filtered = allEmergency.filter(q => {
          const m = (q.chapterId || "").match(/(\d+)$/);
          return m ? chapSet.has(m[1]) : false;
        });
        questions = filtered.length >= 3 ? filtered : allEmergency;
      } else {
        questions = allEmergency;
      }
      console.warn(`배틀 비상 문제 사용 (${courseId}) — 풀/캐시 모두 실패, ${questions.length}문제`);
    }
  }

  // 라운드 데이터 구성 (chapterId에 과목 접두사 보정)
  const pfxMap: Record<string, string> = { biology: "bio_", microbiology: "micro_", pathophysiology: "patho_" };
  const coursePfx = pfxMap[courseId] || "";
  const ensurePrefix = (id: string): string => {
    if (!id) return "";
    if (coursePfx && /^\d+$/.test(id)) return `${coursePfx}${id}`;
    return id;
  };

  const rounds: Record<string, Omit<BattleRoundData, 'started' | 'result' | 'answers'>> = {};
  const battleAnswersData: Record<string, number> = {};
  for (let i = 0; i < questions!.length; i++) {
    const q = questions![i];
    const rawChId = q.chapterId || (chapters && chapters.length > 0 ? chapters[0] : "");
    rounds[i] = {
      questionData: {
        text: q.text,
        type: q.type,
        choices: q.choices,
        ...(q.explanation ? { explanation: q.explanation } : {}),
        ...(q.choiceExplanations ? { choiceExplanations: q.choiceExplanations } : {}),
        chapterId: ensurePrefix(rawChId),
      },
      startedAt: 0,
      timeoutAt: 0,
    };
    battleAnswersData[i] = q.correctAnswer;
  }

  // 즉시 countdown 상태로 배틀 생성 (loading 단계 없음)
  // ⚠️ 풀 로딩 후 fresh 타임스탬프 사용 (now는 함수 시작 시점이라 stale)
  const writeNow = Date.now();
  const battleData = {
    status: "countdown",
    courseId,
    ...(chapters ? { chapters } : {}),
    createdAt: writeNow,
    countdownStartedAt: writeNow + 1500, // 1.5초 뒤 시작 — 양쪽 클라이언트가 데이터 수신할 시간 확보
    endsAt: writeNow + BATTLE_CONFIG.BATTLE_DURATION + 5000,
    currentRound: 0,
    totalRounds: questions!.length,
    rounds,
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

  // 배틀 데이터 + 정답을 병렬로 기록
  await Promise.all([
    rtdb.ref(`tekken/battles/${battleId}`).set(battleData),
    rtdb.ref(`tekken/battleAnswers/${battleId}`).set(battleAnswersData),
  ]);

  // 남은 캐시 정리 (fire-and-forget)
  for (const pid of playerIds) {
    if ((pid === player1.userId && player1.isBot) ||
        (pid === player2.userId && player2.isBot)) continue;
    rtdb.ref(`tekken/pregenQuestions/${courseId}_${pid}`).remove().catch(() => {});
  }

  return battleId;
}


/**
 * 라운드 종료 처리 (HP 기반, 라운드 제한 없음)
 * 양쪽 동시 KO 시 무승부 처리
 */
export async function processRoundEnd(
  battleId: string,
  _roundIndex: number,
  battle: BattleData
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

  // 문제 소진 → 정답 수 비교 우선, 동점 시 HP 비교
  if (nextRound >= totalRounds) {
    const p1 = playerIds[0];
    const p2 = playerIds[1];

    // 각 플레이어의 정답 수 집계
    let p1Correct = 0;
    let p2Correct = 0;
    const rounds = battle.rounds || {};
    for (let i = 0; i < totalRounds; i++) {
      const roundResult = rounds[i]?.result;
      if (!roundResult) continue;
      if (roundResult[p1]?.isCorrect) p1Correct++;
      if (roundResult[p2]?.isCorrect) p2Correct++;
    }

    if (p1Correct > p2Correct) {
      await endBattle(battleId, p1, p2, false, "allRounds");
    } else if (p2Correct > p1Correct) {
      await endBattle(battleId, p2, p1, false, "allRounds");
    } else {
      // 정답 수 동점 → HP로 판정
      const p1Hp = getTotalRemainingHp(battle.players[p1].rabbits);
      const p2Hp = getTotalRemainingHp(battle.players[p2].rabbits);

      if (p1Hp > p2Hp) {
        await endBattle(battleId, p1, p2, false, "allRounds");
      } else if (p2Hp > p1Hp) {
        await endBattle(battleId, p2, p1, false, "allRounds");
      } else {
        await endBattle(battleId, null, null, true, "allRounds");
      }
    }
    return;
  }

  // 토끼 교체 + roundResult 전환을 단일 update로 원자적 기록
  // mash 데이터 정리 (taps/processed 등 제거, result만 보존)
  const roundEndUpdates: Record<string, unknown> = {
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

/**
 * 배틀 종료 + XP 지급
 */
export async function endBattle(
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
  const battle = battleSnap.val() as BattleData | null;

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

  // 인간 플레이어만 필터 + 연승 트랜잭션 병렬 실행
  const humanEntries = Object.entries(players as Record<string, BattlePlayer>).filter(([, p]) => !p.isBot);
  const streakResults = await Promise.all(
    humanEntries.map(async ([uid]) => {
      const isWinner = uid === winnerId;
      const streakRef = rtdb.ref(`tekken/streaks/${uid}`);
      const txResult = await streakRef.transaction((current: { currentStreak: number; lastBattleAt: number } | null) => {
        const streak = current || { currentStreak: 0, lastBattleAt: 0 };
        const newStreak = isWinner
          ? streak.currentStreak + 1
          : isDraw
            ? streak.currentStreak
            : 0;
        return { currentStreak: newStreak, lastBattleAt: Date.now() };
      });
      const newStreak = txResult.snapshot.val()?.currentStreak ?? 0;
      return { uid, isWinner, newStreak, xp: calcBattleXp(isWinner, newStreak) };
    })
  );

  // XP 기록 (RTDB 병렬) + Firestore batch 누적
  await Promise.all(
    streakResults.map(({ uid, xp }) =>
      battleRef.child(`result/xpByPlayer/${uid}`).set(xp)
    )
  );

  for (const { uid, isWinner, newStreak, xp } of streakResults) {
    const userRef = fsDb.collection("users").doc(uid);
    batch.update(userRef, {
      totalExp: FieldValue.increment(xp),
      tekkenTotal: FieldValue.increment(1),
      ...(isWinner ? { tekkenWins: FieldValue.increment(1) } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // previousExp/newExp는 FieldValue.increment 사용 시 정확한 값 알 수 없음
    // → 트리거 기반으로 기록 (실시간 조회 제거)
    const histRef = userRef.collection("expHistory").doc();
    batch.set(histRef, {
      type: "tekken_battle",
      amount: xp,
      reason: isWinner
        ? `배틀 승리 (${newStreak}연승)`
        : isDraw
          ? "배틀 무승부"
          : "배틀 패배",
      sourceId: battleId,
      sourceCollection: "tekken/battles",
      metadata: {
        isWinner,
        isDraw,
        streak: newStreak,
      },
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

  // 오답 → reviews 컬렉션 저장 (복습 오답탭 연동, fire-and-forget)
  saveBattleWrongAnswers(battleId, battle, fsDb).catch((err) => {
    console.error("배틀 오답 저장 실패 (무시):", err);
  });
}

/**
 * 배틀 오답을 reviews 컬렉션에 저장
 * 각 인간 플레이어의 틀린 문제를 reviewType: "wrong"으로 저장
 */
async function saveBattleWrongAnswers(
  battleId: string,
  battle: BattleData | null,
  db: FirebaseFirestore.Firestore
) {
  if (!battle?.rounds || !battle?.players) return;

  const rtdb = getDatabase();
  const courseId = battle.courseId || "biology";

  // 정답 데이터 로드
  const answersSnap = await rtdb.ref(`tekken/battleAnswers/${battleId}`).once("value");
  const correctAnswers = answersSnap.val() || {};

  const rounds = battle.rounds;
  const players = battle.players;
  const humanPlayerIds = Object.keys(players).filter(
    (pid) => !players[pid].isBot
  );

  if (humanPlayerIds.length === 0) return;

  // 가상 퀴즈 ID (배틀 단위로 그룹화)
  const quizId = `tekken_${battleId}`;
  const quizTitle = "철권퀴즈 배틀";

  const writeBatch = db.batch();
  let count = 0;
  const supabaseInputs: SupabaseReviewInput[] = [];

  for (const uid of humanPlayerIds) {
    for (const [roundIdxStr, round] of Object.entries(rounds)) {
      const roundData = round as BattleRoundData;
      const roundIdx = parseInt(roundIdxStr, 10);
      const correctAnswer = correctAnswers[roundIdx];
      if (correctAnswer === undefined || correctAnswer === null) continue;

      const userAnswer = roundData.answers?.[uid]?.answer;
      const isCorrect = userAnswer === correctAnswer;

      // 오답만 저장
      if (isCorrect) continue;

      const questionData = roundData.questionData;
      if (!questionData?.text || !questionData?.choices) continue;

      const reviewDoc: Record<string, unknown> = {
        userId: uid,
        quizId,
        quizTitle,
        questionId: `tekken_r${roundIdx}`,
        question: questionData.text,
        type: "multiple",
        options: questionData.choices,
        correctAnswer: String(correctAnswer),
        userAnswer: userAnswer !== undefined && userAnswer !== null ? String(userAnswer) : "",
        isCorrect: false,
        reviewType: "wrong",
        isBookmarked: false,
        reviewCount: 0,
        courseId,
        createdAt: FieldValue.serverTimestamp(),
      };

      // 해설 필드 (풀에 있으면 포함)
      if (questionData.explanation) {
        reviewDoc.explanation = questionData.explanation;
      }
      if (questionData.choiceExplanations) {
        reviewDoc.choiceExplanations = questionData.choiceExplanations;
      }
      // 챕터 태그 (미분류 방지: 배틀 챕터 폴백 + 접두사 보정)
      let chId = questionData.chapterId || "";
      if (!chId && battle.chapters && battle.chapters.length > 0) {
        chId = battle.chapters[0];
      }
      // 접두사 없으면 과목별 접두사 추가 (reviews에서 챕터 매칭에 필요)
      if (chId && /^\d+$/.test(chId)) {
        const pfxMap: Record<string, string> = { biology: "bio_", microbiology: "micro_", pathophysiology: "patho_" };
        const pfx = pfxMap[courseId] || "";
        if (pfx) chId = `${pfx}${chId}`;
      }
      if (chId) {
        reviewDoc.chapterId = chId;
      }

      const reviewRef = db.collection("reviews").doc();
      writeBatch.set(reviewRef, reviewDoc);

      // Supabase dual-write 입력 수집
      // tekken 배틀은 Supabase quizzes 에 없으므로 quiz_id = null + metadata.originalQuizId 저장
      supabaseInputs.push({
        firestoreId: reviewRef.id,
        userId: uid,
        firestoreQuizId: null,
        originalFirestoreQuizId: quizId,
        courseCode: courseId,
        questionId: `tekken_r${roundIdx}`,
        chapterId: (reviewDoc.chapterId as string | undefined) ?? null,
        reviewType: "wrong",
        isCorrect: false,
        isBookmarked: false,
        reviewCount: 0,
        questionData: {
          question: questionData.text,
          type: "multiple",
          options: questionData.choices,
          correctAnswer: String(correctAnswer),
          userAnswer: userAnswer !== undefined && userAnswer !== null ? String(userAnswer) : "",
          explanation: questionData.explanation ?? null,
          choiceExplanations: questionData.choiceExplanations ?? null,
        },
        metadata: { quizTitle, source: "tekken" },
      });
      count++;
    }
  }

  if (count > 0) {
    await writeBatch.commit();
    console.log(`[배틀 오답] ${battleId}: ${count}개 오답 → reviews 저장`);
    // Supabase 듀얼 라이트 (실패해도 Firestore 영향 없음)
    await supabaseDualBatchUpsertReviews(supabaseInputs).catch((err) => {
      console.error("[배틀 오답] Supabase dual-write 실패 (무시):", err);
    });
  }
}

// ============================================
// startBattleRound — 카운트다운 후 / roundResult 후 라운드 시작
// ============================================
export const startBattleRound = onCall(
  { region: "asia-northeast3", memory: "512MiB" },
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
