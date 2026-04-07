/**
 * 기존 weeklyStats 삭제 후 새 스키마로 백필
 * 실행: node scripts/clear-and-backfill.js
 */

const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const path = require("path");

initializeApp({
  credential: cert(require(path.join(__dirname, "../serviceAccountKey.json"))),
});
const db = getFirestore();

async function main() {
  // 1. 기존 weeklyStats 전부 삭제
  const courseIds = ["biology", "pathophysiology", "microbiology"];
  console.log("기존 weeklyStats 삭제 중...");

  for (const courseId of courseIds) {
    const weeksSnap = await db.collection("weeklyStats").doc(courseId).collection("weeks").get();
    if (weeksSnap.size > 0) {
      const batch = db.batch();
      weeksSnap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      console.log(`  ${courseId}: ${weeksSnap.size}개 삭제`);
    }
  }

  // 2. 백필 호출
  const professorUid = "86OqdHFpGQQOMUNItwFlltYaThI3";
  const customToken = await getAuth().createCustomToken(professorUid);
  const apiKey = "AIzaSyDEX9cGWj4x7MCEQznsBd4KmBkSHwzaxNs";

  const tokenResponse = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );
  const tokenData = await tokenResponse.json();
  const idToken = tokenData.idToken;

  if (!idToken) {
    console.error("ID 토큰 획득 실패:", tokenData);
    process.exit(1);
  }

  console.log("\n새 스키마로 백필 시작...");
  const url = "https://asia-northeast3-project2-7a317.cloudfunctions.net/backfillWeeklyStats";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      data: { startDate: "2026-02-23", endDate: "2026-04-08" },
    }),
  });

  if (!response.ok) {
    console.error(`백필 API 오류 (${response.status}):`, await response.text());
    process.exit(1);
  }

  const result = await response.json();
  console.log("\n백필 결과:");
  if (result.result?.results) {
    result.result.results.forEach(r => console.log(`  ${r}`));
  }
}

main().catch(err => {
  console.error("스크립트 실패:", err);
  process.exit(1);
});
