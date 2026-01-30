import { getFirestore, FieldValue, Transaction } from "firebase-admin/firestore";

/**
 * 계급 정보 타입
 */
export interface RankInfo {
  name: string;           // 계급 이름
  minExp: number;         // 필요 최소 경험치
  armorUnlocked: boolean; // 갑옷 해금 여부
}

/**
 * 계급 시스템 정의 (5단계)
 * 시즌 내 달성 가능하도록 완화된 기준
 */
export const RANKS: RankInfo[] = [
  { name: "견습생", minExp: 0, armorUnlocked: false },
  { name: "용사", minExp: 50, armorUnlocked: true },
  { name: "기사", minExp: 75, armorUnlocked: true },
  { name: "장군", minExp: 100, armorUnlocked: true },
  { name: "전설의 용사", minExp: 125, armorUnlocked: true },
];

/**
 * 경험치 보상 설정 (골드 제거, 경험치로 통합)
 */
export const EXP_REWARDS = {
  // 퀴즈 관련
  QUIZ_PERFECT: 50,       // 만점
  QUIZ_EXCELLENT: 35,     // 90% 이상
  QUIZ_GOOD: 25,          // 70% 이상
  QUIZ_PASS: 15,          // 50% 이상
  QUIZ_FAIL: 5,           // 50% 미만 (참여 보상)

  // 피드백 관련
  FEEDBACK_SUBMIT: 10,    // 피드백 작성

  // 게시판 관련
  POST_CREATE: 5,         // 글 작성
  COMMENT_CREATE: 2,      // 댓글 작성
  LIKE_RECEIVED: 1,       // 좋아요 받음
};

/**
 * 경험치로 계급 결정
 * @param exp 현재 경험치
 * @returns 계급 정보
 */
export function getRankByExp(exp: number): RankInfo {
  // 경험치가 높은 순으로 확인하여 해당 계급 반환
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (exp >= RANKS[i].minExp) {
      return RANKS[i];
    }
  }
  return RANKS[0]; // 기본값: 견습생
}

/**
 * 다음 계급 정보 가져오기
 * @param currentRank 현재 계급 이름
 * @returns 다음 계급 정보 또는 null (최고 계급인 경우)
 */
export function getNextRank(currentRank: string): RankInfo | null {
  const currentIndex = RANKS.findIndex(r => r.name === currentRank);
  if (currentIndex === -1 || currentIndex >= RANKS.length - 1) {
    return null;
  }
  return RANKS[currentIndex + 1];
}

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
 * 사용자에게 골드 지급 (트랜잭션 내에서 사용)
 * @param transaction Firestore 트랜잭션
 * @param userId 사용자 ID
 * @param amount 지급할 골드량
 * @param reason 지급 사유
 */
export async function addGoldInTransaction(
  transaction: Transaction,
  userId: string,
  amount: number,
  reason: string
): Promise<void> {
  const db = getFirestore();
  const userRef = db.collection("users").doc(userId);

  // 사용자 문서 업데이트
  transaction.update(userRef, {
    gold: FieldValue.increment(amount),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // 골드 히스토리 기록
  const historyRef = db.collection("users").doc(userId)
    .collection("goldHistory").doc();

  transaction.set(historyRef, {
    amount,
    reason,
    createdAt: FieldValue.serverTimestamp(),
  });
}

/**
 * 사용자에게 경험치 지급 및 계급 업 체크 (트랜잭션 내에서 사용)
 * @param transaction Firestore 트랜잭션
 * @param userId 사용자 ID
 * @param amount 지급할 경험치량
 * @param reason 지급 사유
 * @returns 계급 업 여부와 새 계급 정보
 */
export async function addExpInTransaction(
  transaction: Transaction,
  userId: string,
  amount: number,
  reason: string
): Promise<{ rankUp: boolean; newRank?: RankInfo; previousRank?: string }> {
  const db = getFirestore();
  const userRef = db.collection("users").doc(userId);

  // 현재 사용자 정보 가져오기
  const userDoc = await transaction.get(userRef);
  if (!userDoc.exists) {
    throw new Error("사용자를 찾을 수 없습니다.");
  }

  const userData = userDoc.data()!;
  const currentExp = userData.exp || 0;
  const currentRank = userData.rank || "견습생";
  const newExp = currentExp + amount;

  // 새 경험치로 계급 결정
  const newRankInfo = getRankByExp(newExp);
  const rankUp = newRankInfo.name !== currentRank;

  // 사용자 문서 업데이트
  const updateData: Record<string, unknown> = {
    exp: FieldValue.increment(amount),
    updatedAt: FieldValue.serverTimestamp(),
  };

  // 계급 업인 경우 계급 정보도 업데이트
  if (rankUp) {
    updateData.rank = newRankInfo.name;
    updateData.rankUpdatedAt = FieldValue.serverTimestamp();

    // 갑옷 해금 처리
    if (newRankInfo.armorUnlocked) {
      updateData[`unlockedArmors.${newRankInfo.name}`] = true;
    }
  }

  transaction.update(userRef, updateData);

  // 경험치 히스토리 기록
  const historyRef = db.collection("users").doc(userId)
    .collection("expHistory").doc();

  transaction.set(historyRef, {
    amount,
    reason,
    previousExp: currentExp,
    newExp,
    rankUp,
    previousRank: rankUp ? currentRank : null,
    newRank: rankUp ? newRankInfo.name : null,
    createdAt: FieldValue.serverTimestamp(),
  });

  return {
    rankUp,
    newRank: rankUp ? newRankInfo : undefined,
    previousRank: rankUp ? currentRank : undefined,
  };
}

/**
 * 골드와 경험치 동시 지급 (트랜잭션 내에서 사용)
 * @param transaction Firestore 트랜잭션
 * @param userId 사용자 ID
 * @param gold 지급할 골드량
 * @param exp 지급할 경험치량
 * @param reason 지급 사유
 */
export async function addRewardsInTransaction(
  transaction: Transaction,
  userId: string,
  gold: number,
  exp: number,
  reason: string
): Promise<{ rankUp: boolean; newRank?: RankInfo; previousRank?: string }> {
  // 골드 지급
  await addGoldInTransaction(transaction, userId, gold, reason);

  // 경험치 지급 (계급 업 체크 포함)
  return await addExpInTransaction(transaction, userId, exp, reason);
}
