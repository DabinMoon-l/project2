/**
 * k6 혼합 부하 테스트 — 300명 실제 사용 패턴
 *
 * 시나리오 분배 (300명, biology 150 + microbiology 150):
 *    80명 — 퀴즈 풀기 (recordAttempt, 교수 캐러셀 퀴즈)
 *    40명 — 배틀 퀴즈 (joinMatchmaking → submitAnswer)
 *    30명 — 토끼 뽑기 (spinRabbitGacha → claimGachaRabbit)
 *    20명 — 토끼 레벨업 (levelUpRabbit)
 *    30명 — AI 문제 생성 (enqueueGenerationJob)
 *    50명 — 복습 연습 (recordReviewPractice)
 *    30명 — 게시판 학술글 (콩콩이 AI 자동답변 트리거)
 *    20명 — 랭킹/레이더 조회 (Firestore read)
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
// ── 유저별 과목 결정 (150명 biology + 150명 microbiology) ──

function getCourseId(vu) {
  return vu % 300 < 150 ? "biology" : "microbiology";
}

function getQuizId(courseId) {
  const idx = Math.floor(Math.random() * 5);
  return `load-test-${courseId}-quiz-${idx}`;
}

// ── 메트릭 (기능별) ──

// 퀴즈
const quizSuccess = new Rate("quiz_submit_success");
const quizDuration = new Trend("quiz_submit_duration", true);
// 배틀
const battleSuccess = new Rate("battle_match_success");
const battleDuration = new Trend("battle_match_duration", true);
const battleAnswerSuccess = new Rate("battle_answer_success");
// 뽑기
const gachaSuccess = new Rate("gacha_spin_success");
const gachaDuration = new Trend("gacha_spin_duration", true);
const gachaClaimSuccess = new Rate("gacha_claim_success");
// 레벨업
const levelUpSuccess = new Rate("levelup_success");
const levelUpDuration = new Trend("levelup_duration", true);
// AI 생성
const aiGenSuccess = new Rate("ai_generate_success");
const aiGenDuration = new Trend("ai_generate_duration", true);
// 복습
const reviewSuccess = new Rate("review_practice_success");
const reviewDuration = new Trend("review_practice_duration", true);
// 게시판 (콩콩이)
const boardSuccess = new Rate("board_academic_success");
const boardDuration = new Trend("board_academic_duration", true);
// 랭킹/레이더 조회
const rankingSuccess = new Rate("ranking_read_success");
const rankingDuration = new Trend("ranking_read_duration", true);
// 공통
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
    quiz_submit_success: ["rate>0.85"],
    battle_match_success: ["rate>0.80"],
    gacha_spin_success: ["rate>0.80"],
    review_practice_success: ["rate>0.85"],
    board_academic_success: ["rate>0.85"],
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

// Firestore REST API 문서 생성
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

// Firestore REST 필드 헬퍼
function strVal(s) { return { stringValue: s }; }
function intVal(n) { return { integerValue: String(n) }; }
function boolVal(b) { return { booleanValue: b }; }
function arrVal(items) { return { arrayValue: { values: items } }; }
function tsVal() { return { timestampValue: new Date().toISOString() }; }

// ── 역할 분배 (300명) ──

function getRole(vu) {
  const mod = vu % 300;
  if (mod < 80) return "quiz";        // 80명: 퀴즈 풀기
  if (mod < 120) return "battle";     // 40명: 배틀 퀴즈
  if (mod < 150) return "gacha";      // 30명: 토끼 뽑기
  if (mod < 170) return "levelup";    // 20명: 토끼 레벨업
  if (mod < 200) return "ai_gen";     // 30명: AI 생성
  if (mod < 250) return "review";     // 50명: 복습
  if (mod < 280) return "board";      // 30명: 게시판 (콩콩이)
  return "ranking";                   // 20명: 랭킹/레이더 조회
}

// ============================================================
// 역할별 시나리오
// ============================================================

// ── 1. 퀴즈 풀기 (교수님 퀴즈 = 캐러셀 퀴즈) ──

function doQuizSubmit(token) {
  const courseId = getCourseId(__VU);
  const quizId = getQuizId(courseId);
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

// ── 2. 배틀 퀴즈 (매칭 → 답변 제출) ──

function doBattle(token) {
  // 1단계: 매칭 참여
  const courseId = getCourseId(__VU);
  const matchRes = callCF("joinMatchmaking", {
    courseId,
  }, token.idToken);

  battleDuration.add(matchRes.timings.duration);
  const matchOk = check(matchRes, { "매칭 200": (r) => r.status === 200 });
  battleSuccess.add(matchOk ? 1 : 0);
  if (!matchOk) { totalErrors.add(1); return; }

  // 2단계: 매칭 결과에서 battleId 추출 → 답변 시도
  try {
    const body = JSON.parse(matchRes.body);
    const battleId = body?.result?.battleId;
    if (!battleId) return; // waiting 상태 → 봇 매칭 대기

    // 카운트다운 시뮬레이션 (3초)
    sleep(3);

    // 첫 라운드 답변 제출
    const answerRes = callCF("submitAnswer", {
      battleId,
      roundIndex: 0,
      answer: Math.floor(Math.random() * 4),
    }, token.idToken);

    const answerOk = check(answerRes, { "배틀 답변 200": (r) => r.status === 200 });
    battleAnswerSuccess.add(answerOk ? 1 : 0);
  } catch (e) {
    // 매칭 결과 파싱 실패
  }
}

// ── 3. 토끼 뽑기 (Roll → Claim 2단계) ──

function doGachaSpin(token) {
  // Roll 단계
  const courseId = getCourseId(__VU);
  const spinRes = callCF("spinRabbitGacha", {
    courseId,
  }, token.idToken);

  gachaDuration.add(spinRes.timings.duration);
  const spinOk = check(spinRes, { "뽑기 Roll 200": (r) => r.status === 200 });
  gachaSuccess.add(spinOk ? 1 : 0);
  if (!spinOk) { totalErrors.add(1); return; }

  // Claim 단계 (새 토끼면 이름 짓기)
  try {
    const body = JSON.parse(spinRes.body);
    const result = body?.result;
    if (!result) return;

    // 연출 시뮬레이션 (뽑기 애니메이션)
    sleep(2);

    if (result.type === "undiscovered") {
      // 최초 발견 → 이름 짓고 claim
      const claimRes = callCF("claimGachaRabbit", {
        courseId,
        rabbitId: result.rabbitId,
        action: "discover",
        name: `테토끼${__VU}_${Date.now() % 10000}`,
      }, token.idToken);

      const claimOk = check(claimRes, { "뽑기 Claim 200": (r) => r.status === 200 });
      gachaClaimSuccess.add(claimOk ? 1 : 0);
    } else if (result.type === "discovered") {
      // 이미 발견된 토끼 → claim
      const claimRes = callCF("claimGachaRabbit", {
        courseId,
        rabbitId: result.rabbitId,
        action: "discover",
        name: `테토끼${__VU}_${Date.now() % 10000}`,
      }, token.idToken);

      const claimOk = check(claimRes, { "뽑기 Claim 200": (r) => r.status === 200 });
      gachaClaimSuccess.add(claimOk ? 1 : 0);
    }
    // type "owned" → 보유 토끼, 마일스톤 미소비 (레벨업용)
  } catch (e) {
    // 파싱 실패
  }
}

// ── 4. 토끼 레벨업 ──

function doLevelUp(token) {
  const courseId = getCourseId(__VU);
  const res = callCF("levelUpRabbit", {
    courseId,
    rabbitId: 0,  // 기본 토끼
  }, token.idToken);

  levelUpDuration.add(res.timings.duration);
  const ok = check(res, { "레벨업 200": (r) => r.status === 200 });
  levelUpSuccess.add(ok ? 1 : 0);
  if (!ok) totalErrors.add(1);
}

// ── 5. AI 문제 생성 ──

function doAiGenerate(token) {
  const courseId = getCourseId(__VU);
  const isBio = courseId === "biology";
  const prefix = isBio ? "bio" : "micro";
  const maxChap = isBio ? 6 : 11;
  const res = callCF("enqueueGenerationJob", {
    text: isBio
      ? "세포의 구조와 기능에 대해 설명하시오."
      : "그람양성균과 그람음성균의 차이를 설명하시오.",
    difficulty: ["easy", "medium", "hard"][Math.floor(Math.random() * 3)],
    questionCount: 5,
    courseId,
    courseName: isBio ? "생물학" : "미생물학",
    tags: [`${prefix}_${Math.floor(Math.random() * maxChap) + 1}`],
  }, token.idToken);

  aiGenDuration.add(res.timings.duration);
  const ok = check(res, { "AI 생성 200": (r) => r.status === 200 });
  aiGenSuccess.add(ok ? 1 : 0);
  if (!ok) totalErrors.add(1);
}

// ── 6. 복습 연습 ──

function doReviewPractice(token) {
  const courseId = getCourseId(__VU);
  const quizId = getQuizId(courseId);
  const correctCount = Math.floor(Math.random() * 10) + 1;
  const totalCount = 10;

  const res = callCF("recordReviewPractice", {
    quizId,
    correctCount,
    totalCount,
    score: Math.round((correctCount / totalCount) * 100),
  }, token.idToken);

  reviewDuration.add(res.timings.duration);
  const ok = check(res, { "복습 완료 200": (r) => r.status === 200 });
  reviewSuccess.add(ok ? 1 : 0);
  if (!ok) totalErrors.add(1);
}

// ── 7. 게시판 학술글 (콩콩이 트리거) ──

function doBoardAcademic(token) {
  const courseId = getCourseId(__VU);
  const bioTopics = [
    "세포 분열 과정에서 DNA 복제는 어떤 단계에서 일어나나요?",
    "미토콘드리아의 내막과 외막의 기능 차이가 뭔가요?",
    "원핵세포와 진핵세포의 차이점을 알고 싶어요",
  ];
  const microTopics = [
    "그람염색의 원리와 세균 분류에서의 의미가 궁금해요",
    "세균의 내독소와 외독소의 차이를 설명해주세요",
    "PCR 기법이 미생물 진단에 어떻게 활용되나요?",
  ];
  const topics = courseId === "biology" ? bioTopics : microTopics;

  // 학술 태그로 게시글 작성 → onPostCreate 트리거 → 콩콩이 자동답변
  const res = firestoreCreate("posts", {
    title: strVal(`학술 질문 VU${__VU}`),
    content: strVal(topics[Math.floor(Math.random() * topics.length)] + ` (${Date.now()})`),
    category: strVal("community"),
    tag: strVal("학술"),
    authorId: strVal(token.uid),
    authorNickname: strVal(`테스터${token.index}`),
    authorClassType: strVal(["A", "B", "C", "D"][__VU % 4]),
    courseId: strVal(courseId),
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
  const ok = check(res, { "학술글 작성": (r) => r.status === 200 });
  boardSuccess.add(ok ? 1 : 0);
  if (!ok) totalErrors.add(1);
}

// ── 8. 랭킹/레이더 조회 (Firestore 문서 읽기) ──

function doRankingRead(token) {
  const courseId = getCourseId(__VU);

  // 랭킹 문서 조회
  const rankUrl = `${FIRESTORE_BASE}/rankings/${courseId}`;
  const rankRes = http.get(rankUrl, {
    headers: cfHeaders(token.idToken),
    timeout: "15s",
  });

  rankingDuration.add(rankRes.timings.duration);
  const rankOk = check(rankRes, { "랭킹 조회 200": (r) => r.status === 200 });

  // 레이더 정규화 조회
  const radarUrl = `${FIRESTORE_BASE}/radarNorm/${courseId}`;
  const radarRes = http.get(radarUrl, {
    headers: cfHeaders(token.idToken),
    timeout: "15s",
  });

  const radarOk = check(radarRes, { "레이더 조회 200": (r) => r.status === 200 });
  rankingSuccess.add(rankOk && radarOk ? 1 : 0);
  if (!rankOk || !radarOk) totalErrors.add(1);
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
    case "battle":  doBattle(token); break;
    case "gacha":   doGachaSpin(token); break;
    case "levelup": doLevelUp(token); break;
    case "ai_gen":  doAiGenerate(token); break;
    case "review":  doReviewPractice(token); break;
    case "board":   doBoardAcademic(token); break;
    case "ranking": doRankingRead(token); break;
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
=== 300명 (biology 150 + micro 150) 부하 테스트 결과 ===

총 요청: ${m.http_reqs?.values?.count || 0}
총 에러: ${m.total_errors?.values?.count || 0}

[퀴즈 풀기 - 80명] (교수님 캐러셀 퀴즈, 2과목)
  ${fmt("quiz_submit_success")} | ${dur("quiz_submit_duration")}

[배틀 퀴즈 - 40명] (매칭 + 답변)
  매칭 ${fmt("battle_match_success")} | ${dur("battle_match_duration")}
  답변 ${fmt("battle_answer_success")}

[토끼 뽑기 - 30명] (Roll + Claim)
  Roll ${fmt("gacha_spin_success")} | ${dur("gacha_spin_duration")}
  Claim ${fmt("gacha_claim_success")}

[토끼 레벨업 - 20명]
  ${fmt("levelup_success")} | ${dur("levelup_duration")}

[AI 생성 - 30명]
  ${fmt("ai_generate_success")} | ${dur("ai_generate_duration")}

[복습 연습 - 50명]
  ${fmt("review_practice_success")} | ${dur("review_practice_duration")}

[게시판 학술 - 30명] (콩콩이 트리거, 2과목)
  ${fmt("board_academic_success")} | ${dur("board_academic_duration")}

[랭킹/레이더 - 20명] (Firestore 읽기, 2과목)
  ${fmt("ranking_read_success")} | ${dur("ranking_read_duration")}
`;

  return {
    "tests/load/results/mixed-summary.json": JSON.stringify({
      timestamp: new Date().toISOString(),
      totalRequests: m.http_reqs?.values?.count || 0,
      totalErrors: m.total_errors?.values?.count || 0,
      quiz: { success: m.quiz_submit_success?.values?.rate, p95: m.quiz_submit_duration?.values?.["p(95)"] },
      battle: {
        matchSuccess: m.battle_match_success?.values?.rate,
        answerSuccess: m.battle_answer_success?.values?.rate,
        p95: m.battle_match_duration?.values?.["p(95)"],
      },
      gacha: {
        spinSuccess: m.gacha_spin_success?.values?.rate,
        claimSuccess: m.gacha_claim_success?.values?.rate,
        p95: m.gacha_spin_duration?.values?.["p(95)"],
      },
      levelup: { success: m.levelup_success?.values?.rate, p95: m.levelup_duration?.values?.["p(95)"] },
      aiGen: { success: m.ai_generate_success?.values?.rate, p95: m.ai_generate_duration?.values?.["p(95)"] },
      review: { success: m.review_practice_success?.values?.rate, p95: m.review_practice_duration?.values?.["p(95)"] },
      board: { success: m.board_academic_success?.values?.rate, p95: m.board_academic_duration?.values?.["p(95)"] },
      ranking: { success: m.ranking_read_success?.values?.rate, p95: m.ranking_read_duration?.values?.["p(95)"] },
    }, null, 2),
    stdout: text,
  };
}
