import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import {
  addGoldInTransaction,
  addExpInTransaction,
  GOLD_REWARDS,
  EXP_REWARDS,
} from "./utils/gold";
import { enforceRateLimit } from "./rateLimit";

/**
 * 게시글 문서 타입
 */
interface Post {
  userId: string;           // 작성자 ID
  userName: string;         // 작성자 이름
  userClass: string;        // 작성자 반
  boardType: "professor" | "students";  // 게시판 유형
  title: string;            // 제목
  content: string;          // 내용
  imageUrls?: string[];     // 이미지 URL 목록
  likeCount: number;        // 좋아요 수
  commentCount: number;     // 댓글 수
  rewarded?: boolean;       // 보상 지급 여부
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
}

/**
 * 댓글 문서 타입
 */
interface Comment {
  userId: string;           // 작성자 ID
  userName: string;         // 작성자 이름
  userClass: string;        // 작성자 반
  postId: string;           // 게시글 ID
  content: string;          // 내용
  likeCount: number;        // 좋아요 수
  rewarded?: boolean;       // 보상 지급 여부
  createdAt: FirebaseFirestore.Timestamp;
}

/**
 * 좋아요 문서 타입
 */
interface Like {
  userId: string;           // 좋아요 누른 사용자 ID
  targetType: "post" | "comment";  // 대상 유형
  targetId: string;         // 대상 ID
  targetUserId: string;     // 대상 작성자 ID (보상 지급용)
  rewarded?: boolean;       // 보상 지급 여부
  createdAt: FirebaseFirestore.Timestamp;
}

/**
 * 게시글 작성 시 골드/경험치 지급
 *
 * Firestore 트리거: posts/{postId} 문서 생성 시
 *
 * 보상:
 * - 골드: 10
 * - 경험치: 3
 */
export const onPostCreate = onDocumentCreated(
  "posts/{postId}",
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      console.log("게시글 문서가 없습니다.");
      return;
    }

    const post = snapshot.data() as Post;
    const postId = event.params.postId;

    // 이미 보상이 지급된 경우 스킵
    if (post.rewarded) {
      console.log(`이미 보상이 지급된 게시글입니다: ${postId}`);
      return;
    }

    const { userId, title, content } = post;

    // 필수 데이터 검증
    if (!userId || !title || !content) {
      console.error("필수 데이터가 누락되었습니다:", { userId, title });
      return;
    }

    const db = getFirestore();

    try {
      // 도배 방지 체크
      await enforceRateLimit(userId, "POST", postId);

      const goldReward = GOLD_REWARDS.POST_CREATE;
      const expReward = EXP_REWARDS.POST_CREATE;
      const reason = "게시글 작성";

      await db.runTransaction(async (transaction) => {
        // 게시글 문서에 보상 지급 플래그 설정
        transaction.update(snapshot.ref, {
          rewarded: true,
          rewardedAt: FieldValue.serverTimestamp(),
          goldRewarded: goldReward,
          expRewarded: expReward,
        });

        // 골드 지급
        await addGoldInTransaction(transaction, userId, goldReward, reason);

        // 경험치 지급
        await addExpInTransaction(transaction, userId, expReward, reason);
      });

      console.log(`게시글 보상 지급 완료: ${userId}`, {
        postId,
        goldReward,
        expReward,
      });
    } catch (error: unknown) {
      // 도배 방지에 걸린 경우
      if (error && typeof error === "object" && "code" in error &&
          (error as { code: string }).code === "resource-exhausted") {
        console.log(`도배 방지로 보상 거부: ${userId}`, postId);
        // 게시글은 이미 생성되었지만 보상은 지급하지 않음
        return;
      }
      console.error("게시글 보상 지급 실패:", error);
      throw error;
    }
  }
);

/**
 * 댓글 작성 시 골드/경험치 지급
 *
 * Firestore 트리거: posts/{postId}/comments/{commentId} 문서 생성 시
 *
 * 보상:
 * - 골드: 5
 * - 경험치: 1
 */
export const onCommentCreate = onDocumentCreated(
  "posts/{postId}/comments/{commentId}",
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      console.log("댓글 문서가 없습니다.");
      return;
    }

    const comment = snapshot.data() as Comment;
    const { postId, commentId } = event.params;

    // 이미 보상이 지급된 경우 스킵
    if (comment.rewarded) {
      console.log(`이미 보상이 지급된 댓글입니다: ${commentId}`);
      return;
    }

    const { userId, content } = comment;

    // 필수 데이터 검증
    if (!userId || !content) {
      console.error("필수 데이터가 누락되었습니다:", { userId });
      return;
    }

    const db = getFirestore();

    try {
      // 도배 방지 체크
      await enforceRateLimit(userId, "COMMENT", commentId);

      const goldReward = GOLD_REWARDS.COMMENT_CREATE;
      const expReward = EXP_REWARDS.COMMENT_CREATE;
      const reason = "댓글 작성";

      await db.runTransaction(async (transaction) => {
        // 댓글 문서에 보상 지급 플래그 설정
        transaction.update(snapshot.ref, {
          rewarded: true,
          rewardedAt: FieldValue.serverTimestamp(),
          goldRewarded: goldReward,
          expRewarded: expReward,
        });

        // 게시글의 댓글 수 증가
        const postRef = db.collection("posts").doc(postId);
        transaction.update(postRef, {
          commentCount: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        });

        // 골드 지급
        await addGoldInTransaction(transaction, userId, goldReward, reason);

        // 경험치 지급
        await addExpInTransaction(transaction, userId, expReward, reason);
      });

      console.log(`댓글 보상 지급 완료: ${userId}`, {
        postId,
        commentId,
        goldReward,
        expReward,
      });

      // 게시글 작성자에게 알림 (본인 댓글은 제외)
      const postDoc = await db.collection("posts").doc(postId).get();
      if (postDoc.exists) {
        const postData = postDoc.data() as Post;
        if (postData.userId !== userId) {
          await db.collection("notifications").add({
            userId: postData.userId,
            type: "NEW_COMMENT",
            title: "새 댓글",
            message: `내 글에 새로운 댓글이 달렸습니다.`,
            data: {
              postId,
              commentId,
            },
            read: false,
            createdAt: FieldValue.serverTimestamp(),
          });
        }
      }
    } catch (error: unknown) {
      // 도배 방지에 걸린 경우
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
 * 좋아요 받으면 골드 지급 (글/댓글 작성자에게)
 *
 * Firestore 트리거: likes/{likeId} 문서 생성 시
 *
 * 보상: 3 골드 (대상 작성자에게)
 */
export const onLikeReceived = onDocumentCreated(
  "likes/{likeId}",
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      console.log("좋아요 문서가 없습니다.");
      return;
    }

    const like = snapshot.data() as Like;
    const likeId = event.params.likeId;

    // 이미 보상이 지급된 경우 스킵
    if (like.rewarded) {
      console.log(`이미 보상이 지급된 좋아요입니다: ${likeId}`);
      return;
    }

    const { userId, targetType, targetId, targetUserId } = like;

    // 필수 데이터 검증
    if (!userId || !targetType || !targetId || !targetUserId) {
      console.error("필수 데이터가 누락되었습니다:", like);
      return;
    }

    // 자기 자신에게 좋아요는 보상 없음
    if (userId === targetUserId) {
      console.log("자기 자신에게 좋아요는 보상이 없습니다.");
      return;
    }

    const db = getFirestore();
    const goldReward = GOLD_REWARDS.LIKE_RECEIVED;
    const reason = `좋아요 받음 (${targetType === "post" ? "게시글" : "댓글"})`;

    try {
      await db.runTransaction(async (transaction) => {
        // 좋아요 문서에 보상 지급 플래그 설정
        transaction.update(snapshot.ref, {
          rewarded: true,
          rewardedAt: FieldValue.serverTimestamp(),
          goldRewarded: goldReward,
        });

        // 대상 문서의 좋아요 수 증가
        if (targetType === "post") {
          const postRef = db.collection("posts").doc(targetId);
          transaction.update(postRef, {
            likeCount: FieldValue.increment(1),
          });
        } else if (targetType === "comment") {
          // 댓글 좋아요는 postId가 필요하므로 별도 처리
          // likes 문서에 postId도 저장되어 있다고 가정
          const likeData = like as Like & { postId?: string };
          if (likeData.postId) {
            const commentRef = db
              .collection("posts")
              .doc(likeData.postId)
              .collection("comments")
              .doc(targetId);
            transaction.update(commentRef, {
              likeCount: FieldValue.increment(1),
            });
          }
        }

        // 대상 작성자에게 골드 지급
        await addGoldInTransaction(transaction, targetUserId, goldReward, reason);
      });

      console.log(`좋아요 보상 지급 완료: ${targetUserId}`, {
        likeId,
        targetType,
        targetId,
        goldReward,
      });

      // 대상 작성자에게 알림
      await db.collection("notifications").add({
        userId: targetUserId,
        type: "LIKE_RECEIVED",
        title: "좋아요",
        message: `내 ${targetType === "post" ? "글" : "댓글"}이 좋아요를 받았습니다.`,
        data: {
          likeId,
          targetType,
          targetId,
        },
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
 *
 * Firestore 트리거: likes/{likeId} 문서 삭제 시
 */
export const onLikeRemoved = onDocumentWritten(
  "likes/{likeId}",
  async (event) => {
    // 삭제된 경우만 처리
    if (event.data?.after.exists) {
      return; // 문서가 존재하면 삭제가 아님
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
        const likeData = beforeData as Like & { postId?: string };
        if (likeData.postId) {
          const commentRef = db
            .collection("posts")
            .doc(likeData.postId)
            .collection("comments")
            .doc(targetId);
          await commentRef.update({
            likeCount: FieldValue.increment(-1),
          });
        }
      }

      console.log("좋아요 취소 처리 완료:", { targetType, targetId });
    } catch (error) {
      console.error("좋아요 취소 처리 실패:", error);
    }
  }
);
