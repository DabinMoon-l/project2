/**
 * recordReviewPractice - 복습 연습 완료 서버 처리
 *
 * 클라이언트에서 직접 quizResults 문서를 생성하던 보안 취약점을 해결.
 * 서버에서 퀴즈 존재 여부 확인 + 중복 보상 방지 + EXP 지급을 일괄 처리합니다.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { readUserForExp, addExpInTransaction, EXP_REWARDS } from "./utils/gold";
import {
  SUPABASE_URL_SECRET,
  SUPABASE_SERVICE_ROLE_SECRET,
  DEFAULT_ORG_ID_SECRET,
  supabaseDualWriteQuizResult,
} from "./utils/supabase";

const db = getFirestore();

// ─── 입력 타입 정의 ───

interface RecordReviewPracticeInput {
  quizId: string;
  correctCount: number;
  totalCount: number;
  score: number;
}

/**
 * 복습 연습 완료 기록 (onCall CF)
 *
 * - auth 필수
 * - 퀴즈 존재 여부 서버 검증
 * - 동일 userId+quizId 복습 중복 보상 방지
 * - quizResults 문서 생성 (isReviewPractice: true, gradedOnServer: true)
 * - EXP 25 지급 (addExpInTransaction)
 */
export const recordReviewPractice = onCall(
  {
    region: "asia-northeast3",
    secrets: [
      SUPABASE_URL_SECRET,
      SUPABASE_SERVICE_ROLE_SECRET,
      DEFAULT_ORG_ID_SECRET,
    ],
  },
  async (request) => {
    // 인증 확인
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const userId = request.auth.uid;
    const data = request.data as RecordReviewPracticeInput;

    // ── 입력값 검증 ──
    const { quizId, correctCount, totalCount, score } = data;

    if (!quizId || typeof quizId !== "string") {
      throw new HttpsError("invalid-argument", "quizId가 필요합니다.");
    }
    if (typeof correctCount !== "number" || correctCount < 0) {
      throw new HttpsError("invalid-argument", "correctCount가 유효하지 않습니다.");
    }
    if (typeof totalCount !== "number" || totalCount <= 0) {
      throw new HttpsError("invalid-argument", "totalCount가 유효하지 않습니다.");
    }
    if (typeof score !== "number" || score < 0 || score > 100) {
      throw new HttpsError("invalid-argument", "score가 유효하지 않습니다 (0~100).");
    }
    if (correctCount > totalCount) {
      throw new HttpsError("invalid-argument", "correctCount가 totalCount보다 클 수 없습니다.");
    }

    // ── 퀴즈 존재 여부 확인 ──
    const quizDoc = await db.collection("quizzes").doc(quizId).get();
    if (!quizDoc.exists) {
      throw new HttpsError("not-found", "해당 퀴즈를 찾을 수 없습니다.");
    }
    const quizData = quizDoc.data()!;

    // ── 제출 락 (동시 중복 요청 방지) ──
    const lockRef = db.doc(`review_submit_locks/${userId}_${quizId}`);
    try {
      await db.runTransaction(async (tx) => {
        const lockDoc = await tx.get(lockRef);
        if (lockDoc.exists) {
          const lockData = lockDoc.data()!;
          if (lockData.lockedAt && Date.now() - lockData.lockedAt < 60_000) {
            throw new Error("SUBMIT_LOCKED");
          }
        }
        tx.set(lockRef, { userId, quizId, lockedAt: Date.now() });
      });
    } catch (e: unknown) {
      if (e instanceof Error && e.message === "SUBMIT_LOCKED") {
        return { success: true, expRewarded: 0, alreadyRewarded: true };
      }
      throw e;
    }

    // ── 동일 userId+quizId 복습 중복 보상 방지 ──
    const existingReviewRewards = await db
      .collection("quizResults")
      .where("userId", "==", userId)
      .where("quizId", "==", quizId)
      .where("isReviewPractice", "==", true)
      .where("rewarded", "==", true)
      .limit(1)
      .get();

    const alreadyRewarded = !existingReviewRewards.empty;

    // ── 트랜잭션: quizResults 생성 + EXP 지급 ──
    const expReward = alreadyRewarded ? 0 : EXP_REWARDS.REVIEW_PRACTICE;

    // 트랜잭션 밖에서 id 사전 할당 → Supabase dual-write 에 동일 id 사용
    const resultRef = db.collection("quizResults").doc();

    await db.runTransaction(async (transaction) => {
      // reads-before-writes: EXP 지급이 필요한 경우에만 읽기
      let userDoc: FirebaseFirestore.DocumentSnapshot | null = null;
      if (!alreadyRewarded) {
        userDoc = await readUserForExp(transaction, userId);
      }

      // quizResults 문서 생성
      transaction.set(resultRef, {
        userId,
        quizId,
        quizTitle: quizData.title || "퀴즈",
        score,
        correctCount,
        totalCount,
        isReviewPractice: true,
        gradedOnServer: true,
        rewarded: true,
        rewardedAt: FieldValue.serverTimestamp(),
        expRewarded: expReward,
        courseId: quizData.courseId || null,
        createdAt: FieldValue.serverTimestamp(),
      });

      // EXP 지급 (중복이 아닌 경우만)
      if (!alreadyRewarded && userDoc) {
        addExpInTransaction(transaction, userId, expReward, "복습 연습 완료", userDoc, {
          type: "review_practice",
          sourceId: quizId,
          sourceCollection: "quizzes",
          metadata: { score, correctCount, totalCount },
        });
      }
    });

    // 락 해제
    await lockRef.delete().catch(() => {});

    // Supabase dual-write (quiz_results) — isReviewPractice 플래그는 metadata 대신 attempt_key 로 구분
    supabaseDualWriteQuizResult({
      firestoreId: resultRef.id,
      firestoreQuizId: quizId,
      userId,
      score,
      correctCount,
      totalCount,
      attemptNo: 1,
      attemptKey: `review_practice_${resultRef.id}`,
      createdAt: new Date(),
    }).catch((e) => console.warn("[Supabase review_practice dual-write] 실패:", e));

    console.log(`복습 연습 기록 완료: userId=${userId}, quizId=${quizId}`, {
      score,
      correctCount,
      totalCount,
      expRewarded: expReward,
      alreadyRewarded,
    });

    return {
      success: true,
      expRewarded: expReward,
      alreadyRewarded,
    };
  }
);
