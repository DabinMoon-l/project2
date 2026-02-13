/**
 * 시나리오 1: 퀴즈 제출 동시성 테스트
 *
 * 300명이 동시에 recordAttempt Cloud Function을 호출하는 시나리오.
 * Firestore 분산 쓰기(sharded counter + quiz_agg)의 동시성을 검증합니다.
 *
 * 실행:
 *   k6 run --env FIREBASE_API_KEY=xxx --env TEST_QUIZ_ID=xxx load-tests/scenarios/quiz-submit.js
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";
import {
  callFunction,
  DEFAULT_THRESHOLDS,
  TEST_QUIZ_ID,
} from "../helpers/config.js";
import {
  signInWithEmail,
  getTestUserCredentials,
} from "../helpers/firebase-auth.js";

// 커스텀 메트릭
const recordAttemptDuration = new Trend("record_attempt_duration", true);
const recordAttemptErrors = new Rate("record_attempt_errors");
const duplicateSubmissions = new Counter("duplicate_submissions");
const rateLimitErrors = new Counter("rate_limit_errors");
const contentionErrors = new Counter("contention_errors");
const authErrors = new Counter("auth_errors");

export const options = {
  scenarios: {
    // 단계별 부하 증가: 50 → 150 → 300명
    ramp_up: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 50 }, // 30초간 50명까지 증가
        { duration: "30s", target: 150 }, // 30초간 150명까지 증가
        { duration: "1m", target: 300 }, // 1분간 300명 유지
        { duration: "30s", target: 300 }, // 300명 유지 (피크)
        { duration: "30s", target: 0 }, // 30초간 감소
      ],
      gracefulRampDown: "10s",
    },
  },
  thresholds: {
    ...DEFAULT_THRESHOLDS,
    // recordAttempt 95%가 5초 이내
    record_attempt_duration: ["p(95)<5000", "p(99)<8000"],
    // recordAttempt 에러율 3% 미만
    record_attempt_errors: ["rate<0.03"],
  },
};

// VU별 상태 저장
const vuState = {};

export function setup() {
  // 퀴즈 ID 확인
  if (!TEST_QUIZ_ID) {
    console.error("TEST_QUIZ_ID 환경변수가 필요합니다.");
    console.error("setup-test-users.js 스크립트를 먼저 실행하세요.");
    return { error: true };
  }

  return { quizId: TEST_QUIZ_ID };
}

export default function (data) {
  if (data.error) return;

  const vuIndex = __VU - 1;
  const iterIndex = __ITER;

  // VU당 최초 1회 로그인
  if (!vuState[__VU]) {
    const creds = getTestUserCredentials(vuIndex);
    const authResult = signInWithEmail(creds.email, creds.password);

    if (!authResult) {
      recordAttemptErrors.add(1);
      sleep(5);
      return;
    }

    vuState[__VU] = {
      token: authResult.idToken,
      userId: authResult.localId,
      refreshToken: authResult.refreshToken,
    };
  }

  const { token } = vuState[__VU];

  // 10문제 랜덤 답안 생성 (일부만 정답)
  const answers = [];
  for (let i = 0; i < 10; i++) {
    answers.push({
      questionId: `q${i}`,
      answer: Math.floor(Math.random() * 4), // 0-3 랜덤
    });
  }

  // 퀴즈 제출 전 자연스러운 딜레이 (풀이 시간 시뮬레이션)
  sleep(Math.random() * 2 + 0.5);

  // attemptNo를 VU+ITER 조합으로 고유하게 생성 (VU당 최대 10000회)
  const attemptNo = __VU * 10000 + iterIndex + 1;

  // recordAttempt 호출
  const startTime = Date.now();
  const res = callFunction(http, "recordAttempt", {
    quizId: data.quizId,
    answers,
    attemptNo,
  }, token);
  const duration = Date.now() - startTime;

  recordAttemptDuration.add(duration);

  const success = check(res, {
    "recordAttempt 200 OK": (r) => r.status === 200,
    "결과에 score 포함": (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.result && typeof body.result.score === "number";
      } catch {
        return false;
      }
    },
  });

  if (!success) {
    recordAttemptErrors.add(1);

    // 에러 유형 분류
    try {
      const body = JSON.parse(res.body);
      const errorMsg = (body.error && body.error.message) || "";

      if (body.result && body.result.alreadySubmitted) {
        duplicateSubmissions.add(1);
      } else if (res.status === 429 || errorMsg.includes("RESOURCE_EXHAUSTED") || errorMsg.includes("rate")) {
        rateLimitErrors.add(1);
      } else if (res.status === 409 || errorMsg.includes("ABORTED") || errorMsg.includes("contention")) {
        contentionErrors.add(1);
      } else if (res.status === 401 || res.status === 403 || errorMsg.includes("UNAUTHENTICATED")) {
        authErrors.add(1);
      }
    } catch {
      // 파싱 실패 무시
    }
  } else {
    recordAttemptErrors.add(0);
  }

  // 다음 반복 전 쿨다운
  sleep(Math.random() * 3 + 1);
}

export function teardown(data) {
  if (data.error) return;
  console.log(`테스트 완료. 퀴즈 ID: ${data.quizId}`);
}
