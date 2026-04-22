// delete-thread — 비공개 글의 루트 댓글 + 대댓글 전부 삭제
//
// 이전 CF: functions/src/board.ts::deleteThread
// 권한: 비공개 글 작성자만. 공개 글에서는 사용 금지 (permission-denied).

import { corsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { verifyFirebaseIdToken, uidOf } from "../_shared/auth.ts";
import { getFirebaseFirestore } from "../_shared/firebaseAdmin.ts";
import { getSupabaseAdmin, DEFAULT_ORG_ID } from "../_shared/supabaseAdmin.ts";
import { FieldValue } from "npm:firebase-admin@12/firestore";

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;

  const claims = await verifyFirebaseIdToken(req);
  const uid = claims ? uidOf(claims) : null;
  if (!uid) return json({ ok: false, error: "unauthorized" }, 401);

  const { rootCommentId, postId } = (await req.json()) as {
    rootCommentId?: string;
    postId?: string;
  };
  if (!rootCommentId || !postId) {
    return json({ ok: false, error: "rootCommentId, postId required" }, 400);
  }

  const db = getFirebaseFirestore();
  const postSnap = await db.collection("posts").doc(postId).get();
  if (!postSnap.exists) return json({ ok: false, error: "post not found" }, 404);

  const post = postSnap.data() as Record<string, unknown>;
  const postAuthorId = (post.authorId ?? post.userId) as string | undefined;

  if (!post.isPrivate) return json({ ok: false, error: "not a private post" }, 403);
  if (uid !== postAuthorId) return json({ ok: false, error: "not post author" }, 403);

  const rootRef = db.collection("comments").doc(rootCommentId);
  const repliesSnap = await db
    .collection("comments")
    .where("parentId", "==", rootCommentId)
    .get();

  const batch = db.batch();
  repliesSnap.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(rootRef);
  await batch.commit();

  const deletedCount = repliesSnap.size + 1;

  // commentCount 감소
  await db.collection("posts").doc(postId).update({
    commentCount: FieldValue.increment(-deletedCount),
  });

  // Supabase dual-delete
  const supabase = getSupabaseAdmin();
  const replyIds = repliesSnap.docs.map((d) => d.id);
  if (replyIds.length > 0) {
    await supabase.from("comments").delete().in("id", replyIds).eq("org_id", DEFAULT_ORG_ID);
  }
  await supabase.from("comments").delete().eq("id", rootCommentId).eq("org_id", DEFAULT_ORG_ID);
  await supabase
    .from("posts")
    .update({ comment_count: (post.commentCount as number ?? 0) - deletedCount })
    .eq("id", postId)
    .eq("org_id", DEFAULT_ORG_ID);

  return json({ ok: true, success: true, deletedCount });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
