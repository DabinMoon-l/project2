/**
 * Firebase 에뮬레이터 시드 데이터 생성
 *
 * 에뮬레이터 시작 후 실행:
 *   firebase emulators:start
 *   node tests/load/seed-emulator.js
 *
 * 생성하는 데이터:
 *   - 테스트 유저 300명 (users, Auth)
 *   - 교수님 퀴즈 5개 (quizzes, 각 10문제)
 *   - 게시글 5개 (posts)
 *   - 토끼 도감 + 보유 데이터 (rabbits, rabbitHoldings)
 *   - 배틀 문제 풀 50문제 (tekkenQuestionPool)
 *   - 과목 설정 (settings, courseScopes)
 */

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIREBASE_DATABASE_EMULATOR_HOST = "127.0.0.1:9000";

const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const { getDatabase } = require("firebase-admin/database");

const app = initializeApp({
  projectId: "project2-7a317",
  databaseURL: "http://127.0.0.1:9000/?ns=project2-7a317-default-rtdb",
});
const db = getFirestore(app);
const auth = getAuth(app);
const rtdb = getDatabase(app);

const NUM_USERS = 300;
const COURSES = ["biology", "microbiology"];
const COURSE_ID = "biology"; // 하위 호환

// ── 테스트 유저 생성 ──

async function seedUsers() {
  console.log(`유저 ${NUM_USERS}명 생성 중...`);
  let batch = db.batch();
  let batchCount = 0;

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
    // totalExp: 500, lastGachaExp: 0 → 마일스톤 10개 보유 (뽑기/레벨업 테스트용)
    // 0~149: biology, 150~299: microbiology (2과목 혼합)
    const userCourseId = i < 150 ? "biology" : "microbiology";
    const userRef = db.doc(`users/${uid}`);
    batch.set(userRef, {
      uid,
      email: `${studentId}@rabbitory.internal`,
      studentId,
      nickname: i < 150 ? `테스터${i}` : `미생물${i - 150}`,
      role: "student",
      courseId: userCourseId,
      classId: ["A", "B", "C", "D"][i % 4],
      totalExp: 500,
      level: 5,
      onboardingCompleted: true,
      equippedRabbits: [{ rabbitId: 0, courseId: userCourseId }],
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
    batchCount++;

    // 500개 단위로 커밋 (Firestore 배치 제한)
    if (batchCount >= 499) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
      console.log(`  ${i + 1}/${NUM_USERS} 유저 생성 완료`);
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }
  console.log(`  ${NUM_USERS}명 유저 생성 완료`);
}

// ── 교수님 퀴즈 생성 (캐러셀 퀴즈) ──

async function seedQuizzes() {
  console.log("교수님 퀴즈 생성 중 (과목당 5개)...");

  const courseQuizConfig = {
    biology: { prefix: "bio", topics: ["세포", "DNA", "유전", "단백질", "효소", "생태계", "진화"] },
    microbiology: { prefix: "micro", topics: ["세균", "바이러스", "면역", "항생제", "감염", "배양", "멸균"] },
  };

  for (const courseId of COURSES) {
    const cfg = courseQuizConfig[courseId];
    for (let q = 0; q < 5; q++) {
      const questions = [];
      for (let i = 0; i < 10; i++) {
        questions.push({
          id: `q${i}`,
          type: i < 7 ? "multiple" : i < 9 ? "ox" : "short_answer",
          text: `${courseId} 문제 ${i + 1} — ${cfg.topics[i % cfg.topics.length]}에 대한 문제`,
          ...(i < 7 ? { choices: ["선택1", "선택2", "선택3", "선택4"] } : {}),
          answer: i < 7 ? Math.floor(Math.random() * 4) : i < 9 ? (Math.random() > 0.5 ? 0 : 1) : "정답",
          explanation: `해설 ${i + 1}`,
          ...(i < 7 ? { choiceExplanations: ["선택1 해설", "선택2 해설", "선택3 해설", "선택4 해설"] } : {}),
        });
      }

      await db.collection("quizzes").doc(`load-test-${courseId}-quiz-${q}`).set({
        title: `${courseId} 부하테스트 퀴즈 ${q + 1}`,
        type: "professor",
        creatorId: "professor-test",
        courseId,
        classId: "A",
        isPublic: true,
        isPublished: true,
        questions,
        participantCount: 0,
        averageScore: 0,
        userScores: {},
        chapterIds: [`${cfg.prefix}_${q + 1}`],
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }

  console.log(`  퀴즈 ${COURSES.length * 5}개 생성 완료 (과목당 5개)`);
}

// ── 게시글 생성 (학술 + 커뮤니티) ──

async function seedPosts() {
  console.log("게시글 5개 생성 중...");

  for (let i = 0; i < 5; i++) {
    await db.collection("posts").doc(`load-test-post-${i}`).set({
      title: `테스트 게시글 ${i + 1}`,
      content: `부하 테스트용 게시글 내용입니다. #${i + 1}`,
      category: "community",
      tag: i < 2 ? "학술" : "일반",
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

// ── 토끼 데이터 ──

async function seedRabbits() {
  console.log("토끼 데이터 생성 중 (2과목)...");

  // 도감 토끼 10종 (#0~#9) — 과목별
  for (const courseId of COURSES) {
    for (let r = 0; r < 10; r++) {
      await db.doc(`rabbits/${courseId}_${r}`).set({
        rabbitId: r,
        courseId,
        name: r === 0 ? "기본토끼" : `토끼${r}호`,
        discoveredBy: r === 0 ? "system" : `load-test-${String(r).padStart(4, "0")}`,
        discoveryOrder: r,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  }

  // 유저별 토끼 보유 (기본 토끼 #0)
  let batch = db.batch();
  let batchCount = 0;

  for (let i = 0; i < NUM_USERS; i++) {
    const uid = `load-test-${String(i).padStart(4, "0")}`;
    const userCourseId = i < 150 ? "biology" : "microbiology";
    batch.set(db.doc(`users/${uid}/rabbitHoldings/0`), {
      rabbitId: 0,
      courseId: userCourseId,
      name: "기본토끼",
      level: 1,
      hp: 30,
      atk: 5,
      def: 5,
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

  if (batchCount > 0) {
    await batch.commit();
  }

  console.log("  토끼 데이터 생성 완료 (과목별 도감 10종 + 보유)");
}

// ── 배틀 문제 풀 ──

async function seedTekkenPool() {
  console.log("배틀 문제 풀 생성 중 (과목당 50문제)...");

  const chapterMap = {
    biology: ["1", "2", "3", "4", "5", "6"],
    microbiology: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"],
  };

  for (const courseId of COURSES) {
    const chapters = chapterMap[courseId];
    const batch = db.batch();

    for (let i = 0; i < 50; i++) {
      const chapter = chapters[i % chapters.length];
      const difficulty = i < 25 ? "easy" : "medium";
      const ref = db.doc(`tekkenQuestionPool/${courseId}/questions/load-q-${i}`);

      batch.set(ref, {
        text: `${courseId} 배틀 문제 ${i + 1}: 챕터${chapter}`,
        type: "multiple",
        choices: ["보기A", "보기B", "보기C", "보기D"],
        correctAnswer: i % 4,
        difficulty,
        chapter,
        chapters: [chapter],
        explanation: `해설: 정답은 보기${["A", "B", "C", "D"][i % 4]}`,
        choiceExplanations: ["A 해설", "B 해설", "C 해설", "D 해설"],
        generatedAt: FieldValue.serverTimestamp(),
        batchId: "load-test-seed",
      });
    }

    await batch.commit();
    await db.doc(`tekkenQuestionPool/${courseId}`).set({
      totalQuestions: 50,
      lastRefill: FieldValue.serverTimestamp(),
    });
  }

  console.log(`  배틀 문제 풀 ${COURSES.length * 50}문제 생성 완료`);
}

// ── 설정 + 과목 스코프 ──

async function seedSettings() {
  console.log("설정 데이터 생성 중...");

  await db.doc("settings/semester").set({
    currentSemester: 1,
    currentYear: 2026,
    courseIds: ["biology", "microbiology"],
    courses: {
      biology: { name: "생물학", grade: 1 },
      microbiology: { name: "미생물학", grade: 2 },
    },
  });

  // 배틀 챕터 설정 (과목별)
  await db.doc("settings/tekken/courses/biology").set({
    chapters: ["1", "2", "3", "4", "5", "6"],
  });
  await db.doc("settings/tekken/courses/microbiology").set({
    chapters: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"],
  });

  // 과목 스코프 (콩콩이 AI 참고용)
  await db.doc("courseScopes/biology").set({
    keywords: ["세포", "DNA", "유전", "단백질", "효소", "생태계", "진화"],
    scope: "생물학 전반 — 세포 구조, 유전학, 분자생물학, 생태학",
  });
  await db.doc("courseScopes/microbiology").set({
    keywords: ["세균", "바이러스", "면역", "항생제", "감염", "배양", "멸균", "진균"],
    scope: "미생물학 — 세균학, 바이러스학, 면역학, 감염병",
  });

  console.log("  설정 완료");
}

// ── RTDB 배틀 초기 구조 ──

async function seedRtdb() {
  console.log("RTDB 배틀 구조 초기화 중...");

  await rtdb.ref("tekken").set({
    matchmaking: { biology: {}, microbiology: {} },
  });

  console.log("  RTDB 초기화 완료");
}

// ── 메인 ──

async function main() {
  console.log("=== Firebase 에뮬레이터 시드 데이터 생성 ===\n");

  await seedSettings();
  await seedUsers();
  await seedQuizzes();
  await seedPosts();
  await seedRabbits();
  await seedTekkenPool();
  await seedRtdb();

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
