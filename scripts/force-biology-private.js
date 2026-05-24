/**
 * 펭귄마을 생물학 8~12단원 5개를 명시적으로 비공개 강제
 *
 * 목적: 현재 isPublic/isPublished 가 false 인 것으로 확인되었으나,
 *       만약 어디선가 undefined 로 새고 있거나 다른 경로로 노출된다면
 *       명시적 false 셋을 다시 박아 카러셀에서 즉시 사라지게 함.
 *
 * 안전: 이미 false 면 사실상 no-op. publicRewarded 가 없으니 보상 회수 이슈 없음.
 */
const admin = require('firebase-admin');
const path = require('path');

admin.initializeApp({
  credential: admin.credential.cert(
    require(path.join(__dirname, '../serviceAccountKey.json'))
  ),
});
const db = admin.firestore();

const QUIZ_IDS = [
  { id: 'NuJy2yWHt8rbIGAfwvoz', label: '8단원' },
  { id: 'ZMb1noye2BbyQqURqOB4', label: '9단원' },
  { id: 'NbZvxdZCPy3LDGW8wxdz', label: '10단원' },
  { id: 'vgwMnp9jMZjLHdS4U3C4', label: '11단원' },
  { id: 'uQCsvkNiRVT13sb1toaB', label: '12단원' },
];

async function main() {
  for (const { id, label } of QUIZ_IDS) {
    const ref = db.collection('quizzes').doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      console.log(`[${label}] ${id} 없음 — 스킵`);
      continue;
    }
    const d = snap.data();
    const before = { isPublic: d.isPublic, isPublished: d.isPublished };

    await ref.update({
      isPublic: false,
      isPublished: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`[${label}] "${d.title}" → 명시적 비공개`);
    console.log(`  이전: isPublic=${before.isPublic}  isPublished=${before.isPublished}`);
    console.log(`  이후: isPublic=false  isPublished=false`);
  }

  console.log('\n=== 5개 모두 명시적 비공개 처리 완료 ===');
  console.log('학생 화면은 onSnapshot 으로 실시간 반영됨 (새로고침 불필요).');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => process.exit(0));
