import { onDocumentCreated, onDocumentDeleted, onDocumentWritten } from "firebase-functions/v2/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { readUserForExp, addExpInTransaction, EXP_REWARDS } from "./utils/gold";
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
  authorClassType?: string;
  boardType?: "professor" | "students";
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
