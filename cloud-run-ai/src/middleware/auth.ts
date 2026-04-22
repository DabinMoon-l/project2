import { Request, Response, NextFunction } from "express";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * HMAC 서명 검증
 * 호출측(pg_cron / Edge Function)은 다음 헤더를 포함해야 함:
 *   X-RB-Timestamp: <unix ms>
 *   X-RB-Signature: hex(HMAC_SHA256(secret, `${timestamp}.${raw_body}`))
 *
 * 5분 초과 타임스탬프는 재생공격(replay) 방지 목적으로 거부.
 */
export function verifyHmac(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.CLOUD_RUN_HMAC_SECRET;
  if (!secret) {
    res.status(500).json({ ok: false, error: "HMAC secret not configured" });
    return;
  }

  const timestamp = req.header("X-RB-Timestamp");
  const signature = req.header("X-RB-Signature");

  if (!timestamp || !signature) {
    res.status(401).json({ ok: false, error: "missing HMAC headers" });
    return;
  }

  // 5분 window
  const age = Math.abs(Date.now() - Number(timestamp));
  if (!Number.isFinite(age) || age > 5 * 60 * 1000) {
    res.status(401).json({ ok: false, error: "timestamp expired" });
    return;
  }

  const rawBody = JSON.stringify(req.body ?? {});
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  const a = Buffer.from(signature, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).json({ ok: false, error: "invalid signature" });
    return;
  }

  next();
}
