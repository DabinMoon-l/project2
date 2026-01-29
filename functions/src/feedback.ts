import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { addGoldInTransaction, GOLD_REWARDS } from "./utils/gold";

/**
 * 피드백 문서 타입
 */
interface Feedback {
  userId: string;         // 작성자 ID
  quizId: string;         // 퀴즈 ID
  questionId: string;     // 문제 ID
  type: "error" | "suggestion" | "other";  // 피드백 유형
  content: string;        // 피드백 내용
  status: "pending" | "reviewed" | "resolved";  // 처리 상태
  rewarded?: boolean;     // 보상 지급 여부
  createdAt: FirebaseFirestore.Timestamp;
}

/**
 * 피드백 제출 시 골드 지급
 *
 * Firestore 트리거: feedbacks/{feedbackId} 문서 생성 시
 *
 * 보상: 15 골드
 */
export const onFeedbackSubmit = onDocumentCreated(
  "feedbacks/{feedbackId}",
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      console.log("피드백 문서가 없습니다.");
      return;
    }

    const feedback = snapshot.data() as Feedback;
    const feedbackId = event.params.feedbackId;

    // 이미 보상이 지급된 경우 스킵
    if (feedback.rewarded) {
      console.log(`이미 보상이 지급된 피드백입니다: ${feedbackId}`);
      return;
    }

    const { userId, questionId, content } = feedback;

    // 필수 데이터 검증
    if (!userId || !questionId || !content) {
      console.error("필수 데이터가 누락되었습니다:", { userId, questionId });
      return;
    }

    // 피드백 내용 최소 길이 검증 (스팸 방지)
    if (content.trim().length < 10) {
      console.log("피드백 내용이 너무 짧습니다:", feedbackId);
      return;
    }

    const db = getFirestore();
    const goldReward = GOLD_REWARDS.FEEDBACK_SUBMIT;
    const reason = "퀴즈 피드백 작성";

    try {
      await db.runTransaction(async (transaction) => {
        // 피드백 문서에 보상 지급 플래그 설정
        transaction.update(snapshot.ref, {
          rewarded: true,
          rewardedAt: FieldValue.serverTimestamp(),
          goldRewarded: goldReward,
        });

        // 골드 지급
        await addGoldInTransaction(transaction, userId, goldReward, reason);
      });

      console.log(`피드백 보상 지급 완료: ${userId}`, {
        feedbackId,
        goldReward,
      });

      // 교수님에게 알림 생성 (새 피드백 알림)
      // 해당 퀴즈의 교수님 ID 조회
      const quizDoc = await db.collection("quizzes").doc(feedback.quizId).get();
      if (quizDoc.exists) {
        const quizData = quizDoc.data();
        const professorId = quizData?.professorId;

        if (professorId) {
          await db.collection("notifications").add({
            userId: professorId,
            type: "NEW_FEEDBACK",
            title: "새 피드백",
            message: `문제에 대한 새로운 피드백이 등록되었습니다.`,
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
      console.error("피드백 보상 지급 실패:", error);
      throw error;
    }
  }
);

/**
 * 피드백 상태 변경 시 사용자에게 알림
 *
 * Firestore 트리거: feedbacks/{feedbackId} 문서 업데이트 시
 */
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

    // 피드백 작성자 조회
    const feedbackDoc = await db.collection("feedbacks").doc(feedbackId).get();
    if (!feedbackDoc.exists) return;

    const feedback = feedbackDoc.data() as Feedback;
    const { userId } = feedback;

    // 상태별 알림 메시지
    const statusMessages: Record<string, string> = {
      reviewed: "교수님이 피드백을 확인했습니다.",
      resolved: "피드백이 반영되었습니다. 감사합니다!",
    };

    const message = statusMessages[statusChange.newStatus];
    if (!message) return;

    // 사용자에게 알림 생성
    await db.collection("notifications").add({
      userId,
      type: "FEEDBACK_STATUS",
      title: "피드백 상태 변경",
      message,
      data: {
        feedbackId,
        newStatus: statusChange.newStatus,
        comment: statusChange.comment,
      },
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });

    console.log(`피드백 상태 변경 알림 전송: ${userId}`, {
      feedbackId,
      newStatus: statusChange.newStatus,
    });
  }
);
