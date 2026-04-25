// react-to-announcement — 공지 이모지 리액션 토글
//
// 이전 CF: functions/src/announcementActions.ts::reactToAnnouncement
// 호출자 UID 만 추가/제거. ALLOWED_EMOJIS 6종 화이트리스트.

import { corsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { verifyFirebaseIdToken, uidOf } from "../_shared/auth.ts";
import { getFirebaseFirestore } from "../_shared/firebaseAdmin.ts";

const ALLOWED_EMOJIS = ["❤️", "👍", "🔥", "😂", "😮", "😢"];

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;

  const claims = await verifyFirebaseIdToken(req);
  const uid = claims ? uidOf(claims) : null;
  if (!uid) return json({ ok: false, error: "unauthorized" }, 401);

  const { announcementId, emoji } = (await req.json()) as {
    announcementId?: string;
    emoji?: string;
  };

  if (!announcementId || !emoji) {
    return json({ ok: false, error: "필수 파라미터가 누락되었습니다." }, 400);
  }
  if (!ALLOWED_EMOJIS.includes(emoji)) {
    return json({ ok: false, error: "허용되지 않은 이모지입니다." }, 400);
  }

  const db = getFirebaseFirestore();
  const docRef = db.collection("announcements").doc(announcementId);

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      if (!snap.exists) {
        throw new Error("not-found");
      }

      const data = snap.data() as { reactions?: Record<string, string[]> };
      const reactions: Record<string, string[]> = { ...(data.reactions || {}) };
      const arr = reactions[emoji] || [];
      const has = arr.includes(uid);

      if (has) {
        const filtered = arr.filter((id) => id !== uid);
        if (filtered.length === 0) delete reactions[emoji];
        else reactions[emoji] = filtered;
      } else {
        reactions[emoji] = [...arr, uid];
      }

      tx.update(docRef, { reactions });
    });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "not-found") {
      return json({ ok: false, error: "공지를 찾을 수 없습니다." }, 404);
    }
    return json({ ok: false, error: msg || "transaction failed" }, 500);
  }

  return json({ ok: true, success: true });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
