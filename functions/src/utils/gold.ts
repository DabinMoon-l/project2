import { getFirestore, FieldValue, Transaction } from "firebase-admin/firestore";

// 참고: 계급 시스템은 토끼 집사 시스템으로 대체되었습니다.
// 이 파일은 경험치 지급 관련 함수만 포함합니다.

/**
 * 경험치 보상 설정
 * 단일 소스: shared/expRewards.json (prebuild에서 src/shared/로 복사)
 */
import EXP_VALUES from "../shared/expRewards.json";
export const EXP_REWARDS = EXP_VALUES;

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
 * EXP 히스토리 소스 타입
 *
 * 모든 EXP 지급 경로를 추적하기 위한 enum.
 * users/{uid}/expHistory 문서의 `type` 필드에 저장됩니다.
 */
export type ExpSourceType =
  | "quiz_complete"      // 퀴즈 완료
  | "quiz_create"        // 퀴즈 생성 (커스텀/AI)
  | "quiz_make_public"   // 퀴즈 공개 전환
  | "review_practice"    // 복습 연습 완료
  | "feedback_submit"    // 피드백 제출
  | "post_create"        // 게시글 작성
  | "comment_create"     // 댓글 작성
  | "comment_accepted"   // 댓글 채택
  | "tekken_battle"      // 배틀 (승리/패배/무승부)
  | "other";             // 기타

/**
 * EXP 히스토리 추가 컨텍스트 (선택 사항)
 */
export interface ExpHistoryOptions {
  type: ExpSourceType;
  sourceId?: string;           // 관련 문서 ID (quizId, postId 등)
  sourceCollection?: string;   // 관련 컬렉션명 (quizzes, posts 등)
  metadata?: Record<string, unknown>; // 추가 컨텍스트 (점수, 제목 등)
}

/**
 * addExpInTransaction 호출 후 Supabase dual-write 에 필요한 payload.
 *
 * 호출부는 트랜잭션 커밋 뒤 이 payload 를 모아서
 *   supabaseDualUpdateUserPartial(userId, { totalExp: newExp })
 *   supabaseDualWriteExpHistory({ userId, expDocId, amount, reason, ... })
 * 를 실행해야 합니다. (트랜잭션 안에서 외부 쓰기 금지)
 */
export interface SupabaseExpPayload {
  userId: string;
  expDocId: string;
  amount: number;
  reason: string;
  previousExp: number;
  newExp: number;
  type: string;
  sourceId?: string;
  sourceCollection?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 사용자에게 경험치 지급 (트랜잭션 내에서 사용)
 *
 * XP만 증가시키고 히스토리 기록.
 * 주의: Firestore 트랜잭션의 reads-before-writes 규칙을 지키기 위해
 * readUserForExp()로 미리 읽은 userDoc을 전달해야 합니다.
 *
 * 반환: { rankUp, supabasePayload } — 호출부가 트랜잭션 커밋 후
 * supabaseDualUpdateUserPartial + supabaseDualWriteExpHistory 호출에 사용.
 *
 * @param transaction Firestore 트랜잭션
 * @param userId 사용자 ID
 * @param amount 지급할 경험치량
 * @param reason 지급 사유
 * @param userDoc 미리 읽은 사용자 문서 스냅샷
 * @param options 구조화된 EXP 소스 정보 (type, sourceId, metadata)
 */
export function addExpInTransaction(
  transaction: Transaction,
  userId: string,
  amount: number,
  reason: string,
  userDoc: FirebaseFirestore.DocumentSnapshot,
  options?: ExpHistoryOptions
): { rankUp: boolean; supabasePayload: SupabaseExpPayload } {
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

  // 경험치 히스토리 기록 (구조화된 필드 포함)
  const historyRef = db.collection("users").doc(userId)
    .collection("expHistory").doc();

  const historyData: Record<string, unknown> = {
    type: options?.type || "other",
    amount,
    reason,
    previousExp: currentExp,
    newExp,
    createdAt: FieldValue.serverTimestamp(),
  };

  // 선택 필드: 값이 있을 때만 저장
  if (options?.sourceId) historyData.sourceId = options.sourceId;
  if (options?.sourceCollection) historyData.sourceCollection = options.sourceCollection;
  if (options?.metadata) historyData.metadata = options.metadata;

  transaction.set(historyRef, historyData);

  const supabasePayload: SupabaseExpPayload = {
    userId,
    expDocId: historyRef.id,
    amount,
    reason,
    previousExp: currentExp,
    newExp,
    type: options?.type || "other",
  };
  if (options?.sourceId) supabasePayload.sourceId = options.sourceId;
  if (options?.sourceCollection) supabasePayload.sourceCollection = options.sourceCollection;
  if (options?.metadata) supabasePayload.metadata = options.metadata;

  return { rankUp: false, supabasePayload };
}

/**
 * addExpInTransaction 결과를 Supabase 에 dual-write 하는 공용 헬퍼.
 *
 * 트랜잭션 커밋 뒤 호출. user_profiles.total_exp 업데이트 +
 * exp_history 새 row 삽입을 병렬 실행. 실패해도 CF 본문엔 영향 없음.
 */
export async function flushExpSupabase(payload: SupabaseExpPayload): Promise<void> {
  const supabase = await import("./supabase");
  await Promise.all([
    supabase.supabaseDualUpdateUserPartial(payload.userId, {
      totalExp: payload.newExp,
    }),
    supabase.supabaseDualWriteExpHistory({
      userId: payload.userId,
      expDocId: payload.expDocId,
      amount: payload.amount,
      reason: payload.reason,
      type: payload.type,
      sourceId: payload.sourceId,
      sourceCollection: payload.sourceCollection,
      previousExp: payload.previousExp,
      newExp: payload.newExp,
      metadata: payload.metadata,
    }),
  ]);
}
