/**
 * quizResults와 feedbacks에 quizCreatorId 필드 추가 마이그레이션
 *
 * 실행 방법:
 * npx ts-node scripts/migrate-quiz-creator-id.ts
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as path from 'path';

// Firebase Admin 초기화
if (getApps().length === 0) {
  const serviceAccountPath = path.join(__dirname, '../serviceAccountKey.json');
  initializeApp({
    credential: cert(serviceAccountPath),
  });
}

const db = getFirestore();

async function migrateQuizResults() {
  console.log('=== quizResults 마이그레이션 시작 ===');

  const resultsSnapshot = await db.collection('quizResults').get();
  console.log(`총 ${resultsSnapshot.size}개의 quizResults 문서`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const doc of resultsSnapshot.docs) {
    const data = doc.data();

    // 이미 quizCreatorId가 있으면 스킵
    if (data.quizCreatorId !== undefined) {
      skipped++;
      continue;
    }

    try {
      // 퀴즈 문서에서 creatorId 가져오기
      const quizDoc = await db.collection('quizzes').doc(data.quizId).get();
      if (!quizDoc.exists) {
        console.log(`  퀴즈 ${data.quizId} 없음 - 스킵`);
        skipped++;
        continue;
      }

      const quizData = quizDoc.data();
      const creatorId = quizData?.creatorId || null;

      // quizCreatorId 필드 추가
      await doc.ref.update({ quizCreatorId: creatorId });
      updated++;

      if (updated % 50 === 0) {
        console.log(`  ${updated}개 업데이트 완료...`);
      }
    } catch (err) {
      console.error(`  문서 ${doc.id} 업데이트 실패:`, err);
      failed++;
    }
  }

  console.log(`quizResults 마이그레이션 완료: ${updated}개 업데이트, ${skipped}개 스킵, ${failed}개 실패`);
}

async function migrateFeedbacks() {
  console.log('\n=== feedbacks 마이그레이션 시작 ===');

  const feedbacksSnapshot = await db.collection('feedbacks').get();
  console.log(`총 ${feedbacksSnapshot.size}개의 feedbacks 문서`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  // 퀴즈 creatorId 캐시
  const quizCreatorCache: Record<string, string | null> = {};

  for (const doc of feedbacksSnapshot.docs) {
    const data = doc.data();

    // 이미 quizCreatorId가 있으면 스킵
    if (data.quizCreatorId !== undefined) {
      skipped++;
      continue;
    }

    try {
      let creatorId: string | null = null;

      // 캐시 확인
      if (quizCreatorCache[data.quizId] !== undefined) {
        creatorId = quizCreatorCache[data.quizId];
      } else {
        // 퀴즈 문서에서 creatorId 가져오기
        const quizDoc = await db.collection('quizzes').doc(data.quizId).get();
        if (!quizDoc.exists) {
          console.log(`  퀴즈 ${data.quizId} 없음 - 스킵`);
          quizCreatorCache[data.quizId] = null;
          skipped++;
          continue;
        }

        const quizData = quizDoc.data();
        creatorId = quizData?.creatorId || null;
        quizCreatorCache[data.quizId] = creatorId;
      }

      // quizCreatorId 필드 추가
      await doc.ref.update({ quizCreatorId: creatorId });
      updated++;

      if (updated % 50 === 0) {
        console.log(`  ${updated}개 업데이트 완료...`);
      }
    } catch (err) {
      console.error(`  문서 ${doc.id} 업데이트 실패:`, err);
      failed++;
    }
  }

  console.log(`feedbacks 마이그레이션 완료: ${updated}개 업데이트, ${skipped}개 스킵, ${failed}개 실패`);
}

async function main() {
  console.log('quizCreatorId 마이그레이션 시작\n');

  await migrateQuizResults();
  await migrateFeedbacks();

  console.log('\n마이그레이션 완료!');
  process.exit(0);
}

main().catch((err) => {
  console.error('마이그레이션 실패:', err);
  process.exit(1);
});
