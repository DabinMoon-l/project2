const admin = require("firebase-admin");
const path = require("path");
admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, "../serviceAccountKey.json"))) });
const db = admin.firestore();

(async () => {
  const usersSnap = await db.collection("users").where("name", "==", "신현민").get();
  for (const userDoc of usersSnap.docs) {
    const ud = userDoc.data();
    const courseId = ud.courseId;
    console.log("UID:", userDoc.id, "| courseId:", courseId);

    const holdingsSnap = await db.collection("users").doc(userDoc.id).collection("rabbitHoldings").get();
    const nonDefault = holdingsSnap.docs.filter(d => d.data().rabbitId !== 0);
    console.log("토끼 수 (기본 제외):", nonDefault.length);

    // rabbits 컬렉션에서 이름 가져오기
    for (const hDoc of nonDefault.sort((a, b) => a.data().rabbitId - b.data().rabbitId)) {
      const h = hDoc.data();
      const rabbitDocId = h.courseId + "_" + h.rabbitId;
      const rabbitDoc = await db.collection("rabbits").doc(rabbitDocId).get();
      const rabbitData = rabbitDoc.exists ? rabbitDoc.data() : null;
      const name = rabbitData ? rabbitData.name : "(미발견)";
      console.log("  rabbitId:", h.rabbitId, "| 이름:", name || "(없음)", "| level:", h.level, "| 발견순:", h.discoveryOrder);
    }
  }
  process.exit(0);
})();
