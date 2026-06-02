/**
 * 저요저요 쪽찌시험 — 출제자(본인) 자동 0점 참여 기록 정정
 *
 * 공개 전환 버그로 인해 다음 부정확 상태:
 *   - quizzes/{quizId}.userScores[creatorUid] = 0
 *   - quizzes/{quizId}.participantCount = 1
 *   - quizzes/{quizId}.averageScore = 0
 *   - quiz_completions/{quizId}_{creatorUid} 존재
 *   - quiz_agg/{quizId}/shards/N count·scoreSum 1 증가
 *
 * 정정:
 *   - userScores에서 creatorUid 제거 (FieldValue.delete)
 *   - participantCount = 0
 *   - averageScore = 0
 *   - quiz_completions/{quizId}_{creatorUid} 삭제
 *   - quiz_agg 분산 카운터 감소
 *
 * 사용: node scripts/_jeoyojeoyo_jjokjji_reset_creator.js [--dry-run]
 *   환경변수 QUIZ_ID 로 다른 quizId 지정 가능 (기본: 쪽찌시험)
 */

const admin = require('firebase-admin');
const path = require('path');

admin.initializeApp({
  credential: admin.credential.cert(
    require(path.join(__dirname, '../serviceAccountKey.json'))
  ),
});
const db = admin.firestore();

const QUIZ_ID = process.env.QUIZ_ID || 'cOQ7T9ppyKCdZkkzU3wz';

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const quizRef = db.collection('quizzes').doc(QUIZ_ID);
  const quizSnap = await quizRef.get();
  if (!quizSnap.exists) {
    console.error(`❌ quizzes/${QUIZ_ID} 없음`);
    process.exit(1);
  }
  const quiz = quizSnap.data();
  console.log(`[quiz] ${QUIZ_ID} | "${quiz.title}"`);
  console.log(`  현재 participantCount=${quiz.participantCount}, averageScore=${quiz.averageScore}`);
  console.log(`  userScores 키들: ${Object.keys(quiz.userScores || {}).join(', ') || '(없음)'}`);

  // creatorUid 결정 — 1) "저요저요" 닉네임 검색, 2) userScores 첫 키
  let creatorUid = null;
  const usersSnap = await db
    .collection('users')
    .where('nickname', '==', '저요저요')
    .limit(1)
    .get();
  if (!usersSnap.empty) {
    creatorUid = usersSnap.docs[0].id;
    console.log(`  "저요저요" uid=${creatorUid}`);
  }

  // userScores에 그 uid 있는지 확인, 없으면 첫 키로 폴백
  const userScores = quiz.userScores || {};
  if (creatorUid && !(creatorUid in userScores)) {
    console.warn(`  ⚠️  "저요저요" uid가 userScores에 없음. userScores 키 사용.`);
    creatorUid = Object.keys(userScores)[0] || null;
  } else if (!creatorUid) {
    creatorUid = Object.keys(userScores)[0] || null;
  }

  if (!creatorUid) {
    console.error('❌ 정정할 출제자 uid 없음 (userScores 비었거나 모름)');
    process.exit(1);
  }
  console.log(`\n[정정 대상] creatorUid=${creatorUid}`);
  console.log(`  userScores[${creatorUid}] = ${userScores[creatorUid]}`);

  if (dryRun) {
    console.log('\n[dry-run] 실제 변경 안 함');
    return;
  }

  // 1. quizzes 문서 정정
  await quizRef.update({
    [`userScores.${creatorUid}`]: admin.firestore.FieldValue.delete(),
    participantCount: 0,
    averageScore: 0,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`✓ quizzes/${QUIZ_ID} 정정`);

  // 2. quiz_completions 삭제
  const completionRef = db.collection('quiz_completions').doc(`${QUIZ_ID}_${creatorUid}`);
  const completionSnap = await completionRef.get();
  if (completionSnap.exists) {
    await completionRef.delete();
    console.log(`✓ quiz_completions/${QUIZ_ID}_${creatorUid} 삭제`);
  } else {
    console.log(`(quiz_completions 없음 — 스킵)`);
  }

  // 3. quiz_agg 분산 카운터 — 모든 샤드 count, scoreSum 0으로 리셋
  //    (단순화: 모든 샤드 일괄 0으로. recordAttempt가 다시 증가시킴)
  const shardsSnap = await quizRef.collection('shards').get();
  if (!shardsSnap.empty) {
    const batch = db.batch();
    for (const s of shardsSnap.docs) {
      batch.update(s.ref, { count: 0, scoreSum: 0 });
    }
    await batch.commit();
    console.log(`✓ quiz_agg/${QUIZ_ID}/shards (${shardsSnap.size}개) 카운터 0 리셋`);
  }

  // quiz_agg 메인 도큐먼트
  const aggRef = db.collection('quiz_agg').doc(QUIZ_ID);
  const aggSnap = await aggRef.get();
  if (aggSnap.exists) {
    const shardsSubSnap = await aggRef.collection('shards').get();
    if (!shardsSubSnap.empty) {
      const batch = db.batch();
      for (const s of shardsSubSnap.docs) {
        batch.update(s.ref, { count: 0, scoreSum: 0 });
      }
      await batch.commit();
      console.log(`✓ quiz_agg/${QUIZ_ID}/shards (${shardsSubSnap.size}개) 카운터 0 리셋`);
    }
  }

  console.log('\n=== 완료 ===');
}

main()
  .catch((e) => {
    console.error('오류:', e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
