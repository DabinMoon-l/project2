/**
 * Firebase Admin SDK — Next.js API Routes (서버 사이드 전용)
 *
 * Vercel: FIREBASE_SERVICE_ACCOUNT_KEY 환경변수 (JSON 문자열)
 * 로컬: serviceAccountKey.json 또는 ADC
 */
import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function getAdminApp(): App {
  if (getApps().length > 0) return getApps()[0];

  // 환경변수에서 서비스 계정 키 (Vercel 배포용)
  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (serviceAccountKey) {
    return initializeApp({
      credential: cert(JSON.parse(serviceAccountKey)),
    });
  }

  // 로컬 개발: ADC 또는 serviceAccountKey.json
  try {
    const fs = require('fs');
    const path = require('path');
    const keyPath = path.join(process.cwd(), 'serviceAccountKey.json');
    const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    return initializeApp({ credential: cert(serviceAccount) });
  } catch {
    // ADC (GOOGLE_APPLICATION_CREDENTIALS) 폴백
    return initializeApp();
  }
}

const adminApp = getAdminApp();
export const adminDb = getFirestore(adminApp);
