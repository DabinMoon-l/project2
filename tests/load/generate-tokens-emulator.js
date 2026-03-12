/**
 * Firebase 에뮬레이터용 토큰 일괄 생성
 *
 * 에뮬레이터 시작 + 시드 완료 후 실행:
 *   node tests/load/generate-tokens-emulator.js
 *
 * Auth 에뮬레이터의 REST API로 직접 토큰을 발급합니다.
 * 프로덕션과 전혀 무관 — 에뮬레이터에서만 유효.
 */

const fs = require("fs");
const path = require("path");

const AUTH_EMULATOR = "http://127.0.0.1:9099";
const API_KEY = "fake-api-key"; // 에뮬레이터는 아무 키나 허용
const NUM_USERS = Number(process.env.K6_VUS) || 300;
const OUTPUT_PATH = path.join(__dirname, "tokens.json");

async function signIn(email, password) {
  const url = `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`로그인 실패 (${email}): ${res.status} ${err}`);
  }

  const data = await res.json();
  return { idToken: data.idToken, localId: data.localId };
}

async function main() {
  console.log(`에뮬레이터에서 ${NUM_USERS}개 토큰 생성 중...\n`);

  const tokens = [];
  const batchSize = 50;

  for (let i = 0; i < NUM_USERS; i += batchSize) {
    const batch = [];
    const end = Math.min(i + batchSize, NUM_USERS);

    for (let j = i; j < end; j++) {
      const studentId = `99${String(j).padStart(6, "0")}`;
      const email = `${studentId}@rabbitory.internal`;
      const uid = `load-test-${String(j).padStart(4, "0")}`;

      batch.push(
        signIn(email, "loadtest1234")
          .then(({ idToken }) => {
            tokens.push({ uid, idToken, index: j });
          })
          .catch((err) => {
            console.warn(`  실패 (${uid}): ${err.message}`);
          })
      );
    }

    await Promise.all(batch);
    console.log(`  ${Math.min(end, NUM_USERS)}/${NUM_USERS} 완료`);
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(tokens, null, 2));
  console.log(`\n${tokens.length}개 토큰 저장: ${OUTPUT_PATH}`);
  console.log("\nk6 실행:");
  console.log("  k6 run tests/load/mixed-scenario.k6.js");
}

main().catch((e) => {
  console.error("토큰 생성 실패:", e);
  process.exit(1);
});
