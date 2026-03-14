const admin = require("firebase-admin");
const path = require("path");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      require(path.join(__dirname, "../serviceAccountKey.json"))
    ),
  });
}
const db = admin.firestore();

// 퀴즈 이름으로 검색 (26학년도 사전평가)
async function main() {
  // 퀴즈 찾기
  const quizzesSnap = await db.collection("quizzes")
    .where("title", "==", "26학년도 사전평가")
    .get();

  if (quizzesSnap.empty) {
    // 부분 검색
    const allQuizzes = await db.collection("quizzes").get();
    const matched = allQuizzes.docs.filter(d => (d.data().title || "").includes("사전평가"));
    if (matched.length === 0) {
      console.log("사전평가 퀴즈를 찾을 수 없습니다.");
      return;
    }
    for (const q of matched) {
      console.log(`퀴즈: ${q.data().title} (${q.id})`);
    }
    await checkQuiz(matched[0].id, matched[0].data().title);
  } else {
    for (const q of quizzesSnap.docs) {
      await checkQuiz(q.id, q.data().title);
    }
  }
}

async function checkQuiz(quizId, title) {
  console.log(`\n========== ${title} (${quizId}) ==========\n`);

  const resultsSnap = await db.collection("quizResults")
    .where("quizId", "==", quizId)
    .get();

  console.log(`전체 결과 문서: ${resultsSnap.size}개\n`);

  // userId별로 모든 결과 그룹핑
  const byUser = {};
  resultsSnap.docs.forEach((d) => {
    const data = d.data();
    const uid = data.userId;
    if (!byUser[uid]) byUser[uid] = [];
    byUser[uid].push({
      docId: d.id,
      score: data.score,
      isUpdate: data.isUpdate || false,
      createdAt: data.createdAt?.toDate?.()?.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) || "?",
      createdAtMs: data.createdAt?.toMillis?.() || data.createdAt?.seconds * 1000 || 0,
    });
  });

  for (const [uid, results] of Object.entries(byUser)) {
    // 시간순 정렬
    results.sort((a, b) => a.createdAtMs - b.createdAtMs);

    // 유저 이름 가져오기
    let name = uid;
    try {
      const userDoc = await db.collection("users").doc(uid).get();
      if (userDoc.exists) {
        const u = userDoc.data();
        name = `${u.nickname || u.name || uid} (${u.classType || "?"}반)`;
      }
    } catch {}

    const marker = results.length > 1 ? " ⚠️ 복수 결과" : "";
    console.log(`[${name}]${marker}`);
    results.forEach((r, i) => {
      console.log(`  ${i + 1}. 점수: ${r.score}점 | isUpdate: ${r.isUpdate} | ${r.createdAt} (${r.docId})`);
    });
    console.log("");
  }

  // 4점짜리 찾기
  console.log("--- 4점 결과 ---");
  resultsSnap.docs.forEach((d) => {
    const data = d.data();
    if (data.score === 4) {
      console.log(`  userId: ${data.userId}, score: ${data.score}, isUpdate: ${data.isUpdate}, docId: ${d.id}`);
    }
  });
}

main().catch(console.error);
