/**
 * k6 부하 테스트 — recordAttempt 동시 제출
 *
 * 시나리오: 300명 학생이 동시에 퀴즈를 제출
 *
 * 사전 준비:
 *   1. node tests/load/generate-tokens.js   (토큰 생성)
 *   2. 테스트용 퀴즈 ID를 K6_QUIZ_ID 환경변수로 전달
 *
 * 실행:
 *   k6 run -e QUIZ_ID=<퀴즈ID> tests/load/recordAttempt.k6.js
 *
 * 옵션:
 *   k6 run -e QUIZ_ID=xxx -e VUS=100 -e DURATION=30s tests/load/recordAttempt.k6.js
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import { SharedArray } from "k6/data";

// ── 토큰 로드 ──

const tokens = new SharedArray("tokens", function () {
  // k6는 프로젝트 루트에서 실행한다고 가정
  const data = JSON.parse(open("./tests/load/tokens.json"));
  return data;
});

// ── 설정 ──

const PROJECT_ID = "project2-7a317";
const REGION = "asia-northeast3";
const QUIZ_ID = __ENV.QUIZ_ID || "TEST_QUIZ_ID";
const BASE_URL = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/recordAttempt`;

// ── 커스텀 메트릭 ──

const submitSuccess = new Rate("submit_success");
const submitDuration = new Trend("submit_duration", true);
const alreadySubmitted = new Counter("already_submitted");
const rateLimited = new Counter("rate_limited");
const serverErrors = new Counter("server_errors");

// ── 시나리오 ──

export const options = {
  scenarios: {
    // 시나리오 1: 점진적 증가 (ramp-up)
    ramp_up: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "10s", target: 50 },   // 10초간 50명까지 증가
        { duration: "10s", target: 150 },  // 10초간 150명까지
        { duration: "10s", target: 300 },  // 10초간 300명까지
        { duration: "30s", target: 300 },  // 30초간 300명 유지
        { duration: "10s", target: 0 },    // 10초간 종료
      ],
      exec: "submitQuiz",
    },

    // 시나리오 2: 동시 폭발 (spike)
    // 주석 해제하여 사용
    // spike: {
    //   executor: "shared-iterations",
    //   vus: 300,
    //   iterations: 300,
    //   maxDuration: "60s",
    //   exec: "submitQuiz",
    //   startTime: "0s",
    // },
  },

  thresholds: {
    // 성공률 95% 이상
    submit_success: ["rate>0.95"],
    // 중앙값 5초 이내
    submit_duration: ["p(50)<5000"],
    // 95th percentile 15초 이내
    "submit_duration{p95}": ["p(95)<15000"],
  },
};

// ── 테스트용 답안 생성 ──

function generateAnswers(numQuestions) {
  const answers = [];
  for (let i = 0; i < numQuestions; i++) {
    answers.push({
      questionId: `q${i}`,
      answer: Math.floor(Math.random() * 4), // 0~3 랜덤 객관식 답
    });
  }
  return answers;
}

// ── 메인 테스트 함수 ──

export function submitQuiz() {
  // 각 VU에 고유 토큰 할당 (순환)
  const tokenData = tokens[__VU % tokens.length];
  if (!tokenData || !tokenData.idToken) {
    console.warn(`VU ${__VU}: 토큰 없음, 건너뜀`);
    return;
  }

  const numQuestions = Number(__ENV.NUM_QUESTIONS) || 10;
  const answers = generateAnswers(numQuestions);

  const payload = JSON.stringify({
    data: {
      quizId: QUIZ_ID,
      answers: answers,
    },
  });

  const params = {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenData.idToken}`,
    },
    timeout: "30s",
  };

  const startTime = Date.now();
  const res = http.post(BASE_URL, payload, params);
  const duration = Date.now() - startTime;

  submitDuration.add(duration);

  // 결과 분석
  const isSuccess = check(res, {
    "status 200": (r) => r.status === 200,
  });

  if (res.status === 200) {
    try {
      const body = JSON.parse(res.body);
      if (body.result && body.result.alreadySubmitted) {
        alreadySubmitted.add(1);
      }
    } catch {
      // JSON 파싱 실패 무시
    }
    submitSuccess.add(1);
  } else if (res.status === 429) {
    rateLimited.add(1);
    submitSuccess.add(0);
  } else {
    serverErrors.add(1);
    submitSuccess.add(0);
    if (__ENV.DEBUG) {
      console.log(`VU ${__VU}: HTTP ${res.status} — ${res.body?.substring(0, 200)}`);
    }
  }

  // 실제 사용자처럼 약간의 간격
  sleep(Math.random() * 2 + 0.5);
}

// ── 결과 요약 ──

export function handleSummary(data) {
  const summary = {
    timestamp: new Date().toISOString(),
    quizId: QUIZ_ID,
    metrics: {
      totalRequests: data.metrics.http_reqs?.values?.count || 0,
      successRate: data.metrics.submit_success?.values?.rate || 0,
      avgDuration: data.metrics.submit_duration?.values?.avg || 0,
      p50Duration: data.metrics.submit_duration?.values["p(50)"] || 0,
      p95Duration: data.metrics.submit_duration?.values["p(95)"] || 0,
      p99Duration: data.metrics.submit_duration?.values["p(99)"] || 0,
      rateLimited: data.metrics.rate_limited?.values?.count || 0,
      serverErrors: data.metrics.server_errors?.values?.count || 0,
      alreadySubmitted: data.metrics.already_submitted?.values?.count || 0,
    },
  };

  return {
    "tests/load/results/summary.json": JSON.stringify(summary, null, 2),
    stdout: textSummary(data, { indent: "  ", enableColors: true }),
  };
}

// k6 내장 텍스트 요약 (fallback)
function textSummary(data) {
  const m = data.metrics;
  return `
=== recordAttempt 부하 테스트 결과 ===
총 요청:     ${m.http_reqs?.values?.count || 0}
성공률:      ${((m.submit_success?.values?.rate || 0) * 100).toFixed(1)}%
응답 시간:
  중앙값:    ${(m.submit_duration?.values?.["p(50)"] || 0).toFixed(0)}ms
  95th:      ${(m.submit_duration?.values?.["p(95)"] || 0).toFixed(0)}ms
  99th:      ${(m.submit_duration?.values?.["p(99)"] || 0).toFixed(0)}ms
Rate Limited: ${m.rate_limited?.values?.count || 0}
서버 에러:   ${m.server_errors?.values?.count || 0}
중복 제출:   ${m.already_submitted?.values?.count || 0}
`;
}
