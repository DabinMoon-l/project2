/**
 * settings/semester 문서 생성 스크립트
 *
 * CourseContext에서 매번 "학기 설정 문서가 없습니다" 경고가 출력되는 문제 해결.
 * 기본 학기 설정 문서를 Firestore에 생성합니다.
 *
 * 실행: node scripts/create-semester-setting.js
 */

const admin = require("firebase-admin");
const path = require("path");

// Firebase Admin 초기화
const serviceAccountPath = path.join(__dirname, "../serviceAccountKey.json");
admin.initializeApp({
  credential: admin.credential.cert(require(serviceAccountPath)),
});

const db = admin.firestore();

// 현재 날짜 기반 학기 판별 (2월 22일 ~ 8월 21일 = 1학기)
function getCurrentSemester() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  if ((month === 2 && day >= 22) || (month >= 3 && month <= 7) || (month === 8 && day <= 21)) {
    return 1;
  }
  return 2;
}

async function main() {
  const year = new Date().getFullYear();
  const semester = getCurrentSemester();

  const settingsData = {
    currentYear: year,
    currentSemester: semester,
    semesterDates: {
      spring: {
        start: `${year}-02-22`,
        end: `${year}-08-22`,
      },
      fall: {
        start: `${year}-08-22`,
        end: `${year + 1}-02-22`,
      },
    },
  };

  const ref = db.collection("settings").doc("semester");
  const existing = await ref.get();

  if (existing.exists) {
    console.log("settings/semester 문서가 이미 존재합니다:");
    console.log(JSON.stringify(existing.data(), null, 2));
    console.log("\n덮어쓰지 않습니다. 수동으로 업데이트하려면 Firebase 콘솔을 사용하세요.");
  } else {
    await ref.set(settingsData);
    console.log("settings/semester 문서를 생성했습니다:");
    console.log(JSON.stringify(settingsData, null, 2));
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("오류:", err);
  process.exit(1);
});
