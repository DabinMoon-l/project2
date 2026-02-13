/**
 * 테스트 사용자 사전 생성 스크립트 (최적화 버전)
 *
 *   node load-tests/setup-test-users.js
 *
 * 최적화:
 * - getUsers()로 기존 사용자 100명씩 일괄 확인 → 이미 있으면 건너뜀
 * - createUser()를 20개씩 병렬 처리 (Promise.allSettled)
 * - Firestore batch write로 500건씩 일괄 쓰기
 * → 300명 신규 생성: 약 30~60초 / 이미 존재: 약 5초
 */

const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();
const auth = admin.auth();

const USER_COUNT = 300;
const PASSWORD = "LoadTest2024!";
const CLASS_TYPES = ["A", "B", "C", "D"];
const COURSE_ID = process.env.TEST_COURSE_ID || "biology";
const AUTH_PARALLEL = 20; // Auth 동시 생성 수

async function createTestUsers() {
  console.log(`테스트 사용자 ${USER_COUNT}명 생성 시작...`);
  console.time("전체 소요 시간");

  // ── 1단계: 기존 사용자 일괄 확인 (getUsers, 100명씩) ──
  console.log("\n[1/3] 기존 사용자 확인 중...");
  const uidMap = {}; // index → uid

  for (let start = 0; start < USER_COUNT; start += 100) {
    const end = Math.min(start + 100, USER_COUNT);
    const identifiers = [];

    for (let i = start; i < end; i++) {
      identifiers.push({
        email: `loadtest-user-${String(i).padStart(3, "0")}@test.com`,
      });
    }

    try {
      const result = await auth.getUsers(identifiers);
      for (const user of result.users) {
        // 이메일에서 인덱스 추출
        const match = user.email.match(/loadtest-user-(\d+)@/);
        if (match) {
          uidMap[parseInt(match[1], 10)] = user.uid;
        }
      }
    } catch {
      // getUsers 미지원 시 무시 (2단계에서 에러 처리)
    }

    process.stdout.write(`  확인: ${end}/${USER_COUNT}\r`);
  }

  const existingCount = Object.keys(uidMap).length;
  console.log(`  기존: ${existingCount}명 / 신규 필요: ${USER_COUNT - existingCount}명`);

  // ── 2단계: 신규 Auth 사용자 병렬 생성 (20개씩) ──
  const toCreate = [];
  for (let i = 0; i < USER_COUNT; i++) {
    if (!uidMap[i]) toCreate.push(i);
  }

  if (toCreate.length > 0) {
    console.log(`\n[2/3] Auth 사용자 ${toCreate.length}명 병렬 생성 중 (${AUTH_PARALLEL}개씩)...`);
    let created = 0;
    let failed = 0;

    for (let start = 0; start < toCreate.length; start += AUTH_PARALLEL) {
      const batch = toCreate.slice(start, start + AUTH_PARALLEL);

      const results = await Promise.allSettled(
        batch.map((i) => {
          const paddedIndex = String(i).padStart(3, "0");
          return auth.createUser({
            email: `loadtest-user-${paddedIndex}@test.com`,
            password: PASSWORD,
            displayName: `테스트유저${paddedIndex}`,
          });
        })
      );

      for (let j = 0; j < results.length; j++) {
        const i = batch[j];
        const result = results[j];

        if (result.status === "fulfilled") {
          uidMap[i] = result.value.uid;
          created++;
        } else {
          // 이미 존재하는 경우 uid 조회
          if (result.reason?.code === "auth/email-already-exists") {
            try {
              const paddedIndex = String(i).padStart(3, "0");
              const existing = await auth.getUserByEmail(
                `loadtest-user-${paddedIndex}@test.com`
              );
              uidMap[i] = existing.uid;
              created++;
            } catch {
              failed++;
            }
          } else {
            console.error(
              `  ✗ user-${String(i).padStart(3, "0")}: ${result.reason?.message}`
            );
            failed++;
          }
        }
      }

      process.stdout.write(
        `  생성: ${created + failed}/${toCreate.length} (성공 ${created}, 실패 ${failed})\r`
      );
    }

    console.log(
      `\n  Auth 완료: 성공 ${created}명, 실패 ${failed}명`
    );
  } else {
    console.log("\n[2/3] Auth 사용자 전부 존재, 건너뜀");
  }

  // ── 3단계: Firestore 문서 일괄 쓰기 (batch 500건) ──
  console.log(`\n[3/3] Firestore 사용자 문서 일괄 쓰기...`);

  for (let start = 0; start < USER_COUNT; start += 500) {
    const batch = db.batch();
    const end = Math.min(start + 500, USER_COUNT);

    for (let i = start; i < end; i++) {
      const uid = uidMap[i];
      if (!uid) continue;

      const paddedIndex = String(i).padStart(3, "0");
      batch.set(
        db.collection("users").doc(uid),
        {
          email: `loadtest-user-${paddedIndex}@test.com`,
          nickname: `로드테스트${paddedIndex}`,
          role: "student",
          classType: CLASS_TYPES[i % 4],
          courseId: COURSE_ID,
          studentId: `2024${paddedIndex}`,
          totalExp: 0,
          rank: "견습생",
          badges: [],
          onboardingCompleted: true,
          characterOptions: {
            hairStyle: "default",
            skinColor: "#FFD5B8",
            beard: "none",
          },
          equipment: { armor: null, weapon: null },
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    await batch.commit();
    console.log(`  Firestore: ${end}/${USER_COUNT}`);
  }

  console.timeEnd("전체 소요 시간");

  const totalMapped = Object.keys(uidMap).length;
  console.log(`\n✅ 사용자 ${totalMapped}/${USER_COUNT}명 준비 완료`);
}

async function createTestQuiz() {
  console.log("\n테스트 퀴즈 생성...");

  const questions = [];
  for (let i = 0; i < 10; i++) {
    questions.push({
      id: `q${i}`,
      type: "multiple",
      text: `부하 테스트 문제 ${i + 1}번`,
      choices: ["선지 1", "선지 2", "선지 3", "선지 4"],
      answer: i % 4,
      explanation: `해설 ${i + 1}`,
      imageUrl: null,
      choiceExplanations: null,
    });
  }

  const quizRef = db.collection("quizzes").doc();
  await quizRef.set({
    title: "[부하 테스트] 테스트 퀴즈",
    courseId: COURSE_ID,
    courseName: "생물학",
    creatorId: "system",
    creatorName: "시스템",
    questions,
    questionCount: 10,
    isPublic: true,
    completedUsers: [],
    bookmarkCount: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`✅ 테스트 퀴즈 생성 완료: ${quizRef.id}`);
  console.log(`\nk6 실행 시 환경변수로 전달:`);
  console.log(`  export TEST_QUIZ_ID=${quizRef.id}`);
}

async function main() {
  await createTestUsers();
  await createTestQuiz();
  process.exit(0);
}

main().catch((err) => {
  console.error("스크립트 실패:", err);
  process.exit(1);
});
