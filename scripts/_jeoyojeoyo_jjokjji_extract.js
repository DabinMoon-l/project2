/**
 * quizId 로 직접 quiz 데이터 추출 (소유자 검색 우회)
 *
 * 사용:
 *   node scripts/_jeoyojeoyo_jjokjji_extract.js cOQ7T9ppyKCdZkkzU3wz
 *
 * 출력: scripts/_jeoyojeoyo_jjokjji_data.json
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

admin.initializeApp({
  credential: admin.credential.cert(
    require(path.join(__dirname, '../serviceAccountKey.json'))
  ),
});
const db = admin.firestore();

async function main() {
  const quizId = process.argv[2];
  if (!quizId) {
    console.error('사용법: node scripts/_jeoyojeoyo_jjokjji_extract.js <quizId>');
    process.exit(1);
  }

  const snap = await db.collection('quizzes').doc(quizId).get();
  if (!snap.exists) {
    console.error(`❌ quizzes/${quizId} 없음`);
    process.exit(1);
  }
  const d = snap.data();

  console.log(`[quiz] ${quizId}`);
  console.log(`  title:    ${d.title}`);
  console.log(`  category: ${d.category}`);
  console.log(`  type:     ${d.type}`);
  console.log(`  courseId: ${d.courseId}`);
  console.log(`  questions: ${(d.questions || []).length}개`);
  console.log(`  ownerId:  ${d.ownerId || '-'}`);
  console.log(`  creatorUid: ${d.creatorUid || '-'}`);
  console.log(`  isPublic: ${d.isPublic}, isPublished: ${d.isPublished}`);

  const questions = (d.questions || []).map((q, idx) => ({
    idx: idx + 1,
    id: q.id,
    type: q.type,
    question: q.question,
    choices: q.choices || null,
    answer: q.answer,
    passageText: q.passageText || null,
    bogiText: q.bogiText || null,
    chapterTags: q.chapterTags || [],
    chapterDetailId: q.chapterDetailId || null,
    existingExplanation: q.explanation || null,
    existingChoiceExplanations: q.choiceExplanations || null,
  }));

  // 통계
  const types = {};
  let hasExp = 0;
  let hasChoiceExp = 0;
  const chaptersUsed = new Set();
  const detailsUsed = new Set();
  for (const q of questions) {
    types[q.type] = (types[q.type] || 0) + 1;
    if (q.existingExplanation) hasExp++;
    if (q.existingChoiceExplanations && q.existingChoiceExplanations.length > 0) hasChoiceExp++;
    for (const t of q.chapterTags) chaptersUsed.add(t);
    if (q.chapterDetailId) detailsUsed.add(q.chapterDetailId);
  }
  console.log(`\n[통계]`);
  console.log(`  유형: ${JSON.stringify(types)}`);
  console.log(`  기존 explanation: ${hasExp}/${questions.length}`);
  console.log(`  기존 choiceExplanations: ${hasChoiceExp}/${questions.length}`);
  console.log(`  chapterTags 사용: ${Array.from(chaptersUsed).join(', ')}`);
  console.log(`  chapterDetailId 사용: ${Array.from(detailsUsed).join(', ')}`);

  const output = {
    quizId,
    title: d.title,
    category: d.category,
    courseId: d.courseId,
    ownerId: d.ownerId || null,
    questionCount: questions.length,
    questions,
  };

  const outPath = path.join(__dirname, '_jeoyojeoyo_jjokjji_data.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\n✓ ${outPath} 저장`);
}

main()
  .catch((e) => {
    console.error('오류:', e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
