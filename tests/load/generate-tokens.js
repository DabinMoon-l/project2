/**
 * k6 부하 테스트용 Firebase Auth 토큰 일괄 생성
 *
 * 사용법:
 *   node tests/load/generate-tokens.js
 *
 * 필요:
 *   - serviceAccountKey.json (프로젝트 루트)
 *   - enrolledStudents에 테스트 학번이 등록되어 있어야 함
 *
 * 출력:
 *   tests/load/tokens.json — k6에서 사용할 토큰 배열
 */

const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const fs = require("fs");
const path = require("path");

// ── 설정 ──

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const SA_PATH = path.join(PROJECT_ROOT, "serviceAccountKey.json");
const OUTPUT_PATH = path.join(__dirname, "tokens.json");

// 테스트 학번 범위 (실제 등록된 학번 사용 또는 테스트용 계정)
const TEST_STUDENT_IDS = [];
const NUM_VIRTUAL_USERS = Number(process.env.K6_VUS) || 300;

// Firebase API Key (.env.local에서 읽기)
let FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || "";
if (!FIREBASE_API_KEY) {
  try {
    const envFile = fs.readFileSync(path.join(PROJECT_ROOT, ".env.local"), "utf8");
    const match = envFile.match(/NEXT_PUBLIC_FIREBASE_API_KEY=(.+)/);
    if (match) FIREBASE_API_KEY = match[1].trim();
  } catch {
    // .env.local 없으면 무시
  }
}

// ── 초기화 ──

if (!fs.existsSync(SA_PATH)) {
  console.error("serviceAccountKey.json이 프로젝트 루트에 필요합니다.");
  process.exit(1);
}

const sa = require(SA_PATH);
const app = initializeApp({ credential: cert(sa) });
const auth = getAuth(app);

// ── Custom Token → ID Token 교환 ──

async function exchangeCustomTokenForIdToken(customToken) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: customToken,
      returnSecureToken: true,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`토큰 교환 실패: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data.idToken;
}

// ── 메인 ──

async function main() {
  if (!FIREBASE_API_KEY) {
    console.error("FIREBASE_API_KEY가 필요합니다. .env.local 또는 환경변수로 설정하세요.");
    process.exit(1);
  }

  console.log(`${NUM_VIRTUAL_USERS}개 토큰 생성 시작...`);

  // 기존 학생 계정의 UID 조회 또는 커스텀 토큰 생성
  const tokens = [];
  const batchSize = 50;

  for (let i = 0; i < NUM_VIRTUAL_USERS; i += batchSize) {
    const batch = [];
    const end = Math.min(i + batchSize, NUM_VIRTUAL_USERS);

    for (let j = i; j < end; j++) {
      // 테스트 UID 생성 (실제 유저가 아닌 가상 UID)
      const uid = `load-test-user-${String(j).padStart(4, "0")}`;

      batch.push(
        auth
          .createCustomToken(uid)
          .then((customToken) => exchangeCustomTokenForIdToken(customToken))
          .then((idToken) => {
            tokens.push({ uid, idToken, index: j });
          })
          .catch((err) => {
            console.warn(`토큰 생성 실패 (${uid}):`, err.message);
          })
      );
    }

    await Promise.all(batch);
    console.log(`  ${Math.min(end, NUM_VIRTUAL_USERS)}/${NUM_VIRTUAL_USERS} 완료`);
  }

  // 저장
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(tokens, null, 2));
  console.log(`\n${tokens.length}개 토큰 저장: ${OUTPUT_PATH}`);
  console.log("\nk6 실행:");
  console.log("  k6 run tests/load/recordAttempt.k6.js");
}

main().catch((err) => {
  console.error("토큰 생성 실패:", err);
  process.exit(1);
});
