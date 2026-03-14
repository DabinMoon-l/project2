const admin = require("firebase-admin");
const path = require("path");
admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, "../serviceAccountKey.json"))) });
const db = admin.firestore();

(async () => {
  // 신현민 학생 찾기
  const usersSnap = await db.collection("users").where("name", "==", "신현민").get();
  if (usersSnap.empty) {
    console.log("신현민 학생을 찾을 수 없습니다.");
    process.exit(1);
  }

  for (const userDoc of usersSnap.docs) {
    const ud = userDoc.data();
    console.log(`UID: ${userDoc.id} | 닉네임: ${ud.nickname} | 과목: ${ud.courseId}`);

    const holdingsSnap = await db.collection("users").doc(userDoc.id).collection("rabbitHoldings").get();
    // 기본 토끼(rabbitId 0) 제외
    const nonDefault = holdingsSnap.docs.filter(d => d.data().rabbitId !== 0);
    console.log(`토끼 발견 수 (기본 제외): ${nonDefault.length}`);
    nonDefault.forEach(d => {
      const h = d.data();
      console.log(`  rabbitId: ${h.rabbitId} | level: ${h.level} | courseId: ${h.courseId}`);
    });
  }

  process.exit(0);
})();
