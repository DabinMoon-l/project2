/**
 * 특정 학생의 EXP 획득 경로 전체 조회
 * 사용법: node scripts/check-student-exp.js 신현민
 */
const admin = require("firebase-admin");
const path = require("path");

admin.initializeApp({
  credential: admin.credential.cert(
    require(path.join(__dirname, "../serviceAccountKey.json"))
  ),
});
const db = admin.firestore();

const targetName = process.argv[2] || "신현민";

async function main() {
  // 1. 유저 찾기
  const usersSnap = await db.collection("users").where("role", "==", "student").get();
  let targetUid = null;
  let userData = null;
  for (const doc of usersSnap.docs) {
    const d = doc.data();
    if (d.name === targetName || d.nickname === targetName) {
      targetUid = doc.id;
      userData = d;
      break;
    }
  }
  if (!targetUid) {
    for (const doc of usersSnap.docs) {
      const d = doc.data();
      if ((d.name || "").includes(targetName) || (d.nickname || "").includes(targetName)) {
        targetUid = doc.id;
        userData = d;
        break;
      }
    }
  }
  if (!targetUid) {
    console.log(targetName + " 학생을 찾을 수 없습니다.");
    process.exit(1);
  }

  console.log("=== " + targetName + " 학생 기본 정보 ===");
  console.log("UID:", targetUid);
  console.log("닉네임:", userData.nickname);
  console.log("이름:", userData.name);
  console.log("반:", userData.classId);
  console.log("레벨:", userData.level);
  console.log("총 EXP:", userData.totalExp);
  console.log("quizStats:", JSON.stringify(userData.quizStats, null, 2));
  console.log("");

  // 2. expHistory 조회 (orderBy 없이 — 인덱스 불필요)
  let expTotal = 0;
  let expDocs = [];
  try {
    const expSnap = await db.collection("expHistory")
      .where("userId", "==", targetUid).get();
    expDocs = expSnap.docs;
  } catch (e) { /* 컬렉션 없을 수 있음 */ }

  if (expDocs.length === 0) {
    try {
      const logsSnap = await db.collection("expLogs")
        .where("userId", "==", targetUid).get();
      expDocs = logsSnap.docs;
    } catch (e) { /* 컬렉션 없을 수 있음 */ }
  }

  if (expDocs.length > 0) {
    // 시간순 정렬
    expDocs.sort((a, b) => {
      const ta = a.data().createdAt && a.data().createdAt.toDate ? a.data().createdAt.toDate().getTime() : 0;
      const tb = b.data().createdAt && b.data().createdAt.toDate ? b.data().createdAt.toDate().getTime() : 0;
      return tb - ta;
    });
    console.log("=== EXP 히스토리 (" + expDocs.length + "건) ===");
    for (const doc of expDocs) {
      const d = doc.data();
      const ts = d.createdAt && d.createdAt.toDate ? d.createdAt.toDate().toISOString() : "?";
      console.log(ts + " | +" + d.amount + " | " + d.reason);
      expTotal += (d.amount || 0);
    }
    console.log("합계:", expTotal);
  } else {
    console.log("EXP 히스토리 없음 (expHistory/expLogs 컬렉션 비어있음)");
  }

  // 3. quizResults 조회
  console.log("");
  const qrSnap = await db.collection("quizResults")
    .where("userId", "==", targetUid)
    .get();
  const qrDocs = qrSnap.docs.sort((a, b) => {
    const ta = a.data().createdAt && a.data().createdAt.toDate ? a.data().createdAt.toDate().getTime() : 0;
    const tb = b.data().createdAt && b.data().createdAt.toDate ? b.data().createdAt.toDate().getTime() : 0;
    return tb - ta;
  });
  console.log("=== 퀴즈 결과 (" + qrDocs.length + "건) ===");
  for (const doc of qrDocs) {
    const d = doc.data();
    const ts = d.createdAt && d.createdAt.toDate ? d.createdAt.toDate().toISOString() : "?";
    const rewarded = d.rewarded ? "O" : "X";
    const expR = d.expRewarded || 0;
    const retry = d.isUpdate ? " (재시도)" : "";
    console.log(ts + " | " + d.quizTitle + " | " + d.score + "점 (" + d.correctCount + "/" + d.totalCount + ") | EXP:" + expR + " 보상:" + rewarded + retry);
  }

  // 4. feedbacks 조회
  console.log("");
  const fbSnap = await db.collection("feedbacks")
    .where("userId", "==", targetUid)
    .get();
  console.log("=== 피드백 (" + fbSnap.size + "건) ===");
  for (const doc of fbSnap.docs) {
    const d = doc.data();
    const ts = d.createdAt && d.createdAt.toDate ? d.createdAt.toDate().toISOString() : "?";
    console.log(ts + " | " + (d.quizTitle || "?"));
  }

  // 5. 게시판 활동
  console.log("");
  const postSnap = await db.collection("posts").where("authorId", "==", targetUid).get();
  console.log("게시글 수:", postSnap.size);

  const commentSnap = await db.collection("comments").where("authorId", "==", targetUid).get();
  console.log("댓글 수:", commentSnap.size);

  // 6. EXP 합산 요약
  console.log("");
  console.log("=== EXP 요약 ===");
  console.log("DB 저장 totalExp:", userData.totalExp);
  console.log("expHistory/expLogs 합계:", expTotal);
  const quizExp = qrSnap.docs.reduce((s, d) => s + (d.data().expRewarded || 0), 0);
  console.log("퀴즈 보상 EXP 합계:", quizExp);
  console.log("피드백 건수 x 15:", fbSnap.size * 15);
  console.log("게시글 건수 x 15:", postSnap.size * 15);
  console.log("댓글 건수 x 15:", commentSnap.size * 15);
  console.log("추정 합계:", quizExp + fbSnap.size * 15 + postSnap.size * 15 + commentSnap.size * 15);

  // 7. 도감 (보유 토끼)
  console.log("");
  const rabbitsSnap = await db.collection("rabbits")
    .where("ownerUid", "==", targetUid)
    .get();
  console.log("=== 도감 토끼 (" + rabbitsSnap.size + "마리) ===");
  for (const doc of rabbitsSnap.docs) {
    const d = doc.data();
    console.log("  #" + (d.rabbitId + 1) + " " + (d.name || "(이름없음)") + " | Lv." + (d.level || 1) + " | HP:" + (d.hp || 0) + " ATK:" + (d.atk || 0) + " DEF:" + (d.def || 0));
  }

  // 장착 토끼
  const equipped = userData.equippedRabbits || [];
  if (equipped.length > 0) {
    console.log("장착:", equipped.map(function(r) { return "#" + (r.rabbitId + 1); }).join(", "));
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
