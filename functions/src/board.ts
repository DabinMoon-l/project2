import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import {
  addExpInTransaction,
  addExpInTransaction,
  EXP_REWARDS,
  EXP_REWARDS,
} from "./utils/gold";
import { enforceRateLimit } from "./rateLimit";

/**
 * ê²Œì‹œê¸€ ë¬¸ì„œ ?€?? */
interface Post {
  userId: string;           // ?‘ì„±??ID
  userName: string;         // ?‘ì„±???´ë¦„
  userClass: string;        // ?‘ì„±??ë°?  boardType: "professor" | "students";  // ê²Œì‹œ??? í˜•
  title: string;            // ?œëª©
  content: string;          // ?´ìš©
  imageUrls?: string[];     // ?´ë?ì§€ URL ëª©ë¡
  likeCount: number;        // ì¢‹ì•„????  commentCount: number;     // ?“ê? ??  rewarded?: boolean;       // ë³´ìƒ ì§€ê¸??¬ë?
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
}

/**
 * ?“ê? ë¬¸ì„œ ?€?? */
interface Comment {
  userId: string;           // ?‘ì„±??ID
  userName: string;         // ?‘ì„±???´ë¦„
  userClass: string;        // ?‘ì„±??ë°?  postId: string;           // ê²Œì‹œê¸€ ID
  content: string;          // ?´ìš©
  likeCount: number;        // ì¢‹ì•„????  rewarded?: boolean;       // ë³´ìƒ ì§€ê¸??¬ë?
  createdAt: FirebaseFirestore.Timestamp;
}

/**
 * ì¢‹ì•„??ë¬¸ì„œ ?€?? */
interface Like {
  userId: string;           // ì¢‹ì•„???„ë¥¸ ?¬ìš©??ID
  targetType: "post" | "comment";  // ?€??? í˜•
  targetId: string;         // ?€??ID
  targetUserId: string;     // ?€???‘ì„±??ID (ë³´ìƒ ì§€ê¸‰ìš©)
  rewarded?: boolean;       // ë³´ìƒ ì§€ê¸??¬ë?
  createdAt: FirebaseFirestore.Timestamp;
}

/**
 * ê²Œì‹œê¸€ ?‘ì„± ??ê³¨ë“œ/ê²½í—˜ì¹?ì§€ê¸? *
 * Firestore ?¸ë¦¬ê±? posts/{postId} ë¬¸ì„œ ?ì„± ?? *
 * ë³´ìƒ:
 * - ê³¨ë“œ: 10
 * - ê²½í—˜ì¹? 3
 */
export const onPostCreate = onDocumentCreated(
  "posts/{postId}",
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      console.log("ê²Œì‹œê¸€ ë¬¸ì„œê°€ ?†ìŠµ?ˆë‹¤.");
      return;
    }

    const post = snapshot.data() as Post;
    const postId = event.params.postId;

    // ?´ë? ë³´ìƒ??ì§€ê¸‰ëœ ê²½ìš° ?¤í‚µ
    if (post.rewarded) {
      console.log(`?´ë? ë³´ìƒ??ì§€ê¸‰ëœ ê²Œì‹œê¸€?…ë‹ˆ?? ${postId}`);
      return;
    }

    const { userId, title, content } = post;

    // ?„ìˆ˜ ?°ì´??ê²€ì¦?    if (!userId || !title || !content) {
      console.error("?„ìˆ˜ ?°ì´?°ê? ?„ë½?˜ì—ˆ?µë‹ˆ??", { userId, title });
      return;
    }

    const db = getFirestore();

    try {
      // ?„ë°° ë°©ì? ì²´í¬
      await enforceRateLimit(userId, "POST", postId);

      const expReward = EXP_REWARDS.POST_CREATE;
      const expReward = EXP_REWARDS.POST_CREATE;
      const reason = "ê²Œì‹œê¸€ ?‘ì„±";

      await db.runTransaction(async (transaction) => {
        // ê²Œì‹œê¸€ ë¬¸ì„œ??ë³´ìƒ ì§€ê¸??Œëž˜ê·??¤ì •
        transaction.update(snapshot.ref, {
          rewarded: true,
          rewardedAt: FieldValue.serverTimestamp(),
          expRewarded: expReward,
          expRewarded: expReward,
        });

        // ê³¨ë“œ ì§€ê¸?        await addExpInTransaction(transaction, userId, expReward, reason);

        // ê²½í—˜ì¹?ì§€ê¸?        await addExpInTransaction(transaction, userId, expReward, reason);
      });

      console.log(`ê²Œì‹œê¸€ ë³´ìƒ ì§€ê¸??„ë£Œ: ${userId}`, {
        postId,
        expReward,
        expReward,
      });
    } catch (error: unknown) {
      // ?„ë°° ë°©ì???ê±¸ë¦° ê²½ìš°
      if (error && typeof error === "object" && "code" in error &&
          (error as { code: string }).code === "resource-exhausted") {
        console.log(`?„ë°° ë°©ì?ë¡?ë³´ìƒ ê±°ë?: ${userId}`, postId);
        // ê²Œì‹œê¸€?€ ?´ë? ?ì„±?˜ì—ˆì§€ë§?ë³´ìƒ?€ ì§€ê¸‰í•˜ì§€ ?ŠìŒ
        return;
      }
      console.error("ê²Œì‹œê¸€ ë³´ìƒ ì§€ê¸??¤íŒ¨:", error);
      throw error;
    }
  }
);

/**
 * ?“ê? ?‘ì„± ??ê³¨ë“œ/ê²½í—˜ì¹?ì§€ê¸? *
 * Firestore ?¸ë¦¬ê±? posts/{postId}/comments/{commentId} ë¬¸ì„œ ?ì„± ?? *
 * ë³´ìƒ:
 * - ê³¨ë“œ: 5
 * - ê²½í—˜ì¹? 1
 */
export const onCommentCreate = onDocumentCreated(
  "posts/{postId}/comments/{commentId}",
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      console.log("?“ê? ë¬¸ì„œê°€ ?†ìŠµ?ˆë‹¤.");
      return;
    }

    const comment = snapshot.data() as Comment;
    const { postId, commentId } = event.params;

    // ?´ë? ë³´ìƒ??ì§€ê¸‰ëœ ê²½ìš° ?¤í‚µ
    if (comment.rewarded) {
      console.log(`?´ë? ë³´ìƒ??ì§€ê¸‰ëœ ?“ê??…ë‹ˆ?? ${commentId}`);
      return;
    }

    const { userId, content } = comment;

    // ?„ìˆ˜ ?°ì´??ê²€ì¦?    if (!userId || !content) {
      console.error("?„ìˆ˜ ?°ì´?°ê? ?„ë½?˜ì—ˆ?µë‹ˆ??", { userId });
      return;
    }

    const db = getFirestore();

    try {
      // ?„ë°° ë°©ì? ì²´í¬
      await enforceRateLimit(userId, "COMMENT", commentId);

      const expReward = EXP_REWARDS.COMMENT_CREATE;
      const expReward = EXP_REWARDS.COMMENT_CREATE;
      const reason = "?“ê? ?‘ì„±";

      await db.runTransaction(async (transaction) => {
        // ?“ê? ë¬¸ì„œ??ë³´ìƒ ì§€ê¸??Œëž˜ê·??¤ì •
        transaction.update(snapshot.ref, {
          rewarded: true,
          rewardedAt: FieldValue.serverTimestamp(),
          expRewarded: expReward,
          expRewarded: expReward,
        });

        // ê²Œì‹œê¸€???“ê? ??ì¦ê?
        const postRef = db.collection("posts").doc(postId);
        transaction.update(postRef, {
          commentCount: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        });

        // ê³¨ë“œ ì§€ê¸?        await addExpInTransaction(transaction, userId, expReward, reason);

        // ê²½í—˜ì¹?ì§€ê¸?        await addExpInTransaction(transaction, userId, expReward, reason);
      });

      console.log(`?“ê? ë³´ìƒ ì§€ê¸??„ë£Œ: ${userId}`, {
        postId,
        commentId,
        expReward,
        expReward,
      });

      // ê²Œì‹œê¸€ ?‘ì„±?ì—ê²??Œë¦¼ (ë³¸ì¸ ?“ê??€ ?œì™¸)
      const postDoc = await db.collection("posts").doc(postId).get();
      if (postDoc.exists) {
        const postData = postDoc.data() as Post;
        if (postData.userId !== userId) {
          await db.collection("notifications").add({
            userId: postData.userId,
            type: "NEW_COMMENT",
            title: "???“ê?",
            message: `??ê¸€???ˆë¡œ???“ê????¬ë ¸?µë‹ˆ??`,
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
      // ?„ë°° ë°©ì???ê±¸ë¦° ê²½ìš°
      if (error && typeof error === "object" && "code" in error &&
          (error as { code: string }).code === "resource-exhausted") {
        console.log(`?„ë°° ë°©ì?ë¡?ë³´ìƒ ê±°ë?: ${userId}`, commentId);
        return;
      }
      console.error("?“ê? ë³´ìƒ ì§€ê¸??¤íŒ¨:", error);
      throw error;
    }
  }
);

/**
 * ì¢‹ì•„??ë°›ìœ¼ë©?ê³¨ë“œ ì§€ê¸?(ê¸€/?“ê? ?‘ì„±?ì—ê²?
 *
 * Firestore ?¸ë¦¬ê±? likes/{likeId} ë¬¸ì„œ ?ì„± ?? *
 * ë³´ìƒ: 3 ê³¨ë“œ (?€???‘ì„±?ì—ê²?
 */
export const onLikeReceived = onDocumentCreated(
  "likes/{likeId}",
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      console.log("ì¢‹ì•„??ë¬¸ì„œê°€ ?†ìŠµ?ˆë‹¤.");
      return;
    }

    const like = snapshot.data() as Like;
    const likeId = event.params.likeId;

    // ?´ë? ë³´ìƒ??ì§€ê¸‰ëœ ê²½ìš° ?¤í‚µ
    if (like.rewarded) {
      console.log(`?´ë? ë³´ìƒ??ì§€ê¸‰ëœ ì¢‹ì•„?”ìž…?ˆë‹¤: ${likeId}`);
      return;
    }

    const { userId, targetType, targetId, targetUserId } = like;

    // ?„ìˆ˜ ?°ì´??ê²€ì¦?    if (!userId || !targetType || !targetId || !targetUserId) {
      console.error("?„ìˆ˜ ?°ì´?°ê? ?„ë½?˜ì—ˆ?µë‹ˆ??", like);
      return;
    }

    // ?ê¸° ?ì‹ ?ê²Œ ì¢‹ì•„?”ëŠ” ë³´ìƒ ?†ìŒ
    if (userId === targetUserId) {
      console.log("?ê¸° ?ì‹ ?ê²Œ ì¢‹ì•„?”ëŠ” ë³´ìƒ???†ìŠµ?ˆë‹¤.");
      return;
    }

    const db = getFirestore();
    const expReward = EXP_REWARDS.LIKE_RECEIVED;
    const reason = `ì¢‹ì•„??ë°›ìŒ (${targetType === "post" ? "ê²Œì‹œê¸€" : "?“ê?"})`;

    try {
      await db.runTransaction(async (transaction) => {
        // ì¢‹ì•„??ë¬¸ì„œ??ë³´ìƒ ì§€ê¸??Œëž˜ê·??¤ì •
        transaction.update(snapshot.ref, {
          rewarded: true,
          rewardedAt: FieldValue.serverTimestamp(),
          expRewarded: expReward,
        });

        // ?€??ë¬¸ì„œ??ì¢‹ì•„????ì¦ê?
        if (targetType === "post") {
          const postRef = db.collection("posts").doc(targetId);
          transaction.update(postRef, {
            likeCount: FieldValue.increment(1),
          });
        } else if (targetType === "comment") {
          // ?“ê? ì¢‹ì•„?”ëŠ” postIdê°€ ?„ìš”?˜ë?ë¡?ë³„ë„ ì²˜ë¦¬
          // likes ë¬¸ì„œ??postId???€?¥ë˜???ˆë‹¤ê³?ê°€??          const likeData = like as Like & { postId?: string };
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

        // ?€???‘ì„±?ì—ê²?ê³¨ë“œ ì§€ê¸?        await addExpInTransaction(transaction, targetUserId, expReward, reason);
      });

      console.log(`ì¢‹ì•„??ë³´ìƒ ì§€ê¸??„ë£Œ: ${targetUserId}`, {
        likeId,
        targetType,
        targetId,
        expReward,
      });

      // ?€???‘ì„±?ì—ê²??Œë¦¼
      await db.collection("notifications").add({
        userId: targetUserId,
        type: "LIKE_RECEIVED",
        title: "ì¢‹ì•„??,
        message: `??${targetType === "post" ? "ê¸€" : "?“ê?"}??ì¢‹ì•„?”ë? ë°›ì•˜?µë‹ˆ??`,
        data: {
          likeId,
          targetType,
          targetId,
        },
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (error) {
      console.error("ì¢‹ì•„??ë³´ìƒ ì§€ê¸??¤íŒ¨:", error);
      throw error;
    }
  }
);

/**
 * ì¢‹ì•„??ì·¨ì†Œ ??ì¢‹ì•„????ê°ì†Œ
 *
 * Firestore ?¸ë¦¬ê±? likes/{likeId} ë¬¸ì„œ ?? œ ?? */
export const onLikeRemoved = onDocumentWritten(
  "likes/{likeId}",
  async (event) => {
    // ?? œ??ê²½ìš°ë§?ì²˜ë¦¬
    if (event.data?.after.exists) {
      return; // ë¬¸ì„œê°€ ì¡´ìž¬?˜ë©´ ?? œê°€ ?„ë‹˜
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

      console.log("ì¢‹ì•„??ì·¨ì†Œ ì²˜ë¦¬ ?„ë£Œ:", { targetType, targetId });
    } catch (error) {
      console.error("ì¢‹ì•„??ì·¨ì†Œ ì²˜ë¦¬ ?¤íŒ¨:", error);
    }
  }
);
