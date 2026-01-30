import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { addExpInTransaction, EXP_REWARDS } from "./utils/gold";

/**
 * ?¼ë“œë°?ë¬¸ì„œ ?€?? */
interface Feedback {
  userId: string;         // ?‘ì„±??ID
  quizId: string;         // ?´ì¦ˆ ID
  questionId: string;     // ë¬¸ì œ ID
  type: "error" | "suggestion" | "other";  // ?¼ë“œë°?? í˜•
  content: string;        // ?¼ë“œë°??´ìš©
  status: "pending" | "reviewed" | "resolved";  // ì²˜ë¦¬ ?íƒœ
  rewarded?: boolean;     // ë³´ìƒ ì§€ê¸??¬ë?
  createdAt: FirebaseFirestore.Timestamp;
}

/**
 * ?¼ë“œë°??œì¶œ ??ê³¨ë“œ ì§€ê¸? *
 * Firestore ?¸ë¦¬ê±? feedbacks/{feedbackId} ë¬¸ì„œ ?ì„± ?? *
 * ë³´ìƒ: 15 ê³¨ë“œ
 */
export const onFeedbackSubmit = onDocumentCreated(
  "feedbacks/{feedbackId}",
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      console.log("?¼ë“œë°?ë¬¸ì„œê°€ ?†ìŠµ?ˆë‹¤.");
      return;
    }

    const feedback = snapshot.data() as Feedback;
    const feedbackId = event.params.feedbackId;

    // ?´ë? ë³´ìƒ??ì§€ê¸‰ëœ ê²½ìš° ?¤í‚µ
    if (feedback.rewarded) {
      console.log(`?´ë? ë³´ìƒ??ì§€ê¸‰ëœ ?¼ë“œë°±ì…?ˆë‹¤: ${feedbackId}`);
      return;
    }

    const { userId, questionId, content } = feedback;

    // ?„ìˆ˜ ?°ì´??ê²€ì¦?    if (!userId || !questionId || !content) {
      console.error("?„ìˆ˜ ?°ì´?°ê? ?„ë½?˜ì—ˆ?µë‹ˆ??", { userId, questionId });
      return;
    }

    // ?¼ë“œë°??´ìš© ìµœì†Œ ê¸¸ì´ ê²€ì¦?(?¤íŒ¸ ë°©ì?)
    if (content.trim().length < 10) {
      console.log("?¼ë“œë°??´ìš©???ˆë¬´ ì§§ìŠµ?ˆë‹¤:", feedbackId);
      return;
    }

    const db = getFirestore();
    const expReward = EXP_REWARDS.FEEDBACK_SUBMIT;
    const reason = "?´ì¦ˆ ?¼ë“œë°??‘ì„±";

    try {
      await db.runTransaction(async (transaction) => {
        // ?¼ë“œë°?ë¬¸ì„œ??ë³´ìƒ ì§€ê¸??Œë˜ê·??¤ì •
        transaction.update(snapshot.ref, {
          rewarded: true,
          rewardedAt: FieldValue.serverTimestamp(),
          expRewarded: expReward,
        });

        // ê³¨ë“œ ì§€ê¸?        await addExpInTransaction(transaction, userId, expReward, reason);
      });

      console.log(`?¼ë“œë°?ë³´ìƒ ì§€ê¸??„ë£Œ: ${userId}`, {
        feedbackId,
        expReward,
      });

      // êµìˆ˜?˜ì—ê²??Œë¦¼ ?ì„± (???¼ë“œë°??Œë¦¼)
      // ?´ë‹¹ ?´ì¦ˆ??êµìˆ˜??ID ì¡°íšŒ
      const quizDoc = await db.collection("quizzes").doc(feedback.quizId).get();
      if (quizDoc.exists) {
        const quizData = quizDoc.data();
        const professorId = quizData?.professorId;

        if (professorId) {
          await db.collection("notifications").add({
            userId: professorId,
            type: "NEW_FEEDBACK",
            title: "???¼ë“œë°?,
            message: `ë¬¸ì œ???€???ˆë¡œ???¼ë“œë°±ì´ ?±ë¡?˜ì—ˆ?µë‹ˆ??`,
            data: {
              feedbackId,
              quizId: feedback.quizId,
              questionId,
            },
            read: false,
            createdAt: FieldValue.serverTimestamp(),
          });
        }
      }
    } catch (error) {
      console.error("?¼ë“œë°?ë³´ìƒ ì§€ê¸??¤íŒ¨:", error);
      throw error;
    }
  }
);

/**
 * ?¼ë“œë°??íƒœ ë³€ê²????¬ìš©?ì—ê²??Œë¦¼
 *
 * Firestore ?¸ë¦¬ê±? feedbacks/{feedbackId} ë¬¸ì„œ ?…ë°?´íŠ¸ ?? */
export const onFeedbackStatusChange = onDocumentCreated(
  "feedbacks/{feedbackId}/statusHistory/{historyId}",
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;

    const statusChange = snapshot.data() as {
      previousStatus: string;
      newStatus: string;
      comment?: string;
      changedBy: string;
      changedAt: FirebaseFirestore.Timestamp;
    };

    const feedbackId = event.params.feedbackId;
    const db = getFirestore();

    // ?¼ë“œë°??‘ì„±??ì¡°íšŒ
    const feedbackDoc = await db.collection("feedbacks").doc(feedbackId).get();
    if (!feedbackDoc.exists) return;

    const feedback = feedbackDoc.data() as Feedback;
    const { userId } = feedback;

    // ?íƒœë³??Œë¦¼ ë©”ì‹œì§€
    const statusMessages: Record<string, string> = {
      reviewed: "êµìˆ˜?˜ì´ ?¼ë“œë°±ì„ ?•ì¸?ˆìŠµ?ˆë‹¤.",
      resolved: "?¼ë“œë°±ì´ ë°˜ì˜?˜ì—ˆ?µë‹ˆ?? ê°ì‚¬?©ë‹ˆ??",
    };

    const message = statusMessages[statusChange.newStatus];
    if (!message) return;

    // ?¬ìš©?ì—ê²??Œë¦¼ ?ì„±
    await db.collection("notifications").add({
      userId,
      type: "FEEDBACK_STATUS",
      title: "?¼ë“œë°??íƒœ ë³€ê²?,
      message,
      data: {
        feedbackId,
        newStatus: statusChange.newStatus,
        comment: statusChange.comment,
      },
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });

    console.log(`?¼ë“œë°??íƒœ ë³€ê²??Œë¦¼ ?„ì†¡: ${userId}`, {
      feedbackId,
      newStatus: statusChange.newStatus,
    });
  }
);
