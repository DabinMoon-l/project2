// mark-announcements-read — 공지 읽음 처리
//
// 이전 CF: functions/src/announcementActions.ts::markAnnouncementsRead
// 한 번에 최대 50개. announcements/{id}.readBy 배열에 호출자 UID arrayUnion.

import { corsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { verifyFirebaseIdToken, uidOf } from "../_shared/auth.ts";
import { getFirebaseFirestore } from "../_shared/firebaseAdmin.ts";
import { FieldValue } from "npm:firebase-admin@12/firestore";

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;

  const claims = await verifyFirebaseIdToken(req);
  const uid = claims ? uidOf(claims) : null;
  if (!uid) return json({ ok: false, error: "unauthorized" }, 401);

  const { announcementIds } = (await req.json()) as { announcementIds?: unknown };
  if (!Array.isArray(announcementIds) || announcementIds.length === 0) {
    return json({ ok: false, error: "announcementIds 배열이 필요합니다." }, 400);
  }
  if (announcementIds.length > 50) {
    return json({ ok: false, error: "한 번에 최대 50개까지 처리 가능합니다." }, 400);
  }

  const db = getFirebaseFirestore();
  const batch = db.batch();
  for (const id of announcementIds) {
    if (typeof id !== "string" || !id) continue;
    batch.update(db.collection("announcements").doc(id), {
      readBy: FieldValue.arrayUnion(uid),
    });
  }
  await batch.commit();

  return json({ ok: true, success: true });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
