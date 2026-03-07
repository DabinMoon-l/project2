import { onDocumentCreated, onDocumentDeleted, onDocumentWritten } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import fetch from "node-fetch";
import { readUserForExp, addExpInTransaction, EXP_REWARDS } from "./utils/gold";
import { enforceRateLimit } from "./rateLimit";

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

/**
 * 게시글 문서 타입
 * 클라이언트에서 authorId를 사용하므로 두 필드 모두 허용
 */
interface Post {
  userId?: string;
  authorId?: string;
  userName?: string;
  authorNickname?: string;
  userClass?: string;
  authorClassType?: string;
  boardType?: "professor" | "students";
  tag?: string;
  category?: string;
  courseId?: string;
  title: string;
  content: string;
  imageUrls?: string[];
  likeCount?: number;
  likes?: number;
  commentCount: number;
  rewarded?: boolean;
  toProfessor?: boolean; // 교수님께 전달 여부
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt?: FirebaseFirestore.Timestamp;
}

/**
 * 댓글 문서 타입
 * 클라이언트에서 authorId를 사용하므로 두 필드 모두 허용
 */
interface Comment {
  userId?: string;
  authorId?: string;
  userName?: string;
  authorNickname?: string;
  userClass?: string;
  postId: string;
  parentId?: string;
  content: string;
  imageUrls?: string[];
  likeCount?: number;
  rewarded?: boolean;
  isAIReply?: boolean;
  createdAt: FirebaseFirestore.Timestamp;
}

/**
 * 좋아요 문서 타입
 */
interface Like {
  userId: string;
  targetType: "post" | "comment";
  targetId: string;
  targetUserId: string;
  rewarded?: boolean;
  createdAt: FirebaseFirestore.Timestamp;
}

/**
 * 게시글 생성 시 경험치 지급
 */
export const onPostCreate = onDocumentCreated(
  {
    document: "posts/{postId}",
    region: "asia-northeast3",
    secrets: [GEMINI_API_KEY],
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      console.log("게시글 문서가 없습니다.");
      return;
    }

    const post = snapshot.data() as Post;
    const postId = event.params.postId;

    if (post.rewarded) {
      console.log(`이미 보상이 지급된 게시글입니다: ${postId}`);
      return;
    }

    // 클라이언트는 authorId를 사용, 레거시는 userId 사용
    const userId = post.authorId || post.userId;
    const { title, content } = post;

    if (!userId || !title || !content) {
      console.error("필수 데이터가 누락되었습니다", { userId, title });
      return;
    }

    const db = getFirestore();

    try {
      await enforceRateLimit(userId, "POST", postId);

      const expReward = EXP_REWARDS.POST_CREATE;
      const reason = "게시글 작성";

      await db.runTransaction(async (transaction) => {
        // READ 먼저
        const userDoc = await readUserForExp(transaction, userId);

        // WRITE
        transaction.update(snapshot.ref, {
          rewarded: true,
          rewardedAt: FieldValue.serverTimestamp(),
          expRewarded: expReward,
        });

        addExpInTransaction(transaction, userId, expReward, reason, userDoc, {
          type: "post_create",
          sourceId: postId,
          sourceCollection: "posts",
          metadata: { tag: post.tag || null },
        });
      });

      console.log(`게시글 보상 지급 완료: ${userId}`, { postId, expReward });

      // 학술 태그 게시글이면 Gemini AI 자동답변 생성 (교수님 글 제외)
      if (post.tag === "학술") {
        try {
          const authorDoc = await db.collection("users").doc(userId).get();
          const authorRole = authorDoc.data()?.role;

          if (authorRole !== "professor") {
            await generateBoardAIReply(post, postId, GEMINI_API_KEY.value());
          } else {
            console.log(`교수님 게시글이므로 AI 자동답변 스킵: ${postId}`);
          }
        } catch (aiError) {
          // AI 답변 실패해도 게시글 작성은 성공으로 처리
          console.error("AI 자동답변 생성 실패:", aiError);
        }
      }

      // 교수님께 전달 체크된 경우 교수님에게 알림 전송
      if (post.toProfessor && post.courseId) {
        try {
          // 해당 과목의 교수님들 조회
          const professorsSnapshot = await db.collection("users")
            .where("role", "==", "professor")
            .get();

          const authorNickname = post.authorNickname || post.userName || "학생";
          const authorClass = post.authorClassType || post.userClass || "";

          // 각 교수님에게 알림 전송
          const notificationPromises = professorsSnapshot.docs.map((profDoc) =>
            db.collection("notifications").add({
              userId: profDoc.id,
              type: "TO_PROFESSOR_POST",
              title: "📬 학생 질문",
              message: `${authorNickname}${authorClass ? `(${authorClass}반)` : ""}님이 교수님께 질문을 남겼습니다`,
              data: {
                postId,
                courseId: post.courseId,
                title: post.title,
                authorNickname,
                authorClass,
              },
              read: false,
              createdAt: FieldValue.serverTimestamp(),
            })
          );

          await Promise.all(notificationPromises);
          console.log(`교수님께 알림 전송 완료: ${postId}`, {
            professorCount: professorsSnapshot.size,
          });
        } catch (notifError) {
          // 알림 실패해도 게시글 작성은 성공으로 처리
          console.error("교수님 알림 전송 실패:", notifError);
        }
      }
    } catch (error: unknown) {
      if (error && typeof error === "object" && "code" in error &&
          (error as { code: string }).code === "resource-exhausted") {
        console.log(`도배 방지로 보상 거부: ${userId}`, postId);
        return;
      }
      console.error("게시글 보상 지급 실패:", error);
      throw error;
    }
  }
);

/**
 * 댓글 생성 시 경험치 지급
 * 클라이언트는 comments 컬렉션에 저장하므로 해당 경로를 리스닝
 */
export const onCommentCreate = onDocumentCreated(
  {
    document: "comments/{commentId}",
    region: "asia-northeast3",
    secrets: [GEMINI_API_KEY],
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      console.log("댓글 문서가 없습니다.");
      return;
    }

    const comment = snapshot.data() as Comment;
    const commentId = event.params.commentId;

    // AI 댓글은 EXP 지급 및 알림 스킵
    if (comment.authorId === "gemini-ai") {
      console.log(`AI 댓글이므로 보상/알림 스킵: ${commentId}`);
      return;
    }

    if (comment.rewarded) {
      console.log(`이미 보상이 지급된 댓글입니다: ${commentId}`);
      return;
    }

    // 클라이언트는 authorId를 사용, 레거시는 userId 사용
    const userId = comment.authorId || comment.userId;
    const { content, postId } = comment;

    if (!userId || !content || !postId) {
      console.error("필수 데이터가 누락되었습니다", { userId, postId });
      return;
    }

    const db = getFirestore();

    try {
      await enforceRateLimit(userId, "COMMENT", commentId);

      const expReward = EXP_REWARDS.COMMENT_CREATE;
      const reason = "댓글 작성";

      await db.runTransaction(async (transaction) => {
        // READ 먼저
        const userDoc = await readUserForExp(transaction, userId);

        // WRITE
        transaction.update(snapshot.ref, {
          rewarded: true,
          rewardedAt: FieldValue.serverTimestamp(),
          expRewarded: expReward,
        });

        addExpInTransaction(transaction, userId, expReward, reason, userDoc, {
          type: "comment_create",
          sourceId: commentId,
          sourceCollection: "comments",
          metadata: { postId },
        });
      });

      // 게시글의 댓글 수 서버사이드 증가
      await db.collection("posts").doc(postId).update({
        commentCount: FieldValue.increment(1),
      }).catch((e) => console.warn("commentCount 증가 실패:", e));

      console.log(`댓글 보상 지급 완료: ${userId}`, { postId, commentId, expReward });

      // 게시글 작성자에게 알림 (본인 댓글은 제외)
      const postDoc = await db.collection("posts").doc(postId).get();
      if (postDoc.exists) {
        const postData = postDoc.data() as Post;
        const postAuthorId = postData.authorId || postData.userId;
        if (postAuthorId && postAuthorId !== userId) {
          await db.collection("notifications").add({
            userId: postAuthorId,
            type: "NEW_COMMENT",
            title: "새 댓글",
            message: "내 글에 새로운 댓글이 달렸습니다",
            data: { postId, commentId },
            read: false,
            createdAt: FieldValue.serverTimestamp(),
          });
        }

        // 콩콩이 대댓글 자동 응답 트리거
        if (comment.parentId && postData.tag === "학술") {
          try {
            // 부모 댓글이 콩콩이 댓글인지 확인
            const parentDoc = await db.collection("comments").doc(comment.parentId).get();
            if (parentDoc.exists) {
              const parentComment = parentDoc.data() as Comment;
              if (parentComment.authorId === "gemini-ai") {
                // 작성자가 교수인지 확인
                const authorDoc = await db.collection("users").doc(userId).get();
                const authorRole = authorDoc.data()?.role;

                if (authorRole !== "professor") {
                  // 스팸 방지: 같은 유저가 30초 내 연속 AI 응답 트리거하는 것 방지
                  // (다른 유저는 독립적으로 응답 받을 수 있음)
                  const recentReplies = await db.collection("comments")
                    .where("parentId", "==", comment.parentId)
                    .get();

                  const thirtySecAgo = Date.now() - 30 * 1000;
                  const hasRecentAIForUser = recentReplies.docs.some((d) => {
                    const data = d.data();
                    if (data.authorId !== "gemini-ai") return false;
                    const ts = data.createdAt?.toMillis?.() || data.createdAt?._seconds * 1000 || 0;
                    if (ts <= thirtySecAgo) return false;
                    // 이 AI 댓글 직전에 같은 유저의 댓글이 있는지 확인
                    const sorted = recentReplies.docs
                      .map((r) => r.data())
                      .filter((r) => {
                        const rTs = r.createdAt?.toMillis?.() || r.createdAt?._seconds * 1000 || 0;
                        return rTs < ts && rTs > thirtySecAgo;
                      })
                      .sort((a, b) => {
                        const aTs = a.createdAt?.toMillis?.() || a.createdAt?._seconds * 1000 || 0;
                        const bTs = b.createdAt?.toMillis?.() || b.createdAt?._seconds * 1000 || 0;
                        return bTs - aTs;
                      });
                    // 직전 댓글이 같은 유저면 스팸으로 판단
                    return sorted.length > 0 && sorted[0].authorId === userId;
                  });

                  if (!hasRecentAIForUser) {
                    await generateAIReplyToComment(
                      postData,
                      postId,
                      comment.parentId,
                      comment,
                      GEMINI_API_KEY.value(),
                    );
                  } else {
                    console.log(`스팸 방지: ${userId}에 대한 30초 내 AI 대댓글 이미 존재`);
                  }
                }
              }
            }
          } catch (aiError) {
            // AI 대댓글 실패해도 댓글 작성은 성공으로 처리
            console.error("콩콩이 대댓글 자동 응답 실패:", aiError);
          }
        }
      }
    } catch (error: unknown) {
      if (error && typeof error === "object" && "code" in error &&
          (error as { code: string }).code === "resource-exhausted") {
        console.log(`도배 방지로 보상 거부: ${userId}`, commentId);
        return;
      }
      console.error("댓글 보상 지급 실패:", error);
      throw error;
    }
  }
);

/**
 * 좋아요 받으면 likeCount 증가 + 알림 (EXP 보상 없음)
 */
export const onLikeReceived = onDocumentCreated(
  {
    document: "likes/{likeId}",
    region: "asia-northeast3",
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      console.log("좋아요 문서가 없습니다.");
      return;
    }

    const like = snapshot.data() as Like;
    const likeId = event.params.likeId;

    const { userId, targetType, targetId, targetUserId } = like;

    if (!userId || !targetType || !targetId || !targetUserId) {
      console.error("필수 데이터가 누락되었습니다", like);
      return;
    }

    const db = getFirestore();

    try {
      // likeCount/likes/likedBy 증가 (EXP 지급 없음)
      if (targetType === "post") {
        const postRef = db.collection("posts").doc(targetId);
        await postRef.update({
          likeCount: FieldValue.increment(1),
          likes: FieldValue.increment(1),
          likedBy: FieldValue.arrayUnion(userId),
        });
      } else if (targetType === "comment") {
        const commentRef = db.collection("comments").doc(targetId);
        await commentRef.update({
          likeCount: FieldValue.increment(1),
          likes: FieldValue.increment(1),
          likedBy: FieldValue.arrayUnion(userId),
        });
      }

      console.log("좋아요 처리 완료:", { likeId, targetType, targetId });

      // 자기 자신에게 좋아요면 알림 미전송
      if (userId !== targetUserId) {
        await db.collection("notifications").add({
          userId: targetUserId,
          type: "LIKE_RECEIVED",
          title: "좋아요",
          message: `내 ${targetType === "post" ? "글" : "댓글"}에 좋아요를 받았습니다`,
          data: { likeId, targetType, targetId },
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
    } catch (error) {
      console.error("좋아요 처리 실패:", error);
      throw error;
    }
  }
);

/**
 * 좋아요 취소 시 좋아요 수 감소
 */
export const onLikeRemoved = onDocumentWritten(
  {
    document: "likes/{likeId}",
    region: "asia-northeast3",
  },
  async (event) => {
    // 삭제인 경우만 처리
    if (event.data?.after.exists) {
      return;
    }

    const beforeData = event.data?.before.data() as Like | undefined;
    if (!beforeData) {
      return;
    }

    const { userId, targetType, targetId } = beforeData;
    const db = getFirestore();

    try {
      if (targetType === "post") {
        const postRef = db.collection("posts").doc(targetId);
        await postRef.update({
          likeCount: FieldValue.increment(-1),
          likes: FieldValue.increment(-1),
          ...(userId ? { likedBy: FieldValue.arrayRemove(userId) } : {}),
        });
      } else if (targetType === "comment") {
        const commentRef = db.collection("comments").doc(targetId);
        await commentRef.update({
          likeCount: FieldValue.increment(-1),
          likes: FieldValue.increment(-1),
          ...(userId ? { likedBy: FieldValue.arrayRemove(userId) } : {}),
        });
      }

      console.log("좋아요 취소 처리 완료:", { targetType, targetId });
    } catch (error) {
      console.error("좋아요 취소 처리 실패:", error);
    }
  }
);

/**
 * 댓글 삭제 시 게시글 댓글 수 감소
 */
export const onCommentDeleted = onDocumentDeleted(
  {
    document: "comments/{commentId}",
    region: "asia-northeast3",
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;

    const comment = snapshot.data() as Comment;
    const { postId } = comment;

    if (!postId) return;

    const db = getFirestore();
    try {
      await db.collection("posts").doc(postId).update({
        commentCount: FieldValue.increment(-1),
      });
      console.log(`댓글 삭제 → commentCount 감소: postId=${postId}`);
    } catch (error) {
      console.error("댓글 삭제 commentCount 감소 실패:", error);
    }
  }
);

/**
 * 학술 태그 게시글에 Gemini AI 자동답변 생성
 * 이미지가 있으면 함께 인식하여 통합 답변
 */
// 과목 ID → 과목명 매핑
const COURSE_NAMES: Record<string, string> = {
  biology: "생물학",
  pathophysiology: "병태생리학",
  microbiology: "미생물학",
};

async function generateBoardAIReply(
  post: Post,
  postId: string,
  apiKey: string,
): Promise<void> {
  const db = getFirestore();

  // 과목명 확인
  const courseName = post.courseId ? COURSE_NAMES[post.courseId] || post.courseId : "";
  const courseContext = courseName ? `\n\n[과목 정보]\n이 질문은 "${courseName}" 과목 게시판에 올라온 글이야. 해당 과목 맥락에 맞게 답변해줘.` : "";

  // 프롬프트 구성
  const systemPrompt = `너는 "콩콩이"라는 이름의 수업 보조 AI야. 학생이 학술 게시판에 올린 질문에 답변해줘.

[절대 금지]
- 이모지, 이모티콘, 특수 기호 문자 절대 사용 금지. 순수 텍스트만 써.
- "후배", "선배" 같은 호칭 금지. 너는 학생의 선배가 아니라 수업 보조 AI야.
- 과하게 유치한 표현, 과한 칭찬, 과한 감탄사 금지.

[콩콩이 말투]
- 20대 한국 여자 대학생이 같은 과 친구한테 설명하듯 자연스러운 반말
- ~거든, ~지, ~잖아, ~인 듯, ~해, ~같아, ~거야 같은 구어체
- 친절하되 담백하게. 과하지 않은 톤.

[답변 구조]
- 학생이 질문에서 핵심을 잘 짚었거나 날카로운 포인트가 있다면, 그 부분을 짧게 인정해줘 (1문장, 과하지 않게)
- 그 다음 본격적으로 자세한 답변을 해줘

[답변 규칙]
- 한국어로 답변해
- 글의 제목, 본문, 첨부된 이미지를 모두 참고해서 답변해
- 학술적으로 정확하고, 핵심 개념과 원리를 자세히 설명해. 예시나 비유를 적절히 활용해줘.
- 관련된 배경 지식이나 추가로 알면 좋을 내용도 함께 알려줘

[정확성 검증]
- 답변 작성 후 반드시 사실 관계, 수치, 용어를 한번 더 검토해.
- 확실하지 않은 내용은 추측하지 말고, "이건 교수님한테 한번 확인해보는 게 좋을 것 같아!"로 안내해.
- 교과서 수준의 정확한 정보만 전달해. 잘못된 정보를 주느니 모른다고 솔직하게 말하는 게 낫다.${courseContext}`;

  const userText = `제목: ${post.title}\n본문: ${post.content}`;

  // Gemini API 요청 parts 구성
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    { text: systemPrompt + "\n\n" + userText },
  ];

  // 이미지가 있으면 base64로 변환하여 추가
  if (post.imageUrls && post.imageUrls.length > 0) {
    for (const imageUrl of post.imageUrls) {
      try {
        const imgResponse = await fetch(imageUrl);
        if (!imgResponse.ok) continue;
        const buffer = await imgResponse.buffer();
        const base64 = buffer.toString("base64");
        const contentType = imgResponse.headers.get("content-type") || "image/jpeg";
        parts.push({
          inlineData: {
            mimeType: contentType,
            data: base64,
          },
        });
      } catch (imgError) {
        console.warn("이미지 fetch 실패, 스킵:", imageUrl, imgError);
      }
    }
  }

  const requestBody = {
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.5,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 8192,
    },
  };

  // Gemini 2.5 Flash API 호출
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      }
    );
  } catch (err: unknown) {
    clearTimeout(timeout);
    if (err && typeof err === "object" && "name" in err && (err as { name: string }).name === "AbortError") {
      throw new Error("Gemini AI 답변 요청 시간 초과 (60초)");
    }
    throw err;
  }
  clearTimeout(timeout);

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Gemini AI 답변 API 오류:", response.status, errorText);
    throw new Error(`Gemini API 오류: ${response.status}`);
  }

  const data = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const aiText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!aiText) {
    console.warn("Gemini AI 답변이 비어있습니다", data);
    return;
  }

  // comments 컬렉션에 AI 댓글 저장
  await db.collection("comments").add({
    postId: postId,
    authorId: "gemini-ai",
    authorNickname: "콩콩이",
    authorClassType: null,
    content: aiText.trim(),
    imageUrls: [],
    isAnonymous: false,
    isAIReply: true,
    createdAt: FieldValue.serverTimestamp(),
  });

  // posts의 commentCount 증가
  await db.collection("posts").doc(postId).update({
    commentCount: FieldValue.increment(1),
  });

  console.log(`AI 자동답변 생성 완료: postId=${postId}`);
}

/**
 * 콩콩이 댓글에 대댓글이 달리면 전체 대화 맥락을 이해하고 대댓글로 응답
 * 여러 유저가 각각 대댓글을 달아도 각자의 대화 맥락을 유지하며 응답
 */
async function generateAIReplyToComment(
  post: Post,
  postId: string,
  parentCommentId: string,
  userReply: Comment,
  apiKey: string,
): Promise<void> {
  const db = getFirestore();

  // 루트 콩콩이 댓글 로드
  const rootDoc = await db.collection("comments").doc(parentCommentId).get();
  if (!rootDoc.exists) return;
  const rootComment = rootDoc.data() as Comment;

  // 전체 대화 스레드 로드 (같은 parentId를 가진 모든 대댓글)
  const threadSnapshot = await db.collection("comments")
    .where("parentId", "==", parentCommentId)
    .get();

  // 시간순 정렬
  const threadComments = threadSnapshot.docs
    .map((d) => d.data() as Comment)
    .sort((a, b) => {
      const aTs = a.createdAt?.toMillis?.() || (a.createdAt as unknown as { _seconds: number })?._seconds * 1000 || 0;
      const bTs = b.createdAt?.toMillis?.() || (b.createdAt as unknown as { _seconds: number })?._seconds * 1000 || 0;
      return aTs - bTs;
    });

  // 최근 20개만 사용 (너무 긴 대화 방지)
  const recentThread = threadComments.slice(-20);

  // 대화 기록 구성
  let conversationHistory = `콩콩이: ${rootComment.content}`;
  for (const msg of recentThread) {
    const speaker = msg.authorId === "gemini-ai"
      ? "콩콩이"
      : (msg.authorNickname || "학생");
    conversationHistory += `\n\n${speaker}: ${msg.content}`;
  }

  // 과목명 확인
  const courseName = post.courseId ? COURSE_NAMES[post.courseId] || post.courseId : "";
  const courseContext = courseName ? `\n\n[과목 정보]\n이 대화는 "${courseName}" 과목 게시판의 글이야. 해당 과목 맥락에 맞게 답변해줘.` : "";

  const systemPrompt = `너는 "콩콩이"라는 이름의 수업 보조 AI야. 학생들이 너의 답변에 추가 질문을 하고 있어. 전체 대화 흐름을 이해하고, 가장 마지막 메시지에 대해 이어서 답변해줘.

[절대 금지]
- 이모지, 이모티콘, 특수 기호 문자 절대 사용 금지. 순수 텍스트만 써.
- "후배", "선배" 같은 호칭 금지. 너는 학생의 선배가 아니라 수업 보조 AI야.
- 과하게 유치한 표현, 과한 칭찬, 과한 감탄사 금지.

[콩콩이 말투]
- 20대 한국 여자 대학생이 같은 과 친구한테 설명하듯 자연스러운 반말
- ~거든, ~지, ~잖아, ~인 듯, ~해, ~같아, ~거야 같은 구어체
- 친절하되 담백하게. 과하지 않은 톤.
- 이전 대화와 자연스럽게 이어지는 대화를 해. 이미 설명한 내용은 반복하지 말고 새로운 정보를 추가해.

[답변 구조]
- 학생의 추가 질문에서 핵심을 잘 짚었거나 좋은 포인트가 있다면, 짧게 인정해줘 (1문장, 과하지 않게)
- 그 다음 본격적으로 자세한 답변을 해줘

[답변 규칙]
- 한국어로 답변해
- 학술적으로 정확하고, 핵심 개념과 원리를 자세히 설명해. 예시나 비유를 적절히 활용해줘.
- 관련된 배경 지식이나 추가로 알면 좋을 내용도 함께 알려줘

[정확성 검증]
- 답변 작성 후 반드시 사실 관계, 수치, 용어를 한번 더 검토해.
- 확실하지 않은 내용은 추측하지 말고, "이건 교수님한테 한번 확인해보는 게 좋을 것 같아!"로 안내해.
- 교과서 수준의 정확한 정보만 전달해. 잘못된 정보를 주느니 모른다고 솔직하게 말하는 게 낫다.${courseContext}`;

  const contextText = `[원본 게시글]
제목: ${post.title}
본문: ${post.content}

[대화 기록]
${conversationHistory}`;

  // Gemini API 요청 parts 구성
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    { text: systemPrompt + "\n\n" + contextText },
  ];

  // 원본 게시글 이미지 추가
  if (post.imageUrls && post.imageUrls.length > 0) {
    for (const imageUrl of post.imageUrls) {
      try {
        const imgResponse = await fetch(imageUrl);
        if (!imgResponse.ok) continue;
        const buffer = await imgResponse.buffer();
        const base64 = buffer.toString("base64");
        const contentType = imgResponse.headers.get("content-type") || "image/jpeg";
        parts.push({ inlineData: { mimeType: contentType, data: base64 } });
      } catch (imgError) {
        console.warn("게시글 이미지 fetch 실패, 스킵:", imageUrl, imgError);
      }
    }
  }

  // 대댓글에 이미지가 있으면 base64로 변환하여 추가
  if (userReply.imageUrls && userReply.imageUrls.length > 0) {
    for (const imageUrl of userReply.imageUrls) {
      try {
        const imgResponse = await fetch(imageUrl);
        if (!imgResponse.ok) continue;
        const buffer = await imgResponse.buffer();
        const base64 = buffer.toString("base64");
        const contentType = imgResponse.headers.get("content-type") || "image/jpeg";
        parts.push({ inlineData: { mimeType: contentType, data: base64 } });
      } catch (imgError) {
        console.warn("대댓글 이미지 fetch 실패, 스킵:", imageUrl, imgError);
      }
    }
  }

  const requestBody = {
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.5,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 8192,
    },
  };

  // Gemini 2.5 Flash API 호출
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      }
    );
  } catch (err: unknown) {
    clearTimeout(timeout);
    if (err && typeof err === "object" && "name" in err && (err as { name: string }).name === "AbortError") {
      throw new Error("콩콩이 대댓글 요청 시간 초과 (60초)");
    }
    throw err;
  }
  clearTimeout(timeout);

  if (!response.ok) {
    const errorText = await response.text();
    console.error("콩콩이 대댓글 API 오류:", response.status, errorText);
    throw new Error(`Gemini API 오류: ${response.status}`);
  }

  const data = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const aiText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!aiText) {
    console.warn("콩콩이 대댓글이 비어있습니다", data);
    return;
  }

  // 콩콩이 원본 댓글 아래 대댓글로 저장
  await db.collection("comments").add({
    postId: postId,
    parentId: parentCommentId,
    authorId: "gemini-ai",
    authorNickname: "콩콩이",
    authorClassType: null,
    content: aiText.trim(),
    imageUrls: [],
    isAnonymous: false,
    isAIReply: true,
    createdAt: FieldValue.serverTimestamp(),
  });

  // posts의 commentCount 증가
  await db.collection("posts").doc(postId).update({
    commentCount: FieldValue.increment(1),
  });

  console.log(`콩콩이 대댓글 생성 완료: postId=${postId}, parentId=${parentCommentId}, thread=${recentThread.length}개`);
}

/**
 * 댓글 채택 (글 작성자만 호출 가능)
 * - 글당 1개 댓글만 채택 가능
 * - 채택 시 댓글 작성자에게 추가 EXP 지급
 */
export const acceptComment = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const { postId, commentId } = request.data as {
      postId?: string;
      commentId?: string;
    };

    if (!postId || !commentId) {
      throw new HttpsError("invalid-argument", "postId와 commentId가 필요합니다.");
    }

    const uid = request.auth.uid;
    const db = getFirestore();

    // 게시글 조회 + 작성자 확인
    const postDoc = await db.collection("posts").doc(postId).get();
    if (!postDoc.exists) {
      throw new HttpsError("not-found", "게시글을 찾을 수 없습니다.");
    }
    const postData = postDoc.data()!;
    const postAuthorId = postData.authorId || postData.userId;

    if (postAuthorId !== uid) {
      throw new HttpsError("permission-denied", "글 작성자만 댓글을 채택할 수 있습니다.");
    }

    // 이미 채택된 댓글이 있는지 확인
    if (postData.acceptedCommentId) {
      throw new HttpsError("already-exists", "이미 채택된 댓글이 있습니다.");
    }

    // 댓글 조회
    const commentDoc = await db.collection("comments").doc(commentId).get();
    if (!commentDoc.exists) {
      throw new HttpsError("not-found", "댓글을 찾을 수 없습니다.");
    }
    const commentData = commentDoc.data()!;

    // 자기 댓글 채택 방지
    if (commentData.authorId === uid) {
      throw new HttpsError("invalid-argument", "본인의 댓글은 채택할 수 없습니다.");
    }

    // AI 댓글 채택 방지
    if (commentData.authorId === "gemini-ai") {
      throw new HttpsError("invalid-argument", "AI 댓글은 채택할 수 없습니다.");
    }

    // 대댓글 채택 방지 (루트 댓글만 채택 가능)
    if (commentData.parentId) {
      throw new HttpsError("invalid-argument", "대댓글은 채택할 수 없습니다.");
    }

    const commentAuthorId = commentData.authorId;
    const expReward = EXP_REWARDS.COMMENT_ACCEPTED;

    // 트랜잭션으로 채택 처리 + EXP 지급
    await db.runTransaction(async (transaction) => {
      const userDoc = await readUserForExp(transaction, commentAuthorId);

      // 게시글에 채택 댓글 ID 저장
      transaction.update(postDoc.ref, {
        acceptedCommentId: commentId,
      });

      // 댓글에 채택 표시
      transaction.update(commentDoc.ref, {
        isAccepted: true,
        acceptedAt: FieldValue.serverTimestamp(),
      });

      // 댓글 작성자에게 EXP 지급
      addExpInTransaction(transaction, commentAuthorId, expReward, "댓글 채택", userDoc, {
        type: "comment_accepted",
        sourceId: commentId,
        sourceCollection: "comments",
        metadata: { postId },
      });
    });

    // 댓글 작성자에게 알림
    await db.collection("notifications").add({
      userId: commentAuthorId,
      type: "COMMENT_ACCEPTED",
      title: "댓글 채택",
      message: "내 댓글이 채택되었습니다!",
      data: { postId, commentId },
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });

    console.log(`댓글 채택 완료: postId=${postId}, commentId=${commentId}, author=${commentAuthorId}`);

    return { success: true, expReward };
  }
);

// ============================================================
// 게시글 삭제 (Admin SDK로 댓글까지 원자적 삭제)
// ============================================================

/**
 * 게시글 삭제 CF
 * 클라이언트에서 댓글을 직접 삭제하면 타인 댓글에 대한 권한이 없어 실패하므로
 * Admin SDK로 글 + 모든 댓글을 서버에서 삭제
 */
export const deletePost = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const { postId } = request.data as { postId: string };
    if (!postId) {
      throw new HttpsError("invalid-argument", "postId가 필요합니다.");
    }

    const db = getFirestore();
    const postRef = db.collection("posts").doc(postId);
    const postSnap = await postRef.get();

    if (!postSnap.exists) {
      throw new HttpsError("not-found", "글을 찾을 수 없습니다.");
    }

    const postData = postSnap.data()!;
    const authorId = postData.authorId || postData.userId;

    // 권한 확인: 작성자 또는 교수님
    const userDoc = await db.collection("users").doc(request.auth.uid).get();
    const isProfessor = userDoc.exists && userDoc.data()?.role === "professor";

    if (request.auth.uid !== authorId && !isProfessor) {
      throw new HttpsError("permission-denied", "삭제 권한이 없습니다.");
    }

    // 해당 글의 모든 댓글 조회
    const commentsSnap = await db
      .collection("comments")
      .where("postId", "==", postId)
      .get();

    // 글 + 댓글 배치 삭제 (500건 제한 분할)
    const allRefs = [...commentsSnap.docs.map(d => d.ref), postRef];
    for (let i = 0; i < allRefs.length; i += 500) {
      const batch = db.batch();
      allRefs.slice(i, i + 500).forEach(ref => batch.delete(ref));
      await batch.commit();
    }

    console.log(`게시글 삭제 완료: postId=${postId}, 댓글 ${commentsSnap.size}개 포함`);
    return { success: true, deletedComments: commentsSnap.size };
  }
);
