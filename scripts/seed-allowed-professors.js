/**
 * allowedProfessors 컬렉션 시드 스크립트
 *
 * 기존 하드코딩된 교수 이메일을 Firestore로 마이그레이션.
 * 새 교수 추가 시 이 스크립트에 항목 추가 후 실행하거나,
 * Firebase Console에서 직접 문서 추가.
 *
 * 사용법: node scripts/seed-allowed-professors.js
 */

const admin = require("firebase-admin");

// Firebase Admin 초기화
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// 교수 허용 목록 (하드코딩에서 이전)
const ALLOWED_PROFESSORS = [
  {
    email: "jkim@ccn.ac.kr",
    nickname: "교수님",
    courses: ["biology", "microbiology", "pathophysiology"],
  },
  // 새 교수 추가 시 여기에 항목 추가
  // {
  //   email: "newprof@example.ac.kr",
  //   nickname: "새 교수님",
  //   courses: ["biology"],
  // },
];

async function seed() {
  const batch = db.batch();

  for (const prof of ALLOWED_PROFESSORS) {
    const ref = db.collection("allowedProfessors").doc(prof.email);
    batch.set(ref, {
      nickname: prof.nickname,
      courses: prof.courses,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log(`  + ${prof.email} → [${prof.courses.join(", ")}]`);
  }

  await batch.commit();
  console.log(`\n완료: ${ALLOWED_PROFESSORS.length}명 시드됨`);
}

seed().catch(console.error);
