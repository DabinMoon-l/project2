import { onDocumentCreated, onDocumentDeleted, onDocumentWritten } from "firebase-functions/v2/firestore";
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
  content: string;
  likeCount?: number;
  rewarded?: boolean;
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

        addExpInTransaction(transaction, userId, expReward, reason, userDoc);
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

        addExpInTransaction(transaction, userId, expReward, reason, userDoc);
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
async function generateBoardAIReply(
  post: Post,
  postId: string,
  apiKey: string,
): Promise<void> {
  const db = getFirestore();

  // 프롬프트 구성
  const systemPrompt = `당신은 대학 수업 보조 AI입니다. 학생이 학술 게시판에 올린 글에 답변합니다.

[검토 과정]
1. 제목, 본문, 첨부 이미지를 하나의 맥락으로 통합 해석합니다
2. 질문의 핵심 의도를 파악합니다
3. 학술적으로 정확한 정보인지 검증합니다
4. 불확실한 내용은 명확히 표시합니다

[답변 규칙]
- 최대 5문장 이내로 간결하게 답변
- 한국어로 답변
- 제목·본문·이미지를 따로 보지 말고 함께 해석하여 답변
- 학술적 정확성을 우선시하되, 학생이 이해하기 쉽게 설명
- 불확실한 경우 "교수님께 확인해보시길 권합니다"로 안내`;

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
      temperature: 0.3,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 1024,
    },
  };

  // Gemini 2.5 Flash API 호출
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
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
      throw new Error("Gemini AI 답변 요청 시간 초과 (30초)");
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
