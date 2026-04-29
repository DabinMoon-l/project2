// equip-rabbit — 토끼 장착 (슬롯 지정)
//
// 이전 CF: functions/src/rabbitEquip.ts::equipRabbit
//
// 입력: courseId, rabbitId, slotIndex (0|1)
// 검증: rabbitHoldings 보유 확인, 중복 장착 금지, 최대 2슬롯

import { corsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { verifyFirebaseIdToken, uidOf } from "../_shared/auth.ts";
import { getFirebaseFirestore } from "../_shared/firebaseAdmin.ts";
import { supabaseDualUpdateUserPartial } from "../_shared/rabbitDualWrite.ts";
import { FieldValue } from "npm:firebase-admin@12/firestore";

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;

  const claims = await verifyFirebaseIdToken(req);
  const userId = claims ? uidOf(claims) : null;
  if (!userId) return json({ ok: false, error: "unauthorized" }, 401);

  const { courseId, rabbitId, slotIndex } = (await req.json()) as {
    courseId?: string;
    rabbitId?: number;
    slotIndex?: number;
  };

  if (!courseId || rabbitId === undefined || slotIndex === undefined) {
    return json(
      { ok: false, error: "courseId, rabbitId, slotIndex가 필요합니다." },
      400,
    );
  }
  if (slotIndex !== 0 && slotIndex !== 1) {
    return json({ ok: false, error: "slotIndex는 0 또는 1이어야 합니다." }, 400);
  }

  const db = getFirebaseFirestore();
  const rabbitDocId = `${courseId}_${rabbitId}`;

  let newEquipped: Array<{ rabbitId: number; courseId: string }>;
  try {
    newEquipped = await db.runTransaction<
      Array<{ rabbitId: number; courseId: string }>
    >(async (tx) => {
      const userRef = db.collection("users").doc(userId);
      const holdingRef = userRef.collection("rabbitHoldings").doc(rabbitDocId);

      const [userDoc, holdingDoc] = await Promise.all([
        tx.get(userRef),
        tx.get(holdingRef),
      ]);

      if (!holdingDoc.exists) {
        throw new Error("not_owned");
      }
      if (!userDoc.exists) {
        throw new Error("user_not_found");
      }

      const userData = userDoc.data()!;
      const equippedRabbits: Array<{ rabbitId: number; courseId: string }> =
        userData.equippedRabbits || [];

      const alreadyEquipped = equippedRabbits.some(
        (e) => e.rabbitId === rabbitId && e.courseId === courseId,
      );
      if (alreadyEquipped) {
        throw new Error("already_equipped");
      }

      const built = [...equippedRabbits];
      while (built.length <= slotIndex) {
        built.push({ rabbitId: -1, courseId: "" });
      }
      built[slotIndex] = { rabbitId, courseId };

      const validEquipped = built.filter(
        (e) => e.rabbitId >= 0 && e.courseId !== "",
      );

      tx.update(userRef, {
        equippedRabbits: validEquipped,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return validEquipped;
    });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "not_owned") {
      return json({ ok: false, error: "발견하지 않은 토끼입니다." }, 404);
    }
    if (msg === "user_not_found") {
      return json({ ok: false, error: "사용자를 찾을 수 없습니다." }, 404);
    }
    if (msg === "already_equipped") {
      return json({ ok: false, error: "이미 장착 중인 토끼입니다." }, 409);
    }
    return json({ ok: false, error: msg || "transaction failed" }, 500);
  }

  supabaseDualUpdateUserPartial(userId, { equippedRabbits: newEquipped }).catch(
    (e) => console.warn("[Supabase equipRabbit dual-write]", e),
  );

  return json({ ok: true, success: true });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
