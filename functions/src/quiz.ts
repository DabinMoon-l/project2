import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import {
  calculateQuizExp,
  addExpInTransaction,
  EXP_REWARDS,
} from "./utils/gold";

/**
 * 퀴즈 결과 문서 타입
 */
interface QuizResult {
  userId: string;         // 사용자 ID
  quizId: string;         // 퀴즈 ID
  score: number;          // 점수 (0-100)
  correctCount: number;   // 정답 수
  totalCount: number;     // 전체 문제 수
  answers: Record<string, unknown>;  // 답변 기록
  startedAt: FirebaseFirestore.Timestamp;   // 시작 시간
  completedAt: FirebaseFirestore.Timestamp; // 완료 시간
  rewarded?: boolean;     // 보상 지급 여부
}

/**
 * 퀴즈 완료 시 경험치 지급
 *
 * Firestore 트리거: quizResults/{resultId} 문서 생성 시
 *
 * 점수별 경험치 보상:
 * - 만점(100): 50 EXP
 * - 90% 이상: 35 EXP
 * - 70% 이상: 25 EXP
 * - 50% 이상: 15 EXP
 * - 50% 미만: 5 EXP (참여 보상)
 */
export const onQuizComplete = onDocumentCreated(
  {
    document: "quizResults/{resultId}",
    region: "asia-northeast3",
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      console.log("퀴즈 결과 문서가 없습니다.");
      return;
    }

    const result = snapshot.data() as QuizResult;
    const resultId = event.params.resultId;

    // 이미 보상이 지급된 경우 스킵
    if (result.rewarded) {
      console.log(`이미 보상이 지급된 퀴즈 결과입니다: ${resultId}`);
      return;
    }

    const { userId, quizId, score } = result;

    // 필수 데이터 검증
    if (!userId || !quizId || score === undefined) {
      console.error("필수 데이터가 누락되었습니다:", { userId, quizId, score });
      return;
    }

    // 경험치 보상 계산
    const expReward = calculateQuizExp(score);
    const reason = `퀴즈 완료 (점수: ${score}점)`;

    const db = getFirestore();

    try {
      // 트랜잭션으로 보상 지급
      const rewardResult = await db.runTransaction(async (transaction) => {
        // 결과 문서에 보상 지급 플래그 설정 (중복 방지)
        transaction.update(snapshot.ref, {
          rewarded: true,
          rewardedAt: FieldValue.serverTimestamp(),
          expRewarded: expReward,
        });

        // 경험치 지급
        return await addExpInTransaction(
          transaction,
          userId,
          expReward,
          reason
        );
      });

      console.log(`퀴즈 보상 지급 완료: ${userId}`, {
        resultId,
        score,
        expReward,
        rankUp: rewardResult.rankUp,
        newRank: rewardResult.newRank?.name,
      });

      // 계급 업인 경우 알림 생성
      if (rewardResult.rankUp && rewardResult.newRank) {
        await db.collection("notifications").add({
          userId,
          type: "RANK_UP",
          title: "계급 승급!",
          message: `축하합니다! ${rewardResult.previousRank}에서 ${rewardResult.newRank.name}(으)로 승급했습니다!`,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
    } catch (error) {
      console.error("퀴즈 보상 지급 실패:", error);
      throw error;
    }
  }
);

/**
 * 퀴즈 통계 업데이트 (문제별 정답률 등)
 *
 * Firestore 트리거: quizResults/{resultId} 문서 생성 시
 */
export const updateQuizStatistics = onDocumentCreated(
  {
    document: "quizResults/{resultId}",
    region: "asia-northeast3",
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;

    const result = snapshot.data() as QuizResult & {
      questionResults?: Array<{
        questionId: string;
        correct: boolean;
      }>;
    };

    const { quizId, questionResults } = result;
    if (!quizId || !questionResults) return;

    const db = getFirestore();

    try {
      // 퀴즈 전체 통계 업데이트
      const quizRef = db.collection("quizzes").doc(quizId);

      await db.runTransaction(async (transaction) => {
        const quizDoc = await transaction.get(quizRef);
        if (!quizDoc.exists) return;

        // 퀴즈 참여 횟수 증가
        transaction.update(quizRef, {
          attemptCount: FieldValue.increment(1),
          totalScore: FieldValue.increment(result.score),
          updatedAt: FieldValue.serverTimestamp(),
        });
      });

      // 문제별 통계 업데이트 (배치 처리)
      const batch = db.batch();

      for (const qr of questionResults) {
        const questionStatsRef = db
          .collection("quizzes")
          .doc(quizId)
          .collection("questionStats")
          .doc(qr.questionId);

        batch.set(
          questionStatsRef,
          {
            attemptCount: FieldValue.increment(1),
            correctCount: qr.correct ? FieldValue.increment(1) : FieldValue.increment(0),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      await batch.commit();

      console.log(`퀴즈 통계 업데이트 완료: ${quizId}`);
    } catch (error) {
      console.error("퀴즈 통계 업데이트 실패:", error);
    }
  }
);

/**
 * 퀴즈 문서 타입
 */
interface Quiz {
  creatorId: string;      // 생성자 ID
  title: string;          // 퀴즈 제목
  questions: unknown[];   // 문제 목록
  rewarded?: boolean;     // 보상 지급 여부
}

/**
 * 퀴즈 생성 시 경험치 지급
 *
 * Firestore 트리거: quizzes/{quizId} 문서 생성 시
 *
 * 보상: 15 EXP
 */
export const onQuizCreate = onDocumentCreated(
  {
    document: "quizzes/{quizId}",
    region: "asia-northeast3",
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      console.log("퀴즈 문서가 없습니다.");
      return;
    }

    const quiz = snapshot.data() as Quiz;
    const quizId = event.params.quizId;

    // 이미 보상이 지급된 경우 스킵
    if (quiz.rewarded) {
      console.log(`이미 보상이 지급된 퀴즈입니다: ${quizId}`);
      return;
    }

    const { creatorId } = quiz;

    // 필수 데이터 검증
    if (!creatorId) {
      console.error("퀴즈 생성자 ID가 없습니다:", quizId);
      return;
    }

    const expReward = EXP_REWARDS.QUIZ_CREATE;
    const reason = "퀴즈 생성";

    const db = getFirestore();

    try {
      // 트랜잭션으로 보상 지급
      const rewardResult = await db.runTransaction(async (transaction) => {
        // 퀴즈 문서에 보상 지급 플래그 설정 (중복 방지)
        transaction.update(snapshot.ref, {
          rewarded: true,
          rewardedAt: FieldValue.serverTimestamp(),
          expRewarded: expReward,
        });

        // 경험치 지급
        return await addExpInTransaction(
          transaction,
          creatorId,
          expReward,
          reason
        );
      });

      console.log(`퀴즈 생성 보상 지급 완료: ${creatorId}`, {
        quizId,
        expReward,
        rankUp: rewardResult.rankUp,
        newRank: rewardResult.newRank?.name,
      });

      // 계급 업인 경우 알림 생성
      if (rewardResult.rankUp && rewardResult.newRank) {
        await db.collection("notifications").add({
          userId: creatorId,
          type: "RANK_UP",
          title: "계급 승급!",
          message: `축하합니다! ${rewardResult.previousRank}에서 ${rewardResult.newRank.name}(으)로 승급했습니다!`,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
    } catch (error) {
      console.error("퀴즈 생성 보상 지급 실패:", error);
      throw error;
    }
  }
);
