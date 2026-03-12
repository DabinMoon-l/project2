/**
 * k6 스파이크 테스트 — 300명 동시 제출 (한 번에)
 *
 * 시나리오: 시험 종료 시 300명이 거의 동시에 제출 버튼을 누르는 상황
 *
 * 에뮬레이터 대상 (기본):
 *   firebase emulators:start
 *   node tests/load/seed-emulator.js
 *   node tests/load/generate-tokens-emulator.js
 *   k6 run tests/load/spike-submit.k6.js
 */

import http from "k6/http";
import { check } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import { SharedArray } from "k6/data";

// ── 토큰 로드 ──

const tokens = new SharedArray("tokens", function () {
  return JSON.parse(open("./tests/load/tokens.json"));
});

// ── 설정 ──

const PROJECT_ID = "project2-7a317";
const REGION = "asia-northeast3";
const QUIZ_ID = __ENV.QUIZ_ID || "load-test-quiz-0";
const VUS = Number(__ENV.VUS) || 300;
const BASE_URL = __ENV.FUNCTIONS_URL
  ? `${__ENV.FUNCTIONS_URL}/recordAttempt`
  : `http://127.0.0.1:5001/${PROJECT_ID}/${REGION}/recordAttempt`;

// ── 메트릭 ──

const submitSuccess = new Rate("submit_success");
const submitDuration = new Trend("submit_duration", true);
const rateLimited = new Counter("rate_limited");
const serverErrors = new Counter("server_errors");

// ── 시나리오: 300명 동시 1회 제출 ──

export const options = {
  scenarios: {
    spike: {
      executor: "shared-iterations",
      vus: VUS,
      iterations: VUS,     // 1인당 1회
      maxDuration: "120s",
    },
  },
  thresholds: {
    submit_success: ["rate>0.90"],        // 90% 이상 성공
    submit_duration: ["p(95)<20000"],     // 95th < 20초
  },
};

// ── 답안 생성 ──

function generateAnswers(n) {
  const answers = [];
  for (let i = 0; i < n; i++) {
    answers.push({
      questionId: `q${i}`,
      answer: Math.floor(Math.random() * 4),
    });
  }
  return answers;
}

// ── 메인 ──

export default function () {
  const tokenData = tokens[__VU % tokens.length];
  if (!tokenData?.idToken) return;

  const payload = JSON.stringify({
    data: {
      quizId: QUIZ_ID,
      answers: generateAnswers(Number(__ENV.NUM_QUESTIONS) || 10),
    },
  });

  const res = http.post(BASE_URL, payload, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenData.idToken}`,
    },
    timeout: "60s",
  });

  submitDuration.add(res.timings.duration);

  const ok = check(res, { "status 200": (r) => r.status === 200 });

  if (ok) {
    submitSuccess.add(1);
  } else if (res.status === 429) {
    rateLimited.add(1);
    submitSuccess.add(0);
  } else {
    serverErrors.add(1);
    submitSuccess.add(0);
  }
}
