/**
 * 펭귄마을 교수 서재 — isPublished 정합화 백필
 *
 * 대상: 펭귄마을 소유 퀴즈 중 isPublished 필드가 없는 것
 * 규칙: publicRewarded === true 이면 isPublished=true (안전망), 아니면 isPublished=false
 *
 * 안전:
 *  - 이미 isPublished 가 명시되어 있으면 손대지 않음
 *  - 어디까지나 누락된 필드를 채우는 것
 */
const admin = require('firebase-admin');
const path = require('path');

admin.initializeApp({
  credential: admin.credential.cert(
    require(path.join(__dirname, '../serviceAccountKey.json'))
  ),
});
const db = admin.firestore();

const PENGUIN_UID = '86OqdHFpGQQOMUNItwFlltYaThI3';

async function main() {
  const [byUid, byId] = await Promise.all([
    db.collection('quizzes').where('creatorUid', '==', PENGUIN_UID).get(),
    db.collection('quizzes').where('creatorId',  '==', PENGUIN_UID).get(),
  ]);

  const seen = new Map();
  for (const snap of [byUid, byId]) {
    snap.forEach(d => { if (!seen.has(d.id)) seen.set(d.id, { ref: d.ref, data: d.data() }); });
  }

  let updated = 0;
  let skipped = 0;

  for (const [id, { ref, data }] of seen.entries()) {
    if (data.isPublished !== undefined) {
      skipped++;
      continue;
    }

    const target = data.publicRewarded === true; // 한 번이라도 공개됐던 적 있으면 true 로 채움
    await ref.update({ isPublished: target });
    console.log(`✓ ${id}  "${data.title}"  → isPublished=${target}  (publicRewarded=${data.publicRewarded})`);
    updated++;
  }

  console.log(`\n=== 백필 완료 ===`);
  console.log(`업데이트: ${updated}개`);
  console.log(`스킵(이미 명시됨): ${skipped}개`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => process.exit(0));
