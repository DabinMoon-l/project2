/**
 * 프로덕션 k6 부하 테스트용 Firebase Auth 토큰 일괄 생성
 *
 * 사용법:
 *   node tests/load/generate-tokens.js
 *
 * 필요:
 *   - serviceAccountKey.json (프로젝트 루트)
 *   - seed-production.js 먼저 실행 (Auth 계정 생성)
 *
 * 출력:
 *   tests/load/tokens.json     — 학생 토큰 배열
 *   tests/load/prof-tokens.json — 교수 토큰 배열
 */

const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const fs = require("fs");
const path = require("path");

// ── 설정 ──

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const SA_PATH = path.join(PROJECT_ROOT, "serviceAccountKey.json");
const OUTPUT_PATH = path.join(__dirname, "tokens.json");
const PROF_OUTPUT_PATH = path.join(__dirname, "prof-tokens.json");

const NUM_STUDENTS = Number(process.env.K6_VUS) || 300;
const NUM_PROFESSORS = 1;
const UID_PREFIX = "load-test-";

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
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
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

  // ── 학생 토큰 ──
  console.log(`학생 ${NUM_STUDENTS}개 토큰 생성 중...`);
  const tokens = [];
  const batchSize = 50;

  for (let i = 0; i < NUM_STUDENTS; i += batchSize) {
    const batch = [];
    const end = Math.min(i + batchSize, NUM_STUDENTS);

    for (let j = i; j < end; j++) {
      const uid = `${UID_PREFIX}${String(j).padStart(4, "0")}`;

      batch.push(
        auth
          .createCustomToken(uid)
          .then((customToken) => exchangeCustomTokenForIdToken(customToken))
          .then((idToken) => {
            tokens.push({ uid, idToken, index: j, role: "student" });
          })
          .catch((err) => {
            console.warn(`  학생 토큰 실패 (${uid}): ${err.message}`);
          })
      );
    }

    await Promise.all(batch);
    console.log(`  ${Math.min(end, NUM_STUDENTS)}/${NUM_STUDENTS} 완료`);
  }

  // index 순서 보장
  tokens.sort((a, b) => a.index - b.index);
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(tokens, null, 2));
  console.log(`${tokens.length}개 학생 토큰 저장: ${OUTPUT_PATH}`);

  // ── 교수 토큰 ──
  console.log(`\n교수 ${NUM_PROFESSORS}개 토큰 생성 중...`);
  const profTokens = [];

  for (let i = 0; i < NUM_PROFESSORS; i++) {
    const uid = `${UID_PREFIX}prof-${i}`;

    try {
      const customToken = await auth.createCustomToken(uid);
      const idToken = await exchangeCustomTokenForIdToken(customToken);
      profTokens.push({ uid, idToken, index: i, role: "professor" });
    } catch (err) {
      console.warn(`  교수 토큰 실패 (${uid}): ${err.message}`);
    }
  }

  fs.writeFileSync(PROF_OUTPUT_PATH, JSON.stringify(profTokens, null, 2));
  console.log(`${profTokens.length}개 교수 토큰 저장: ${PROF_OUTPUT_PATH}`);

  console.log("\n프로덕션 k6 실행:");
  console.log("  k6 run -e PROD=1 tests/load/mixed-scenario.k6.js");
}

main().catch((err) => {
  console.error("토큰 생성 실패:", err);
  process.exit(1);
});
