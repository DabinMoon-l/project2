import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { readUserForExp, addExpInTransaction, EXP_REWARDS } from "./utils/gold";

/**
 * 피드백 문서 타입
 */
interface Feedback {
  userId: string;         // 작성자 ID
  quizId: string;         // 퀴즈 ID
  questionId: string;     // 문제 ID
  type: "praise" | "wantmore" | "unclear" | "wrong" | "typo" | "other";  // 피드백 유형
  content?: string;       // 피드백 내용 (선택)
  status: "pending" | "reviewed" | "resolved";  // 처리 상태
  rewarded?: boolean;     // 보상 지급 여부
  createdAt: FirebaseFirestore.Timestamp;
}

/**
 * 피드백 제출 시 경험치 지급
 *
 * Firestore 트리거: questionFeedbacks/{feedbackId} 문서 생성 시
 * 보상: 20 경험치
 */
export const onFeedbackSubmit = onDocumentCreated(
  {
    document: "questionFeedbacks/{feedbackId}",
    region: "asia-northeast3",
  },
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

    const { userId, questionId, type } = feedback;

    // 필수 데이터 검증 (type 선택만으로 제출 가능, content는 선택)
    if (!userId || !questionId || !type) {
      console.error("필수 데이터가 누락되었습니다", { userId, questionId, type });
      return;
    }

    const db = getFirestore();

    // 동일 유저+문제 중복 EXP 지급 방지
    const existingFeedbacks = await db
      .collection("questionFeedbacks")
      .where("userId", "==", userId)
      .where("questionId", "==", questionId)
      .where("rewarded", "==", true)
      .limit(1)
      .get();

    if (!existingFeedbacks.empty) {
      console.log(`이미 보상이 지급된 피드백입니다: userId=${userId}, questionId=${questionId}`);
      await snapshot.ref.update({ rewarded: true, expRewarded: 0 });
      return;
    }

    const expReward = EXP_REWARDS.FEEDBACK_SUBMIT;
    const reason = "퀴즈 피드백 작성";

    try {
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

      console.log(`피드백 보상 지급 완료: ${userId}`, {
        feedbackId,
        expReward,
      });

      // 교수님에게 알림 생성 (새 피드백 알림)
      // 해당 퀴즈의 교수님 ID 조회
      const quizDoc = await db.collection("quizzes").doc(feedback.quizId).get();
      if (quizDoc.exists) {
        const quizData = quizDoc.data();
        const professorId = quizData?.creatorId;

        if (professorId) {
          await db.collection("notifications").add({
            userId: professorId,
            type: "NEW_FEEDBACK",
            title: "새 피드백",
            message: "문제에 대한 새로운 피드백이 등록되었습니다",
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
 * Firestore 트리거: feedbacks/{feedbackId}/statusHistory/{historyId} 문서 생성 시
 */
export const onFeedbackStatusChange = onDocumentCreated(
  {
    document: "questionFeedbacks/{feedbackId}/statusHistory/{historyId}",
    region: "asia-northeast3",
  },
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
    const feedbackDoc = await db.collection("questionFeedbacks").doc(feedbackId).get();
    if (!feedbackDoc.exists) return;

    const feedback = feedbackDoc.data() as Feedback;
    const { userId } = feedback;

    // 상태별 알림 메시지
    const statusMessages: Record<string, string> = {
      reviewed: "교수님이 피드백을 확인하셨습니다.",
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
