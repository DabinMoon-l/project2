/**
 * 기존 posts, comments, quizzes에 authorClassType/creatorClassType 필드 추가 마이그레이션
 *
 * 실행 방법:
 * npx ts-node scripts/migrate-class-type.ts
 */

import { initializeApp, cert, getApps, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as fs from 'fs';

// ESM에서 __dirname 대체
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Firebase Admin 초기화
if (getApps().length === 0) {
  const serviceAccountPath = path.join(__dirname, '../serviceAccountKey.json');

  // serviceAccountKey.json이 있으면 사용, 없으면 기본 인증 시도
  if (fs.existsSync(serviceAccountPath)) {
    initializeApp({
      credential: cert(serviceAccountPath),
    });
  } else {
    // GOOGLE_APPLICATION_CREDENTIALS 환경 변수 또는 gcloud 인증 사용
    console.log('serviceAccountKey.json이 없어 기본 인증을 사용합니다.');
    initializeApp({
      credential: applicationDefault(),
      projectId: 'project2-7a317', // 프로젝트 ID 직접 지정
    });
  }
}

const db = getFirestore();

// 사용자 classType 캐시
const userClassCache: Record<string, string | null> = {};

/**
 * 사용자의 classType 가져오기 (캐시 사용)
 */
async function getUserClassType(userId: string): Promise<string | null> {
  if (userClassCache[userId] !== undefined) {
    return userClassCache[userId];
  }

  try {
    const userDoc = await db.collection('users').doc(userId).get();
    if (userDoc.exists) {
      // Firestore 필드명은 classId
      const classType = userDoc.data()?.classId || null;
      userClassCache[userId] = classType;
      return classType;
    }
  } catch (err) {
    console.error(`  사용자 ${userId} 조회 실패:`, err);
  }

  userClassCache[userId] = null;
  return null;
}

/**
 * posts 컬렉션 마이그레이션
 */
async function migratePosts() {
  console.log('=== posts 마이그레이션 시작 ===');

  const postsSnapshot = await db.collection('posts').get();
  console.log(`총 ${postsSnapshot.size}개의 posts 문서`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const doc of postsSnapshot.docs) {
    const data = doc.data();

    // 이미 authorClassType이 있으면 스킵
    if (data.authorClassType !== undefined) {
      skipped++;
      continue;
    }

    try {
      const classType = await getUserClassType(data.authorId);

      if (classType) {
        await doc.ref.update({ authorClassType: classType });
        updated++;
      } else {
        // 사용자를 찾을 수 없는 경우에도 null로 설정
        await doc.ref.update({ authorClassType: null });
        updated++;
      }

      if (updated % 50 === 0) {
        console.log(`  ${updated}개 업데이트 완료...`);
      }
    } catch (err) {
      console.error(`  문서 ${doc.id} 업데이트 실패:`, err);
      failed++;
    }
  }

  console.log(`posts 마이그레이션 완료: ${updated}개 업데이트, ${skipped}개 스킵, ${failed}개 실패`);
}

/**
 * comments 컬렉션 마이그레이션
 */
async function migrateComments() {
  console.log('\n=== comments 마이그레이션 시작 ===');

  const commentsSnapshot = await db.collection('comments').get();
  console.log(`총 ${commentsSnapshot.size}개의 comments 문서`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const doc of commentsSnapshot.docs) {
    const data = doc.data();

    // 이미 authorClassType이 있으면 스킵
    if (data.authorClassType !== undefined) {
      skipped++;
      continue;
    }

    try {
      const classType = await getUserClassType(data.authorId);

      if (classType) {
        await doc.ref.update({ authorClassType: classType });
        updated++;
      } else {
        await doc.ref.update({ authorClassType: null });
        updated++;
      }

      if (updated % 50 === 0) {
        console.log(`  ${updated}개 업데이트 완료...`);
      }
    } catch (err) {
      console.error(`  문서 ${doc.id} 업데이트 실패:`, err);
      failed++;
    }
  }

  console.log(`comments 마이그레이션 완료: ${updated}개 업데이트, ${skipped}개 스킵, ${failed}개 실패`);
}

/**
 * quizzes 컬렉션 마이그레이션
 */
async function migrateQuizzes() {
  console.log('\n=== quizzes 마이그레이션 시작 ===');

  const quizzesSnapshot = await db.collection('quizzes').get();
  console.log(`총 ${quizzesSnapshot.size}개의 quizzes 문서`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const doc of quizzesSnapshot.docs) {
    const data = doc.data();

    // 이미 creatorClassType이 있으면 스킵
    if (data.creatorClassType !== undefined) {
      skipped++;
      continue;
    }

    // creatorId가 없으면 스킵 (교수님 생성 퀴즈 등)
    if (!data.creatorId) {
      skipped++;
      continue;
    }

    try {
      const classType = await getUserClassType(data.creatorId);

      if (classType) {
        await doc.ref.update({ creatorClassType: classType });
        updated++;
      } else {
        await doc.ref.update({ creatorClassType: null });
        updated++;
      }

      if (updated % 50 === 0) {
        console.log(`  ${updated}개 업데이트 완료...`);
      }
    } catch (err) {
      console.error(`  문서 ${doc.id} 업데이트 실패:`, err);
      failed++;
    }
  }

  console.log(`quizzes 마이그레이션 완료: ${updated}개 업데이트, ${skipped}개 스킵, ${failed}개 실패`);
}

async function main() {
  console.log('classType 마이그레이션 시작\n');

  await migratePosts();
  await migrateComments();
  await migrateQuizzes();

  console.log('\n마이그레이션 완료!');
  console.log(`캐시된 사용자 수: ${Object.keys(userClassCache).length}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('마이그레이션 실패:', err);
  process.exit(1);
});
