import { getFirestore, FieldValue } from "firebase-admin/firestore";

/**
 * Rate limit 설정
 */
interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

/**
 * 액션별 Rate limit 설정
 * - quiz-submit: 퀴즈 제출 (버그/무한루프 차단 목적, 넉넉하게)
 * - ai-generate: AI 문제 생성 (분당)
 * - ai-generate-daily: AI 문제 생성 (일간)
 */
const LIMITS: Record<string, RateLimitConfig> = {
  "quiz-submit": { maxRequests: 10, windowMs: 60_000 },         // 분당 10회
  "ai-generate": { maxRequests: 3, windowMs: 60_000 },          // 분당 3회
  "ai-generate-daily": { maxRequests: 15, windowMs: 86_400_000 }, // 일 15회
};

/**
 * Rate limit 검사
 * 초과 시 에러 메시지와 함께 throw
 *
 * @param userId - 사용자 ID
 * @param action - 액션 타입 (LIMITS 키)
 */
export async function checkRateLimitV2(
  userId: string,
  action: string
): Promise<void> {
  const config = LIMITS[action];
  if (!config) return;

  const db = getFirestore();
  const now = Date.now();
  const windowStart = now - config.windowMs;
  const counterRef = db.doc(`rateLimits_v2/${userId}_${action}`);

  const doc = await counterRef.get();
  const data = doc.data();

  if (data) {
    // 윈도우 내 타임스탬프만 필터
    const timestamps: number[] = (data.timestamps || [])
      .filter((ts: number) => ts > windowStart);

    if (timestamps.length >= config.maxRequests) {
      const retryAfterMs = timestamps[0] + config.windowMs - now;
      const retryAfterSec = Math.ceil(retryAfterMs / 1000);
      throw new Error(
        `요청 한도 초과 (${action}: ${config.maxRequests}회/${config.windowMs < 120_000 ? "분" : "일"}). ` +
        `${retryAfterSec}초 후 다시 시도해주세요.`
      );
    }

    // 현재 요청 추가 (오래된 것은 제거)
    timestamps.push(now);
    await counterRef.update({
      timestamps,
      updatedAt: FieldValue.serverTimestamp(),
    });
  } else {
    // 첫 요청
    await counterRef.set({
      timestamps: [now],
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
}
