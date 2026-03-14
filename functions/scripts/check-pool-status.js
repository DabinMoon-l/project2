/**
 * 철권퀴즈 문제 풀 상태 확인
 * 실행: node scripts/check-pool-status.js
 */
const admin = require("firebase-admin");
const serviceAccount = require("../serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function checkPool() {
  const courses = ["biology", "microbiology"];

  for (const courseId of courses) {
    const poolRef = db.collection("tekkenQuestionPool").doc(courseId);

    // 메타 문서
    const meta = await poolRef.get();
    const metaData = meta.exists ? meta.data() : null;

    // 실제 문제 수
    const questionsSnap = await poolRef.collection("questions").count().get();
    const actualCount = questionsSnap.data().count;

    // 난이도별 분포
    const easySnap = await poolRef.collection("questions").where("difficulty", "==", "easy").count().get();
    const mediumSnap = await poolRef.collection("questions").where("difficulty", "==", "medium").count().get();
    const hardSnap = await poolRef.collection("questions").where("difficulty", "==", "hard").count().get();

    // seenQuestions 수
    const seenSnap = await poolRef.collection("seenQuestions").count().get();
    const seenCount = seenSnap.data().count;

    console.log(`\n=== ${courseId} ===`);
    console.log(`메타 totalQuestions: ${metaData?.totalQuestions || "없음"}`);
    console.log(`실제 문제 수: ${actualCount}`);
    console.log(`  easy: ${easySnap.data().count}`);
    console.log(`  medium: ${mediumSnap.data().count}`);
    console.log(`  hard: ${hardSnap.data().count}`);
    console.log(`seenQuestions 기록: ${seenCount}개`);
    console.log(`마지막 갱신: ${metaData?.lastRefreshedAt?.toDate?.() || "없음"}`);
  }

  process.exit(0);
}

checkPool().catch(err => {
  console.error("에러:", err);
  process.exit(1);
});
