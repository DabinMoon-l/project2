// level-up-rabbit — 토끼 레벨업 (마일스톤 1개 소비, 랜덤 스탯 분배)
//
// 이전 CF: functions/src/rabbitLevelUp.ts::levelUpRabbit
//
// 트랜잭션:
//   READ: users / rabbitHoldings/{courseId_rabbitId}
//   WRITE: holding.level/stats 갱신, user.lastGachaExp += 50, expHistory append
// Supabase: rabbit_holdings / user_profiles / exp_history dual-write

import { corsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { verifyFirebaseIdToken, uidOf } from "../_shared/auth.ts";
import { getFirebaseFirestore } from "../_shared/firebaseAdmin.ts";
import {
  supabaseDualWriteRabbitHolding,
  supabaseDualUpdateUserPartial,
  supabaseDualWriteExpHistory,
} from "../_shared/rabbitDualWrite.ts";
import { getBaseStats, generateStatIncreases } from "../_shared/rabbitStats.ts";
import { FieldValue } from "npm:firebase-admin@12/firestore";

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;

  const claims = await verifyFirebaseIdToken(req);
  const userId = claims ? uidOf(claims) : null;
  if (!userId) return json({ ok: false, error: "unauthorized" }, 401);

  const { courseId, rabbitId } = (await req.json()) as {
    courseId?: string;
    rabbitId?: number;
  };

  if (!courseId || rabbitId === undefined) {
    return json({ ok: false, error: "courseId와 rabbitId가 필요합니다." }, 400);
  }
  if (typeof rabbitId !== "number" || rabbitId < 0 || rabbitId > 79) {
    return json({ ok: false, error: "rabbitId는 0-79 범위여야 합니다." }, 400);
  }

  const db = getFirebaseFirestore();

  interface ResultEnvelope {
    newLevel: number;
    oldStats: { hp: number; atk: number; def: number };
    newStats: { hp: number; atk: number; def: number };
    statIncreases: { hp: number; atk: number; def: number };
    totalPoints: number;
    _supabase: {
      newLastGachaExp: number;
      expDocId: string;
      reason: string;
      previousExp: number;
      newExp: number;
      metadata: Record<string, unknown>;
    };
  }

  let result: ResultEnvelope;
  try {
    result = await db.runTransaction<ResultEnvelope>(async (tx) => {
      const userRef = db.collection("users").doc(userId);
      const userDoc = await tx.get(userRef);
      if (!userDoc.exists) {
        throw new Error("user_not_found");
      }

      const userData = userDoc.data()!;
      const totalExp = userData.totalExp || 0;
      const lastGachaExp = userData.lastGachaExp || 0;

      const pendingMilestones =
        Math.floor(totalExp / 50) - Math.floor(lastGachaExp / 50);
      if (pendingMilestones <= 0) {
        throw new Error("no_milestone");
      }

      const holdingId = `${courseId}_${rabbitId}`;
      const holdingRef = userRef.collection("rabbitHoldings").doc(holdingId);
      const holdingDoc = await tx.get(holdingRef);
      if (!holdingDoc.exists) {
        throw new Error("not_owned");
      }

      const holdingData = holdingDoc.data()!;
      const currentLevel = holdingData.level || 1;
      const currentStats = holdingData.stats || getBaseStats(rabbitId);

      const { increases, totalPoints } = generateStatIncreases();

      const newStats = {
        hp: currentStats.hp + increases.hp,
        atk: currentStats.atk + increases.atk,
        def: currentStats.def + increases.def,
      };
      const newLevel = currentLevel + 1;

      tx.update(holdingRef, {
        level: newLevel,
        stats: newStats,
        updatedAt: FieldValue.serverTimestamp(),
      });

      const newLastGachaExp = lastGachaExp + 50;
      tx.update(userRef, {
        lastGachaExp: newLastGachaExp,
        updatedAt: FieldValue.serverTimestamp(),
      });

      const historyRef = userRef.collection("expHistory").doc();
      const reason = `토끼 레벨업 (Lv.${currentLevel} → ${newLevel})`;
      tx.set(historyRef, {
        type: "rabbit_levelup",
        amount: 0,
        reason,
        previousExp: totalExp,
        newExp: totalExp,
        createdAt: FieldValue.serverTimestamp(),
        sourceId: holdingId,
        sourceCollection: "rabbitHoldings",
        metadata: { rabbitId, courseId, newLevel, statIncreases: increases },
      });

      return {
        newLevel,
        oldStats: currentStats,
        newStats,
        statIncreases: increases,
        totalPoints,
        _supabase: {
          newLastGachaExp,
          expDocId: historyRef.id,
          reason,
          previousExp: totalExp,
          newExp: totalExp,
          metadata: { rabbitId, courseId, newLevel, statIncreases: increases },
        },
      };
    });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "user_not_found") {
      return json({ ok: false, error: "사용자를 찾을 수 없습니다." }, 404);
    }
    if (msg === "no_milestone") {
      return json(
        { ok: false, error: "사용 가능한 마일스톤이 없습니다." },
        412,
      );
    }
    if (msg === "not_owned") {
      return json({ ok: false, error: "보유하지 않은 토끼입니다." }, 404);
    }
    return json({ ok: false, error: msg || "transaction failed" }, 500);
  }

  await Promise.all([
    supabaseDualWriteRabbitHolding(courseId, userId, rabbitId, {
      level: result.newLevel,
      stats: result.newStats,
    }),
    supabaseDualUpdateUserPartial(userId, {
      lastGachaExp: result._supabase.newLastGachaExp,
    }).catch((e) =>
      console.warn("[Supabase levelup user dual-write]", e),
    ),
    supabaseDualWriteExpHistory({
      userId,
      expDocId: result._supabase.expDocId,
      amount: 0,
      reason: result._supabase.reason,
      type: "rabbit_levelup",
      sourceId: `${courseId}_${rabbitId}`,
      sourceCollection: "rabbitHoldings",
      previousExp: result._supabase.previousExp,
      newExp: result._supabase.newExp,
      metadata: result._supabase.metadata,
    }).catch((e) =>
      console.warn("[Supabase levelup exp_history dual-write]", e),
    ),
  ]);

  const { _supabase: _u, ...publicResult } = result;
  void _u;
  return json({ ok: true, ...publicResult });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
