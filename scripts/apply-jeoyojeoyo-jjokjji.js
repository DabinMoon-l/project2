/**
 * 저요저요 쪽찌시험 해설 Firestore 적용
 *
 * - _jeoyojeoyo_jjokjji_explanations.js 데이터를 quizzes/{quizId}.questions[]에 반영
 * - 기존 필드가 빈 값(null/undefined/빈 배열)일 때만 덮어쓰기 — 사용자 자동 해설 결과 보존
 * - 사용: node scripts/apply-jeoyojeoyo-jjokjji.js [--dry-run]
 */

const admin = require('firebase-admin');
const path = require('path');

admin.initializeApp({
  credential: admin.credential.cert(
    require(path.join(__dirname, '../serviceAccountKey.json'))
  ),
});
const db = admin.firestore();

const EXPLANATIONS = require('./_jeoyojeoyo_jjokjji_explanations.js');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const force = process.argv.includes('--force');
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalPreserved = 0;

  for (const [quizId, questionMap] of Object.entries(EXPLANATIONS)) {
    const ref = db.collection('quizzes').doc(quizId);
    const snap = await ref.get();
    if (!snap.exists) {
      console.log(`❌ quizId=${quizId} 없음`);
      continue;
    }
    const quiz = snap.data();
    const questions = [...(quiz.questions || [])];
    let quizUpdated = 0;

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const exp = questionMap[q.id];
      if (!exp) {
        totalSkipped++;
        continue;
      }

      const updated = { ...q };
      let changed = false;

      // explanation — --force 면 항상 덮어쓰기, 아니면 빈 값일 때만
      if (force || !updated.explanation || updated.explanation === null || updated.explanation === '') {
        updated.explanation = exp.explanation;
        changed = true;
      } else {
        totalPreserved++;
      }

      // choiceExplanations — --force 면 항상 덮어쓰기, 아니면 빈 배열/null일 때만
      if (exp.choiceExplanations && exp.choiceExplanations.length > 0) {
        const isEmpty =
          !updated.choiceExplanations ||
          updated.choiceExplanations.length === 0 ||
          updated.choiceExplanations.every((c) => !c);
        if (force || isEmpty) {
          updated.choiceExplanations = exp.choiceExplanations;
          changed = true;
        }
      }

      if (changed) {
        questions[i] = updated;
        quizUpdated++;
        totalUpdated++;
      }
    }

    console.log(`${dryRun ? '[dry-run]' : '✓'} [${quiz.title}] ${quizUpdated}/${questions.length} 문제 업데이트`);

    if (!dryRun) {
      await ref.update({
        questions,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }

  console.log(
    `\n=== ${dryRun ? '[dry-run] ' : ''}완료: ${totalUpdated} 문제 업데이트, ${totalSkipped} 스킵, ${totalPreserved} 보존(기존 값 유지) ===`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
