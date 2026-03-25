/**
 * chapter3.easy 5번 문제 수정 + 푼 유저 2명의 복습/오답 데이터 갱신
 *
 * 문제: "옳은 것은?" 발문인데 여러 선지가 사실상 옳은 애매한 문제
 * 수정: 감염회로 6단계에 대한 명확한 문제로 교체
 *
 * 실행: node scripts/fix-chapter3-easy-q5.js
 */

const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();

// 수정할 문제 (5번 = index 4)
const QUESTION_INDEX = 4;

const newQuestion = {
  text: "감염성 질환의 생성 6단계인 감염 회로의 순서로 올바른 것은?",
  type: "multiple",
  choices: [
    "병원체 → 전파 → 병원소 → 탈출 → 침입 → 감수성",
    "병원체 → 병원소 → 탈출 → 전파 → 침입 → 감수성",
    "병원소 → 병원체 → 전파 → 탈출 → 침입 → 감수성",
    "전파 → 병원체 → 병원소 → 침입 → 탈출 → 감수성",
    "병원체 → 병원소 → 침입 → 전파 → 탈출 → 감수성",
  ],
  answer: 1, // 0-indexed: 2번 선지
  explanation: "감염 회로(감염성 질환의 생성 6단계)는 ①병원체 → ②병원소 → ③병원소로부터 탈출 → ④전파 → ⑤신숙주에 침입 → ⑥신숙주의 감수성과 면역 순서로 진행됩니다.",
  choiceExplanations: [
    "병원체 다음에 전파가 바로 오지 않습니다. 병원소를 거쳐야 합니다.",
    "정답입니다. 병원체 → 병원소 → 탈출 → 전파 → 침입 → 감수성이 올바른 순서입니다.",
    "병원소가 병원체보다 먼저 올 수 없습니다. 병원체가 감염 회로의 시작점입니다.",
    "전파가 맨 처음에 올 수 없습니다. 전파되려면 먼저 병원체가 병원소에서 탈출해야 합니다.",
    "침입은 전파 이후에 이루어집니다. 탈출 → 전파 → 침입 순서가 맞습니다.",
  ],
  chapterId: "micro_3",
  chapterDetailId: "micro_3_3",
};

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

  const creatorId = usersSnap.docs[0].id;
  console.log(`✅ 저요저요 UID: ${creatorId}`);

  // 2. chapter3.easy 퀴즈 찾기
  const quizzesSnap = await db.collection("quizzes")
    .where("creatorId", "==", creatorId)
    .get();

  const quizDoc = quizzesSnap.docs.find(d => {
    const title = (d.data().title || "").toLowerCase();
    return title === "chapter3.easy";
  });

  if (!quizDoc) {
    console.error("❌ chapter3.easy 퀴즈를 찾을 수 없습니다. 전체 목록:");
    quizzesSnap.docs.forEach(d => console.log(`  - ${d.id}: ${d.data().title}`));
    process.exit(1);
  }

  const quizId = quizDoc.id;
  const quizData = quizDoc.data();
  const questions = quizData.questions || [];

  console.log(`✅ 퀴즈 발견: ${quizId} (${quizData.title})`);
  console.log(`   현재 5번 문제: ${questions[QUESTION_INDEX]?.text}`);

  // 3. 5번 문제 교체
  questions[QUESTION_INDEX] = newQuestion;

  const batch = db.batch();
  batch.update(quizDoc.ref, { questions });
  console.log(`\n📝 5번 문제 교체: "${newQuestion.text}"`);

  // 4. 이 퀴즈를 푼 유저들의 reviews 갱신
  // questionId는 "q4" (0-indexed)
  const questionId = `q${QUESTION_INDEX}`;

  const reviewsSnap = await db.collection("reviews")
    .where("quizId", "==", quizId)
    .where("questionId", "==", questionId)
    .get();

  console.log(`\n🔍 reviews에서 5번 문제 관련 문서 ${reviewsSnap.size}개 발견`);

  for (const reviewDoc of reviewsSnap.docs) {
    const reviewData = reviewDoc.data();
    const userId = reviewData.userId;
    const reviewType = reviewData.reviewType;

    // 문제 내용 갱신 (정답/오답 상태는 유지하지 않고 새 문제 기준으로 갱신)
    // 기존 userAnswer를 새 문제 기준으로 isCorrect 재판정
    const userAnswerStr = reviewData.userAnswer;
    const userAnswerNum = parseInt(userAnswerStr);
    const isCorrectNow = userAnswerNum === newQuestion.answer;

    const updateData = {
      question: newQuestion.text,
      options: newQuestion.choices,
      correctAnswer: String(newQuestion.answer),
      explanation: newQuestion.explanation,
      choiceExplanations: newQuestion.choiceExplanations,
      isCorrect: isCorrectNow,
      chapterId: newQuestion.chapterId,
      chapterDetailId: newQuestion.chapterDetailId,
    };

    // wrong 타입인데 새 문제에서 맞은 경우 → 삭제
    if (reviewType === "wrong" && isCorrectNow) {
      batch.delete(reviewDoc.ref);
      console.log(`  🗑️ ${userId} wrong review 삭제 (새 문제 기준 정답)`);
    }
    // solved 타입인데 새 문제에서 틀린 경우 → wrong review 추가 생성 필요 체크
    else {
      batch.update(reviewDoc.ref, updateData);
      console.log(`  ✏️ ${userId} ${reviewType} review 갱신 (isCorrect: ${isCorrectNow})`);
    }
  }

  // 5. solved는 있지만 wrong이 없는 유저 중, 새 문제 기준 오답인 경우 wrong 추가
  const solvedReviews = reviewsSnap.docs.filter(d => d.data().reviewType === "solved");
  const wrongReviews = reviewsSnap.docs.filter(d => d.data().reviewType === "wrong");
  const wrongUserIds = new Set(wrongReviews.map(d => d.data().userId));

  for (const solvedDoc of solvedReviews) {
    const data = solvedDoc.data();
    const userAnswerNum = parseInt(data.userAnswer);
    const isCorrectNow = userAnswerNum === newQuestion.answer;

    // 새 문제 기준 오답인데 wrong review가 없는 경우 → 추가
    if (!isCorrectNow && !wrongUserIds.has(data.userId)) {
      const wrongReview = {
        ...data,
        question: newQuestion.text,
        options: newQuestion.choices,
        correctAnswer: String(newQuestion.answer),
        explanation: newQuestion.explanation,
        choiceExplanations: newQuestion.choiceExplanations,
        isCorrect: false,
        chapterId: newQuestion.chapterId,
        chapterDetailId: newQuestion.chapterDetailId,
        reviewType: "wrong",
        isBookmarked: false,
        reviewCount: 0,
        lastReviewedAt: null,
      };
      batch.create(db.collection("reviews").doc(), wrongReview);
      console.log(`  ➕ ${data.userId} wrong review 추가 생성`);
    }
  }

  // 6. quizResults의 questionScores도 갱신
  const resultsSnap = await db.collection("quizResults")
    .where("quizId", "==", quizId)
    .get();

  console.log(`\n🔍 quizResults ${resultsSnap.size}개 발견`);

  for (const resultDoc of resultsSnap.docs) {
    const resultData = resultDoc.data();
    const qs = resultData.questionScores;
    if (qs && qs[questionId]) {
      const userAnswer = qs[questionId].userAnswer;
      const userAnswerNum = parseInt(userAnswer);
      const isCorrectNow = userAnswerNum === newQuestion.answer;

      // correctAnswer만 갱신 (userAnswer는 유지)
      batch.update(resultDoc.ref, {
        [`questionScores.${questionId}.correctAnswer`]: String(newQuestion.answer),
        [`questionScores.${questionId}.isCorrect`]: isCorrectNow,
      });
      console.log(`  ✏️ quizResults/${resultDoc.id} ${questionId} 갱신 (isCorrect: ${isCorrectNow})`);
    }
  }

  // 배치 커밋
  await batch.commit();
  console.log("\n✅ 모든 수정 완료!");
  console.log("   - chapter3.easy 5번 문제 교체");
  console.log("   - 유저 reviews (서재/오답) 갱신");
  console.log("   - quizResults questionScores 갱신");
}

main().catch(e => {
  console.error("❌ 에러:", e.message);
  process.exit(1);
});
