/**
 * 푸시 알림 관련 Cloud Functions
 *
 * FCM을 통한 푸시 알림 전송 기능을 제공합니다.
 */

import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  onDocumentCreated,
  onDocumentUpdated,
} from "firebase-functions/v2/firestore";

// ============================================
// 타입 정의
// ============================================

/**
 * 알림 메시지 타입
 */
interface NotificationPayload {
  title: string;
  body: string;
  icon?: string;
  image?: string;
  data?: Record<string, string>;
}

/**
 * 알림 토픽
 */
const TOPICS = {
  ALL: "all",
  NEW_QUIZ: "new-quiz",
  SEASON: "season",
  CLASS_A: "class-a",
  CLASS_B: "class-b",
  CLASS_C: "class-c",
  CLASS_D: "class-d",
} as const;

// ============================================
// 유틸리티 함수
// ============================================

/**
 * 사용자의 FCM 토큰 목록 조회
 */
async function getUserTokens(userId: string): Promise<string[]> {
  const db = getFirestore();
  const tokensSnapshot = await db
    .collection("fcmTokens")
    .where("uid", "==", userId)
    .get();

  return tokensSnapshot.docs.map((doc) => doc.data().token);
}

/**
 * 토픽 구독자들의 토큰 조회
 */
async function getTopicTokens(topic: string): Promise<string[]> {
  const db = getFirestore();
  const tokensSnapshot = await db
    .collection("fcmTokens")
    .where("topics", "array-contains", topic)
    .get();

  return tokensSnapshot.docs.map((doc) => doc.data().token);
}

/**
 * FCM 메시지 전송
 */
async function sendPushNotification(
  tokens: string[],
  payload: NotificationPayload
): Promise<{ successCount: number; failureCount: number }> {
  if (tokens.length === 0) {
    return { successCount: 0, failureCount: 0 };
  }

  const messaging = getMessaging();

  try {
    const message = {
      notification: {
        title: payload.title,
        body: payload.body,
        ...(payload.icon && { icon: payload.icon }),
        ...(payload.image && { image: payload.image }),
      },
      data: payload.data || {},
      tokens,
    };

    const response = await messaging.sendEachForMulticast(message);

    // 실패한 토큰 정리
    if (response.failureCount > 0) {
      const db = getFirestore();
      const failedTokens = response.responses
        .map((resp, idx) => (resp.success ? null : tokens[idx]))
        .filter((token): token is string => token !== null);

      // 실패한 토큰 삭제
      const batch = db.batch();
      for (const token of failedTokens) {
        const tokenRef = db.collection("fcmTokens").doc(token);
        batch.delete(tokenRef);
      }
      await batch.commit();

      console.log(`실패한 토큰 ${failedTokens.length}개 삭제`);
    }

    console.log(
      `알림 전송 완료: 성공 ${response.successCount}, 실패 ${response.failureCount}`
    );

    return {
      successCount: response.successCount,
      failureCount: response.failureCount,
    };
  } catch (error) {
    console.error("알림 전송 에러:", error);
    throw error;
  }
}

// ============================================
// Callable Functions
// ============================================

/**
 * 특정 사용자에게 알림 전송 (Callable Function)
 * 교수님만 사용 가능
 */
export const sendNotificationToUser = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const adminId = request.auth.uid;
    const db = getFirestore();

    // 교수님 권한 확인
    const adminDoc = await db.collection("users").doc(adminId).get();
    if (!adminDoc.exists || adminDoc.data()?.role !== "professor") {
      throw new HttpsError("permission-denied", "교수님만 알림을 보낼 수 있습니다.");
    }

    const { targetUserId, title, body, data } = request.data as {
      targetUserId: string;
      title: string;
      body: string;
      data?: Record<string, string>;
    };

    if (!targetUserId || !title || !body) {
      throw new HttpsError(
        "invalid-argument",
        "targetUserId, title, body가 필요합니다."
      );
    }

    const tokens = await getUserTokens(targetUserId);
    const result = await sendPushNotification(tokens, { title, body, data });

    return result;
  }
);

/**
 * 반별 알림 전송 (Callable Function)
 * 교수님만 사용 가능
 */
export const sendNotificationToClass = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const adminId = request.auth.uid;
    const db = getFirestore();

    // 교수님 권한 확인
    const adminDoc = await db.collection("users").doc(adminId).get();
    if (!adminDoc.exists || adminDoc.data()?.role !== "professor") {
      throw new HttpsError("permission-denied", "교수님만 알림을 보낼 수 있습니다.");
    }

    const { classId, title, body, data } = request.data as {
      classId: "A" | "B" | "C" | "D" | "all";
      title: string;
      body: string;
      data?: Record<string, string>;
    };

    if (!classId || !title || !body) {
      throw new HttpsError(
        "invalid-argument",
        "classId, title, body가 필요합니다."
      );
    }

    // 토픽 결정
    const topic =
      classId === "all"
        ? TOPICS.ALL
        : TOPICS[`CLASS_${classId}` as keyof typeof TOPICS];

    const tokens = await getTopicTokens(topic);
    const result = await sendPushNotification(tokens, { title, body, data });

    // 알림 히스토리 저장
    await db.collection("notificationHistory").add({
      type: "class",
      classId,
      title,
      body,
      data,
      sentBy: adminId,
      successCount: result.successCount,
      failureCount: result.failureCount,
      createdAt: new Date(),
    });

    return result;
  }
);

// ============================================
// Firestore Trigger Functions
// ============================================

/**
 * 새 퀴즈 생성 시 알림 전송
 */
export const onNewQuizCreated = onDocumentCreated(
  {
    document: "quizzes/{quizId}",
    region: "asia-northeast3",
  },
  async (event) => {
    const quizData = event.data?.data();
    if (!quizData) return;

    // 공개된 퀴즈만 알림
    if (!quizData.isPublished) return;

    const { title, targetClass, creatorNickname } = quizData;
    const quizId = event.params.quizId;

    // 알림 데이터
    const payload: NotificationPayload = {
      title: "새로운 퀴즈가 출제되었어요!",
      body: `${creatorNickname || "교수님"}이 "${title}" 퀴즈를 출제했습니다.`,
      data: {
        type: "new_quiz",
        quizId,
      },
    };

    // 대상 반에 따라 토픽 결정
    let topic: string;
    if (targetClass === "all") {
      topic = TOPICS.ALL;
    } else {
      topic = TOPICS[`CLASS_${targetClass}` as keyof typeof TOPICS] || TOPICS.ALL;
    }

    const tokens = await getTopicTokens(topic);
    await sendPushNotification(tokens, payload);

    console.log(`새 퀴즈 알림 전송: ${quizId}`, { targetClass, tokenCount: tokens.length });
  }
);

/**
 * 피드백 답변 시 알림 전송
 */
export const onFeedbackReplied = onDocumentUpdated(
  {
    document: "feedbacks/{feedbackId}",
    region: "asia-northeast3",
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    if (!before || !after) return;

    // 답변이 새로 추가된 경우에만
    if (before.reply || !after.reply) return;

    const { userId, quizId, questionText } = after;
    const feedbackId = event.params.feedbackId;

    // 알림 데이터
    const payload: NotificationPayload = {
      title: "피드백 답변이 도착했어요!",
      body: `"${questionText?.slice(0, 30)}..." 문제에 대한 피드백 답변이 등록되었습니다.`,
      data: {
        type: "feedback_reply",
        feedbackId,
        quizId: quizId || "",
      },
    };

    const tokens = await getUserTokens(userId);
    await sendPushNotification(tokens, payload);

    console.log(`피드백 답변 알림 전송: ${feedbackId}`, { userId });
  }
);

/**
 * 게시판 댓글 알림
 */
export const onBoardCommentCreated = onDocumentCreated(
  {
    document: "posts/{postId}/comments/{commentId}",
    region: "asia-northeast3",
  },
  async (event) => {
    const commentData = event.data?.data();
    if (!commentData) return;

    const { postId } = event.params;
    const { authorId: commentAuthorId, content } = commentData;

    // 게시글 작성자 조회
    const db = getFirestore();
    const postDoc = await db.collection("posts").doc(postId).get();
    if (!postDoc.exists) return;

    const postData = postDoc.data();
    const postAuthorId = postData?.authorId;

    // 자신의 글에 댓글을 단 경우 알림 제외
    if (postAuthorId === commentAuthorId) return;

    // 알림 데이터
    const payload: NotificationPayload = {
      title: "새 댓글이 달렸어요!",
      body: `"${postData?.title?.slice(0, 20)}..." 게시글에 새 댓글: "${content?.slice(0, 30)}..."`,
      data: {
        type: "board_comment",
        postId,
      },
    };

    const tokens = await getUserTokens(postAuthorId);
    await sendPushNotification(tokens, payload);

    console.log(`댓글 알림 전송: ${postId}`, { postAuthorId, commentAuthorId });
  }
);

/**
 * 대댓글 알림
 */
export const onBoardReplyCreated = onDocumentCreated(
  {
    document: "posts/{postId}/comments/{commentId}/replies/{replyId}",
    region: "asia-northeast3",
  },
  async (event) => {
    const replyData = event.data?.data();
    if (!replyData) return;

    const { postId, commentId } = event.params;
    const { authorId: replyAuthorId, content } = replyData;

    // 원 댓글 작성자 조회
    const db = getFirestore();
    const commentDoc = await db
      .collection("posts")
      .doc(postId)
      .collection("comments")
      .doc(commentId)
      .get();

    if (!commentDoc.exists) return;

    const commentData = commentDoc.data();
    const commentAuthorId = commentData?.authorId;

    // 자신의 댓글에 대댓글을 단 경우 알림 제외
    if (commentAuthorId === replyAuthorId) return;

    // 알림 데이터
    const payload: NotificationPayload = {
      title: "답글이 달렸어요!",
      body: `내 댓글에 답글: "${content?.slice(0, 40)}..."`,
      data: {
        type: "board_reply",
        postId,
      },
    };

    const tokens = await getUserTokens(commentAuthorId);
    await sendPushNotification(tokens, payload);

    console.log(`대댓글 알림 전송: ${postId}/${commentId}`, {
      commentAuthorId,
      replyAuthorId,
    });
  }
);

/**
 * 랭킹 변동 알림 (1등 달성 시)
 */
export const onRankingChange = onDocumentUpdated(
  {
    document: "users/{userId}",
    region: "asia-northeast3",
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    if (!before || !after) return;

    // 경험치가 변경된 경우에만
    if (before.exp === after.exp) return;

    const userId = event.params.userId;
    const { classId, userName, exp } = after;

    // 해당 반에서 1등인지 확인
    const db = getFirestore();
    const topUserSnapshot = await db
      .collection("users")
      .where("classId", "==", classId)
      .orderBy("exp", "desc")
      .limit(1)
      .get();

    if (topUserSnapshot.empty) return;

    const topUser = topUserSnapshot.docs[0];
    if (topUser.id !== userId) return;

    // 이전에 1등이 아니었는데 1등이 된 경우에만 알림
    // (간단히 경험치가 증가한 경우만 체크)
    if (before.exp >= after.exp) return;

    // 알림 데이터
    const payload: NotificationPayload = {
      title: "축하해요! 1등 달성!",
      body: `${userName || "용사"}님이 ${classId}반 1등에 올랐습니다!`,
      data: {
        type: "ranking_change",
        userId,
      },
    };

    const tokens = await getUserTokens(userId);
    await sendPushNotification(tokens, payload);

    console.log(`랭킹 1등 알림: ${userId}`, { classId, exp });
  }
);
