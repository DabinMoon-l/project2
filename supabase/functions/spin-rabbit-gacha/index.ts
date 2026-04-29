// spin-rabbit-gacha — 토끼 뽑기 Phase 1 (Roll)
//
// 이전 CF: functions/src/rabbitGacha.ts::spinRabbitGacha
//
// 1. pendingSpin 존재 시 이전 결과 복구 (마일스톤 손실 방지)
// 2. 마일스톤 검증 (floor(totalExp/50) > floor(lastGachaExp/50))
// 3. 미보유 토끼 풀에서 랜덤 선택
// 4. rabbit 문서 존재 여부로 undiscovered/discovered 판별
// 5. lastGachaExp += 50, pendingSpin 저장, spinLock 설정
// 6. Supabase user_profiles.last_gacha_exp 동기화

import { corsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { verifyFirebaseIdToken, uidOf } from "../_shared/auth.ts";
import { getFirebaseFirestore } from "../_shared/firebaseAdmin.ts";
import { supabaseDualUpdateUserPartial } from "../_shared/rabbitDualWrite.ts";
import { FieldValue } from "npm:firebase-admin@12/firestore";

interface RollResult {
  type: "undiscovered" | "discovered" | "owned";
  rabbitId: number;
  rabbitName: string | null;
  nextDiscoveryOrder: number | null;
  myDiscoveryOrder: number | null;
  equippedCount: number;
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;

  const claims = await verifyFirebaseIdToken(req);
  const userId = claims ? uidOf(claims) : null;
  if (!userId) return json({ ok: false, error: "unauthorized" }, 401);

  const { courseId } = (await req.json()) as { courseId?: string };
  if (!courseId) {
    return json({ ok: false, error: "courseId가 필요합니다." }, 400);
  }

  const db = getFirebaseFirestore();

  type ResultEnvelope = RollResult & { _supabaseNewLastGachaExp?: number };

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
      const equippedRabbits: Array<{ rabbitId: number; courseId: string }> =
        userData.equippedRabbits || [];

      // === 이전 pendingSpin 복구 ===
      if (userData.pendingSpin && userData.pendingSpin.courseId === courseId) {
        const psRabbitId = userData.pendingSpin.rabbitId as number;

        const holdingRef = userRef
          .collection("rabbitHoldings")
          .doc(`${courseId}_${psRabbitId}`);
        const holdingDoc = await tx.get(holdingRef);

        const psRabbitRef = db
          .collection("rabbits")
          .doc(`${courseId}_${psRabbitId}`);
        const psRabbitDoc = await tx.get(psRabbitRef);
        const psRabbitData = psRabbitDoc.exists ? psRabbitDoc.data()! : null;

        if (holdingDoc.exists) {
          return {
            type: "owned",
            rabbitId: psRabbitId,
            rabbitName: psRabbitData?.name || null,
            nextDiscoveryOrder: null,
            myDiscoveryOrder: holdingDoc.data()?.discoveryOrder || null,
            equippedCount: equippedRabbits.length,
          };
        }

        if (!psRabbitData) {
          return {
            type: "undiscovered",
            rabbitId: psRabbitId,
            rabbitName: null,
            nextDiscoveryOrder: null,
            myDiscoveryOrder: null,
            equippedCount: equippedRabbits.length,
          };
        }

        return {
          type: "discovered",
          rabbitId: psRabbitId,
          rabbitName: psRabbitData.name || null,
          nextDiscoveryOrder: (psRabbitData.discovererCount || 1) + 1,
          myDiscoveryOrder: null,
          equippedCount: equippedRabbits.length,
        };
      }

      // === 새 스핀 ===

      // 스핀 잠금 (10초 이내 중복 방지)
      if (userData.spinLock && Date.now() - userData.spinLock < 10000) {
        throw new Error("spin_in_progress");
      }

      const pendingMilestones =
        Math.floor(totalExp / 50) - Math.floor(lastGachaExp / 50);
      if (pendingMilestones <= 0) {
        throw new Error("no_milestone");
      }

      const holdingsSnap = await tx.get(userRef.collection("rabbitHoldings"));
      const ownedIds = new Set(
        holdingsSnap.docs
          .filter((d) => d.data().courseId === courseId)
          .map((d) => d.data().rabbitId as number),
      );

      const availableIds: number[] = [];
      for (let i = 0; i < 80; i++) {
        if (!ownedIds.has(i)) availableIds.push(i);
      }

      if (availableIds.length === 0) {
        throw new Error("all_discovered");
      }

      const rabbitId =
        availableIds[Math.floor(Math.random() * availableIds.length)];
      const rabbitDocId = `${courseId}_${rabbitId}`;

      const rabbitRef = db.collection("rabbits").doc(rabbitDocId);
      const rabbitDoc = await tx.get(rabbitRef);
      const rabbitData = rabbitDoc.exists ? rabbitDoc.data()! : null;

      const newLastGachaExp = lastGachaExp + 50;
      tx.update(userRef, {
        lastGachaExp: newLastGachaExp,
        spinLock: Date.now(),
        pendingSpin: { rabbitId, courseId },
        updatedAt: FieldValue.serverTimestamp(),
      });

      if (!rabbitData) {
        return {
          type: "undiscovered",
          rabbitId,
          rabbitName: null,
          nextDiscoveryOrder: null,
          myDiscoveryOrder: null,
          equippedCount: equippedRabbits.length,
          _supabaseNewLastGachaExp: newLastGachaExp,
        };
      }

      return {
        type: "discovered",
        rabbitId,
        rabbitName: rabbitData.name || null,
        nextDiscoveryOrder: (rabbitData.discovererCount || 1) + 1,
        myDiscoveryOrder: null,
        equippedCount: equippedRabbits.length,
        _supabaseNewLastGachaExp: newLastGachaExp,
      };
    });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "user_not_found") {
      return json({ ok: false, error: "사용자를 찾을 수 없습니다." }, 404);
    }
    if (msg === "spin_in_progress") {
      return json({ ok: false, error: "이미 뽑기가 진행 중입니다." }, 412);
    }
    if (msg === "no_milestone") {
      return json({ ok: false, error: "뽑기 조건을 충족하지 않습니다." }, 412);
    }
    if (msg === "all_discovered") {
      return json(
        {
          ok: false,
          error: "모든 토끼를 발견했습니다! 더 이상 뽑을 토끼가 없어요.",
        },
        412,
      );
    }
    return json({ ok: false, error: msg || "transaction failed" }, 500);
  }

  if (result._supabaseNewLastGachaExp !== undefined) {
    supabaseDualUpdateUserPartial(userId, {
      lastGachaExp: result._supabaseNewLastGachaExp,
    }).catch((e) =>
      console.warn("[Supabase spinRabbitGacha user dual-write]", e),
    );
  }

  const { _supabaseNewLastGachaExp: _unused, ...publicResult } = result;
  void _unused;
  return json(publicResult);
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
