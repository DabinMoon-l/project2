// Firebase Auth ID 토큰 검증 (Phase 3 Wave 1 한정)
//
// Phase 6 에서 Better Auth 로 전환하면 이 파일은 Supabase JWT 검증으로 대체된다.
// 지금은 Firebase Auth 토큰을 받아 Google public keys 로 서명만 검증한다.
//
// 사용법:
//   const uid = await verifyFirebaseIdToken(req);
//   if (!uid) return new Response("unauthorized", { status: 401 });

import { jwtVerify, importX509, JWTPayload } from "npm:jose@5";

const GOOGLE_JWKS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

const FIREBASE_PROJECT_ID = Deno.env.get("FIREBASE_PROJECT_ID") ?? "rabbitory-prod";

let cachedCerts: { certs: Record<string, string>; expiresAt: number } | null = null;

async function getCerts(): Promise<Record<string, string>> {
  if (cachedCerts && cachedCerts.expiresAt > Date.now()) {
    return cachedCerts.certs;
  }
  const res = await fetch(GOOGLE_JWKS_URL);
  const certs = await res.json() as Record<string, string>;
  // Cache-Control max-age 파싱은 생략, 1시간 고정 캐시
  cachedCerts = { certs, expiresAt: Date.now() + 60 * 60 * 1000 };
  return certs;
}

export interface FirebaseClaims extends JWTPayload {
  user_id?: string;
  sub?: string;
  email?: string;
  firebase?: { identities?: Record<string, unknown>; sign_in_provider?: string };
}

export async function verifyFirebaseIdToken(req: Request): Promise<FirebaseClaims | null> {
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);
  const [headerB64] = token.split(".");
  if (!headerB64) return null;

  let kid: string;
  try {
    const header = JSON.parse(atob(headerB64.replace(/-/g, "+").replace(/_/g, "/")));
    kid = header.kid;
  } catch {
    return null;
  }

  const certs = await getCerts();
  const pem = certs[kid];
  if (!pem) return null;

  try {
    const key = await importX509(pem, "RS256");
    const { payload } = await jwtVerify(token, key, {
      issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
      audience: FIREBASE_PROJECT_ID,
    });
    return payload as FirebaseClaims;
  } catch {
    return null;
  }
}

export function uidOf(claims: FirebaseClaims): string | null {
  return (claims.user_id as string) ?? (claims.sub as string) ?? null;
}
