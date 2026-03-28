/**
 * 저요저요 서재에 chapter2.normal (4) 퀴즈 생성 (isPublic: false)
 *
 * 실행: node scripts/upload-chapter2-normal.js
 *
 * 1. 25010423(저요저요) 유저 찾기
 * 2. 기존 chapter2.normal (4) 퀴즈 삭제 (잘못 공개로 생성된 것 포함)
 * 3. 서재용 퀴즈 새로 생성 (isPublic: false)
 */

const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const questions = require("./chapter2-normal-questions.json");

initializeApp();
const db = getFirestore();

async function main() {
  // 1. 25010423(저요저요) 유저 찾기
  let joyoUser;

  const byStudentId = await db.collection("users")
    .where("studentId", "==", "25010423")
    .limit(1)
    .get();

  if (!byStudentId.empty) {
    joyoUser = byStudentId.docs[0];
  } else {
    console.log("⚠️ studentId로 못 찾음, 닉네임으로 재시도...");
    const byNickname = await db.collection("users")
      .where("nickname", "==", "저요저요")
      .limit(1)
      .get();

    if (byNickname.empty) {
      console.error("❌ 25010423 / '저요저요' 유저를 찾을 수 없습니다");
      process.exit(1);
    }
    joyoUser = byNickname.docs[0];
  }

  const userId = joyoUser.id;
  const userData = joyoUser.data();
  console.log(`✅ 유저: UID=${userId}, nickname=${userData.nickname}`);

  // 2. 기존 chapter2.normal (4) 퀴즈 모두 삭제 (공개로 잘못 생성된 것 포함)
  const allQuizzes = await db.collection("quizzes")
    .where("creatorId", "==", userId)
    .get();

  const oldQuizzes = allQuizzes.docs.filter(d => {
    const title = (d.data().title || "");
    return title === "chapter2.normal (4)";
  });

  if (oldQuizzes.length > 0) {
    const batch = db.batch();
    for (const doc of oldQuizzes) {
      console.log(`🗑️ 기존 퀴즈 삭제: ${doc.id} (isPublic: ${doc.data().isPublic})`);
      batch.delete(doc.ref);
    }
    await batch.commit();
    console.log(`   ${oldQuizzes.length}개 삭제 완료`);
  }

  // 3. 서재용 퀴즈 새로 생성 (isPublic: false)
  const quizData = {
    title: "chapter2.normal (4)",
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
  console.log(`\n✅ 서재 퀴즈 생성 완료!`);
  console.log(`   문서 ID: ${docRef.id}`);
  console.log(`   제목: chapter2.normal (4)`);
  console.log(`   문제 수: ${questions.length}`);
  console.log(`   공개: false (서재)`);
  console.log(`   태그: 중간`);
}

main().catch(err => {
  console.error("❌ 오류:", err);
  process.exit(1);
});
