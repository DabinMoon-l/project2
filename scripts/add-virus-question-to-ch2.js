/**
 * chapter2.normal (4) 퀴즈에 바이러스 감염 문제 1개 추가
 *
 * 실행: node scripts/add-virus-question-to-ch2.js
 */

const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();

const newQuestion = {
  "id": "q21",
  "order": 21,
  "type": "multiple",
  "text": "바이러스 감염 시 감염세포를 제거하기 위한 CTL과 NK세포의 상보적 역할에 대한 설명으로 옳은 것은?",
  "choices": [
    "바이러스 감염세포는 MHC I에 바이러스 항원을 제시하여 CTL의 공격 대상이 되지만, 일부 바이러스는 MHC I 발현을 감소시켜 CTL을 회피한다. 이때 NK세포가 MHC I이 감소한 세포를 인식하여 살해함으로써 상보적 방어가 이루어진다.",
    "NK세포는 MHC I이 정상적으로 발현된 세포만을 살해 대상으로 인식하므로, 바이러스가 MHC I 발현을 감소시키면 NK세포에 의한 방어도 함께 무력화된다.",
    "CTL(CD8⁺)은 MHC II에 제시된 바이러스 항원을 인식하여 감염세포를 살해하며, NK세포는 MHC II 발현이 감소한 세포를 감지하여 보조적으로 작용한다.",
    "바이러스가 MHC I 발현을 감소시키면 CTL과 NK세포 모두 감염세포를 인식할 수 없으므로, 이 경우 항체에 의한 중화만이 유일한 방어 수단이다.",
    "NK세포의 살해 기전은 항체 매개(ADCC)에 의해서만 작동하므로, 항체가 생산되기 전인 감염 초기에는 NK세포가 바이러스 감염세포를 살해할 수 없다."
  ],
  "answer": 0,
  "explanation": "CTL은 MHC I에 제시된 바이러스 항원을 인식하여 감염세포를 살해한다. 일부 바이러스는 MHC I 발현을 하향조절하여 CTL을 회피하지만, NK세포는 MHC I이 감소한 세포를 'missing self'로 인식하여 살해한다. 이처럼 CTL과 NK세포가 상보적으로 작용하여 바이러스의 면역회피를 극복한다.",
  "choiceExplanations": [
    "정답. CTL은 MHC I 발현 세포를, NK세포는 MHC I 감소 세포를 각각 공격하여 바이러스가 어떤 전략을 취하든 면역 방어가 이루어지는 상보적 관계이다.",
    "오답. NK세포는 MHC I이 정상 발현된 세포에 대해서는 살해를 억제하고, MHC I이 감소한 세포를 살해한다(missing self 가설). 바이러스가 MHC I을 감소시키면 오히려 NK세포에 의한 살해가 활성화된다.",
    "오답. CTL(CD8⁺)은 MHC II가 아닌 MHC I에 제시된 항원을 인식한다. MHC II를 인식하는 것은 CD4⁺ 보조T세포이다.",
    "오답. MHC I 발현이 감소하면 CTL 인식은 어려워지지만, NK세포는 오히려 MHC I 감소를 감지하여 살해가 활성화된다. 두 세포가 상보적으로 작용하므로 방어가 완전히 무력화되지 않는다.",
    "오답. NK세포는 ADCC 외에도 자체 활성화/억제 수용체를 통해 MHC I 발현이 감소한 감염세포를 항체 없이 직접 살해할 수 있다. 이것이 선천면역으로서 감염 초기부터 작동하는 이유이다."
  ],
  "questionType": "MECHANISM",
  "chapterId": "micro_2"
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

  const userId = usersSnap.docs[0].id;
  console.log(`✅ 저요저요 UID: ${userId}`);

  // 2. chapter2.normal (4) 퀴즈 찾기
  const quizzesSnap = await db.collection("quizzes")
    .where("creatorId", "==", userId)
    .get();

  const targetQuiz = quizzesSnap.docs.find(d => {
    const title = (d.data().title || "");
    return title === "chapter2.normal (4)";
  });

  if (!targetQuiz) {
    console.error("❌ 'chapter2.normal (4)' 퀴즈를 찾을 수 없습니다");
    console.log("   전체 퀴즈 목록:");
    quizzesSnap.docs.forEach(d => console.log(`   - ${d.id}: ${d.data().title}`));
    process.exit(1);
  }

  const quizData = targetQuiz.data();
  const existingQuestions = quizData.questions || [];
  console.log(`✅ 퀴즈 발견: "${quizData.title}" [${targetQuiz.id}]`);
  console.log(`   기존 문제 수: ${existingQuestions.length}`);

  // 3. 새 문제 ID/order 설정
  newQuestion.id = `q${existingQuestions.length + 1}`;
  newQuestion.order = existingQuestions.length + 1;

  const updatedQuestions = [...existingQuestions, newQuestion];

  // 4. 업데이트
  await targetQuiz.ref.update({
    questions: updatedQuestions,
    questionCount: updatedQuestions.length,
    updatedAt: FieldValue.serverTimestamp(),
  });

  console.log(`\n✅ 완료!`);
  console.log(`   추가된 문제: ${newQuestion.id} — "${newQuestion.text.substring(0, 40)}..."`);
  console.log(`   총 문제 수: ${updatedQuestions.length}`);
}

main().catch(err => {
  console.error("❌ 오류:", err);
  process.exit(1);
});
