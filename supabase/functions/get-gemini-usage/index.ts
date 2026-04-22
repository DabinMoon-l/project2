// get-gemini-usage — Gemini 일일 사용량 조회
//
// 이전 CF: functions/src/gemini.ts::getGeminiUsage
// Firestore 경로:
//   geminiUsage/users (컬렉션 docs 아님) / {userId} / {YYYY-MM-DD}.count
//   geminiUsage/{YYYY-MM-DD}.count  ← 전체 합산
//
// 응답 필드명은 원본 CF 와 동일: userUsed / userLimit / userRemaining / totalUsed / totalLimit / totalRemaining
// (lib/api/types.ts 의 GeminiUsage 타입과 일치해야 함)

import { corsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { verifyFirebaseIdToken, uidOf } from "../_shared/auth.ts";
import { getFirebaseFirestore } from "../_shared/firebaseAdmin.ts";

const DAILY_USER_LIMIT = 10;
const DAILY_TOTAL_LIMIT = 1500;

function todayKst(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;

  const claims = await verifyFirebaseIdToken(req);
  const uid = claims ? uidOf(claims) : null;
  if (!uid) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const db = getFirebaseFirestore();
  const today = todayKst();

  const [userSnap, totalSnap] = await Promise.all([
    db.collection("geminiUsage").doc("users").collection(uid).doc(today).get(),
    db.collection("geminiUsage").doc(today).get(),
  ]);

  const userUsed = userSnap.exists ? (userSnap.data()?.count ?? 0) : 0;
  const totalUsed = totalSnap.exists ? (totalSnap.data()?.count ?? 0) : 0;

  return new Response(
    JSON.stringify({
      userUsed,
      userLimit: DAILY_USER_LIMIT,
      userRemaining: Math.max(0, DAILY_USER_LIMIT - userUsed),
      totalUsed,
      totalLimit: DAILY_TOTAL_LIMIT,
      totalRemaining: Math.max(0, DAILY_TOTAL_LIMIT - totalUsed),
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
