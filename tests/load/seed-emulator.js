/**
 * Firebase 에뮬레이터 시드 데이터 생성
 *
 * 에뮬레이터 시작 후 실행:
 *   firebase emulators:start
 *   node tests/load/seed-emulator.js
 *
 * 생성하는 데이터:
 *   - 테스트 유저 300명 (users 컬렉션)
 *   - 테스트 퀴즈 5개 (quizzes 컬렉션, 각 10문제)
 *   - 테스트 게시글 5개 (posts 컬렉션)
 *   - 토끼 데이터 (rabbits 컬렉션)
 *   - 배틀 문제 풀 (tekkenQuestionPool)
 */

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIREBASE_DATABASE_EMULATOR_HOST = "127.0.0.1:9000";

const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

const app = initializeApp({ projectId: "project2-7a317" });
const db = getFirestore(app);
const auth = getAuth(app);

const NUM_USERS = 300;
const COURSE_ID = "biology";

// ── 테스트 유저 생성 ──

async function seedUsers() {
  console.log(`유저 ${NUM_USERS}명 생성 중...`);
  const batch = db.batch();

  for (let i = 0; i < NUM_USERS; i++) {
    const uid = `load-test-${String(i).padStart(4, "0")}`;
    const studentId = `99${String(i).padStart(6, "0")}`;

    // Auth 유저 생성
    try {
      await auth.createUser({
        uid,
        email: `${studentId}@rabbitory.internal`,
        password: "loadtest1234",
      });
    } catch (e) {
      // 이미 존재하면 무시
    }

    // Firestore 유저 문서
    const userRef = db.doc(`users/${uid}`);
    batch.set(userRef, {
      uid,
      email: `${studentId}@rabbitory.internal`,
      studentId,
      nickname: `테스터${i}`,
      role: "student",
      courseId: COURSE_ID,
      classId: ["A", "B", "C", "D"][i % 4],
      totalExp: Math.floor(Math.random() * 500),
      level: Math.floor(Math.random() * 10) + 1,
      onboardingCompleted: true,
      equippedRabbits: [{ rabbitId: 0, courseId: COURSE_ID }],
      lastGachaExp: 0,
      quizStats: {
        totalAttempts: 0,
        totalCorrect: 0,
        totalQuestions: 0,
        totalScoreSum: 0,
        averageScore: 0,
      },
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // 500개 단위로 커밋 (Firestore 배치 제한)
    if ((i + 1) % 500 === 0) {
      await batch.commit();
      console.log(`  ${i + 1}/${NUM_USERS} 유저 생성 완료`);
    }
  }

  // 나머지 커밋
  await batch.commit();
  console.log(`  ${NUM_USERS}명 유저 생성 완료`);
}

// ── 테스트 퀴즈 생성 ──

async function seedQuizzes() {
  console.log("퀴즈 5개 생성 중...");

  for (let q = 0; q < 5; q++) {
    const questions = [];
    for (let i = 0; i < 10; i++) {
      questions.push({
        id: `q${i}`,
        type: i < 7 ? "multiple" : i < 9 ? "ox" : "short_answer",
        text: `테스트 문제 ${i + 1}`,
        choices: i < 7 ? ["선택1", "선택2", "선택3", "선택4"] : undefined,
        answer: i < 7 ? Math.floor(Math.random() * 4) : i < 9 ? (Math.random() > 0.5 ? 0 : 1) : "정답",
        explanation: `해설 ${i + 1}`,
      });
    }

    await db.collection("quizzes").doc(`load-test-quiz-${q}`).set({
      title: `부하테스트 퀴즈 ${q + 1}`,
      type: "professor",
      creatorId: "professor-test",
      courseId: COURSE_ID,
      classId: "A",
      isPublic: true,
      isPublished: true,
      questions,
      participantCount: 0,
      averageScore: 0,
      userScores: {},
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  console.log("  퀴즈 5개 생성 완료");
}

// ── 테스트 게시글 생성 ──

async function seedPosts() {
  console.log("게시글 5개 생성 중...");

  for (let i = 0; i < 5; i++) {
    await db.collection("posts").doc(`load-test-post-${i}`).set({
      title: `테스트 게시글 ${i + 1}`,
      content: `부하 테스트용 게시글 내용입니다. #${i + 1}`,
      category: "community",
      authorId: `load-test-${String(i).padStart(4, "0")}`,
      authorNickname: `테스터${i}`,
      authorClassType: "A",
      courseId: COURSE_ID,
      likes: 0,
      likedBy: [],
      commentCount: 0,
      viewCount: 0,
      isAnonymous: false,
      isNotice: false,
      imageUrls: [],
      fileUrls: [],
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  console.log("  게시글 5개 생성 완료");
}

// ── 토끼 기본 데이터 ──

async function seedRabbits() {
  console.log("기본 토끼 데이터 생성 중...");

  // 기본 토끼 (#0)
  await db.doc(`rabbits/${COURSE_ID}_0`).set({
    rabbitId: 0,
    courseId: COURSE_ID,
    name: "기본토끼",
    discoveredBy: "system",
    discoveryOrder: 0,
    createdAt: FieldValue.serverTimestamp(),
  });

  // 유저별 토끼 보유
  const batch = db.batch();
  for (let i = 0; i < Math.min(NUM_USERS, 300); i++) {
    const uid = `load-test-${String(i).padStart(4, "0")}`;
    batch.set(db.doc(`users/${uid}/rabbitHoldings/0`), {
      rabbitId: 0,
      courseId: COURSE_ID,
      name: "기본토끼",
      level: 1,
      hp: 30,
      atk: 5,
      def: 5,
      discoveryOrder: 0,
      obtainedAt: FieldValue.serverTimestamp(),
    });

    if ((i + 1) % 500 === 0) {
      await batch.commit();
    }
  }
  await batch.commit();

  console.log("  토끼 데이터 생성 완료");
}

// ── 설정 데이터 ──

async function seedSettings() {
  console.log("설정 데이터 생성 중...");

  await db.doc("settings/semester").set({
    currentSemester: 1,
    currentYear: 2026,
    courses: {
      biology: { name: "생물학", grade: 1 },
      microbiology: { name: "미생물학", grade: 2 },
    },
  });

  // 배틀 챕터 설정
  await db.doc(`settings/tekken/courses/${COURSE_ID}`).set({
    chapters: ["1", "2", "3", "4", "5", "6"],
  });

  console.log("  설정 완료");
}

// ── 메인 ──

async function main() {
  console.log("=== Firebase 에뮬레이터 시드 데이터 생성 ===\n");

  await seedSettings();
  await seedUsers();
  await seedQuizzes();
  await seedPosts();
  await seedRabbits();

  console.log("\n=== 시드 완료! ===");
  console.log("에뮬레이터 UI: http://127.0.0.1:4000");
  console.log("\n다음 단계:");
  console.log("  node tests/load/generate-tokens-emulator.js");
  console.log("  k6 run tests/load/mixed-scenario.k6.js");
}

main().catch((e) => {
  console.error("시드 실패:", e);
  process.exit(1);
});
