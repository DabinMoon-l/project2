/**
 * 미생물학 - 그람음성 혈청형 관련 글 찾기 (최근순 두번째)
 * + 댓글/대댓글 구조 출력
 */
const admin = require("firebase-admin");
const path = require("path");

admin.initializeApp({
  credential: admin.credential.cert(
    require(path.join(__dirname, "../serviceAccountKey.json"))
  ),
});
const db = admin.firestore();

const KEYWORDS = ["그람음성 조건무산소성막대균", "조건무산소성막대균", "혈청형"];

async function main() {
  const postsSnap = await db.collection("posts")
    .where("courseId", "==", "microbiology")
    .orderBy("createdAt", "desc")
    .limit(80)
    .get();

  const matches = [];
  for (const doc of postsSnap.docs) {
    const data = doc.data();
    const text = `${data.title || ""} ${data.content || ""}`;
    const hit = KEYWORDS.find((k) => text.includes(k));
    if (hit) {
      matches.push({ id: doc.id, data, hit });
    }
  }

  console.log(`\n[미생물학 + 그람음성/혈청형 키워드 매치 — 최근순]`);
  console.log(`매치 게시물 ${matches.length}개:\n`);
  matches.forEach((m, i) => {
    const ts = m.data.createdAt?.toDate?.()?.toISOString?.() || "?";
    console.log(`${i + 1}. [${m.id}] (${ts}) hit="${m.hit}"`);
    console.log(`   제목: ${m.data.title}`);
    console.log(`   본문: ${(m.data.content || "").slice(0, 150)}...`);
    console.log(`   tag: ${m.data.tag}, isPrivate: ${!!m.data.isPrivate}`);
    console.log("");
  });

  if (matches.length === 0) {
    console.log("매치 글 없음.");
    return;
  }

  // 사용자가 지목한 글이 1개라면 그걸 타겟으로, 여럿이면 두번째
  const target = matches.length >= 2 ? matches[1] : matches[0];
  console.log(`\n========================================`);
  console.log(`[타겟: 최근순 두번째]`);
  console.log(`postId: ${target.id}`);
  console.log(`제목: ${target.data.title}`);
  console.log(`본문 전체:\n${target.data.content}`);
  console.log(`========================================\n`);

  // 댓글 구조 조회
  const commentsSnap = await db.collection("comments")
    .where("postId", "==", target.id)
    .get();

  const comments = commentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  comments.sort((a, b) => {
    const aTs = a.createdAt?.toMillis?.() || 0;
    const bTs = b.createdAt?.toMillis?.() || 0;
    return aTs - bTs;
  });

  console.log(`[댓글 ${comments.length}개]\n`);
  for (const c of comments) {
    const isKongi = c.authorId === "gemini-ai";
    const role = isKongi ? "콩콩이" : (c.authorNickname || "학생");
    const tsStr = c.createdAt?.toDate?.()?.toISOString?.() || "?";
    const indent = c.parentId ? "    └─ (대댓글) " : "";
    console.log(`${indent}[${c.id}] ${role} (${tsStr})${isKongi ? " ★" : ""}`);
    console.log(`${indent}  parentId: ${c.parentId || "(루트)"}`);
    console.log(`${indent}  content: ${c.content.slice(0, 200)}${c.content.length > 200 ? "..." : ""}`);
    console.log("");
  }
}

main().catch(console.error).finally(() => process.exit(0));
