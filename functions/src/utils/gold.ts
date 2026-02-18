import { getFirestore, FieldValue, Transaction } from "firebase-admin/firestore";

// 참고: 계급 시스템은 토끼 집사 시스템으로 대체되었습니다.
// 이 파일은 경험치 지급 관련 함수만 포함합니다.

/**
 * 경험치 보상 설정
 */
export const EXP_REWARDS = {
  // 퀴즈 관련
  QUIZ_PERFECT: 50,       // 만점
  QUIZ_EXCELLENT: 40,     // 90% 이상
  QUIZ_GOOD: 35,          // 70% 이상
  QUIZ_PASS: 30,          // 50% 이상
  QUIZ_FAIL: 25,          // 50% 미만 (참여 보상)
  QUIZ_CREATE: 50,        // 커스텀 퀴즈 생성 (isPublic: true)
  QUIZ_AI_SAVE: 25,       // AI 퀴즈 서재 저장 (isPublic: false)
  QUIZ_MAKE_PUBLIC: 10,   // 서재 퀴즈 공개 전환

  // 피드백 관련
  FEEDBACK_SUBMIT: 10,    // 피드백 작성 (1개당)

  // 게시판 관련
  POST_CREATE: 15,        // 글 작성
  COMMENT_CREATE: 15,     // 댓글 작성
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
 * 사용자 문서를 트랜잭션 내에서 읽기 (reads-before-writes 보장용)
 *
 * Firestore 트랜잭션에서는 모든 read가 write보다 먼저 실행되어야 합니다.
 * 이 함수로 먼저 읽은 후, addExpInTransaction에 전달하세요.
 */
export async function readUserForExp(
  transaction: Transaction,
  userId: string
): Promise<FirebaseFirestore.DocumentSnapshot> {
  const db = getFirestore();
  const userRef = db.collection("users").doc(userId);
  return transaction.get(userRef);
}

/**
 * 사용자에게 경험치 지급 (트랜잭션 내에서 사용)
 *
 * XP만 증가시키고 히스토리 기록.
 * 주의: Firestore 트랜잭션의 reads-before-writes 규칙을 지키기 위해
 * readUserForExp()로 미리 읽은 userDoc을 전달해야 합니다.
 *
 * @param transaction Firestore 트랜잭션
 * @param userId 사용자 ID
 * @param amount 지급할 경험치량
 * @param reason 지급 사유
 * @param userDoc 미리 읽은 사용자 문서 스냅샷
 */
export function addExpInTransaction(
  transaction: Transaction,
  userId: string,
  amount: number,
  reason: string,
  userDoc: FirebaseFirestore.DocumentSnapshot
): { rankUp: boolean } {
  if (!userDoc.exists) {
    throw new Error("사용자를 찾을 수 없습니다.");
  }

  const db = getFirestore();
  const userRef = db.collection("users").doc(userId);

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

  return { rankUp: false };
}
