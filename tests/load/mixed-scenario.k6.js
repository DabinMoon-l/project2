/**
 * k6 혼합 부하 테스트 — 300명 동시 다양한 활동
 *
 * 시나리오 분배 (300명):
 *   150명 — 퀴즈 제출 (recordAttempt)
 *    50명 — 게시판 글/댓글 (Firestore REST API)
 *    30명 — 복습 연습 (recordReviewPractice)
 *    20명 — 배틀 매칭 (joinMatchmaking)
 *    30명 — AI 문제 생성 (enqueueGenerationJob)
 *    20명 — 뽑기 (spinRabbitGacha)
 *
 * 에뮬레이터 대상:
 *   firebase emulators:start
 *   node tests/load/seed-emulator.js
 *   node tests/load/generate-tokens-emulator.js
 *   k6 run tests/load/mixed-scenario.k6.js
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import { SharedArray } from "k6/data";

// ── 토큰 ──

const tokens = new SharedArray("tokens", function () {
  return JSON.parse(open("./tests/load/tokens.json"));
});

// ── 설정 (에뮬레이터 기본) ──

const PROJECT_ID = "project2-7a317";
const REGION = "asia-northeast3";
const FUNCTIONS_BASE = __ENV.FUNCTIONS_URL ||
  `http://127.0.0.1:5001/${PROJECT_ID}/${REGION}`;
const FIRESTORE_BASE = __ENV.FIRESTORE_URL ||
  `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const COURSE_ID = "biology";

// ── 메트릭 (기능별) ──

const quizSuccess = new Rate("quiz_submit_success");
const quizDuration = new Trend("quiz_submit_duration", true);
const boardSuccess = new Rate("board_write_success");
const boardDuration = new Trend("board_write_duration", true);
const reviewSuccess = new Rate("review_practice_success");
const reviewDuration = new Trend("review_practice_duration", true);
const battleSuccess = new Rate("battle_match_success");
const battleDuration = new Trend("battle_match_duration", true);
const aiGenSuccess = new Rate("ai_generate_success");
const aiGenDuration = new Trend("ai_generate_duration", true);
const gachaSuccess = new Rate("gacha_spin_success");
const gachaDuration = new Trend("gacha_spin_duration", true);
const totalErrors = new Counter("total_errors");

// ── 시나리오 ──

export const options = {
  scenarios: {
    mixed_load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "15s", target: 100 },   // 워밍업
        { duration: "15s", target: 200 },
        { duration: "15s", target: 300 },   // 최대 300명
        { duration: "60s", target: 300 },   // 1분 유지
        { duration: "15s", target: 0 },     // 쿨다운
      ],
    },
  },
  thresholds: {
    quiz_submit_success: ["rate>0.90"],
    board_write_success: ["rate>0.90"],
    review_practice_success: ["rate>0.90"],
    quiz_submit_duration: ["p(95)<15000"],
  },
};

// ── 공통 헬퍼 ──

function getToken() {
  return tokens[__VU % tokens.length];
}

function cfHeaders(idToken) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${idToken}`,
  };
}

function callCF(functionName, data, idToken) {
  const url = `${FUNCTIONS_BASE}/${functionName}`;
  return http.post(url, JSON.stringify({ data }), {
    headers: cfHeaders(idToken),
    timeout: "30s",
  });
}

// Firestore REST API로 문서 생성
function firestoreCreate(collection, fields, idToken) {
  const url = `${FIRESTORE_BASE}/${collection}`;
  return http.post(url, JSON.stringify({ fields }), {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    timeout: "15s",
  });
}

// Firestore REST 필드 변환
function strVal(s) { return { stringValue: s }; }
function intVal(n) { return { integerValue: String(n) }; }
function boolVal(b) { return { booleanValue: b }; }
function arrVal(items) { return { arrayValue: { values: items } }; }
function tsVal() { return { timestampValue: new Date().toISOString() }; }

// ── 역할 분배 ──

function getRole(vu) {
  // VU 번호 기반으로 역할 결정 (비율 유지)
  const mod = vu % 300;
  if (mod < 150) return "quiz";       // 150명: 퀴즈 제출
  if (mod < 200) return "board";      // 50명: 게시판
  if (mod < 230) return "review";     // 30명: 복습
  if (mod < 250) return "battle";     // 20명: 배틀
  if (mod < 280) return "ai_gen";     // 30명: AI 생성
  return "gacha";                     // 20명: 뽑기
}

// ============================================================
// 역할별 시나리오
// ============================================================

// ── 퀴즈 제출 ──

function doQuizSubmit(token) {
  const quizId = `load-test-quiz-${Math.floor(Math.random() * 5)}`;
  const answers = [];
  for (let i = 0; i < 10; i++) {
    answers.push({
      questionId: `q${i}`,
      answer: Math.floor(Math.random() * 4),
    });
  }

  const res = callCF("recordAttempt", { quizId, answers }, token.idToken);
  quizDuration.add(res.timings.duration);

  const ok = check(res, { "퀴즈 제출 200": (r) => r.status === 200 });
  quizSuccess.add(ok ? 1 : 0);
  if (!ok) totalErrors.add(1);
}

// ── 게시판 글/댓글 ──

function doBoardWrite(token) {
  const action = Math.random() > 0.5 ? "post" : "comment";

  if (action === "post") {
    const res = firestoreCreate("posts", {
      title: strVal(`부하테스트 글 VU${__VU}`),
      content: strVal(`동시접속 테스트 중입니다. ${Date.now()}`),
      category: strVal("community"),
      authorId: strVal(token.uid),
      authorNickname: strVal(`테스터${token.index}`),
      authorClassType: strVal("A"),
      courseId: strVal(COURSE_ID),
      likes: intVal(0),
      likedBy: arrVal([]),
      commentCount: intVal(0),
      viewCount: intVal(0),
      isAnonymous: boolVal(false),
      isNotice: boolVal(false),
      imageUrls: arrVal([]),
      fileUrls: arrVal([]),
      createdAt: tsVal(),
    }, token.idToken);

    boardDuration.add(res.timings.duration);
    const ok = check(res, { "게시글 작성": (r) => r.status === 200 });
    boardSuccess.add(ok ? 1 : 0);
    if (!ok) totalErrors.add(1);
  } else {
    const postId = `load-test-post-${Math.floor(Math.random() * 5)}`;
    const res = firestoreCreate("comments", {
      postId: strVal(postId),
      authorId: strVal(token.uid),
      authorNickname: strVal(`테스터${token.index}`),
      authorClassType: strVal("A"),
      content: strVal(`테스트 댓글 ${Date.now()}`),
      isAnonymous: boolVal(false),
      imageUrls: arrVal([]),
      createdAt: tsVal(),
    }, token.idToken);

    boardDuration.add(res.timings.duration);
    const ok = check(res, { "댓글 작성": (r) => r.status === 200 });
    boardSuccess.add(ok ? 1 : 0);
    if (!ok) totalErrors.add(1);
  }
}

// ── 복습 연습 ──

function doReviewPractice(token) {
  const quizId = `load-test-quiz-${Math.floor(Math.random() * 5)}`;
  const correctCount = Math.floor(Math.random() * 10) + 1;
  const totalCount = 10;

  const res = callCF("recordReviewPractice", {
    quizId,
    correctCount,
    totalCount,
    score: Math.round((correctCount / totalCount) * 100),
  }, token.idToken);

  reviewDuration.add(res.timings.duration);
  const ok = check(res, { "복습 제출 200": (r) => r.status === 200 });
  reviewSuccess.add(ok ? 1 : 0);
  if (!ok) totalErrors.add(1);
}

// ── 배틀 매칭 ──

function doBattleMatch(token) {
  const res = callCF("joinMatchmaking", {
    courseId: COURSE_ID,
  }, token.idToken);

  battleDuration.add(res.timings.duration);
  const ok = check(res, { "매칭 200": (r) => r.status === 200 });
  battleSuccess.add(ok ? 1 : 0);
  if (!ok) totalErrors.add(1);
}

// ── AI 문제 생성 ──

function doAiGenerate(token) {
  const res = callCF("enqueueGenerationJob", {
    text: "세포의 구조와 기능에 대해 설명하시오.",
    difficulty: ["easy", "medium", "hard"][Math.floor(Math.random() * 3)],
    questionCount: 5,
    courseId: COURSE_ID,
    courseName: "생물학",
    tags: ["1_세포"],
  }, token.idToken);

  aiGenDuration.add(res.timings.duration);
  const ok = check(res, { "AI 생성 200": (r) => r.status === 200 });
  aiGenSuccess.add(ok ? 1 : 0);
  if (!ok) totalErrors.add(1);
}

// ── 뽑기 ──

function doGachaSpin(token) {
  const res = callCF("spinRabbitGacha", {
    courseId: COURSE_ID,
  }, token.idToken);

  gachaDuration.add(res.timings.duration);
  const ok = check(res, { "뽑기 200": (r) => r.status === 200 });
  gachaSuccess.add(ok ? 1 : 0);
  if (!ok) totalErrors.add(1);
}

// ============================================================
// 메인 실행
// ============================================================

export default function () {
  const token = getToken();
  if (!token?.idToken) return;

  const role = getRole(__VU);

  switch (role) {
    case "quiz":    doQuizSubmit(token); break;
    case "board":   doBoardWrite(token); break;
    case "review":  doReviewPractice(token); break;
    case "battle":  doBattleMatch(token); break;
    case "ai_gen":  doAiGenerate(token); break;
    case "gacha":   doGachaSpin(token); break;
  }

  // 실제 사용자처럼 간격
  sleep(Math.random() * 3 + 1);
}

// ── 요약 출력 ──

export function handleSummary(data) {
  const m = data.metrics;
  const fmt = (key) => {
    const v = m[key]?.values;
    if (!v) return "N/A";
    return `성공${((v.rate || 0) * 100).toFixed(1)}%`;
  };
  const dur = (key) => {
    const v = m[key]?.values;
    if (!v) return "N/A";
    return `p50=${(v["p(50)"] || 0).toFixed(0)}ms p95=${(v["p(95)"] || 0).toFixed(0)}ms`;
  };

  const text = `
=== 300명 혼합 부하 테스트 결과 ===

총 요청: ${m.http_reqs?.values?.count || 0}
총 에러: ${m.total_errors?.values?.count || 0}

[퀴즈 제출 - 150명]
  ${fmt("quiz_submit_success")} | ${dur("quiz_submit_duration")}

[게시판 - 50명]
  ${fmt("board_write_success")} | ${dur("board_write_duration")}

[복습 연습 - 30명]
  ${fmt("review_practice_success")} | ${dur("review_practice_duration")}

[배틀 매칭 - 20명]
  ${fmt("battle_match_success")} | ${dur("battle_match_duration")}

[AI 생성 - 30명]
  ${fmt("ai_generate_success")} | ${dur("ai_generate_duration")}

[뽑기 - 20명]
  ${fmt("gacha_spin_success")} | ${dur("gacha_spin_duration")}
`;

  return {
    "tests/load/results/mixed-summary.json": JSON.stringify({
      timestamp: new Date().toISOString(),
      totalRequests: m.http_reqs?.values?.count || 0,
      totalErrors: m.total_errors?.values?.count || 0,
      quiz: { success: m.quiz_submit_success?.values?.rate, p95: m.quiz_submit_duration?.values?.["p(95)"] },
      board: { success: m.board_write_success?.values?.rate, p95: m.board_write_duration?.values?.["p(95)"] },
      review: { success: m.review_practice_success?.values?.rate, p95: m.review_practice_duration?.values?.["p(95)"] },
      battle: { success: m.battle_match_success?.values?.rate, p95: m.battle_match_duration?.values?.["p(95)"] },
      aiGen: { success: m.ai_generate_success?.values?.rate, p95: m.ai_generate_duration?.values?.["p(95)"] },
      gacha: { success: m.gacha_spin_success?.values?.rate, p95: m.gacha_spin_duration?.values?.["p(95)"] },
    }, null, 2),
    stdout: text,
  };
}
