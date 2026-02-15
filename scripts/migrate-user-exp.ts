/**
 * 기존 사용자 EXP 필드 마이그레이션 스크립트
 *
 * 실행 방법:
 * 1. Firebase Console에서 실행하거나
 * 2. Node.js 환경에서 Firebase Admin SDK로 실행
 *
 * 이 스크립트는 totalExp 필드가 없는 모든 사용자에게 초기값을 설정합니다.
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// Firebase Admin 초기화 (서비스 계정 키 필요)
// const serviceAccount = require('./serviceAccountKey.json');
// initializeApp({ credential: cert(serviceAccount) });

async function migrateUserExp() {
  const db = getFirestore();
  const usersRef = db.collection('users');

  // 모든 사용자 조회
  const snapshot = await usersRef.get();

  let migratedCount = 0;
  const batch = db.batch();

  for (const doc of snapshot.docs) {
    const data = doc.data();

    // totalExp 필드가 없거나 undefined인 경우만 업데이트
    if (data.totalExp === undefined || data.totalExp === null) {
      batch.update(doc.ref, {
        totalExp: 0,
        totalQuizzes: data.totalQuizzes ?? 0,
        correctAnswers: data.correctAnswers ?? 0,
        wrongAnswers: data.wrongAnswers ?? 0,
        averageScore: data.averageScore ?? 0,
        participationRate: data.participationRate ?? 0,
        totalFeedbacks: data.totalFeedbacks ?? 0,
        helpfulFeedbacks: data.helpfulFeedbacks ?? 0,
        badges: data.badges ?? [],
      });
      migratedCount++;
      console.log(`마이그레이션 대상: ${doc.id} (${data.nickname || data.email})`);
    }
  }

  if (migratedCount > 0) {
    await batch.commit();
    console.log(`\n총 ${migratedCount}명의 사용자가 마이그레이션되었습니다.`);
  } else {
    console.log('마이그레이션 대상 사용자가 없습니다.');
  }
}

// 실행
migrateUserExp().catch(console.error);
