/**
 * 철권퀴즈 문제 풀 즉시 재생성 (새 코드 적용)
 * 기존 풀 삭제 → 300문제 새로 생성 (easy 150 + medium 150, 챕터별 분리)
 *
 * 실행: cd functions && node scripts/refresh-pool-now.js
 */
const admin = require("firebase-admin");
const serviceAccount = require("../../serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// ⚠️ 하드코딩 금지 — 실행 시 반드시 env 로 주입
// 예: GEMINI_API_KEY=xxx node scripts/refresh-pool-now.js
// 또는: firebase functions:secrets:access GEMINI_API_KEY
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY env가 필요합니다.");
  process.exit(1);
}

// 빌드된 코드에서 import
const { replenishQuestionPool } = require("../lib/tekkenQuestionPool");

const db = admin.firestore();

async function refreshPool(courseId) {
  const poolRef = db.collection("tekkenQuestionPool").doc(courseId);
  const questionsRef = poolRef.collection("questions");
  const seenRef = poolRef.collection("seenQuestions");

  // 1. 기존 문제 + seenQuestions 삭제
  console.log(`[${courseId}] 기존 풀 삭제 중...`);

  const [existingSnap, seenSnap] = await Promise.all([
    questionsRef.get(),
    seenRef.get(),
  ]);

  const deleteBatch = async (docs) => {
    for (let i = 0; i < docs.length; i += 500) {
      const batch = db.batch();
      docs.slice(i, i + 500).forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }
  };

  await Promise.all([
    existingSnap.empty ? Promise.resolve() : deleteBatch(existingSnap.docs),
    seenSnap.empty ? Promise.resolve() : deleteBatch(seenSnap.docs),
  ]);

  console.log(`[${courseId}] 삭제 완료 (문제 ${existingSnap.size}개, seen ${seenSnap.size}개)`);

  // 2. 300문제 새로 생성
  console.log(`[${courseId}] 300문제 생성 시작...`);
  const startTime = Date.now();

  const result = await replenishQuestionPool(courseId, GEMINI_API_KEY);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[${courseId}] 완료! ${result.added}문제 생성 (${elapsed}초)`);

  // 3. 결과 확인
  const finalSnap = await questionsRef.count().get();
  const easySnap = await questionsRef.where("difficulty", "==", "easy").count().get();
  const mediumSnap = await questionsRef.where("difficulty", "==", "medium").count().get();

  console.log(`[${courseId}] 최종: ${finalSnap.data().count}문제 (easy ${easySnap.data().count}, medium ${mediumSnap.data().count})`);
}

async function main() {
  const courses = ["biology", "microbiology"];

  console.log(`\n=== 문제 풀 즉시 재생성 시작 ===`);
  console.log(`과목: ${courses.join(", ")}`);
  console.log(`목표: 과목당 300문제 (easy 150 + medium 150)\n`);

  for (const courseId of courses) {
    try {
      await refreshPool(courseId);
      console.log();
    } catch (err) {
      console.error(`[${courseId}] 실패:`, err.message || err);
    }
  }

  console.log("=== 완료 ===");
  process.exit(0);
}

main();
