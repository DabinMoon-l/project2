import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { addExpInTransaction, EXP_REWARDS } from "./utils/gold";
import { enforceRateLimit } from "./rateLimit";

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
  boardType?: "professor" | "students";
  category?: string;
  title: string;
  content: string;
  imageUrls?: string[];
  likeCount?: number;
  likes?: number;
  commentCount: number;
  rewarded?: boolean;
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
        transaction.update(snapshot.ref, {
          rewarded: true,
          rewardedAt: FieldValue.serverTimestamp(),
          expRewarded: expReward,
        });

        await addExpInTransaction(transaction, userId, expReward, reason);
      });

      console.log(`게시글 보상 지급 완료: ${userId}`, { postId, expReward });
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
        transaction.update(snapshot.ref, {
          rewarded: true,
          rewardedAt: FieldValue.serverTimestamp(),
          expRewarded: expReward,
        });

        // 클라이언트에서 이미 commentCount를 증가시키므로 여기서는 하지 않음
        // const postRef = db.collection("posts").doc(postId);
        // transaction.update(postRef, {
        //   commentCount: FieldValue.increment(1),
        //   updatedAt: FieldValue.serverTimestamp(),
        // });

        await addExpInTransaction(transaction, userId, expReward, reason);
      });

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
 * 좋아요 받으면 경험치 지급 (글/댓글 작성자에게)
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

    if (like.rewarded) {
      console.log(`이미 보상이 지급된 좋아요입니다: ${likeId}`);
      return;
    }

    const { userId, targetType, targetId, targetUserId } = like;

    if (!userId || !targetType || !targetId || !targetUserId) {
      console.error("필수 데이터가 누락되었습니다", like);
      return;
    }

    // 자기 자신에게 좋아요는 보상 없음
    if (userId === targetUserId) {
      console.log("자기 자신에게 좋아요는 보상이 없습니다.");
      return;
    }

    const db = getFirestore();
    const expReward = EXP_REWARDS.LIKE_RECEIVED;
    const reason = `좋아요 받음 (${targetType === "post" ? "게시글" : "댓글"})`;

    try {
      await db.runTransaction(async (transaction) => {
        transaction.update(snapshot.ref, {
          rewarded: true,
          rewardedAt: FieldValue.serverTimestamp(),
          expRewarded: expReward,
        });

        if (targetType === "post") {
          const postRef = db.collection("posts").doc(targetId);
          transaction.update(postRef, {
            likeCount: FieldValue.increment(1),
          });
        } else if (targetType === "comment") {
          // 댓글은 comments 컬렉션에 저장됨
          const commentRef = db.collection("comments").doc(targetId);
          transaction.update(commentRef, {
            likeCount: FieldValue.increment(1),
          });
        }

        await addExpInTransaction(transaction, targetUserId, expReward, reason);
      });

      console.log(`좋아요 보상 지급 완료: ${targetUserId}`, {
        likeId,
        targetType,
        targetId,
        expReward,
      });

      // 대상 작성자에게 알림
      await db.collection("notifications").add({
        userId: targetUserId,
        type: "LIKE_RECEIVED",
        title: "좋아요",
        message: `내 ${targetType === "post" ? "글" : "댓글"}에 좋아요를 받았습니다`,
        data: { likeId, targetType, targetId },
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (error) {
      console.error("좋아요 보상 지급 실패:", error);
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

    const { targetType, targetId } = beforeData;
    const db = getFirestore();

    try {
      if (targetType === "post") {
        const postRef = db.collection("posts").doc(targetId);
        await postRef.update({
          likeCount: FieldValue.increment(-1),
        });
      } else if (targetType === "comment") {
        // 댓글은 comments 컬렉션에 저장됨
        const commentRef = db.collection("comments").doc(targetId);
        await commentRef.update({
          likeCount: FieldValue.increment(-1),
        });
      }

      console.log("좋아요 취소 처리 완료:", { targetType, targetId });
    } catch (error) {
      console.error("좋아요 취소 처리 실패:", error);
    }
  }
);
