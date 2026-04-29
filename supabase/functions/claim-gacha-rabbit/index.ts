// claim-gacha-rabbit — 토끼 뽑기 Phase 2 (Claim)
//
// 이전 CF: functions/src/rabbitGacha.ts::claimGachaRabbit
//
// action === "pass" → pendingSpin 정리 (마일스톤은 이미 Phase 1에서 소비됨)
// action === "discover" → 트랜잭션:
//   0. pendingSpin.rabbitId === request.rabbitId 검증
//   1. 이미 보유 확인
//   2. rabbit 미존재 → 최초 발견자 등록 (이름 필수, rabbitNames 인덱스)
//      rabbit 존재 → 후속 발견자 등록
//   3. 빈 슬롯 자동 장착 (2개 미만) 또는 equipSlot 지정 교체
//   4. Supabase rabbits / rabbit_holdings / user_profiles dual-write

import { corsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { verifyFirebaseIdToken, uidOf } from "../_shared/auth.ts";
import { getFirebaseFirestore } from "../_shared/firebaseAdmin.ts";
import {
  supabaseDualWriteRabbit,
  supabaseDualWriteRabbitHolding,
  supabaseDualUpdateUserPartial,
} from "../_shared/rabbitDualWrite.ts";
import { getBaseStats } from "../_shared/rabbitStats.ts";
import { FieldValue } from "npm:firebase-admin@12/firestore";

interface ClaimResult {
  success: boolean;
  discoveryOrder: number;
  needsNaming: boolean;
  rabbitName: string | null;
}

interface RabbitUpsertPayload {
  name: string | null;
  firstDiscovererUserId?: string;
  firstDiscovererName?: string;
  discoverers: Array<{ userId: string; nickname: string; discoveryOrder: number }>;
  discovererCount: number;
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;

  const claims = await verifyFirebaseIdToken(req);
  const userId = claims ? uidOf(claims) : null;
  if (!userId) return json({ ok: false, error: "unauthorized" }, 401);

  const body = (await req.json()) as {
    courseId?: string;
    rabbitId?: number;
    action?: "discover" | "pass";
    name?: string;
    equipSlot?: number;
  };
  const { courseId, rabbitId, action, name, equipSlot } = body;

  if (!courseId || rabbitId === undefined || !action) {
    return json(
      { ok: false, error: "courseId, rabbitId, action이 필요합니다." },
      400,
    );
  }
  if (typeof rabbitId !== "number" || rabbitId < 0 || rabbitId > 79) {
    return json(
      { ok: false, error: "rabbitId는 0-79 범위여야 합니다." },
      400,
    );
  }

  const db = getFirebaseFirestore();

  // Pass — pendingSpin 정리만
  if (action === "pass") {
    await db.collection("users").doc(userId).update({
      pendingSpin: FieldValue.delete(),
      spinLock: null,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return json({ ok: true, success: true, passed: true });
  }

  const trimmedName = name?.trim();
  if (trimmedName && (trimmedName.length < 1 || trimmedName.length > 10)) {
    return json({ ok: false, error: "이름은 1-10자여야 합니다." }, 400);
  }

  const rabbitDocId = `${courseId}_${rabbitId}`;

  type ResultEnvelope = ClaimResult & {
    _supabasePayload: RabbitUpsertPayload;
    _supabaseNewEquipped: Array<{ rabbitId: number; courseId: string }> | null;
  };

  let result: ResultEnvelope;
  try {
    result = await db.runTransaction<ResultEnvelope>(async (tx) => {
      const userRef = db.collection("users").doc(userId);
      const userDoc = await tx.get(userRef);
      if (!userDoc.exists) {
        throw new Error("user_not_found");
      }

      const userData = userDoc.data()!;
      const userName = userData.nickname || "용사";

      // pendingSpin 검증
      const pendingSpin = userData.pendingSpin;
      if (
        !pendingSpin ||
        pendingSpin.rabbitId !== rabbitId ||
        pendingSpin.courseId !== courseId
      ) {
        throw new Error("invalid_spin");
      }

      // 이미 보유 확인
      const holdingRef = userRef.collection("rabbitHoldings").doc(rabbitDocId);
      const holdingDoc = await tx.get(holdingRef);
      if (holdingDoc.exists) {
        tx.update(userRef, {
          pendingSpin: FieldValue.delete(),
          spinLock: null,
          updatedAt: FieldValue.serverTimestamp(),
        });
        throw new Error("already_owned");
      }

      const rabbitRef = db.collection("rabbits").doc(rabbitDocId);
      const rabbitDoc = await tx.get(rabbitRef);
      const rabbitData = rabbitDoc.exists ? rabbitDoc.data()! : null;

      let discoveryOrder: number;
      let needsNaming = false;
      let rabbitName: string | null;
      let rabbitUpsertPayload: RabbitUpsertPayload;

      if (!rabbitData) {
        // 최초 발견자
        if (!trimmedName) {
          throw new Error("name_required");
        }

        const nameDocId = `${courseId}_${trimmedName}`;
        const nameRef = db.collection("rabbitNames").doc(nameDocId);
        const nameDoc = await tx.get(nameRef);
        if (nameDoc.exists) {
          throw new Error("name_taken");
        }

        discoveryOrder = 1;
        needsNaming = true;
        rabbitName = trimmedName;

        tx.set(nameRef, {
          courseId,
          rabbitId,
          rabbitDocId,
          createdAt: FieldValue.serverTimestamp(),
        });

        tx.set(rabbitRef, {
          courseId,
          rabbitId,
          name: trimmedName,
          firstDiscovererUserId: userId,
          firstDiscovererName: userName,
          discovererCount: 1,
          discoverers: [{ userId, nickname: userName, discoveryOrder: 1 }],
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        tx.set(holdingRef, {
          rabbitId,
          courseId,
          discoveryOrder: 1,
          discoveredAt: FieldValue.serverTimestamp(),
          level: 1,
          stats: getBaseStats(rabbitId),
        });

        rabbitUpsertPayload = {
          name: trimmedName,
          firstDiscovererUserId: userId,
          firstDiscovererName: userName,
          discoverers: [{ userId, nickname: userName, discoveryOrder: 1 }],
          discovererCount: 1,
        };
      } else {
        // 후속 발견자
        discoveryOrder = (rabbitData.discovererCount || 1) + 1;
        rabbitName = rabbitData.name || null;

        const existingDiscoverers: Array<{
          userId: string;
          nickname: string;
          discoveryOrder: number;
        }> = Array.isArray(rabbitData.discoverers) ? rabbitData.discoverers : [];
        const nextDiscoverers = [
          ...existingDiscoverers,
          { userId, nickname: userName, discoveryOrder },
        ];

        tx.update(rabbitRef, {
          discovererCount: FieldValue.increment(1),
          discoverers: FieldValue.arrayUnion({
            userId,
            nickname: userName,
            discoveryOrder,
          }),
          updatedAt: FieldValue.serverTimestamp(),
        });

        tx.set(holdingRef, {
          rabbitId,
          courseId,
          discoveryOrder,
          discoveredAt: FieldValue.serverTimestamp(),
          level: 1,
          stats: getBaseStats(rabbitId),
        });

        rabbitUpsertPayload = {
          name: rabbitName,
          discoverers: nextDiscoverers,
          discovererCount: discoveryOrder,
        };
      }

      // 장착 처리
      const equippedRabbits: Array<{ rabbitId: number; courseId: string }> =
        userData.equippedRabbits || [];

      let newEquippedForSupabase:
        | Array<{ rabbitId: number; courseId: string }>
        | null = null;

      if (equippedRabbits.length < 2) {
        const newEquipped = [...equippedRabbits, { rabbitId, courseId }];
        tx.update(userRef, {
          equippedRabbits: newEquipped,
          pendingSpin: FieldValue.delete(),
          spinLock: null,
          updatedAt: FieldValue.serverTimestamp(),
        });
        newEquippedForSupabase = newEquipped;
      } else if (
        equipSlot !== undefined &&
        (equipSlot === 0 || equipSlot === 1)
      ) {
        const newEquipped = [...equippedRabbits];
        newEquipped[equipSlot] = { rabbitId, courseId };
        tx.update(userRef, {
          equippedRabbits: newEquipped,
          pendingSpin: FieldValue.delete(),
          spinLock: null,
          updatedAt: FieldValue.serverTimestamp(),
        });
        newEquippedForSupabase = newEquipped;
      } else {
        tx.update(userRef, {
          pendingSpin: FieldValue.delete(),
          spinLock: null,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      return {
        success: true,
        discoveryOrder,
        needsNaming,
        rabbitName,
        _supabasePayload: rabbitUpsertPayload,
        _supabaseNewEquipped: newEquippedForSupabase,
      };
    });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "user_not_found") {
      return json({ ok: false, error: "사용자를 찾을 수 없습니다." }, 404);
    }
    if (msg === "invalid_spin") {
      return json(
        { ok: false, error: "유효하지 않은 뽑기입니다. 다시 뽑기해주세요." },
        412,
      );
    }
    if (msg === "already_owned") {
      return json({ ok: false, error: "이미 발견한 토끼입니다." }, 409);
    }
    if (msg === "name_required") {
      return json({ ok: false, error: "최초 발견 시 이름이 필요합니다." }, 400);
    }
    if (msg === "name_taken") {
      return json({ ok: false, error: "이미 같은 이름의 토끼가 있어요!" }, 409);
    }
    return json({ ok: false, error: msg || "transaction failed" }, 500);
  }

  // Supabase dual-write
  await Promise.all([
    supabaseDualWriteRabbit(courseId, rabbitId, result._supabasePayload),
    supabaseDualWriteRabbitHolding(courseId, userId, rabbitId, {
      level: 1,
      stats: getBaseStats(rabbitId),
      discoveryOrder: result.discoveryOrder,
      discoveredAt: new Date(),
    }),
    result._supabaseNewEquipped
      ? supabaseDualUpdateUserPartial(userId, {
        equippedRabbits: result._supabaseNewEquipped,
      }).catch((e) =>
        console.warn("[Supabase claimGachaRabbit user dual-write]", e),
      )
      : Promise.resolve(),
  ]);

  const {
    _supabasePayload: _u1,
    _supabaseNewEquipped: _u2,
    ...publicResult
  } = result;
  void _u1;
  void _u2;
  return json({ ok: true, ...publicResult });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
