import { getFirestore, FieldValue, Transaction } from "firebase-admin/firestore";

// 참고: 계급 시스템은 토끼 집사 시스템으로 대체되었습니다.
// 이 파일은 경험치 지급 관련 함수만 포함합니다.

/**
 * 경험치 보상 설정
 */
export const EXP_REWARDS = {
  // 퀴즈 관련
  QUIZ_PERFECT: 50,       // 만점
  QUIZ_EXCELLENT: 35,     // 90% 이상
  QUIZ_GOOD: 25,          // 70% 이상
  QUIZ_PASS: 15,          // 50% 이상
  QUIZ_FAIL: 5,           // 50% 미만 (참여 보상)
  QUIZ_CREATE: 15,        // 퀴즈 생성

  // 피드백 관련
  FEEDBACK_SUBMIT: 10,    // 피드백 작성

  // 게시판 관련
  POST_CREATE: 5,         // 글 작성
  COMMENT_CREATE: 2,      // 댓글 작성
  LIKE_RECEIVED: 1,       // 좋아요 받음

  // 데일리 관련
  DAILY_COMPLETE: 5,      // 데일리 퀴즈 완료
  STREAK_3_DAYS: 10,      // 3일 연속 출석 보너스
  STREAK_7_DAYS: 20,      // 7일 연속 출석 보너스
  STREAK_30_DAYS: 50,     // 30일 연속 출석 보너스
};

/**
 * 퀴즈 점수에 따른 경험치 보상 계산
 * @param score 점수 (0-100)
 * @returns 경험치 보상량
 */
export function calculateQuizExp(score: number): number {
  if (score === 100) return EXP_REWARDS.QUIZ_PERFECT;
  if (score >= 90) return EXP_REWARDS.QUIZ_EXCELLENT;
  if (score >= 70) return EXP_REWARDS.QUIZ_GOOD;
  if (score >= 50) return EXP_REWARDS.QUIZ_PASS;
  return EXP_REWARDS.QUIZ_FAIL;
}

/**
 * 사용자에게 경험치 지급 (트랜잭션 내에서 사용)
 *
 * XP만 증가시키고 히스토리 기록.
 *
 * @param transaction Firestore 트랜잭션
 * @param userId 사용자 ID
 * @param amount 지급할 경험치량
 * @param reason 지급 사유
 */
export async function addExpInTransaction(
  transaction: Transaction,
  userId: string,
  amount: number,
  reason: string
): Promise<{ rankUp: boolean }> {
  const db = getFirestore();
  const userRef = db.collection("users").doc(userId);

  // 현재 사용자 정보 가져오기
  const userDoc = await transaction.get(userRef);
  if (!userDoc.exists) {
    throw new Error("사용자를 찾을 수 없습니다.");
  }

  const userData = userDoc.data()!;
  const currentExp = userData.totalExp || 0;
  const newExp = currentExp + amount;

  // 사용자 문서 업데이트 (XP만)
  transaction.update(userRef, {
    totalExp: FieldValue.increment(amount),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // 경험치 히스토리 기록
  const historyRef = db.collection("users").doc(userId)
    .collection("expHistory").doc();

  transaction.set(historyRef, {
    amount,
    reason,
    previousExp: currentExp,
    newExp,
    createdAt: FieldValue.serverTimestamp(),
  });

  // 하위 호환용 반환 (항상 rankUp: false)
  return { rankUp: false };
}
