/**
 * 펭귄마을(생물학 교수)로 이동한 8~12단원 연습문제 5개의 공개 전환 여부 확인
 *
 * 확인 항목:
 * - isPublic: 현재 학생에게 공개되는지
 * - isPublished: 공개 출제(분석 트리거) 여부
 * - publicRewarded / publicRewardedAt: 최초 공개 전환 시각 (onQuizMakePublic CF가 false→true 시 1회 기록)
 * - creatorNickname, creatorClassType, type: 이동 결과 검증
 * - updatedAt: 마지막 수정 시각 (이동 후 교수가 추가로 토글했는지 추정)
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

function fmtTs(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
}

async function main() {
  console.log(`생물학 펭귄마을 이동 퀴즈 ${QUIZ_IDS.length}개 — 공개 전환 상태\n`);

  let publicCount = 0;
  let publishedCount = 0;
  let rewardedCount = 0;

  for (const { id, label } of QUIZ_IDS) {
    const snap = await db.collection('quizzes').doc(id).get();
    if (!snap.exists) {
      console.log(`[${label}] ${id} 없음\n`);
      continue;
    }
    const d = snap.data();

    if (d.isPublic) publicCount++;
    if (d.isPublished) publishedCount++;
    if (d.publicRewarded) rewardedCount++;

    console.log(`[${label}] "${d.title}"  id=${id}`);
    console.log(`  type=${d.type}  creator=${d.creatorNickname}(${d.creatorClassType ?? 'null'})`);
    console.log(`  isPublic=${!!d.isPublic}  isPublished=${!!d.isPublished}`);
    console.log(`  publicRewarded=${!!d.publicRewarded}  publicRewardedAt=${fmtTs(d.publicRewardedAt)}`);
    console.log(`  createdAt=${fmtTs(d.createdAt)}  updatedAt=${fmtTs(d.updatedAt)}`);
    console.log('');
  }

  console.log('=== 요약 ===');
  console.log(`isPublic=true : ${publicCount}/${QUIZ_IDS.length}`);
  console.log(`isPublished=true : ${publishedCount}/${QUIZ_IDS.length}`);
  console.log(`publicRewarded=true (최초 공개 전환 기록 있음) : ${rewardedCount}/${QUIZ_IDS.length}`);
  console.log('');
  console.log('※ publicRewardedAt 이 비어있고 isPublic=false 면 교수가 공개 전환한 적이 한 번도 없는 것.');
  console.log('※ publicRewardedAt 에 시각이 찍혀 있으면 그 시점에 교수가 토글한 것 (CF 로그 기준).');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => process.exit(0));
