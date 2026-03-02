/**
 * 진단 스크립트: 남아있는 데이터 확인
 * node scripts/diagnose-data.js
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

async function diagnose() {
  console.log("=== 데이터 진단 시작 ===\n");

  // 1. 커스텀폴더 확인 (여러 컬렉션명 시도)
  console.log("[1] 커스텀폴더 관련 컬렉션 확인...");
  const folderNames = [
    "customFolders",
    "custom_folders",
    "folders",
    "userFolders",
    "reviewFolders",
  ];
  for (const name of folderNames) {
    const snap = await db.collection(name).limit(3).get();
    if (snap.size > 0) {
      console.log(`  ✓ ${name}: ${snap.size}건+ 발견`);
      snap.docs.forEach((doc) => {
        const d = doc.data();
        console.log(
          `    - ${doc.id}: userId=${d.userId || "?"}, name=${d.name || d.folderName || "?"}`
        );
      });
    } else {
      console.log(`  ✗ ${name}: 비어있음`);
    }
  }

  // 2. 로드테스트 계정 확인
  console.log("\n[2] 로드테스트 계정 확인...");

  // Firestore에서 닉네임으로 검색
  const loadTestQuery = await db
    .collection("users")
    .where("nickname", ">=", "로드테스트")
    .where("nickname", "<=", "로드테스트\uf8ff")
    .limit(5)
    .get();
  console.log(`  Firestore (닉네임 '로드테스트*'): ${loadTestQuery.size}건`);
  loadTestQuery.docs.forEach((doc) => {
    const d = doc.data();
    console.log(
      `    - uid: ${doc.id}, email: ${d.email}, nickname: ${d.nickname}`
    );
  });

  // 이메일 패턴으로 검색
  const emailQuery = await db
    .collection("users")
    .where("email", ">=", "loadtest")
    .where("email", "<=", "loadtest\uf8ff")
    .limit(5)
    .get();
  console.log(`  Firestore (이메일 'loadtest*'): ${emailQuery.size}건`);
  emailQuery.docs.forEach((doc) => {
    const d = doc.data();
    console.log(
      `    - uid: ${doc.id}, email: ${d.email}, nickname: ${d.nickname}`
    );
  });

  // studentId 패턴으로 검색 (2024000~2024299)
  const studentIdQuery = await db
    .collection("users")
    .where("studentId", ">=", "2024000")
    .where("studentId", "<=", "2024299")
    .limit(5)
    .get();
  console.log(
    `  Firestore (studentId '2024000~2024299'): ${studentIdQuery.size}건`
  );
  studentIdQuery.docs.forEach((doc) => {
    const d = doc.data();
    console.log(
      `    - uid: ${doc.id}, email: ${d.email}, studentId: ${d.studentId}, nickname: ${d.nickname}`
    );
  });

  // Auth에서 확인 (첫 5개)
  console.log("  Auth 계정 확인 (처음 5개)...");
  for (let i = 0; i < 5; i++) {
    const padded = String(i).padStart(3, "0");
    try {
      const user = await auth.getUserByEmail(
        `loadtest-user-${padded}@test.com`
      );
      console.log(`    ✓ loadtest-user-${padded}@test.com: uid=${user.uid}`);
    } catch {
      // @rabbitory.internal 패턴 시도
      try {
        const user2 = await auth.getUserByEmail(
          `2024${padded}@rabbitory.internal`
        );
        console.log(
          `    ✓ 2024${padded}@rabbitory.internal: uid=${user2.uid}`
        );
      } catch {
        if (i === 0) console.log(`    ✗ 두 패턴 모두 없음`);
      }
    }
  }

  // 3. 빠샤 계정 확인
  console.log("\n[3] 빠샤 계정 확인...");
  const bbashaQuery = await db
    .collection("users")
    .where("nickname", "==", "빠샤")
    .get();
  if (bbashaQuery.size > 0) {
    for (const doc of bbashaQuery.docs) {
      const d = doc.data();
      console.log(
        `  ✓ uid: ${doc.id}, nickname: ${d.nickname}, role: ${d.role}, courseId: ${d.courseId}`
      );
      console.log(
        `    equippedRabbits: ${JSON.stringify(d.equippedRabbits || [])}`
      );
      console.log(`    totalExp: ${d.totalExp}, lastGachaExp: ${d.lastGachaExp}`);

      // 보유 토끼 확인
      const holdings = await db
        .collection("users")
        .doc(doc.id)
        .collection("rabbitHoldings")
        .get();
      console.log(`    보유 토끼: ${holdings.size}마리`);
      holdings.docs.forEach((h) => {
        const hd = h.data();
        console.log(
          `      - ${h.id}: rabbitId=${hd.rabbitId}, level=${hd.level}, order=${hd.discoveryOrder}`
        );
      });
    }
  } else {
    console.log("  ✗ '빠샤' 닉네임 없음, 다른 이름 검색...");
    // 교수 계정 전체 조회
    const profQuery = await db
      .collection("users")
      .where("role", "==", "professor")
      .get();
    console.log(`  교수 계정 총 ${profQuery.size}명:`);
    profQuery.docs.forEach((doc) => {
      const d = doc.data();
      console.log(
        `    - uid: ${doc.id}, nickname: ${d.nickname}, email: ${d.email}`
      );
    });
  }

  // 4. rabbits 컬렉션 현황
  console.log("\n[4] rabbits 컬렉션 현황...");
  const rabbitsSnap = await db.collection("rabbits").get();
  console.log(`  총 토끼 문서: ${rabbitsSnap.size}건`);
  // 과목별 카운트
  const courseCount = {};
  rabbitsSnap.docs.forEach((doc) => {
    const d = doc.data();
    const key = d.courseId || "unknown";
    courseCount[key] = (courseCount[key] || 0) + 1;
  });
  console.log("  과목별:", JSON.stringify(courseCount));

  // 5. 주간/월간 통계 확인
  console.log("\n[5] 주간/월간 통계 확인...");
  const weeklySnap = await db.collectionGroup("weeks").limit(1).get();
  console.log(`  weeklyStats/*/weeks: ${weeklySnap.size > 0 ? "있음" : "없음"}`);

  const courses = ["biology", "pathophysiology", "microbiology"];
  for (const c of courses) {
    const ws = await db
      .collection("weeklyStats")
      .doc(c)
      .collection("weeks")
      .get();
    const ms = await db
      .collection("monthlyReports")
      .doc(c)
      .collection("months")
      .get();
    console.log(`  ${c}: weeklyStats=${ws.size}건, monthlyReports=${ms.size}건`);
  }

  // 6. 오답 기록 (users/{uid}/quizHistory) 확인
  console.log("\n[6] 유저 서브컬렉션 (quizHistory, expHistory) 확인...");
  const sampleUsers = await db.collection("users").limit(3).get();
  for (const doc of sampleUsers.docs) {
    const qh = await db
      .collection("users")
      .doc(doc.id)
      .collection("quizHistory")
      .get();
    const eh = await db
      .collection("users")
      .doc(doc.id)
      .collection("expHistory")
      .get();
    console.log(
      `  ${doc.data().nickname || doc.id}: quizHistory=${qh.size}건, expHistory=${eh.size}건`
    );
  }

  // 7. rabbitNames 확인
  console.log("\n[7] rabbitNames 컬렉션 확인...");
  const rnSnap = await db.collection("rabbitNames").get();
  console.log(`  총: ${rnSnap.size}건`);
  rnSnap.docs.slice(0, 5).forEach((doc) => {
    const d = doc.data();
    console.log(
      `    - ${doc.id}: courseId=${d.courseId}, rabbitId=${d.rabbitId}`
    );
  });

  console.log("\n=== 진단 완료 ===");
}

diagnose()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("진단 실패:", err);
    process.exit(1);
  });
