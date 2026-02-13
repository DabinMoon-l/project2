/**
 * 부하 테스트 데이터 정리 스크립트
 *
 * k6가 아닌 Node.js로 실행합니다:
 *   node load-tests/cleanup-test-data.js
 *
 * 테스트 사용자, 게시글, 댓글, 퀴즈 결과 등을 일괄 삭제합니다.
 */

const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();
const auth = admin.auth();

const BATCH_SIZE = 500;

// Firestore 일괄 삭제 헬퍼
async function deleteQueryBatch(query, label) {
  let totalDeleted = 0;

  while (true) {
    const snapshot = await query.limit(BATCH_SIZE).get();

    if (snapshot.size === 0) break;

    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();

    totalDeleted += snapshot.size;
    console.log(`  ${label}: ${totalDeleted}건 삭제됨...`);
  }

  return totalDeleted;
}

async function cleanup() {
  console.log("=== 부하 테스트 데이터 정리 시작 ===\n");

  // 1. 테스트 게시글 삭제 ([부하테스트], [혼합테스트] 제목)
  console.log("1. 테스트 게시글 삭제...");
  const postsQuery = db
    .collection("posts")
    .where("authorNickname", ">=", "로드테스트")
    .where("authorNickname", "<=", "로드테스트\uf8ff");
  const postsDeleted = await deleteQueryBatch(postsQuery, "게시글");
  console.log(`   완료: ${postsDeleted}건\n`);

  // 2. 테스트 댓글 삭제
  console.log("2. 테스트 댓글 삭제...");
  const commentsQuery = db
    .collection("comments")
    .where("authorNickname", ">=", "로드테스트")
    .where("authorNickname", "<=", "로드테스트\uf8ff");
  const commentsDeleted = await deleteQueryBatch(commentsQuery, "댓글");
  console.log(`   완료: ${commentsDeleted}건\n`);

  // 3. 테스트 퀴즈 삭제
  console.log("3. 테스트 퀴즈 삭제...");
  const quizzesQuery = db
    .collection("quizzes")
    .where("creatorId", "==", "system")
    .where("title", ">=", "[부하 테스트]")
    .where("title", "<=", "[부하 테스트]\uf8ff");
  const quizzesDeleted = await deleteQueryBatch(quizzesQuery, "퀴즈");
  console.log(`   완료: ${quizzesDeleted}건\n`);

  // 4. 테스트 사용자의 퀴즈 결과 삭제
  console.log("4. 테스트 퀴즈 결과 삭제...");
  let resultsDeleted = 0;
  for (let i = 0; i < 300; i++) {
    const paddedIndex = String(i).padStart(3, "0");
    const email = `loadtest-user-${paddedIndex}@test.com`;

    try {
      const userRecord = await auth.getUserByEmail(email);
      const resultQuery = db
        .collection("quizResults")
        .where("userId", "==", userRecord.uid);
      resultsDeleted += await deleteQueryBatch(resultQuery, `유저${paddedIndex} 결과`);
    } catch {
      // 사용자가 없으면 건너뜀
    }
  }
  console.log(`   완료: ${resultsDeleted}건\n`);

  // 5. 테스트 사용자의 리뷰 삭제
  console.log("5. 테스트 리뷰 삭제...");
  let reviewsDeleted = 0;
  for (let i = 0; i < 300; i++) {
    const paddedIndex = String(i).padStart(3, "0");
    const email = `loadtest-user-${paddedIndex}@test.com`;

    try {
      const userRecord = await auth.getUserByEmail(email);
      const reviewQuery = db
        .collection("reviews")
        .where("userId", "==", userRecord.uid);
      reviewsDeleted += await deleteQueryBatch(reviewQuery, `유저${paddedIndex} 리뷰`);
    } catch {
      // 사용자가 없으면 건너뜀
    }
  }
  console.log(`   완료: ${reviewsDeleted}건\n`);

  // 6. 테스트 Auth 사용자 삭제 (선택)
  const deleteAuthUsers = process.argv.includes("--delete-users");
  if (deleteAuthUsers) {
    console.log("6. Auth 사용자 삭제...");
    let usersDeleted = 0;

    for (let i = 0; i < 300; i++) {
      const paddedIndex = String(i).padStart(3, "0");
      const email = `loadtest-user-${paddedIndex}@test.com`;

      try {
        const userRecord = await auth.getUserByEmail(email);
        // Firestore 사용자 문서 삭제
        await db.collection("users").doc(userRecord.uid).delete();
        // Auth 사용자 삭제
        await auth.deleteUser(userRecord.uid);
        usersDeleted++;
      } catch {
        // 사용자가 없으면 건너뜀
      }
    }
    console.log(`   완료: ${usersDeleted}명\n`);
  } else {
    console.log("6. Auth 사용자 유지 (삭제하려면 --delete-users 옵션 추가)\n");
  }

  console.log("=== 정리 완료 ===");
}

cleanup()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("정리 실패:", err);
    process.exit(1);
  });
