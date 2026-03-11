/**
 * 잘린 콩콩이 답변 찾기 + 재생성 스크립트
 *
 * 1단계: --dry-run (기본) — 잘린 답변 목록만 출력
 * 2단계: --fix — 잘린 답변 삭제 후 새 프롬프트로 재생성
 */
const admin = require("firebase-admin");
const path = require("path");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      require(path.join(__dirname, "../serviceAccountKey.json"))
    ),
  });
}
const db = admin.firestore();

const COURSE_NAMES = {
  biology: "생물학",
  pathophysiology: "병태생리학",
  microbiology: "미생물학",
};

// 답변이 잘렸는지 판단하는 휴리스틱
function isTruncated(content) {
  if (!content || content.length < 50) return false;
  const trimmed = content.trim();
  const lastChar = trimmed[trimmed.length - 1];
  // 정상 종료 문자가 아닌 경우
  const normalEndings = [".", "!", "?", "~", ")", "]", "야", "해", "지", "거든", "봐", "줘", "줄게", "다", "요"];
  const endsNormally = normalEndings.some(e => trimmed.endsWith(e));
  // 마크다운 볼드/이탈릭 중간에 잘린 경우
  const openBold = (trimmed.match(/\*\*/g) || []).length;
  const hasDanglingMarkdown = openBold % 2 !== 0;
  // 번호 매기기 중간에 잘린 경우 (마지막 줄이 번호로 시작하고 짧은 경우)
  const lines = trimmed.split("\n");
  const lastLine = lines[lines.length - 1].trim();
  const lastLineIsShortNumbered = /^\d+\./.test(lastLine) && lastLine.length < 20;

  return hasDanglingMarkdown || lastLineIsShortNumbered || (!endsNormally && /[가-힣a-zA-Z,:]$/.test(lastChar));
}

async function findTruncatedReplies() {
  // 콩콩이 루트 댓글만 (대댓글 아닌 것)
  const commentsSnap = await db.collection("comments")
    .where("authorId", "==", "gemini-ai")
    .get();

  const truncated = [];
  for (const doc of commentsSnap.docs) {
    const data = doc.data();
    // 루트 댓글만 (parentId 없는 것)
    if (data.parentId) continue;
    if (isTruncated(data.content)) {
      truncated.push({ id: doc.id, ...data });
    }
  }
  return truncated;
}

async function regenerateReply(postId, oldCommentId) {
  // 게시글 조회
  const postDoc = await db.collection("posts").doc(postId).get();
  if (!postDoc.exists) {
    console.log(`  ⚠️ 게시글 없음: ${postId}`);
    return false;
  }
  const post = postDoc.data();

  const courseName = post.courseId ? COURSE_NAMES[post.courseId] || post.courseId : "";
  const courseContext = courseName ? `\n\n[과목 정보]\n이 질문은 "${courseName}" 과목 게시판에 올라온 글이야. 해당 과목 맥락에 맞게 답변해줘.` : "";

  const systemPrompt = `너는 "콩콩이"라는 이름의 수업 보조 AI야. 학생이 학술 게시판에 올린 질문에 답변해줘.

[절대 금지]
- 이모지, 이모티콘, 특수 기호 문자 절대 사용 금지. 순수 텍스트만 써.
- "후배", "선배" 같은 호칭 금지. 너는 학생의 선배가 아니라 수업 보조 AI야.
- 과하게 유치한 표현, 과한 칭찬, 과한 감탄사 금지.

[콩콩이 말투]
- 20대 한국 여자 대학생이 같은 과 친구한테 설명하듯 자연스러운 반말
- ~거든, ~지, ~잖아, ~인 듯, ~해, ~같아, ~거야 같은 구어체
- 친절하되 담백하게. 과하지 않은 톤.

[답변 규칙]
- 한국어로 답변해
- 글의 제목, 본문, 첨부된 이미지를 모두 참고해서 답변해
- 핵심 개념과 원리를 충분히 자세하게 설명해. 예시나 비유도 적극 활용해.
- 여러 개념이 나오면 번호를 매겨서 하나씩 정리해줘.
- 불필요한 서론이나 반복은 빼되, 설명 자체는 충분히 해줘.

[답변 마무리]
- 답변의 마지막 줄에 반드시 "궁금한 게 더 있으면 대댓글로 물어봐~"라고 안내해.

[정확성 검증]
- 답변 작성 후 반드시 사실 관계, 수치, 용어를 한번 더 검토해.
- 확실하지 않은 내용은 추측하지 말고, "이건 교수님한테 한번 확인해보는 게 좋을 것 같아!"로 안내해.
- 교과서 수준의 정확한 정보만 전달해. 잘못된 정보를 주느니 모른다고 솔직하게 말하는 게 낫다.${courseContext}`;

  const userText = `제목: ${post.title}\n본문: ${post.content}`;

  const parts = [{ text: systemPrompt + "\n\n" + userText }];

  // 이미지 포함
  if (post.imageUrls && post.imageUrls.length > 0) {
    const fetch = (await import("node-fetch")).default;
    for (const imageUrl of post.imageUrls) {
      try {
        const imgResponse = await fetch(imageUrl);
        if (!imgResponse.ok) continue;
        const buffer = await imgResponse.buffer();
        const base64 = buffer.toString("base64");
        const contentType = imgResponse.headers.get("content-type") || "image/jpeg";
        parts.push({ inlineData: { mimeType: contentType, data: base64 } });
      } catch (e) {
        console.log(`  ⚠️ 이미지 fetch 실패: ${imageUrl}`);
      }
    }
  }

  // Gemini API 호출
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log("  ❌ GEMINI_API_KEY 환경변수 필요");
    return false;
  }

  const fetch = (await import("node-fetch")).default;
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          temperature: 0.5,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 8192,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.log(`  ❌ Gemini API 오류: ${response.status} — ${errorText.slice(0, 200)}`);
    return false;
  }

  const data = await response.json();
  const aiText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!aiText) {
    console.log("  ❌ Gemini 빈 응답");
    return false;
  }

  // 기존 잘린 댓글 삭제
  await db.collection("comments").doc(oldCommentId).delete();

  // 새 댓글 저장
  await db.collection("comments").add({
    postId,
    authorId: "gemini-ai",
    authorNickname: "콩콩이",
    authorClassType: null,
    content: aiText.trim(),
    imageUrls: [],
    isAnonymous: false,
    isAIReply: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`  ✅ 재생성 완료 (${aiText.trim().length}자)`);
  return true;
}

async function main() {
  const doFix = process.argv.includes("--fix");

  console.log("콩콩이 잘린 답변 검색 중...\n");
  const truncated = await findTruncatedReplies();

  if (truncated.length === 0) {
    console.log("잘린 답변이 없습니다!");
    return;
  }

  console.log(`잘린 답변 ${truncated.length}개 발견:\n`);
  for (const t of truncated) {
    const ts = t.createdAt?.toDate?.()?.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) || "?";
    const preview = t.content.slice(-80).replace(/\n/g, " ");
    console.log(`[${t.id}] postId: ${t.postId}`);
    console.log(`  작성일: ${ts}`);
    console.log(`  끝부분: ...${preview}`);

    if (doFix) {
      console.log("  → 재생성 중...");
      try {
        await regenerateReply(t.postId, t.id);
      } catch (e) {
        console.log(`  ❌ 실패: ${e.message}`);
      }
      // API rate limit 방지
      await new Promise(r => setTimeout(r, 3000));
    }
    console.log("");
  }

  if (!doFix) {
    console.log("--fix 플래그를 추가하면 재생성합니다.");
    console.log("예: GEMINI_API_KEY=xxx node scripts/fix-kongi-replies.js --fix");
  }
}

main().catch(console.error).finally(() => process.exit(0));
