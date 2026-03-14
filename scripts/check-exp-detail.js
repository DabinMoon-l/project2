/**
 * 특정 유저의 expHistory 서브컬렉션 상세 조회
 * 사용법: node scripts/check-exp-detail.js 미생물1등
 */
const admin = require("firebase-admin");
const path = require("path");

admin.initializeApp({
  credential: admin.credential.cert(
    require(path.join(__dirname, "../serviceAccountKey.json"))
  ),
});
const db = admin.firestore();

const targetName = process.argv[2] || "미생물1등";

async function main() {
  // 유저 찾기
  const usersSnap = await db.collection("users").where("role", "==", "student").get();
  let uid = null;
  for (const doc of usersSnap.docs) {
    const d = doc.data();
    if (d.nickname === targetName || d.name === targetName) {
      uid = doc.id;
      console.log("UID:", uid, "| nickname:", d.nickname, "| totalExp:", d.totalExp);
      break;
    }
  }
  if (!uid) {
    console.log("유저를 찾을 수 없습니다:", targetName);
    process.exit(1);
  }

  // expHistory 서브컬렉션
  const histSnap = await db.collection("users").doc(uid).collection("expHistory").get();
  console.log("\n=== expHistory 서브컬렉션 (" + histSnap.size + "건) ===");

  var total = 0;
  var items = [];
  histSnap.docs.forEach(function(doc) {
    var d = doc.data();
    var sec = d.createdAt ? d.createdAt._seconds : 0;
    items.push({
      sec: sec,
      amount: d.amount || 0,
      type: d.type || "?",
      reason: d.reason || "?",
      prev: d.previousExp,
      newE: d.newExp,
    });
    total += (d.amount || 0);
  });

  items.sort(function(a, b) { return a.sec - b.sec; });
  items.forEach(function(i) {
    var ts = i.sec ? new Date(i.sec * 1000).toISOString() : "?";
    console.log(ts + " | +" + i.amount + " | " + i.type + " | " + i.reason + " | " + i.prev + " -> " + i.newE);
  });

  // 타입별 합산
  var byType = {};
  items.forEach(function(i) {
    byType[i.type] = (byType[i.type] || 0) + i.amount;
  });
  console.log("\n=== 타입별 합산 ===");
  Object.keys(byType).forEach(function(t) {
    console.log(t + ": " + byType[t]);
  });
  console.log("합계: " + total);
}

main().then(function() { process.exit(0); }).catch(function(e) { console.error(e); process.exit(1); });
