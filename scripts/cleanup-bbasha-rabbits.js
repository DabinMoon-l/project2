/**
 * 빠샤 토끼 전체 삭제 (기본토끼 #0 제외)
 * 이름, 부모, 집사 정보 모두 제거
 *
 * node scripts/cleanup-bbasha-rabbits.js
 */
const admin = require("firebase-admin");
const path = require("path");

admin.initializeApp({
  credential: admin.credential.cert(
    require(path.join(__dirname, "../serviceAccountKey.json"))
  ),
});

const db = admin.firestore();

const BBASHA_UID = "5ecO4zdELuaTt5oPAAOHlGNm6up1";
const COURSE = "biology";

async function run() {
  console.log("=== 빠샤 토끼 전체 삭제 (기본토끼 #0 제외) ===\n");

  // 1. rabbitHoldings 삭제 (biology_0 유지)
  const holdings = await db
    .collection("users")
    .doc(BBASHA_UID)
    .collection("rabbitHoldings")
    .get();
  let hDel = 0;
  for (let i = 0; i < holdings.docs.length; i += 500) {
    const batch = db.batch();
    holdings.docs.slice(i, i + 500).forEach((doc) => {
      if (doc.id !== "biology_0") {
        batch.delete(doc.ref);
        hDel++;
      }
    });
    await batch.commit();
  }
  console.log(`rabbitHoldings 삭제: ${hDel}마리 (biology_0 유지)`);

  // 2. rabbits 컬렉션 삭제 (biology_0 유지, 나머지 미발견으로 리셋)
  const rabbits = await db
    .collection("rabbits")
    .where("courseId", "==", COURSE)
    .get();
  let rDel = 0;
  for (let i = 0; i < rabbits.docs.length; i += 500) {
    const batch = db.batch();
    rabbits.docs.slice(i, i + 500).forEach((doc) => {
      if (doc.id !== "biology_0") {
        batch.delete(doc.ref);
        rDel++;
      }
    });
    await batch.commit();
  }
  console.log(`rabbits 문서 삭제: ${rDel}건 (미발견 상태로 리셋)`);

  // 3. rabbitNames 삭제 (biology, rabbitId !== 0)
  const names = await db
    .collection("rabbitNames")
    .where("courseId", "==", COURSE)
    .get();
  let nDel = 0;
  if (names.size > 0) {
    const batch = db.batch();
    names.docs.forEach((doc) => {
      if (doc.data().rabbitId !== 0) {
        batch.delete(doc.ref);
        nDel++;
      }
    });
    if (nDel > 0) await batch.commit();
  }
  console.log(`rabbitNames 삭제: ${nDel}건`);

  // 4. equippedRabbits → 기본토끼만 유지
  const userDoc = await db.collection("users").doc(BBASHA_UID).get();
  const equipped = userDoc.data().equippedRabbits || [];
  const newEquipped = equipped.filter((r) => r.rabbitId === 0);
  await db
    .collection("users")
    .doc(BBASHA_UID)
    .update({ equippedRabbits: newEquipped });
  console.log(`equippedRabbits: ${equipped.length}개 → ${newEquipped.length}개`);

  console.log("\n완료! 빠샤: 기본토끼(#0)만 보유, 1~79번은 미발견 상태");
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
