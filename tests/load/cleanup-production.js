/**
 * 프로덕션 부하 테스트 데이터 정리
 *
 * 사용법:
 *   node tests/load/cleanup-production.js
 *
 * 삭제 대상:
 *   - Auth: load-test-* 계정
 *   - Firestore: isLoadTest === true 문서 + load-test-* 관련 문서
 */

const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const fs = require("fs");
const path = require("path");

const SA_PATH = path.resolve(__dirname, "../../serviceAccountKey.json");
const sa = JSON.parse(fs.readFileSync(SA_PATH, "utf8"));
const app = initializeApp({ credential: cert(sa) });
const db = getFirestore(app);
const auth = getAuth(app);

const NUM_STUDENTS = 300;
const NUM_PROFESSORS = 1;
const UID_PREFIX = "load-test-";
const COURSES = ["biology", "microbiology"];

// ── Auth 계정 삭제 ──

async function cleanupAuth() {
  console.log("Auth 계정 삭제 중...");
  const uids = [];

  for (let i = 0; i < NUM_STUDENTS; i++) {
    uids.push(`${UID_PREFIX}${String(i).padStart(4, "0")}`);
  }
  for (let i = 0; i < NUM_PROFESSORS; i++) {
    uids.push(`${UID_PREFIX}prof-${i}`);
  }

  // deleteUsers는 최대 1000명씩 가능
  const batchSize = 1000;
  for (let i = 0; i < uids.length; i += batchSize) {
    const batch = uids.slice(i, i + batchSize);
    try {
      const result = await auth.deleteUsers(batch);
      console.log(`  Auth ${result.successCount}명 삭제, ${result.failureCount}명 실패`);
    } catch (e) {
      console.warn(`  Auth 삭제 실패:`, e.message);
    }
  }
}

// ── Firestore 문서 삭제 ──

async function deleteCollection(collectionPath, batchSize = 499) {
  const collectionRef = db.collection(collectionPath);
  let deleted = 0;

  while (true) {
    const snapshot = await collectionRef.limit(batchSize).get();
    if (snapshot.empty) break;

    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += snapshot.size;
  }

  return deleted;
}

async function cleanupFirestore() {
  console.log("Firestore 정리 중...");

  // 1. users/{uid} + 하위 컬렉션
  for (let i = 0; i < NUM_STUDENTS; i++) {
    const uid = `${UID_PREFIX}${String(i).padStart(4, "0")}`;
    // rabbitHoldings 서브컬렉션
    await deleteCollection(`users/${uid}/rabbitHoldings`);
    // expHistory 서브컬렉션
    await deleteCollection(`users/${uid}/expHistory`);
    // users 문서
    await db.doc(`users/${uid}`).delete();
  }
  for (let i = 0; i < NUM_PROFESSORS; i++) {
    const uid = `${UID_PREFIX}prof-${i}`;
    await db.doc(`users/${uid}`).delete();
  }
  console.log("  users 삭제 완료");

  // 2. 퀴즈
  for (const courseId of COURSES) {
    for (let q = 0; q < 20; q++) {
      const quizId = `load-test-${courseId}-quiz-${q}`;
      await db.doc(`quizzes/${quizId}`).delete();

      // 관련 quiz_completions, quizResults, quiz_agg
      const completions = await db.collection("quiz_completions")
        .where("quizId", "==", quizId).get();
      if (!completions.empty) {
        const batch = db.batch();
        completions.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    }
  }
  console.log("  퀴즈 삭제 완료");

  // 3. quizResults (load-test 유저)
  for (let i = 0; i < NUM_STUDENTS; i++) {
    const uid = `${UID_PREFIX}${String(i).padStart(4, "0")}`;
    const results = await db.collection("quizResults")
      .where("userId", "==", uid).limit(100).get();
    if (!results.empty) {
      const batch = db.batch();
      results.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  }
  console.log("  quizResults 삭제 완료");

  // 4. quiz_submit_locks (load-test 유저)
  const locks = await db.collection("quiz_submit_locks").get();
  if (!locks.empty) {
    let batch = db.batch();
    let count = 0;
    for (const doc of locks.docs) {
      if (doc.id.includes(UID_PREFIX)) {
        batch.delete(doc.ref);
        count++;
        if (count >= 499) {
          await batch.commit();
          batch = db.batch();
          count = 0;
        }
      }
    }
    if (count > 0) await batch.commit();
  }
  console.log("  quiz_submit_locks 삭제 완료");

  // 5. reviews (load-test 유저)
  for (let i = 0; i < NUM_STUDENTS; i += 50) {
    const uids = [];
    for (let j = i; j < Math.min(i + 50, NUM_STUDENTS); j++) {
      uids.push(`${UID_PREFIX}${String(j).padStart(4, "0")}`);
    }
    // Firestore in 쿼리 최대 30개
    for (let k = 0; k < uids.length; k += 30) {
      const chunk = uids.slice(k, k + 30);
      const snap = await db.collection("reviews")
        .where("userId", "in", chunk).limit(500).get();
      if (!snap.empty) {
        const batch = db.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    }
  }
  console.log("  reviews 삭제 완료");

  // 6. posts (load-test 유저)
  const posts = await db.collection("posts")
    .where("isLoadTest", "==", true).get();
  if (!posts.empty) {
    const batch = db.batch();
    posts.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  // authorId 기반으로도 삭제
  for (let i = 0; i < NUM_STUDENTS; i += 30) {
    const uids = [];
    for (let j = i; j < Math.min(i + 30, NUM_STUDENTS); j++) {
      uids.push(`${UID_PREFIX}${String(j).padStart(4, "0")}`);
    }
    const snap = await db.collection("posts")
      .where("authorId", "in", uids).limit(500).get();
    if (!snap.empty) {
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  }
  console.log("  posts 삭제 완료");

  // 7. comments (load-test 유저)
  for (let i = 0; i < NUM_STUDENTS; i += 30) {
    const uids = [];
    for (let j = i; j < Math.min(i + 30, NUM_STUDENTS); j++) {
      uids.push(`${UID_PREFIX}${String(j).padStart(4, "0")}`);
    }
    const snap = await db.collection("comments")
      .where("authorId", "in", uids).limit(500).get();
    if (!snap.empty) {
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  }
  console.log("  comments 삭제 완료");

  // 8. allowedProfessors (테스트 교수)
  await db.doc("allowedProfessors/loadprof0@test.rabbitory.internal").delete();
  console.log("  allowedProfessors 삭제 완료");

  // 9. 배틀 문제 풀 (load-test 태그만)
  for (const courseId of COURSES) {
    const snap = await db.collection(`tekkenQuestionPool/${courseId}/questions`)
      .where("isLoadTest", "==", true).get();
    if (!snap.empty) {
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      console.log(`  ${courseId} 테스트 배틀 문제 ${snap.size}개 삭제`);
    }
  }

  // 10. feedbacks (load-test 유저)
  for (let i = 0; i < NUM_STUDENTS; i += 30) {
    const uids = [];
    for (let j = i; j < Math.min(i + 30, NUM_STUDENTS); j++) {
      uids.push(`${UID_PREFIX}${String(j).padStart(4, "0")}`);
    }
    const snap = await db.collection("feedbacks")
      .where("userId", "in", uids).limit(500).get();
    if (!snap.empty) {
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  }
  console.log("  feedbacks 삭제 완료");

  // 11. jobs (load-test 유저)
  for (let i = 0; i < NUM_STUDENTS; i += 30) {
    const uids = [];
    for (let j = i; j < Math.min(i + 30, NUM_STUDENTS); j++) {
      uids.push(`${UID_PREFIX}${String(j).padStart(4, "0")}`);
    }
    const snap = await db.collection("jobs")
      .where("userId", "in", uids).limit(500).get();
    if (!snap.empty) {
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  }
  console.log("  jobs 삭제 완료");
}

// ── 메인 ──

async function main() {
  console.log("=== 프로덕션 부하 테스트 데이터 정리 ===\n");
  console.log("삭제 대상: load-test-* 계정 + 관련 Firestore 문서\n");

  await cleanupAuth();
  await cleanupFirestore();

  console.log("\n=== 정리 완료! ===");
}

main().catch((e) => {
  console.error("정리 실패:", e);
  process.exit(1);
});
