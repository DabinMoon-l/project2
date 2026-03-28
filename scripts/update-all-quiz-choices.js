/**
 * 선지 편향 수정된 JSON → Firestore 기존 퀴즈 업데이트
 *
 * 대상:
 * - chapter2.normal (4) — 저요저요/25010423 서재
 * - chapter3.normal (3) — 저요저요/25010423 서재
 * - chapter4.normal — 저요저요/25010423 서재 (공개)
 * - chapter4.hard — 저요저요/25010423 서재 (공개)
 *
 * 실행: node scripts/update-all-quiz-choices.js
 */

const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const fs = require("fs");
const path = require("path");

initializeApp();
const db = getFirestore();

const UPDATES = [
  {
    title: "chapter2.normal (4)",
    file: "chapter2-normal-questions.json",
  },
  {
    title: "chapter3.normal (3)",
    file: "chapter3-normal-questions.json",
  },
  {
    title: "chapter4.normal",
    file: "chapter4-normal-questions.json",
  },
  {
    title: "chapter4.hard",
    file: "chapter4-hard-questions.json",
  },
];

async function main() {
  // 1. 25010423 (저요저요) 유저 찾기
  let userId;
  const byStudentId = await db.collection("users")
    .where("studentId", "==", "25010423")
    .limit(1)
    .get();

  if (!byStudentId.empty) {
    userId = byStudentId.docs[0].id;
  } else {
    const byNickname = await db.collection("users")
      .where("nickname", "==", "저요저요")
      .limit(1)
      .get();

    if (byNickname.empty) {
      console.error("❌ 25010423 / '저요저요' 유저를 찾을 수 없습니다");
      process.exit(1);
    }
    userId = byNickname.docs[0].id;
  }
  console.log(`✅ 저요저요 UID: ${userId}\n`);

  // 2. 유저의 전체 퀴즈 조회
  const allQuizzes = await db.collection("quizzes")
    .where("creatorId", "==", userId)
    .get();

  console.log(`📋 전체 퀴즈 ${allQuizzes.size}개\n`);

  const batch = db.batch();
  let updateCount = 0;

  for (const update of UPDATES) {
    // 3. 타이틀로 퀴즈 찾기
    const matchingDocs = allQuizzes.docs.filter(d => {
      const t = d.data().title || "";
      return t === update.title;
    });

    if (matchingDocs.length === 0) {
      console.error(`❌ "${update.title}" 퀴즈를 찾을 수 없습니다`);
      continue;
    }

    // 여러 개 있으면 전부 업데이트 (중복 문서 대비)
    for (const doc of matchingDocs) {
      const filePath = path.join(__dirname, update.file);
      const raw = fs.readFileSync(filePath, "utf-8");
      const questions = JSON.parse(raw);

      batch.update(doc.ref, {
        questions: questions,
        questionCount: questions.length,
        updatedAt: FieldValue.serverTimestamp(),
      });

      const data = doc.data();
      console.log(`✏️ "${update.title}" [${doc.id}]`);
      console.log(`   isPublic: ${data.isPublic}, 기존 문제수: ${(data.questions || []).length} → ${questions.length}`);
      updateCount++;
    }
  }

  if (updateCount === 0) {
    console.error("\n❌ 업데이트할 퀴즈가 없습니다");
    process.exit(1);
  }

  // 4. 배치 커밋
  await batch.commit();
  console.log(`\n✅ ${updateCount}개 퀴즈 업데이트 완료!`);
}

main().catch(err => {
  console.error("❌ 오류:", err.message);
  process.exit(1);
});
