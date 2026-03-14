/**
 * 로그인 로그 조회 스크립트
 * usage: node scripts/check-login-logs.js [uid] [count]
 */
const admin = require("firebase-admin");
const path = require("path");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      require(path.resolve(__dirname, "../serviceAccountKey.json"))
    ),
  });
}
const db = admin.firestore();

(async () => {
  const targetUid = process.argv[2]; // 특정 uid만 보기 (선택)
  const limit = parseInt(process.argv[3]) || 30;

  let query = db.collection("loginLogs").orderBy("timestamp", "desc").limit(limit);
  if (targetUid) {
    query = db.collection("loginLogs")
      .where("uid", "==", targetUid)
      .orderBy("timestamp", "desc")
      .limit(limit);
  }

  const snap = await query.get();
  console.log(`=== 로그인 로그 (최근 ${snap.size}건) ===\n`);

  // uid → nickname 매핑
  const uidSet = new Set(snap.docs.map(d => d.data().uid));
  const nickMap = {};
  for (const uid of uidSet) {
    try {
      const u = await db.collection("users").doc(uid).get();
      nickMap[uid] = u.exists ? (u.data().nickname || uid.slice(0, 8)) : uid.slice(0, 8);
    } catch { nickMap[uid] = uid.slice(0, 8); }
  }

  for (const doc of snap.docs) {
    const d = doc.data();
    const time = d.timestamp?.toDate?.()?.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) || "N/A";
    const nick = nickMap[d.uid] || d.uid?.slice(0, 8);
    const ua = d.userAgent || "";

    // 기기 간단 파싱
    let device = "기타";
    if (ua.includes("iPhone")) device = "iPhone";
    else if (ua.includes("iPad")) device = "iPad";
    else if (ua.includes("Android")) device = "Android";
    else if (ua.includes("Windows")) device = "Windows";
    else if (ua.includes("Mac")) device = "Mac";

    console.log(`${time} | ${nick} | ${d.ip} | ${device} | ${d.screenSize || ""}`);
  }

  process.exit(0);
})();
