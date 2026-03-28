/**
 * 저요저요 서재에 chapter3.normal (4) 퀴즈 업로드
 *
 * 실행: node scripts/upload-chapter3-normal4.js
 *
 * 1. 저요저요 유저 찾기
 * 2. 새 퀴즈 문서 생성 (chapter3.normal (4), 20문제)
 */

const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const questions = require("./chapter3-normal4-questions.json");

initializeApp();
const db = getFirestore();

async function main() {
  // 1. 저요저요 유저 찾기
  const usersSnap = await db.collection("users")
    .where("nickname", "==", "저요저요")
    .limit(1)
    .get();

  if (usersSnap.empty) {
    console.error("❌ '저요저요' 유저를 찾을 수 없습니다");
    process.exit(1);
  }

  const joyoUser = usersSnap.docs[0];
  const userId = joyoUser.id;
  console.log(`✅ 저요저요 UID: ${userId}`);

  // 2. 기존 chapter3.normal (4) 퀴즈가 있는지 확인
  const existingSnap = await db.collection("quizzes")
    .where("creatorId", "==", userId)
    .get();

  const existing = existingSnap.docs.find(d => {
    const title = (d.data().title || "").toLowerCase();
    return title === "chapter3.normal (4)";
  });

  if (existing) {
    console.log(`⚠️ 기존 "chapter3.normal (4)" 퀴즈 발견: ${existing.id}`);
    console.log(`   기존 문제 수: ${(existing.data().questions || []).length}`);
    console.log(`   → 기존 퀴즈를 업데이트합니다.`);

    await existing.ref.update({
      questions: questions,
      questionCount: questions.length,
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log(`✅ 업데이트 완료! (${questions.length}문제)`);
    return;
  }

  // 3. 새 퀴즈 생성
  const quizData = {
    title: "chapter3.normal (4)",
    creatorId: userId,
    courseId: "microbiology",
    type: "custom",
    questions: questions,
    questionCount: questions.length,
    isPublic: false,
    tags: ["중간"],
    participantCount: 0,
    averageScore: 0,
    userScores: {},
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  const docRef = await db.collection("quizzes").add(quizData);
  console.log(`✅ 새 퀴즈 생성 완료!`);
  console.log(`   문서 ID: ${docRef.id}`);
  console.log(`   제목: chapter3.normal (4)`);
  console.log(`   문제 수: ${questions.length}`);
  console.log(`   태그: 중간`);
  console.log(`   공개: false (서재)`);
}

main().catch(err => {
  console.error("❌ 오류:", err);
  process.exit(1);
});
