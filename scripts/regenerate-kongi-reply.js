/**
 * 콩콩이 대댓글 재생성 — 라이트 모드 (학술 공개 대댓글)
 *
 * board.ts의 generateAIReplyToComment 학술 라이트 모드 로직을 복제하여
 * 기존 콩콩이 대댓글을 삭제하고 새 라이트 모드 응답으로 교체.
 *
 * 사용법:
 *   GEMINI_API_KEY=xxx node scripts/regenerate-kongi-reply.js
 */
const admin = require("firebase-admin");
const path = require("path");

admin.initializeApp({
  credential: admin.credential.cert(
    require(path.join(__dirname, "../serviceAccountKey.json"))
  ),
});
const db = admin.firestore();

// 타겟
const POST_ID = "sGBrkcvKEWebQrUugzDY";
const ROOT_COMMENT_ID = "vJ9348KGPOvkv69mFG26"; // 콩콩이 루트 (KEEP)
const KONGI_REPLY_ID_TO_DELETE = "dtpQJEHOtJGBSono6NeY"; // 삭제할 콩콩이 대댓글 (잘린 깊이 강조 결과)

const COURSE_NAMES = {
  biology: "생물학",
  pathophysiology: "병태생리학",
  microbiology: "미생물학",
};

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("ERROR: GEMINI_API_KEY 환경변수 필요");
  process.exit(1);
}

async function main() {
  // 1. 게시물 + 부모 댓글 + 스레드 로드
  const postDoc = await db.collection("posts").doc(POST_ID).get();
  if (!postDoc.exists) {
    console.error(`게시물 없음: ${POST_ID}`);
    process.exit(1);
  }
  const post = postDoc.data();
  console.log(`[게시물] ${post.title}`);
  console.log(`  본문: ${post.content}\n`);

  const rootDoc = await db.collection("comments").doc(ROOT_COMMENT_ID).get();
  if (!rootDoc.exists) {
    console.error(`루트 댓글 없음: ${ROOT_COMMENT_ID}`);
    process.exit(1);
  }
  const rootComment = rootDoc.data();
  console.log(`[콩콩이 루트] ${rootComment.content.slice(0, 80)}...\n`);

  // 2. 콩콩이 대댓글 삭제 (먼저)
  const toDeleteDoc = await db.collection("comments").doc(KONGI_REPLY_ID_TO_DELETE).get();
  if (!toDeleteDoc.exists) {
    console.warn(`삭제 대상 콩콩이 대댓글 없음: ${KONGI_REPLY_ID_TO_DELETE} (이미 삭제됨?)`);
  } else {
    const old = toDeleteDoc.data();
    console.log(`[삭제] 콩콩이 대댓글 (${KONGI_REPLY_ID_TO_DELETE})`);
    console.log(`  이전 내용 미리보기: ${old.content.slice(0, 80)}...\n`);
    await db.collection("comments").doc(KONGI_REPLY_ID_TO_DELETE).delete();
  }

  // 3. 스레드 (현재 남은 대댓글들) 로드
  const threadSnap = await db.collection("comments")
    .where("parentId", "==", ROOT_COMMENT_ID)
    .get();
  const threadComments = threadSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => {
      const aTs = a.createdAt?.toMillis?.() || 0;
      const bTs = b.createdAt?.toMillis?.() || 0;
      return aTs - bTs;
    });

  console.log(`[남은 스레드 대댓글: ${threadComments.length}개]`);
  threadComments.forEach((c) => {
    const who = c.authorId === "gemini-ai" ? "콩콩이" : (c.authorNickname || "학생");
    console.log(`  - ${who}: ${c.content.slice(0, 60)}...`);
  });
  console.log("");

  // 4. otherCommentsContext (이 글의 다른 댓글/대댓글, 현재 스레드 제외)
  let otherCommentsContext = "";
  if (post.tag === "학술" && !post.isPrivate) {
    const allCommentsSnap = await db.collection("comments")
      .where("postId", "==", POST_ID)
      .get();
    const otherComments = allCommentsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((c) => c.id !== ROOT_COMMENT_ID)
      .filter((c) => !c.parentId || c.parentId !== ROOT_COMMENT_ID)
      .sort((a, b) => {
        const aTs = a.createdAt?.toMillis?.() || 0;
        const bTs = b.createdAt?.toMillis?.() || 0;
        return aTs - bTs;
      });
    if (otherComments.length > 0) {
      const lines = otherComments.map((c) => {
        const speaker = c.authorId === "gemini-ai" ? "콩콩이" : (c.authorNickname || "학생");
        const prefix = c.parentId ? "  (대댓글) " : "";
        return `${prefix}${speaker}: ${c.content}`;
      });
      otherCommentsContext = `\n\n[이 글의 다른 댓글/대댓글]\n${lines.join("\n\n")}`;
    }
  }

  // 5. conversationHistory
  const rootSpeaker = rootComment.authorId === "gemini-ai"
    ? "콩콩이"
    : (rootComment.authorNickname || "학생");
  let conversationHistory = `${rootSpeaker}: ${rootComment.content}`;
  for (const msg of threadComments) {
    const speaker = msg.authorId === "gemini-ai"
      ? "콩콩이"
      : (msg.authorNickname || "학생");
    conversationHistory += `\n\n${speaker}: ${msg.content}`;
  }

  // 6. courseContext (과목명만)
  const courseName = post.courseId ? COURSE_NAMES[post.courseId] || post.courseId : "";
  const courseContext = courseName
    ? `\n\n[과목 정보]\n이 대화는 "${courseName}" 과목 게시판의 글이야. 해당 과목 맥락에 맞게 답변해줘.`
    : "";

  // 7. systemPrompt — board.ts의 학술 자유 답변 모드 프롬프트 그대로
  const systemPrompt = `너는 "콩콩이"라는 이름의 수업 보조 AI야. 학생이 학술 게시판에서 추가 질문(대댓글)을 했어. 전체 대화 흐름을 이해하고, 가장 마지막 메시지에 대해 이어서 답변해줘.

[답변 모드 — 자유 답변 모드 (자료만 가벼움, 답변 깊이는 깊게)]
- "라이트"라고 해서 답변을 짧거나 얕게 하지 마. 가벼워진 건 **참고 자료의 양**(scope/퀴즈 미제공)일 뿐이야.
- 오히려 교과서 범위(scope)에 갇히지 않으니, 너의 학부 의대/약대/생명과학 수준 일반 지식을 **충분히 깊고 폭넓게** 끌어 써. 단순 정의로 끝내지 말고 메커니즘/원리/임상 의의/관련 예시까지 풀어내.
- 참고할 정보는 "이 게시글의 과목명, 제목, 본문, 그리고 이 글에 달린 다른 댓글/대댓글, 현재 대화 스레드" 정도(맥락 파악용)지만, 답변 내용 자체는 학술적으로 깊이 있게 풀어줘.

[절대 금지]
- 이모지, 이모티콘, 특수 기호 문자 절대 사용 금지. 순수 텍스트만 써.
- "후배", "선배" 같은 호칭 금지. 너는 학생의 선배가 아니라 수업 보조 AI야.
- 과하게 유치한 표현, 과한 칭찬, 과한 감탄사 금지.
- 마크다운 헤딩(#, ##, ###) 사용 금지. 강조는 **볼드**만 사용.

[콩콩이 말투]
- 20대 한국 여자 대학생이 같은 과 친구한테 설명하듯 자연스러운 반말
- ~거든, ~지, ~잖아, ~인 듯, ~해, ~같아, ~거야 같은 구어체
- 친절하되 담백하게. 과하지 않은 톤.

[플랫폼 기능 질문 처리]
- 학생이 "이 앱 어떻게 써?", "배틀 어떻게 해?", "뽑기 언제 돼?", "EXP 얼마야?" 같은 앱/플랫폼 사용법 자체를 물어볼 때만 의견게시판으로 안내해.
- 안내 방법: 공감 한마디 + "이런 건 홈 탭에 있는 의견게시판에 올려보면 교수님이나 관리자가 직접 답해줄 수 있을 거야!" + 콩콩이는 수업 내용 도우미라 앱 기능은 잘 모른다고 솔직히 말해.
- 중요: "토끼", "배틀", "랭킹" 같은 단어가 포함되더라도 수업/학술 맥락의 질문이면 반드시 학술 답변을 해줘.

[설명 방법 — 깊이가 핵심]
- **대댓글의 의미**: 학생이 대댓글로 추가 질문을 했다는 건 그 부분에 대해 **더 깊이 알고 싶다**는 신호야. 루트 답변보다 한 단계 더 깊게 들어가야 해.
- **결론 먼저**: 질문에 대한 답을 첫 1~2문장에서 바로 말해줘.
- **왜 그런지 설명**: 결론 뒤에 "왜냐면~", "이게 왜 그러냐면~" 하고 근거를 붙여.
- **메커니즘/원리까지**: 단순히 "그렇다"가 아니라 "왜 그렇게 되는지" 분자/세포/조직 수준의 메커니즘까지 풀어줘.
- **단계별 분해**: 복잡한 개념은 단계별로 쪼개서 설명해.
- **비유 적극 활용**: 어려운 개념은 일상적 비유로 풀어줘.
- **헷갈리는 개념 비교**: 비슷한 용어가 있으면 차이점을 짚어줘.
- **임상/실제 예시**: 가능하면 임상적 의의나 실제 사례(균종, 질환, 약물 작용 등)를 곁들여서 깊이를 더해.
- **교과서 용어 병기**: 중요한 용어는 한글(영문) 형태로 써줘.
- **마지막에 핵심 정리**: 설명이 길어졌으면 "정리하면:" 하고 핵심만 1~3줄로 요약해줘.

[답변 규칙]
- 한국어로 답변해
- **충분히 깊고 자세하게** 설명해. 대댓글 답변은 루트 답변보다 더 풀어내야 해. 짧게 끊거나 표면만 훑지 마.
- 단, 불필요한 서론/반복은 빼. "설명해줄게~" 같은 빈 말 대신 바로 본론으로.
- 이전 대화와 자연스럽게 이어가되, 이미 설명한 내용은 반복하지 마. 다음 깊이로 넘어가.
- 답변 마지막에 "궁금한 거 더 있으면 대댓글로 물어봐~" 같은 말로 마무리해.

[정확성]
- 너의 일반 지식으로 답하되, 비슷한 용어 구분(예: 침입/정착, 감염/발병)은 정확히 해줘. 대충 비슷한 말로 바꿔 쓰지 마.
- 학생이 틀린 전제로 질문했을 때는 "좋은 질문인데, 여기서 한 가지 짚고 가자면~" 하고 부드럽게 교정해줘.
- "~한다"(확정)와 "~할 수 있다"(가능성)를 구분해서 써.
- 확신이 없으면 "이건 교수님한테 한번 확인해보는 게 좋을 것 같아!"로 안내해. 틀린 정보보다 모른다고 말하는 게 낫다.

[최종 검증]
- 답변 작성 후 반드시 사실 관계, 수치, 용어를 한번 더 검토해. 비슷한 용어 혼동, 인과관계 오류, 너무 단정적인 표현이 없는지 점검.
- 의심스러운 부분이 있으면 단정하지 말고 "확신이 안 서는데" 식으로 표현하거나 "교수님 확인 권장"으로 마무리.${courseContext}`;

  // 8. contextText
  const contextText = `[원본 게시글]
제목: ${post.title}
본문: ${post.content}
${otherCommentsContext}

[현재 대화 스레드]
${conversationHistory}`;

  // 9. Gemini API 호출 — gemini-2.5-flash, thinkingBudget 8192 (학술)
  console.log(`[Gemini 호출 시작]`);
  console.log(`  systemPrompt 길이: ${systemPrompt.length}자`);
  console.log(`  contextText 길이: ${contextText.length}자\n`);

  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + GEMINI_API_KEY;
  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: systemPrompt + "\n\n" + contextText }],
      },
    ],
    generationConfig: {
      temperature: 0.7,
      // board.ts와 동일: 학술 대댓글은 thinkingBudget(8192) + 16384 = 24576 (넉넉히)
      maxOutputTokens: 24576,
      thinkingConfig: { thinkingBudget: 8192 },
    },
  };

  const startedAt = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const elapsed = Date.now() - startedAt;

  if (!res.ok) {
    const errText = await res.text();
    console.error(`Gemini API 오류 (${res.status}): ${errText}`);
    process.exit(1);
  }

  const data = await res.json();
  const newReplyText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!newReplyText) {
    console.error("Gemini 응답이 비어있음:", JSON.stringify(data).slice(0, 500));
    process.exit(1);
  }

  console.log(`[Gemini 응답 받음] ${elapsed}ms, ${newReplyText.length}자\n`);
  console.log("=== 새 콩콩이 대댓글 (라이트 모드) ===");
  console.log(newReplyText);
  console.log("================================\n");

  // 10. 새 댓글 저장
  const newCommentRef = await db.collection("comments").add({
    postId: POST_ID,
    parentId: ROOT_COMMENT_ID,
    authorId: "gemini-ai",
    authorNickname: "콩콩이",
    authorClassType: null,
    content: newReplyText,
    likes: 0,
    likedBy: [],
    rewarded: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`[저장 완료]`);
  console.log(`  새 댓글 ID: ${newCommentRef.id}`);
  console.log(`  postId: ${POST_ID}`);
  console.log(`  parentId: ${ROOT_COMMENT_ID}`);
}

main()
  .catch((err) => {
    console.error("실행 실패:", err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
