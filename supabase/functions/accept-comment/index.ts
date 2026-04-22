// accept-comment — 글 작성자가 댓글을 채택하고 EXP 지급
//
// 이전 CF: functions/src/board.ts::acceptComment
// Wave 1-A 의 첫 Edge 이전. dual-deploy 기간은 flag `NEXT_PUBLIC_USE_EDGE_ACCEPT_COMMENT`.
//
// 동작:
//   1. Firebase Auth ID 토큰 검증
//   2. Firestore 에서 post / comment 읽어 권한 체크 (작성자·자기댓글·AI·대댓글 금지)
//   3. Firestore 트랜잭션으로 채택 + EXP 지급 (트리거 체인 유지 위해 Firestore 쓰기 필요)
//   4. Supabase user_profiles.total_exp + exp_history insert + posts.accepted_comment_id + comments.is_accepted
//   5. notifications 컬렉션에 알림 insert

import { corsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { verifyFirebaseIdToken, uidOf } from "../_shared/auth.ts";
import { getFirebaseFirestore } from "../_shared/firebaseAdmin.ts";
import { getSupabaseAdmin, DEFAULT_ORG_ID } from "../_shared/supabaseAdmin.ts";
import { FieldValue } from "npm:firebase-admin@12/firestore";

const EXP_COMMENT_ACCEPTED = 30;

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;

  const claims = await verifyFirebaseIdToken(req);
  const uid = claims ? uidOf(claims) : null;
  if (!uid) return json({ ok: false, error: "unauthorized" }, 401);

  const { postId, commentId } = (await req.json()) as { postId?: string; commentId?: string };
  if (!postId || !commentId) {
    return json({ ok: false, error: "postId, commentId required" }, 400);
  }

  const db = getFirebaseFirestore();

  const postRef = db.collection("posts").doc(postId);
  const commentRef = db.collection("comments").doc(commentId);

  const [postSnap, commentSnap] = await Promise.all([postRef.get(), commentRef.get()]);
  if (!postSnap.exists) return json({ ok: false, error: "post not found" }, 404);
  if (!commentSnap.exists) return json({ ok: false, error: "comment not found" }, 404);

  const post = postSnap.data() as Record<string, unknown>;
  const comment = commentSnap.data() as Record<string, unknown>;
  const postAuthorId = (post.authorId ?? post.userId) as string | undefined;

  if (postAuthorId !== uid) return json({ ok: false, error: "not post author" }, 403);
  if (post.acceptedCommentId) return json({ ok: false, error: "already accepted" }, 409);
  if (comment.authorId === uid) return json({ ok: false, error: "cannot accept own comment" }, 400);
  if (comment.authorId === "gemini-ai") return json({ ok: false, error: "cannot accept AI comment" }, 400);
  if (comment.parentId) return json({ ok: false, error: "reply not acceptable" }, 400);

  const commentAuthorId = comment.authorId as string;

  // Firestore 트랜잭션: 채택 표시 + EXP 증가
  await db.runTransaction(async (tx) => {
    const userRef = db.collection("users").doc(commentAuthorId);
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) throw new Error("comment author user not found");

    tx.update(postRef, { acceptedCommentId: commentId });
    tx.update(commentRef, { isAccepted: true, acceptedAt: FieldValue.serverTimestamp() });
    tx.update(userRef, {
      totalExp: FieldValue.increment(EXP_COMMENT_ACCEPTED),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  // 알림
  await db.collection("notifications").add({
    userId: commentAuthorId,
    type: "COMMENT_ACCEPTED",
    title: "댓글 채택",
    message: "내 댓글이 채택되었습니다!",
    data: { postId, commentId },
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  });

  // Supabase dual-write
  const supabase = getSupabaseAdmin();
  await Promise.all([
    supabase.from("posts").update({ accepted_comment_id: commentId }).eq("id", postId).eq("org_id", DEFAULT_ORG_ID),
    supabase.from("comments").update({ is_accepted: true, accepted_at: new Date().toISOString() }).eq("id", commentId).eq("org_id", DEFAULT_ORG_ID),
    supabase.from("exp_history").insert({
      org_id: DEFAULT_ORG_ID,
      user_id: commentAuthorId,
      amount: EXP_COMMENT_ACCEPTED,
      reason: "comment_accepted",
      reference_id: commentId,
    }),
  ]);

  return json({ ok: true, success: true, expReward: EXP_COMMENT_ACCEPTED });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
