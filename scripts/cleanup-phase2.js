/**
 * 2차 정리 스크립트
 *
 * node scripts/cleanup-phase2.js
 *
 * 1. 로드테스트 계정 300개 삭제 (2024000~2024299@rabbitory.internal)
 * 2. 빠샤 계정 토끼 절반(40마리) 삭제 + 부모/집사 정보 제거
 * 3. 모든 유저의 quizHistory/expHistory 서브컬렉션 삭제
 */

const admin = require("firebase-admin");
const path = require("path");

admin.initializeApp({
  credential: admin.credential.cert(
    require(path.join(__dirname, "../serviceAccountKey.json"))
  ),
});

const db = admin.firestore();
const auth = admin.auth();
const BATCH_SIZE = 500;

// ── 헬퍼 ──

async function deleteSubcollection(collRef) {
  let total = 0;
  while (true) {
    const snapshot = await collRef.limit(BATCH_SIZE).get();
    if (snapshot.size === 0) break;
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    total += snapshot.size;
  }
  return total;
}

async function cleanup() {
  console.log("=== 2차 정리 시작 ===\n");

  // ════════════════════════════════════════════
  // 1. 로드테스트 계정 300개 삭제
  // ════════════════════════════════════════════
  console.log("[1/3] 로드테스트 계정 삭제 (2024000~2024299@rabbitory.internal)...\n");

  // 1-1. Firestore에서 닉네임 '로드테스트*' 유저 전부 수집
  const loadTestUsers = [];
  let lastDoc = null;
  while (true) {
    let query = db
      .collection("users")
      .where("nickname", ">=", "로드테스트")
      .where("nickname", "<=", "로드테스트\uf8ff")
      .limit(BATCH_SIZE);
    if (lastDoc) query = query.startAfter(lastDoc);

    const snap = await query.get();
    if (snap.size === 0) break;
    snap.docs.forEach((doc) =>
      loadTestUsers.push({ uid: doc.id, ...doc.data() })
    );
    lastDoc = snap.docs[snap.docs.length - 1];
  }
  console.log(`  Firestore 로드테스트 유저 발견: ${loadTestUsers.length}명`);

  // 1-2. Firestore 서브컬렉션 + 문서 삭제
  let fsDeleted = 0;
  for (const user of loadTestUsers) {
    const userRef = db.collection("users").doc(user.uid);

    // 서브컬렉션 삭제
    const subcollections = await userRef.listCollections();
    for (const sub of subcollections) {
      await deleteSubcollection(sub);
    }

    // 유저 문서 삭제
    await userRef.delete();
    fsDeleted++;

    if (fsDeleted % 50 === 0) {
      process.stdout.write(
        `  Firestore: ${fsDeleted}/${loadTestUsers.length} 삭제...\r`
      );
    }
  }
  console.log(`  Firestore 유저 문서: ${fsDeleted}건 삭제 완료`);

  // 1-3. Auth 계정 삭제 (이메일: 2024XXX@rabbitory.internal)
  // UID 수집 (getUsers로 100명씩)
  const authUids = [];
  for (let start = 0; start < 300; start += 100) {
    const end = Math.min(start + 100, 300);
    const identifiers = [];
    for (let i = start; i < end; i++) {
      identifiers.push({
        email: `2024${String(i).padStart(3, "0")}@rabbitory.internal`,
      });
    }
    try {
      const result = await auth.getUsers(identifiers);
      result.users.forEach((u) => authUids.push(u.uid));
    } catch (err) {
      console.error(`  getUsers 오류 (${start}~${end}):`, err.message);
    }
  }
  console.log(`  Auth 계정 발견: ${authUids.length}개`);

  if (authUids.length > 0) {
    // 1000명까지 한 번에 삭제 가능
    try {
      const result = await auth.deleteUsers(authUids);
      console.log(
        `  Auth 삭제: 성공 ${result.successCount}명, 실패 ${result.failureCount}명`
      );
      if (result.failureCount > 0) {
        result.errors.slice(0, 3).forEach((e) => {
          console.error(`    - ${e.error.message}`);
        });
      }
    } catch (err) {
      console.error("  Auth 일괄삭제 실패:", err.message);
    }
  }

  // 1-4. enrolledStudents에서 로드테스트 학번 제거
  console.log("  enrolledStudents 정리...");
  const courses = ["biology", "pathophysiology", "microbiology"];
  for (const courseId of courses) {
    for (let i = 0; i < 300; i++) {
      const studentId = `2024${String(i).padStart(3, "0")}`;
      try {
        const docRef = db
          .collection("enrolledStudents")
          .doc(courseId)
          .collection("students")
          .doc(studentId);
        const doc = await docRef.get();
        if (doc.exists) {
          await docRef.delete();
        }
      } catch {
        // 무시
      }
    }
  }
  console.log("  enrolledStudents 정리 완료\n");

  // ════════════════════════════════════════════
  // 2. 빠샤 계정 토끼 절반 삭제 + 부모 정보 제거
  // ════════════════════════════════════════════
  console.log("[2/3] 빠샤 계정 토끼 절반 삭제...\n");

  const BBASHA_UID = "5ecO4zdELuaTt5oPAAOHlGNm6up1";
  const COURSE_ID = "biology";

  // 삭제할 토끼: rabbitId 40~79 (후반 40마리)
  const RABBITS_TO_DELETE = [];
  for (let i = 40; i < 80; i++) {
    RABBITS_TO_DELETE.push(i);
  }

  console.log(
    `  삭제 대상: rabbitId ${RABBITS_TO_DELETE[0]}~${RABBITS_TO_DELETE[RABBITS_TO_DELETE.length - 1]} (${RABBITS_TO_DELETE.length}마리)`
  );

  // 2-1. 빠샤의 rabbitHoldings에서 삭제
  let holdingsDeleted = 0;
  const holdingsBatch = db.batch();
  for (const rabbitId of RABBITS_TO_DELETE) {
    const docId = `${COURSE_ID}_${rabbitId}`;
    holdingsBatch.delete(
      db
        .collection("users")
        .doc(BBASHA_UID)
        .collection("rabbitHoldings")
        .doc(docId)
    );
    holdingsDeleted++;
  }
  await holdingsBatch.commit();
  console.log(`  rabbitHoldings: ${holdingsDeleted}마리 삭제`);

  // 2-2. rabbits 컬렉션에서 해당 토끼 문서 삭제 (→ 미발견 상태로 리셋)
  let rabbitsDeleted = 0;
  const rabbitsBatch = db.batch();
  for (const rabbitId of RABBITS_TO_DELETE) {
    const docId = `${COURSE_ID}_${rabbitId}`;
    rabbitsBatch.delete(db.collection("rabbits").doc(docId));
    rabbitsDeleted++;
  }
  await rabbitsBatch.commit();
  console.log(`  rabbits 문서: ${rabbitsDeleted}건 삭제 (미발견 상태로 리셋)`);

  // 2-3. rabbitNames에서 해당 토끼 이름 삭제
  // rabbitNames 문서 ID: {courseId}_{이름} → rabbitId로 검색 필요
  const rnSnap = await db
    .collection("rabbitNames")
    .where("courseId", "==", COURSE_ID)
    .get();
  let namesDeleted = 0;
  const namesBatch = db.batch();
  for (const doc of rnSnap.docs) {
    const d = doc.data();
    if (RABBITS_TO_DELETE.includes(d.rabbitId)) {
      namesBatch.delete(doc.ref);
      namesDeleted++;
    }
  }
  if (namesDeleted > 0) {
    await namesBatch.commit();
  }
  console.log(`  rabbitNames: ${namesDeleted}건 삭제`);

  // 2-4. 빠샤 유저 문서의 equippedRabbits 업데이트
  // 현재 장착: rabbitId 59, 45 → 둘 다 삭제 대상(40~79)
  const bbashaRef = db.collection("users").doc(BBASHA_UID);
  const bbashaDoc = await bbashaRef.get();
  const bbashaData = bbashaDoc.data();
  const currentEquipped = bbashaData.equippedRabbits || [];
  const newEquipped = currentEquipped.filter(
    (r) => !RABBITS_TO_DELETE.includes(r.rabbitId)
  );

  if (newEquipped.length !== currentEquipped.length) {
    await bbashaRef.update({ equippedRabbits: newEquipped });
    console.log(
      `  equippedRabbits: ${currentEquipped.length}개 → ${newEquipped.length}개 (삭제된 토끼 장착 해제)`
    );
  }

  // 2-5. lastGachaExp 조정 (뽑기를 다시 할 수 있도록)
  // 현재 totalExp=1145, lastGachaExp=250 → 차이 895 → 뽑기 17번 가능 → 충분
  console.log(
    `  빠샤 EXP 상태: totalExp=${bbashaData.totalExp}, lastGachaExp=${bbashaData.lastGachaExp}`
  );
  console.log(
    `  → 뽑기 가능 횟수: ${Math.floor((bbashaData.totalExp - bbashaData.lastGachaExp) / 50)}회 (충분)\n`
  );

  // ════════════════════════════════════════════
  // 3. 모든 유저의 quizHistory / expHistory 삭제
  // ════════════════════════════════════════════
  console.log("[3/3] 모든 유저의 quizHistory / expHistory 삭제...\n");

  // 모든 유저 문서 순회
  let userCount = 0;
  let totalQH = 0;
  let totalEH = 0;
  let lastUserDoc = null;

  while (true) {
    let usersQuery = db.collection("users").limit(100);
    if (lastUserDoc) usersQuery = usersQuery.startAfter(lastUserDoc);

    const usersSnap = await usersQuery.get();
    if (usersSnap.size === 0) break;

    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.id;

      // quizHistory 삭제
      const qhDeleted = await deleteSubcollection(
        db.collection("users").doc(uid).collection("quizHistory")
      );
      totalQH += qhDeleted;

      // expHistory 삭제
      const ehDeleted = await deleteSubcollection(
        db.collection("users").doc(uid).collection("expHistory")
      );
      totalEH += ehDeleted;

      userCount++;
    }

    lastUserDoc = usersSnap.docs[usersSnap.docs.length - 1];
    process.stdout.write(
      `  유저 ${userCount}명 처리 (quizHistory: ${totalQH}건, expHistory: ${totalEH}건)...\r`
    );
  }
  console.log(
    `  완료: ${userCount}명 처리, quizHistory ${totalQH}건, expHistory ${totalEH}건 삭제`
  );

  // ── 결과 요약 ──
  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║           2차 정리 결과 요약                ║");
  console.log("╠══════════════════════════════════════════════╣");
  console.log(
    `║  로드테스트 Firestore: ${String(fsDeleted).padStart(5)}명 삭제          ║`
  );
  console.log(
    `║  로드테스트 Auth:      ${String(authUids.length).padStart(5)}명 삭제          ║`
  );
  console.log(
    `║  빠샤 토끼 삭제:      ${String(holdingsDeleted).padStart(5)}마리              ║`
  );
  console.log(
    `║  rabbits 문서 삭제:   ${String(rabbitsDeleted).padStart(5)}건                ║`
  );
  console.log(
    `║  rabbitNames 삭제:    ${String(namesDeleted).padStart(5)}건                ║`
  );
  console.log(
    `║  quizHistory 삭제:    ${String(totalQH).padStart(5)}건                ║`
  );
  console.log(
    `║  expHistory 삭제:     ${String(totalEH).padStart(5)}건                ║`
  );
  console.log("╚══════════════════════════════════════════════╝");
  console.log("\n=== 2차 정리 완료 ===");
}

cleanup()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("2차 정리 실패:", err);
    process.exit(1);
  });
