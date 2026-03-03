/**
 * 빠샤 계정에 토끼 #59(꽁이), #60(맹이) 추가
 */
const admin = require("firebase-admin");
const path = require("path");
admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, "../serviceAccountKey.json"))) });
const db = admin.firestore();

const UID = "5ecO4zdELuaTt5oPAAOHlGNm6up1";

// 토끼 베이스 스탯 (rabbitStats.ts에서 발췌)
const BASE_STATS = {
  59: { hp: 60, atk: 13, def: 12 }, // 체력형·좋음
  60: { hp: 36, atk: 19, def: 10 }, // 공격형·좋음
};

const RABBITS = [
  { rabbitId: 59, name: "꽁이" },
  { rabbitId: 60, name: "맹이" },
];

async function main() {
  // 유저 정보 조회
  const userDoc = await db.collection("users").doc(UID).get();
  if (!userDoc.exists) { console.error("유저 없음!"); return; }
  const userData = userDoc.data();
  const nickname = userData.nickname || "빠샤";
  const courseId = userData.courseId || "microbiology";
  console.log(`유저: ${nickname}, courseId: ${courseId}`);

  const batch = db.batch();

  for (const { rabbitId, name } of RABBITS) {
    const rabbitDocId = `${courseId}_${rabbitId}`;
    const rabbitRef = db.collection("rabbits").doc(rabbitDocId);
    const holdingRef = db.collection("users").doc(UID).collection("rabbitHoldings").doc(rabbitDocId);

    // 기존 rabbit 문서 확인
    const rabbitDoc = await rabbitRef.get();

    if (rabbitDoc.exists) {
      // 이미 존재 → discoverers에 추가
      const rabbitData = rabbitDoc.data();
      const discoveryOrder = (rabbitData.discovererCount || 1) + 1;

      batch.update(rabbitRef, {
        discovererCount: admin.firestore.FieldValue.increment(1),
        discoverers: admin.firestore.FieldValue.arrayUnion({
          userId: UID,
          nickname,
          discoveryOrder,
        }),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      batch.set(holdingRef, {
        rabbitId,
        courseId,
        discoveryOrder,
        discoveredAt: admin.firestore.FieldValue.serverTimestamp(),
        level: 1,
        stats: BASE_STATS[rabbitId],
      }, { merge: true });

      console.log(`토끼 #${rabbitId} (${name}) — 후속 발견 (order: ${discoveryOrder})`);
    } else {
      // 새로 생성 → 최초 발견자
      batch.set(rabbitRef, {
        rabbitId,
        courseId,
        name,
        firstDiscovererUserId: UID,
        firstDiscovererNickname: nickname,
        discovererCount: 1,
        discoverers: [{
          userId: UID,
          nickname,
          discoveryOrder: 1,
        }],
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      batch.set(holdingRef, {
        rabbitId,
        courseId,
        discoveryOrder: 1,
        discoveredAt: admin.firestore.FieldValue.serverTimestamp(),
        level: 1,
        stats: BASE_STATS[rabbitId],
      });

      console.log(`토끼 #${rabbitId} (${name}) — 최초 발견!`);
    }
  }

  await batch.commit();
  console.log("\n완료! 토끼 #59(꽁이), #60(맹이) 추가됨.");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
