/**
 * 철권퀴즈 문제풀 + 오답 리뷰 데이터 검증
 * Firestore 경로: tekkenQuestionPool/{courseId}/questions/{qId}
 */
const admin = require("firebase-admin");
const path = require("path");

admin.initializeApp({
  credential: admin.credential.cert(
    require(path.join(__dirname, "../serviceAccountKey.json"))
  ),
});
const db = admin.firestore();

async function main() {
  // 1. 문제풀 확인 (biology + microbiology) — 올바른 경로 사용
  for (const courseId of ["biology", "microbiology"]) {
    console.log("=== " + courseId + " 문제풀 ===");

    // 총 문제 수
    var countSnap = await db.collection("tekkenQuestionPool").doc(courseId).collection("questions").count().get();
    console.log("총 문제 수:", countSnap.data().count);

    // 샘플 5개
    var poolSnap = await db.collection("tekkenQuestionPool").doc(courseId).collection("questions").limit(5).get();
    poolSnap.docs.forEach(function(doc) {
      var d = doc.data();
      console.log("  - " + (d.text || "").substring(0, 50) + "...");
      console.log("    chapter:", d.chapter, "| difficulty:", d.difficulty);
      console.log("    explanation:", d.explanation ? "O (" + d.explanation.length + "자)" : "X");
      console.log("    choiceExplanations:", d.choiceExplanations ? "O (" + d.choiceExplanations.length + "개)" : "X");
      console.log("    generatedAt:", d.generatedAt ? d.generatedAt.toDate().toISOString() : "없음");
    });

    // 챕터 분포
    var allPool = await db.collection("tekkenQuestionPool").doc(courseId).collection("questions").get();
    var chDist = {};
    var diffDist = {};
    var poolHasExp = 0;
    var poolHasChoiceExp = 0;
    allPool.docs.forEach(function(doc) {
      var d = doc.data();
      chDist[d.chapter || "없음"] = (chDist[d.chapter || "없음"] || 0) + 1;
      diffDist[d.difficulty || "없음"] = (diffDist[d.difficulty || "없음"] || 0) + 1;
      if (d.explanation) poolHasExp++;
      if (d.choiceExplanations && d.choiceExplanations.length > 0) poolHasChoiceExp++;
    });
    console.log("  챕터 분포:", JSON.stringify(chDist));
    console.log("  난이도 분포:", JSON.stringify(diffDist));
    console.log("  해설 포함:", poolHasExp + "/" + allPool.size);
    console.log("  선지별해설 포함:", poolHasChoiceExp + "/" + allPool.size);
    console.log("");
  }

  // 2. 배틀 오답 리뷰의 챕터 분포
  console.log("=== 배틀 오답 챕터 분포 ===");
  var allReviews = await db.collection("reviews")
    .where("reviewType", "==", "wrong")
    .get();
  var chapterCounts = {};
  var hasExplanation = 0;
  var hasChoiceExp = 0;
  allReviews.docs.forEach(function(doc) {
    var d = doc.data();
    var ch = d.chapterId || "없음";
    chapterCounts[ch] = (chapterCounts[ch] || 0) + 1;
    if (d.explanation) hasExplanation++;
    if (d.choiceExplanations && d.choiceExplanations.length > 0) hasChoiceExp++;
  });
  console.log("총 배틀 오답:", allReviews.size, "건");
  console.log("챕터별:", JSON.stringify(chapterCounts));
  console.log("해설 포함:", hasExplanation + "/" + allReviews.size);
  console.log("선지별해설 포함:", hasChoiceExp + "/" + allReviews.size);
}

main().then(function() { process.exit(0); }).catch(function(e) { console.error(e); process.exit(1); });
