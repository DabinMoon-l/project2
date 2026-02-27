import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import {
  calculateQuizExp,
  readUserForExp,
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
  isUpdate?: boolean;     // 재시도 여부
  quizCreatorId?: string; // 퀴즈 생성자 ID
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

    const { userId, quizId, correctCount, totalCount } = result;
    const isUpdate = result.isUpdate === true;
    const quizCreatorId = result.quizCreatorId || null;

    // 필수 데이터 검증
    if (!userId || !quizId) {
      console.error("필수 데이터가 누락되었습니다:", { userId, quizId });
      return;
    }

    // 서버 채점 점수 검증: gradedOnServer가 true이면 score 신뢰,
    // 그렇지 않으면 (클라이언트 폴백) submissions에서 실제 점수 확인
    let verifiedScore = result.score;
    if ((result as any).gradedOnServer !== true) {
      // 클라이언트 생성 문서 — submissions에서 서버 채점 결과 확인
      const db2 = getFirestore();
      const subsSnap = await db2
        .collection("quizzes").doc(quizId)
        .collection("submissions")
        .where("userId", "==", userId)
        .orderBy("createdAt", "desc")
        .limit(1)
        .get();

      if (!subsSnap.empty) {
        const subData = subsSnap.docs[0].data();
        verifiedScore = subData.score ?? result.score;
        console.log(`클라이언트 폴백 문서 점수 검증: 문서=${result.score}, 서버=${verifiedScore}`);
      } else {
        // submissions도 없으면 최소 보상만 지급
        console.warn(`서버 채점 결과 없음, 최소 보상 적용: userId=${userId}, quizId=${quizId}`);
        verifiedScore = 0;
      }
    }

    const score = typeof verifiedScore === "number" ? verifiedScore : 0;

    // 경험치 보상 계산
    const expReward = calculateQuizExp(score);
    const reason = `퀴즈 완료 (점수: ${score}점)`;

    const db = getFirestore();

    // 동일 유저+퀴즈 중복 보상 방지 (isUpdate 무시, 항상 체크 — 클라이언트 조작 방지)
    const existingRewards = await db
      .collection("quizResults")
      .where("userId", "==", userId)
      .where("quizId", "==", quizId)
      .where("rewarded", "==", true)
      .limit(1)
      .get();
    if (!existingRewards.empty) {
      console.log(`이미 보상이 지급된 퀴즈입니다: userId=${userId}, quizId=${quizId}`);
      // 현재 문서도 rewarded 처리 (재트리거 방지)
      await snapshot.ref.update({ rewarded: true, rewardedAt: FieldValue.serverTimestamp(), expRewarded: 0 });
      return;
    }

    try {
      // 트랜잭션으로 보상 지급
      // 주의: Firestore 트랜잭션은 모든 READ가 WRITE보다 먼저 실행되어야 함
      await db.runTransaction(async (transaction) => {
        // ── 모든 READ를 먼저 수행 ──
        const userDoc = await readUserForExp(transaction, userId);

        let creatorDoc = null;
        if (!isUpdate && correctCount !== undefined && totalCount !== undefined && quizCreatorId) {
          creatorDoc = await transaction.get(
            db.collection("users").doc(quizCreatorId)
          );
        }

        // ── 모든 WRITE 수행 ──
        // 결과 문서에 보상 지급 플래그 설정 (중복 방지)
        transaction.update(snapshot.ref, {
          rewarded: true,
          rewardedAt: FieldValue.serverTimestamp(),
          expRewarded: expReward,
        });

        // 경험치 지급
        addExpInTransaction(transaction, userId, expReward, reason, userDoc);

        // 첫 시도 + 서버 채점된 결과에만 누적 통계 업데이트 (랭킹용)
        if (!isUpdate && correctCount !== undefined && totalCount !== undefined && (result as any).gradedOnServer === true) {
          const userRef = db.collection("users").doc(userId);
          const statsUpdate: Record<string, FirebaseFirestore.FieldValue> = {
            totalCorrect: FieldValue.increment(correctCount),
            totalAttemptedQuestions: FieldValue.increment(totalCount),
          };

          if (creatorDoc?.exists && creatorDoc.data()?.role === "professor") {
            statsUpdate.professorQuizzesCompleted = FieldValue.increment(1);
          }

          transaction.update(userRef, statsUpdate);
        }
      });

      console.log(`퀴즈 보상 지급 완료: ${userId}`, {
        resultId,
        score,
        expReward,
      });
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

        const quizData = quizDoc.data();
        const currentAttemptCount = quizData?.attemptCount || 0;
        const currentTotalScore = quizData?.totalScore || 0;

        // 새로운 값 계산
        const newAttemptCount = currentAttemptCount + 1;
        const newTotalScore = currentTotalScore + result.score;
        const newAverageScore = newTotalScore / newAttemptCount;

        // 퀴즈 통계 업데이트 (평균 점수 포함)
        transaction.update(quizRef, {
          attemptCount: newAttemptCount,
          totalScore: newTotalScore,
          averageScore: Math.round(newAverageScore * 10) / 10, // 소수점 1자리
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
  isPublic?: boolean;     // 공개 여부
  type?: string;          // 퀴즈 타입 (ai-generated 등)
  rewarded?: boolean;     // 생성 보상 지급 여부
  publicRewarded?: boolean; // 공개 전환 보상 지급 여부
}

/**
 * 퀴즈 생성 시 경험치 지급
 *
 * - 커스텀 퀴즈 (isPublic: true): 50 EXP
 * - AI 퀴즈 서재 저장 (isPublic: false): 25 EXP
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

    if (quiz.rewarded) {
      console.log(`이미 보상이 지급된 퀴즈입니다: ${quizId}`);
      return;
    }

    const { creatorId } = quiz;
    if (!creatorId) {
      console.error("퀴즈 생성자 ID가 없습니다:", quizId);
      return;
    }

    // 커스텀(공개) vs AI(서재) 구분
    const isAiSave = quiz.isPublic === false;
    const expReward = isAiSave ? EXP_REWARDS.QUIZ_AI_SAVE : EXP_REWARDS.QUIZ_CREATE;
    const reason = isAiSave ? "AI 퀴즈 서재 저장" : "퀴즈 생성";

    const db = getFirestore();

    try {
      await db.runTransaction(async (transaction) => {
        // READ 먼저
        const userDoc = await readUserForExp(transaction, creatorId);

        // WRITE
        transaction.update(snapshot.ref, {
          rewarded: true,
          rewardedAt: FieldValue.serverTimestamp(),
          expRewarded: expReward,
        });

        addExpInTransaction(transaction, creatorId, expReward, reason, userDoc);
      });

      console.log(`퀴즈 생성 보상 지급 완료: ${creatorId}`, {
        quizId,
        expReward,
        isAiSave,
      });
    } catch (error) {
      console.error("퀴즈 생성 보상 지급 실패:", error);
      throw error;
    }
  }
);

/**
 * 서재 퀴즈 공개 전환 시 경험치 지급
 *
 * isPublic: false → true 변경 감지
 * 보상: 10 EXP (1회만)
 */
export const onQuizMakePublic = onDocumentWritten(
  {
    document: "quizzes/{quizId}",
    region: "asia-northeast3",
  },
  async (event) => {
    const before = event.data?.before.data() as Quiz | undefined;
    const after = event.data?.after.data() as Quiz | undefined;

    // 삭제이거나 데이터 없으면 무시
    if (!before || !after) return;

    // isPublic이 false → true로 변경된 경우만
    if (before.isPublic !== false || after.isPublic !== true) return;

    // 이미 공개 전환 보상 지급된 경우
    if (after.publicRewarded) return;

    const quizId = event.params.quizId;
    const creatorId = after.creatorId;
    if (!creatorId) return;

    const expReward = EXP_REWARDS.QUIZ_MAKE_PUBLIC;
    const reason = "퀴즈 공개 전환";
    const db = getFirestore();

    try {
      await db.runTransaction(async (transaction) => {
        // READ 먼저
        const userDoc = await readUserForExp(transaction, creatorId);

        // WRITE
        const quizRef = db.collection("quizzes").doc(quizId);
        transaction.update(quizRef, {
          publicRewarded: true,
          publicRewardedAt: FieldValue.serverTimestamp(),
        });

        addExpInTransaction(transaction, creatorId, expReward, reason, userDoc);
      });

      console.log(`퀴즈 공개 전환 보상 지급: ${creatorId}`, { quizId, expReward });
    } catch (error) {
      console.error("퀴즈 공개 전환 보상 실패:", error);
    }
  }
);
