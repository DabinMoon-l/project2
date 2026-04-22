// delete-post — 게시글 + 모든 댓글 삭제 (Admin 권한)
//
// 이전 CF: functions/src/board.ts::deletePost
// 권한: 작성자 또는 교수(role='professor')
// Firestore 500 배치 제한을 고려해 분할 삭제. Supabase 는 CASCADE 로 자동 comments 삭제.

import { corsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { verifyFirebaseIdToken, uidOf } from "../_shared/auth.ts";
import { getFirebaseFirestore } from "../_shared/firebaseAdmin.ts";
import { getSupabaseAdmin, DEFAULT_ORG_ID } from "../_shared/supabaseAdmin.ts";

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;

  const claims = await verifyFirebaseIdToken(req);
  const uid = claims ? uidOf(claims) : null;
  if (!uid) return json({ ok: false, error: "unauthorized" }, 401);

  const { postId } = (await req.json()) as { postId?: string };
  if (!postId) return json({ ok: false, error: "postId required" }, 400);

  const db = getFirebaseFirestore();
  const postRef = db.collection("posts").doc(postId);
  const postSnap = await postRef.get();
  if (!postSnap.exists) return json({ ok: false, error: "post not found" }, 404);

  const post = postSnap.data() as Record<string, unknown>;
  const authorId = (post.authorId ?? post.userId) as string | undefined;

  // 권한: 작성자 또는 교수
  const userSnap = await db.collection("users").doc(uid).get();
  const isProfessor = userSnap.exists && (userSnap.data() as { role?: string }).role === "professor";
  if (uid !== authorId && !isProfessor) {
    return json({ ok: false, error: "permission denied" }, 403);
  }

  // 댓글 전부 조회
  const commentsSnap = await db.collection("comments").where("postId", "==", postId).get();
  const allRefs = [...commentsSnap.docs.map((d) => d.ref), postRef];

  // 500 배치 분할
  for (let i = 0; i < allRefs.length; i += 500) {
    const batch = db.batch();
    allRefs.slice(i, i + 500).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }

  // Supabase CASCADE (posts 삭제하면 comments FK ON DELETE CASCADE 로 자동)
  const supabase = getSupabaseAdmin();
  await supabase.from("posts").delete().eq("id", postId).eq("org_id", DEFAULT_ORG_ID);

  return json({ ok: true, success: true, deletedComments: commentsSnap.size });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
