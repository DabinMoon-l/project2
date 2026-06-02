/**
 * 저요저요 계정의 "쪽찌시험" 19문제 퀴즈 찾기
 *
 * 사용: node scripts/_jeoyojeoyo_jjokjji_find.js
 * 출력: scripts/_jeoyojeoyo_jjokjji_data.json (다음 단계 입력)
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
  // 1. "저요저요" 닉네임으로 user 찾기
  const usersSnap = await db
    .collection('users')
    .where('nickname', '==', '저요저요')
    .limit(5)
    .get();

  if (usersSnap.empty) {
    console.error('❌ 닉네임 "저요저요" 사용자 없음');
    process.exit(1);
  }

  console.log(`[1단계] 닉네임 매칭 ${usersSnap.size}건:`);
  for (const u of usersSnap.docs) {
    const d = u.data();
    console.log(
      `  uid=${u.id} | nickname=${d.nickname} | studentId=${d.studentId || '-'} | courseId=${d.courseId || '-'}`
    );
  }

  const targetUser = usersSnap.docs[0];
  const ownerId = targetUser.id;
  const courseId = targetUser.data().courseId || 'microbiology';
  console.log(`\n[선택] uid=${ownerId}, courseId=${courseId}`);

  // 2. 그 uid가 owner인 모든 quizzes — 사용자가 직접 골라 선택
  //    환경변수 TARGET_QUIZ_ID 로 지정하면 그 quizId 만 추출
  const targetQuizId = process.env.TARGET_QUIZ_ID;
  const quizzesSnap = await db
    .collection('quizzes')
    .where('ownerId', '==', ownerId)
    .get();

  console.log(`\n[2단계] ownerId 매칭 ${quizzesSnap.size}건 — 전체 목록:`);
  const sortedQuizzes = quizzesSnap.docs
    .map((d) => ({ id: d.id, data: d.data() }))
    .sort((a, b) => {
      const at = a.data.updatedAt?.toMillis?.() || a.data.createdAt?.toMillis?.() || 0;
      const bt = b.data.updatedAt?.toMillis?.() || b.data.createdAt?.toMillis?.() || 0;
      return bt - at;  // 최신순
    });

  for (const { id, data } of sortedQuizzes) {
    const qLen = (data.questions || []).length;
    const title = data.title || '(제목 없음)';
    const mark = targetQuizId === id ? '★ ' : '  ';
    // "쪽" 글자 포함이면 강조
    const hint = title.includes('쪽') ? ' ← 후보' : '';
    console.log(`${mark}${id} | "${title}" | ${qLen}문제 | ${data.category || '-'}${hint}`);
  }

  // 환경변수로 지정 안했으면 여기서 종료 — 사용자가 quizId 보고 다시 실행
  if (!targetQuizId) {
    console.log(
      `\n💡 위 목록에서 쪽찌시험에 해당하는 quizId를 골라 다시 실행:\n` +
      `   TARGET_QUIZ_ID=<quizId> node scripts/_jeoyojeoyo_jjokjji_find.js`
    );
    return;
  }

  const target = sortedQuizzes.find((q) => q.id === targetQuizId);
  if (!target) {
    console.error(`\n❌ TARGET_QUIZ_ID=${targetQuizId} 매칭 안됨`);
    process.exit(1);
  }
  console.log(`\n[선택] quizId=${target.id}, title="${target.data.title}"`);

  // 3. 문제 본문 + 선지 추출
  const questions = target.data.questions.map((q) => ({
    id: q.id,
    type: q.type,
    question: q.question,
    choices: q.choices || null,
    answer: q.answer,
    chapterTags: q.chapterTags || [],
    chapterDetailId: q.chapterDetailId || null,
    existingExplanation: q.explanation || null,
    existingChoiceExplanations: q.choiceExplanations || null,
  }));

  const output = {
    quizId: target.id,
    title: target.data.title,
    ownerId,
    courseId,
    category: target.data.category,
    questionCount: questions.length,
    questions,
  };

  const outPath = path.join(__dirname, '_jeoyojeoyo_jjokjji_data.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\n✓ ${outPath} 저장 (${questions.length}문제)`);

  // 4. 요약 통계
  const types = {};
  let hasExp = 0;
  let hasChoiceExp = 0;
  for (const q of questions) {
    types[q.type] = (types[q.type] || 0) + 1;
    if (q.existingExplanation) hasExp++;
    if (q.existingChoiceExplanations && q.existingChoiceExplanations.length > 0) hasChoiceExp++;
  }
  console.log(`\n[통계]`);
  console.log(`  문제 유형: ${JSON.stringify(types)}`);
  console.log(`  기존 explanation 있음: ${hasExp}/${questions.length}`);
  console.log(`  기존 choiceExplanations 있음: ${hasChoiceExp}/${questions.length}`);
  console.log(`  → 채워야 할 explanation: ${questions.length - hasExp}개`);
  console.log(`  → 채워야 할 choiceExplanations: ${questions.length - hasChoiceExp}개 (객관식 한정)`);
}

main()
  .catch((e) => {
    console.error('오류:', e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
