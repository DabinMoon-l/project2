/**
 * 프로덕션 Firebase 부하 테스트 시드 데이터 생성
 *
 * 사용법:
 *   node tests/load/seed-production.js
 *
 * 필요:
 *   - serviceAccountKey.json (프로젝트 루트)
 *
 * 생성 데이터:
 *   - Auth 테스트 계정 300명 학생 + 5명 교수
 *   - Firestore users, quizzes, posts, rabbits 등
 *
 * ⚠️ 프로덕션 DB에 직접 씁니다. 테스트 후 cleanup-production.js 필수 실행!
 */

const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const { getDatabase } = require("firebase-admin/database");
const fs = require("fs");
const path = require("path");

const SA_PATH = path.resolve(__dirname, "../../serviceAccountKey.json");
if (!fs.existsSync(SA_PATH)) {
  console.error("serviceAccountKey.json이 프로젝트 루트에 필요합니다.");
  process.exit(1);
}

const sa = JSON.parse(fs.readFileSync(SA_PATH, "utf8"));
const app = initializeApp({
  credential: cert(sa),
  databaseURL: `https://${sa.project_id}-default-rtdb.asia-southeast1.firebasedatabase.app`,
});
const db = getFirestore(app);
const auth = getAuth(app);
const rtdb = getDatabase(app);

const NUM_STUDENTS = 300;
const NUM_PROFESSORS = 1;
const NUM_QUIZZES = 20; // 과목당 퀴즈 수 (VU 분산용)
const COURSES = ["biology", "microbiology"];
// 테스트 계정 식별 접두사 (cleanup 시 사용)
const UID_PREFIX = "load-test-";

// ── 테스트 학생 생성 ──

async function seedUsers() {
  console.log(`학생 ${NUM_STUDENTS}명 생성 중...`);
  let batch = db.batch();
  let batchCount = 0;

  for (let i = 0; i < NUM_STUDENTS; i++) {
    const uid = `${UID_PREFIX}${String(i).padStart(4, "0")}`;
    const email = `loadtest${String(i).padStart(4, "0")}@rabbitory.internal`;

    // Auth 계정 생성 (이미 있으면 스킵)
    try {
      await auth.createUser({ uid, email, password: "loadtest1234" });
    } catch (e) {
      if (e.code !== "auth/uid-already-exists") {
        console.warn(`  Auth 생성 실패 (${uid}):`, e.message);
      }
    }

    const courseId = i < 150 ? "biology" : "microbiology";
    const userRef = db.doc(`users/${uid}`);
    batch.set(userRef, {
      uid,
      email,
      studentId: `99${String(i).padStart(6, "0")}`,
      nickname: i < 150 ? `부하테스터${i}` : `부하미생물${i - 150}`,
      role: "student",
      courseId,
      classId: ["A", "B", "C", "D"][i % 4],
      totalExp: 2000,
      level: 10,
      onboardingCompleted: true,
      equippedRabbits: [{ rabbitId: 0, courseId }],
      lastGachaExp: 0,
      quizStats: {
        totalAttempts: 0,
        totalCorrect: 0,
        totalQuestions: 0,
        totalScoreSum: 0,
        averageScore: 0,
      },
      totalCorrect: 0,
      totalAttemptedQuestions: 0,
      professorQuizzesCompleted: 0,
      isLoadTest: true, // cleanup 식별용
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    batchCount++;

    if (batchCount >= 499) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
      console.log(`  ${i + 1}/${NUM_STUDENTS} 생성 완료`);
    }
  }

  if (batchCount > 0) await batch.commit();
  console.log(`  학생 ${NUM_STUDENTS}명 완료`);
}

// ── 교수 생성 ──

async function seedProfessors() {
  console.log(`교수 ${NUM_PROFESSORS}명 생성 중...`);
  const batch = db.batch();

  const configs = [
    { email: "loadprof0@test.rabbitory.internal", nickname: "부하교수0", courses: ["biology", "microbiology"] },
  ];

  for (let i = 0; i < NUM_PROFESSORS; i++) {
    const uid = `${UID_PREFIX}prof-${i}`;
    const cfg = configs[i];

    try {
      await auth.createUser({ uid, email: cfg.email, password: "loadtest1234" });
    } catch (e) {
      if (e.code !== "auth/uid-already-exists") {
        console.warn(`  교수 Auth 생성 실패 (${uid}):`, e.message);
      }
    }

    batch.set(db.doc(`users/${uid}`), {
      uid,
      email: cfg.email,
      nickname: cfg.nickname,
      role: "professor",
      assignedCourses: cfg.courses,
      totalExp: 0,
      level: 1,
      onboardingCompleted: true,
      isLoadTest: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // allowedProfessors 등록
    batch.set(db.doc(`allowedProfessors/${cfg.email}`), {
      courses: cfg.courses,
      name: cfg.nickname,
      isLoadTest: true,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();
  console.log(`  교수 ${NUM_PROFESSORS}명 완료`);
}

// ── 퀴즈 생성 ──

async function seedQuizzes() {
  console.log(`퀴즈 생성 중 (과목당 ${NUM_QUIZZES}개)...`);

  const courseConfig = {
    biology: { prefix: "bio", topics: ["세포", "DNA", "유전", "단백질", "효소", "생태계", "진화"] },
    microbiology: { prefix: "micro", topics: ["세균", "바이러스", "면역", "항생제", "감염", "배양", "멸균"] },
  };

  for (const courseId of COURSES) {
    const cfg = courseConfig[courseId];
    for (let q = 0; q < NUM_QUIZZES; q++) {
      const questions = [];
      for (let i = 0; i < 10; i++) {
        questions.push({
          id: `q${i}`,
          type: i < 7 ? "multiple" : i < 9 ? "ox" : "short_answer",
          text: `[부하테스트] ${courseId} 문제 ${i + 1} — ${cfg.topics[i % cfg.topics.length]}`,
          ...(i < 7 ? { choices: ["선택1", "선택2", "선택3", "선택4"] } : {}),
          answer: i < 7 ? Math.floor(Math.random() * 4) : i < 9 ? (Math.random() > 0.5 ? 0 : 1) : "정답",
          explanation: `해설 ${i + 1}`,
          ...(i < 7 ? { choiceExplanations: ["선택1 해설", "선택2 해설", "선택3 해설", "선택4 해설"] } : {}),
        });
      }

      await db.doc(`quizzes/load-test-${courseId}-quiz-${q}`).set({
        title: `[부하테스트] ${courseId} 퀴즈 ${q + 1}`,
        type: "professor",
        creatorId: `${UID_PREFIX}prof-0`,
        courseId,
        classId: "A",
        isPublic: true,
        isPublished: true,
        questions,
        participantCount: 0,
        averageScore: 0,
        userScores: {},
        chapterIds: [`${cfg.prefix}_${q + 1}`],
        isLoadTest: true,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }

  console.log(`  퀴즈 ${COURSES.length * NUM_QUIZZES}개 완료`);
}

// ── 토끼 데이터 ──

async function seedRabbits() {
  console.log("토끼 보유 데이터 생성 중...");
  let batch = db.batch();
  let batchCount = 0;

  for (let i = 0; i < NUM_STUDENTS; i++) {
    const uid = `${UID_PREFIX}${String(i).padStart(4, "0")}`;
    const courseId = i < 150 ? "biology" : "microbiology";

    // CF는 `${courseId}_${rabbitId}` 형식으로 조회함
    batch.set(db.doc(`users/${uid}/rabbitHoldings/${courseId}_0`), {
      rabbitId: 0,
      courseId,
      name: "기본토끼",
      level: 1,
      stats: { hp: 30, atk: 5, def: 5 },
      discoveryOrder: 0,
      obtainedAt: FieldValue.serverTimestamp(),
    });
    batchCount++;

    if (batchCount >= 499) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) await batch.commit();
  console.log("  토끼 보유 완료");
}

// ── 배틀 문제 풀 (기존 프로덕션 풀 사용, 없으면 생성) ──

async function seedTekkenPool() {
  // 기존 프로덕션 문제 풀이 있으면 스킵
  for (const courseId of COURSES) {
    const snap = await db.collection(`tekkenQuestionPool/${courseId}/questions`).limit(1).get();
    if (!snap.empty) {
      console.log(`  ${courseId} 배틀 문제 풀: 기존 프로덕션 데이터 사용`);
      continue;
    }

    console.log(`  ${courseId} 배틀 문제 풀 생성 중 (50문제)...`);
    const chapters = courseId === "biology"
      ? ["1", "2", "3", "4", "5", "6"]
      : ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"];

    const batch = db.batch();
    for (let i = 0; i < 50; i++) {
      const chapter = chapters[i % chapters.length];
      batch.set(db.doc(`tekkenQuestionPool/${courseId}/questions/load-q-${i}`), {
        text: `[부하테스트] ${courseId} 배틀 문제 ${i + 1}`,
        type: "multiple",
        choices: ["보기A", "보기B", "보기C", "보기D"],
        correctAnswer: i % 4,
        difficulty: i < 25 ? "easy" : "medium",
        chapter,
        chapters: [chapter],
        explanation: `정답: 보기${["A", "B", "C", "D"][i % 4]}`,
        choiceExplanations: ["A 해설", "B 해설", "C 해설", "D 해설"],
        isLoadTest: true,
        generatedAt: FieldValue.serverTimestamp(),
        batchId: "load-test-prod",
      });
    }
    await batch.commit();
  }
  console.log("  배틀 문제 풀 완료");
}

// ── RTDB 배틀 매칭 큐 초기화 ──

async function seedRtdb() {
  console.log("RTDB 매칭 큐 확인 중...");
  const snap = await rtdb.ref("tekken/matchmaking").get();
  if (!snap.exists()) {
    await rtdb.ref("tekken/matchmaking").set({
      biology: {},
      microbiology: {},
    });
    console.log("  RTDB 매칭 큐 초기화 완료");
  } else {
    console.log("  RTDB 매칭 큐: 기존 데이터 사용");
  }
}

// ── 메인 ──

async function main() {
  console.log("=== 프로덕션 부하 테스트 시드 ===\n");
  console.log("⚠️  프로덕션 Firebase에 테스트 데이터를 생성합니다.");
  console.log("⚠️  테스트 후 반드시 cleanup-production.js를 실행하세요!\n");

  await seedUsers();
  await seedProfessors();
  await seedQuizzes();
  await seedRabbits();
  await seedTekkenPool();
  await seedRtdb();

  console.log("\n=== 시드 완료! ===");
  console.log(`학생 ${NUM_STUDENTS}명 + 교수 ${NUM_PROFESSORS}명`);
  console.log(`퀴즈 ${COURSES.length * NUM_QUIZZES}개`);
  console.log("\n다음 단계:");
  console.log("  node tests/load/generate-tokens.js");
  console.log("  k6 run -e PROD=1 tests/load/mixed-scenario.k6.js");
}

main().catch((e) => {
  console.error("시드 실패:", e);
  process.exit(1);
});
