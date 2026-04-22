// Firebase Admin (Deno npm compat)
//
// Phase 3 Wave 1~2 기간 한정 사용. Wave 3 에서 Firestore 트리거를 PostgreSQL trigger 로
// 교체하면 Edge Function 의 Firestore 쓰기도 제거되고 이 파일은 삭제된다.
//
// Firestore 의존성 이유:
// - Firestore onDocumentCreated/Written 트리거(quiz/board/feedback) 가 아직 살아있음
// - Edge 에서 쓰기를 안 하면 트리거 체인이 깨짐 (EXP·알림·콩콩이 등)
//
// Service account JSON 은 Supabase secrets `FIREBASE_SERVICE_ACCOUNT_JSON` 에 보관.

import { cert, getApps, initializeApp } from "npm:firebase-admin@12/app";
import { getFirestore, Firestore } from "npm:firebase-admin@12/firestore";

let cachedDb: Firestore | null = null;

export function getFirebaseFirestore(): Firestore {
  if (cachedDb) return cachedDb;
  if (getApps().length === 0) {
    const raw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
    if (!raw) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON not configured");
    }
    const sa = JSON.parse(raw);
    initializeApp({ credential: cert(sa) });
  }
  cachedDb = getFirestore();
  return cachedDb;
}
