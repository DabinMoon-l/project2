/**
 * 전체 데이터 초기화 + 로드테스트 계정 300개 삭제 스크립트
 *
 * 실행: node scripts/cleanup-all-data.js
 *
 * 삭제 대상:
 * 1. 공지 (announcements)
 * 2. 랭킹 (rankings, radarNorm)
 * 3. 게시판 (posts + comments + likes)
 * 4. 퀴즈 + 관련 (quizzes, quizResults, quiz_completions, quiz_agg,
 *    quizProgress, submissions, feedbacks, questionFeedbacks, quizJobs)
 * 5. 복습 (reviews, deletedReviewItems)
 * 6. 찜기록 (quizBookmarks)
 * 7. 서재 (jobs, materials)
 * 8. 커스텀폴더 (customFolders)
 * 9. 교수 퀴즈 분석 (professorQuizAnalysis)
 * 10. 로드테스트 계정 300개 (Auth + Firestore + 서브컬렉션)
 *
 * ⚠️ 다른 테스트 계정은 삭제하지 않습니다!
 */

const admin = require("firebase-admin");
const path = require("path");
const readline = require("readline");

// Firebase Admin 초기화
const serviceAccountPath = path.join(__dirname, "../serviceAccountKey.json");
admin.initializeApp({
  credential: admin.credential.cert(require(serviceAccountPath)),
});

const db = admin.firestore();
const auth = admin.auth();
const BATCH_SIZE = 500;

// ── 헬퍼 함수 ──

/** 컬렉션의 모든 문서를 배치 삭제 (서브컬렉션 없는 경우) */
async function deleteCollection(collectionPath, label) {
  const collRef = db.collection(collectionPath);
  let totalDeleted = 0;

  while (true) {
    const snapshot = await collRef.limit(BATCH_SIZE).get();
    if (snapshot.size === 0) break;

    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();

    totalDeleted += snapshot.size;
    process.stdout.write(`  ${label}: ${totalDeleted}건 삭제됨...\r`);
  }

  if (totalDeleted > 0) console.log(`  ${label}: ${totalDeleted}건 삭제 완료`);
  return totalDeleted;
}

/** 컬렉션의 모든 문서 + 서브컬렉션까지 재귀 삭제 */
async function deleteCollectionRecursive(collectionPath, label) {
  const collRef = db.collection(collectionPath);
  let totalDeleted = 0;

  while (true) {
    const snapshot = await collRef.limit(BATCH_SIZE).get();
    if (snapshot.size === 0) break;

    // 각 문서의 서브컬렉션 먼저 삭제
    for (const doc of snapshot.docs) {
      const subcollections = await doc.ref.listCollections();
      for (const sub of subcollections) {
        await deleteSubcollection(sub);
      }
    }

    // 문서 삭제
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();

    totalDeleted += snapshot.size;
    process.stdout.write(`  ${label}: ${totalDeleted}건 삭제됨...\r`);
  }

  if (totalDeleted > 0) console.log(`  ${label}: ${totalDeleted}건 삭제 완료`);
  return totalDeleted;
}

/** 서브컬렉션 전체 삭제 (내부용) */
async function deleteSubcollection(collRef) {
  while (true) {
    const snapshot = await collRef.limit(BATCH_SIZE).get();
    if (snapshot.size === 0) break;

    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
}

/** 사용자에게 확인 프롬프트 */
function confirm(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

// ── 메인 ──

async function cleanup() {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║   ⚠️  전체 데이터 초기화 스크립트           ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  console.log("삭제 대상:");
  console.log("  - 공지 (announcements)");
  console.log("  - 랭킹 (rankings, radarNorm)");
  console.log("  - 게시판 (posts, comments, likes)");
  console.log("  - 퀴즈 + 관련 데이터 (quizzes, quizResults 등)");
  console.log("  - 복습 (reviews, deletedReviewItems)");
  console.log("  - 찜기록 (quizBookmarks)");
  console.log("  - 서재 (jobs, materials)");
  console.log("  - 커스텀폴더 (customFolders)");
  console.log("  - 교수 퀴즈 분석 (professorQuizAnalysis)");
  console.log("  - 로드테스트 계정 300개 (loadtest-user-000 ~ 299)");
  console.log("");

  const ok = await confirm("정말 삭제하시겠습니까? (y/N): ");
  if (!ok) {
    console.log("취소됨.");
    return;
  }

  console.log("\n=== 삭제 시작 ===\n");
  const results = {};

  // ── 1. 공지 ──
  console.log("[1/10] 공지 삭제...");
  results.announcements = await deleteCollection("announcements", "공지");

  // ── 2. 랭킹 ──
  console.log("\n[2/10] 랭킹 삭제...");
  results.rankings = await deleteCollection("rankings", "랭킹");
  results.radarNorm = await deleteCollection("radarNorm", "레이더");

  // ── 3. 게시판 ──
  console.log("\n[3/10] 게시판 삭제...");
  results.posts = await deleteCollectionRecursive("posts", "게시글");
  results.comments = await deleteCollection("comments", "댓글");
  results.likes = await deleteCollection("likes", "좋아요");

  // ── 4. 퀴즈 + 관련 데이터 ──
  console.log("\n[4/10] 퀴즈 + 관련 데이터 삭제...");
  results.quizzes = await deleteCollectionRecursive("quizzes", "퀴즈");
  results.quizResults = await deleteCollection("quizResults", "퀴즈결과");
  results.quizCompletions = await deleteCollection("quiz_completions", "퀴즈완료");
  results.quizAgg = await deleteCollectionRecursive("quiz_agg", "퀴즈통계");
  results.quizProgress = await deleteCollection("quizProgress", "퀴즈진행");
  results.submissions = await deleteCollection("submissions", "제출");
  results.feedbacks = await deleteCollection("feedbacks", "피드백");
  results.questionFeedbacks = await deleteCollection("questionFeedbacks", "문제피드백");
  results.quizJobs = await deleteCollection("quizJobs", "퀴즈작업");

  // ── 5. 복습 ──
  console.log("\n[5/10] 복습 삭제...");
  results.reviews = await deleteCollection("reviews", "복습");
  results.deletedReviews = await deleteCollection("deletedReviewItems", "삭제된복습");

  // ── 6. 찜기록 ──
  console.log("\n[6/10] 찜기록 삭제...");
  results.bookmarks = await deleteCollection("quizBookmarks", "찜기록");

  // ── 7. 서재 ──
  console.log("\n[7/10] 서재 삭제...");
  results.jobs = await deleteCollection("jobs", "서재(jobs)");
  results.materials = await deleteCollection("materials", "서재(materials)");

  // ── 8. 커스텀폴더 ──
  console.log("\n[8/10] 커스텀폴더 삭제...");
  results.customFolders = await deleteCollection("customFolders", "커스텀폴더");

  // ── 9. 교수 퀴즈 분석 ──
  console.log("\n[9/10] 교수 퀴즈 분석 삭제...");
  results.profAnalysis = await deleteCollectionRecursive(
    "professorQuizAnalysis",
    "교수퀴즈분석"
  );

  // ── 10. 로드테스트 계정 300개 삭제 ──
  console.log("\n[10/10] 로드테스트 계정 300개 삭제...");

  // 10-1. 일괄 UID 수집 (100명씩 getUsers)
  const uidMap = {}; // index → uid
  for (let start = 0; start < 300; start += 100) {
    const end = Math.min(start + 100, 300);
    const identifiers = [];
    for (let i = start; i < end; i++) {
      identifiers.push({
        email: `loadtest-user-${String(i).padStart(3, "0")}@test.com`,
      });
    }
    try {
      const result = await auth.getUsers(identifiers);
      for (const user of result.users) {
        const match = user.email.match(/loadtest-user-(\d+)@/);
        if (match) uidMap[parseInt(match[1], 10)] = user.uid;
      }
    } catch (err) {
      console.error(`  getUsers 오류 (${start}~${end}):`, err.message);
    }
  }

  const uids = Object.values(uidMap);
  console.log(`  로드테스트 계정 발견: ${uids.length}개`);

  if (uids.length > 0) {
    // 10-2. Firestore 사용자 문서 + 서브컬렉션 삭제
    let fsDeleted = 0;
    for (const uid of uids) {
      const userRef = db.collection("users").doc(uid);
      const doc = await userRef.get();
      if (doc.exists) {
        // 서브컬렉션 삭제 (quizHistory, expHistory, rabbitHoldings 등)
        const subcollections = await userRef.listCollections();
        for (const sub of subcollections) {
          await deleteSubcollection(sub);
        }
        await userRef.delete();
        fsDeleted++;
      }
      if (fsDeleted % 50 === 0 && fsDeleted > 0) {
        process.stdout.write(
          `  Firestore 유저 문서: ${fsDeleted}/${uids.length} 삭제됨...\r`
        );
      }
    }
    console.log(`  Firestore 유저 문서: ${fsDeleted}건 삭제 완료`);

    // 10-3. Auth 사용자 일괄 삭제 (1000명까지 한 번에 가능)
    try {
      const deleteResult = await auth.deleteUsers(uids);
      console.log(
        `  Auth 계정: ${deleteResult.successCount}명 삭제, ${deleteResult.failureCount}명 실패`
      );
      if (deleteResult.failureCount > 0) {
        deleteResult.errors.slice(0, 5).forEach((err) => {
          console.error(`    - index ${err.index}: ${err.error.message}`);
        });
      }
    } catch (err) {
      console.error("  Auth 일괄 삭제 실패:", err.message);
      // 개별 삭제 폴백
      let authDeleted = 0;
      for (const uid of uids) {
        try {
          await auth.deleteUser(uid);
          authDeleted++;
        } catch {
          // 이미 삭제된 경우 무시
        }
      }
      console.log(`  Auth 개별 삭제: ${authDeleted}명`);
    }

    results.loadTestUsers = uids.length;
  } else {
    results.loadTestUsers = 0;
    console.log("  로드테스트 계정 없음 (이미 삭제됨)");
  }

  // ── 결과 요약 ──
  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║             삭제 결과 요약                   ║");
  console.log("╠══════════════════════════════════════════════╣");
  console.log(`║  공지:           ${String(results.announcements).padStart(6)}건                ║`);
  console.log(`║  랭킹:           ${String(results.rankings).padStart(6)}건                ║`);
  console.log(`║  레이더:         ${String(results.radarNorm).padStart(6)}건                ║`);
  console.log(`║  게시글:         ${String(results.posts).padStart(6)}건                ║`);
  console.log(`║  댓글:           ${String(results.comments).padStart(6)}건                ║`);
  console.log(`║  좋아요:         ${String(results.likes).padStart(6)}건                ║`);
  console.log(`║  퀴즈:           ${String(results.quizzes).padStart(6)}건                ║`);
  console.log(`║  퀴즈결과:       ${String(results.quizResults).padStart(6)}건                ║`);
  console.log(`║  퀴즈완료:       ${String(results.quizCompletions).padStart(6)}건                ║`);
  console.log(`║  퀴즈통계:       ${String(results.quizAgg).padStart(6)}건                ║`);
  console.log(`║  제출:           ${String(results.submissions).padStart(6)}건                ║`);
  console.log(`║  피드백:         ${String(results.feedbacks).padStart(6)}건                ║`);
  console.log(`║  문제피드백:     ${String(results.questionFeedbacks).padStart(6)}건                ║`);
  console.log(`║  복습:           ${String(results.reviews).padStart(6)}건                ║`);
  console.log(`║  찜기록:         ${String(results.bookmarks).padStart(6)}건                ║`);
  console.log(`║  서재(jobs):     ${String(results.jobs).padStart(6)}건                ║`);
  console.log(`║  서재(materials):${String(results.materials).padStart(6)}건                ║`);
  console.log(`║  커스텀폴더:     ${String(results.customFolders).padStart(6)}건                ║`);
  console.log(`║  교수분석:       ${String(results.profAnalysis).padStart(6)}건                ║`);
  console.log(`║  로드테스트계정: ${String(results.loadTestUsers).padStart(6)}명                ║`);
  console.log("╚══════════════════════════════════════════════╝");
  console.log("\n=== 초기화 완료 ===");
}

cleanup()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("초기화 실패:", err);
    process.exit(1);
  });
