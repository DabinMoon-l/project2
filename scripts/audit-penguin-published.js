/**
 * 펭귄마을 교수 서재 전체 감사
 *
 * 출력: 각 퀴즈의 isPublic / isPublished / publicRewarded 조합
 * 분류:
 *   [정상-공개]   isPublished=true  AND publicRewarded=true   → 교수가 실제 공개 토글한 것
 *   [정상-비공개] isPublished=false (또는 isPublic=false 일관) → 비공개 상태
 *   [위험]        isPublished=undefined → 폴백에 의존, 데이터 비정합
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
    snap.forEach(d => { if (!seen.has(d.id)) seen.set(d.id, d.data()); });
  }

  const rows = [];
  for (const [id, d] of seen.entries()) {
    rows.push({
      id,
      title: d.title,
      type: d.type,
      courseId: d.courseId,
      isPublic: d.isPublic,
      isPublished: d.isPublished,
      publicRewarded: d.publicRewarded,
    });
  }

  // 정렬: course → type → title
  rows.sort((a, b) =>
    (a.courseId || '').localeCompare(b.courseId || '') ||
    (a.type     || '').localeCompare(b.type     || '') ||
    (a.title    || '').localeCompare(b.title    || '', 'ko')
  );

  let cnt = { okPub: 0, okPriv: 0, risky: 0 };
  const risky = [];

  console.log(`펭귄마을 교수 서재 ${rows.length}개\n`);
  for (const r of rows) {
    let tag;
    if (r.isPublished === undefined) {
      tag = '⚠️ 위험(폴백)';
      cnt.risky++;
      risky.push(r);
    } else if (r.isPublished === true) {
      tag = '✓  공개';
      cnt.okPub++;
    } else {
      tag = '·  비공개';
      cnt.okPriv++;
    }
    console.log(`${tag} | ${(r.courseId||'?').padEnd(16)} | ${(r.type||'?').padEnd(12)} | isPub=${String(r.isPublic).padEnd(5)} isPubd=${String(r.isPublished).padEnd(9)} rew=${String(r.publicRewarded).padEnd(5)} | ${r.title}`);
  }

  console.log(`\n=== 요약 ===`);
  console.log(`공개 (isPublished=true): ${cnt.okPub}`);
  console.log(`비공개 (isPublished=false): ${cnt.okPriv}`);
  console.log(`⚠️ 위험 (isPublished 필드 없음): ${cnt.risky}`);

  if (risky.length > 0) {
    console.log(`\n=== ⚠️ 정합화 필요한 퀴즈 ${risky.length}개 ===`);
    console.log(`(아래는 backfill 대상 후보. publicRewarded=true 이면 isPublished=true, 그 외엔 false)`);
    for (const r of risky) {
      const target = r.publicRewarded === true ? 'true' : 'false';
      console.log(`  ${r.id} → isPublished=${target}  "${r.title}"`);
    }
  }
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => process.exit(0));
