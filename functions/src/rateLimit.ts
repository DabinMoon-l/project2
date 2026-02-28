import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";

/**
 * 도배 방지 설정
 */
export const RATE_LIMITS = {
  // 글 작성: 1분에 3개 제한
  POST: {
    windowMs: 60 * 1000,  // 1분 (밀리초)
    maxCount: 3,
    message: "글 작성은 1분에 3개까지만 가능합니다.",
  },
  // 댓글 작성: 30초에 1개 제한
  COMMENT: {
    windowMs: 30 * 1000,  // 30초 (밀리초)
    maxCount: 1,
    message: "댓글 작성은 30초에 1개까지만 가능합니다.",
  },
};

/**
 * Rate limit 타입
 */
export type RateLimitType = keyof typeof RATE_LIMITS;

/**
 * Rate limit 체크 결과
 */
export interface RateLimitResult {
  allowed: boolean;       // 허용 여부
  remaining: number;      // 남은 횟수
  resetAt: Date;          // 리셋 시간
  message?: string;       // 거부 시 메시지
}

/**
 * 사용자의 Rate limit 체크
 * @param userId 사용자 ID
 * @param type Rate limit 타입 (POST 또는 COMMENT)
 * @returns Rate limit 체크 결과
 */
export async function checkRateLimit(
  userId: string,
  type: RateLimitType
): Promise<RateLimitResult> {
  const db = getFirestore();
  const limit = RATE_LIMITS[type];
  const now = Date.now();
  const windowStart = now - limit.windowMs;

  // Rate limit 기록 조회
  const rateLimitRef = db
    .collection("rateLimits")
    .doc(userId)
    .collection(type.toLowerCase())
    .where("timestamp", ">", Timestamp.fromMillis(windowStart));

  const snapshot = await rateLimitRef.get();
  const recentCount = snapshot.size;

  // 허용 여부 결정
  const allowed = recentCount < limit.maxCount;
  const remaining = Math.max(0, limit.maxCount - recentCount - (allowed ? 1 : 0));

  // 가장 오래된 기록의 만료 시간 계산
  let resetAt = new Date(now + limit.windowMs);
  if (!snapshot.empty) {
    const oldestDoc = snapshot.docs.reduce((oldest, doc) => {
      const docTime = doc.data().timestamp as Timestamp;
      const oldestTime = oldest.data().timestamp as Timestamp;
      return docTime.toMillis() < oldestTime.toMillis() ? doc : oldest;
    });
    const oldestTimestamp = oldestDoc.data().timestamp as Timestamp;
    resetAt = new Date(oldestTimestamp.toMillis() + limit.windowMs);
  }

  return {
    allowed,
    remaining,
    resetAt,
    message: allowed ? undefined : limit.message,
  };
}

/**
 * Rate limit 기록 추가
 * @param userId 사용자 ID
 * @param type Rate limit 타입
 * @param referenceId 참조 ID (글 또는 댓글 ID)
 */
export async function recordRateLimit(
  userId: string,
  type: RateLimitType,
  referenceId: string
): Promise<void> {
  const db = getFirestore();

  await db
    .collection("rateLimits")
    .doc(userId)
    .collection(type.toLowerCase())
    .add({
      referenceId,
      timestamp: FieldValue.serverTimestamp(),
    });
}

/**
 * Rate limit 체크 및 기록 (통합 함수)
 * 허용되면 기록하고 true 반환, 거부되면 에러 throw
 * @param userId 사용자 ID
 * @param type Rate limit 타입
 * @param referenceId 참조 ID (글 또는 댓글 ID)
 * @throws HttpsError Rate limit 초과 시
 */
export async function enforceRateLimit(
  userId: string,
  type: RateLimitType,
  referenceId: string
): Promise<void> {
  const result = await checkRateLimit(userId, type);

  if (!result.allowed) {
    throw new HttpsError(
      "resource-exhausted",
      result.message || "요청 횟수를 초과했습니다."
    );
  }

  // 허용된 경우 기록
  await recordRateLimit(userId, type, referenceId);
}

/**
 * 오래된 Rate limit 기록 정리 (Cloud Scheduler로 주기적 실행 권장)
 * @param olderThanMs 이 시간보다 오래된 기록 삭제 (기본: 1시간)
 */
export async function cleanupRateLimits(
  olderThanMs: number = 60 * 60 * 1000
): Promise<number> {
  const db = getFirestore();
  const cutoffTime = Timestamp.fromMillis(Date.now() - olderThanMs);
  let deletedCount = 0;

  const usersSnapshot = await db.collection("rateLimits").listDocuments();

  // 사용자별 병렬 처리
  const results = await Promise.allSettled(
    usersSnapshot.map(async (userDoc) => {
      let count = 0;
      for (const sub of ["post", "comment"]) {
        const snap = await userDoc
          .collection(sub)
          .where("timestamp", "<", cutoffTime)
          .get();

        // 배치 삭제 (500개 제한)
        const batch = db.batch();
        snap.docs.forEach(doc => {
          batch.delete(doc.ref);
          count++;
        });
        if (snap.docs.length > 0) await batch.commit();
      }
      return count;
    })
  );

  results.forEach(r => {
    if (r.status === "fulfilled") deletedCount += r.value;
  });

  return deletedCount;
}
