/**
 * 전체 시나리오 순차 통합 실행
 *
 * 4개 시나리오를 하나의 k6 프로세스에서 startTime 기반으로 순차 실행합니다:
 *   시나리오 1: quiz_submit      (0s ~ 3m10s)    — 퀴즈 제출 동시성
 *   시나리오 2: board_activity    (3m20s ~ 6m30s)  — 게시판 읽기/쓰기
 *   시나리오 3: review_load       (6m40s ~ 9m50s)  — 복습 대량 조회
 *   시나리오 4: mixed_realistic   (10m ~ 16m)      — 300명 혼합 시나리오
 *
 * 총 소요 시간: 약 16분
 *
 * 실행:
 *   k6 run --env FIREBASE_API_KEY=xxx --env TEST_QUIZ_ID=xxx load-tests/scenarios/sequential-all.js
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";
import {
  callFunction,
  firestoreQuery,
  firestoreGet,
  DEFAULT_THRESHOLDS,
  FIRESTORE_URL,
  TEST_COURSE_ID,
  TEST_QUIZ_ID,
} from "../helpers/config.js";
import {
  signInWithEmail,
  getTestUserCredentials,
} from "../helpers/firebase-auth.js";

// ============================================================
// 커스텀 메트릭
// ============================================================

// Quiz submit 메트릭
const recordAttemptDuration = new Trend("record_attempt_duration", true);
const recordAttemptErrors = new Rate("record_attempt_errors");
const duplicateSubmissions = new Counter("duplicate_submissions");
const rateLimitErrors = new Counter("rate_limit_errors");
const contentionErrors = new Counter("contention_errors");
const authErrors = new Counter("auth_errors");

// Board activity 메트릭
const postListDuration = new Trend("post_list_duration", true);
const postCreateDuration = new Trend("post_create_duration", true);
const commentCreateDuration = new Trend("comment_create_duration", true);
const rateLimitHits = new Rate("rate_limit_hits");

// Review load 메트릭
const reviewPageDuration = new Trend("review_page_load", true);
const wrongQueryDuration = new Trend("wrong_query_duration", true);
const bookmarkQueryDuration = new Trend("bookmark_query_duration", true);
const solvedQueryDuration = new Trend("solved_query_duration", true);
const queryErrors = new Rate("review_query_errors");

// Mixed realistic 메트릭
const scenarioDuration = new Trend("scenario_duration", true);
const cfErrors = new Rate("cloud_function_errors");
const firestoreErrors = new Rate("firestore_errors");
const activeScenarios = new Counter("active_scenarios");

// ============================================================
// 옵션: 4개 시나리오 순차 실행 (startTime 기반)
// ============================================================

export const options = {
  scenarios: {
    // 시나리오 1: 퀴즈 제출 동시성 (0s ~ 3m10s)
    quiz_submit: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 50 },
        { duration: "30s", target: 150 },
        { duration: "1m", target: 300 },
        { duration: "30s", target: 300 },
        { duration: "30s", target: 0 },
      ],
      gracefulRampDown: "10s",
      exec: "quizSubmit",
      startTime: "0s",
    },
    // 시나리오 2: 게시판 읽기/쓰기 (3m20s ~ 6m30s)
    board_activity: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "20s", target: 30 },
        { duration: "30s", target: 100 },
        { duration: "2m", target: 100 },
        { duration: "20s", target: 0 },
      ],
      exec: "boardActivity",
      startTime: "3m20s",
    },
    // 시나리오 3: 복습 대량 조회 (6m40s ~ 9m50s)
    review_load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "20s", target: 100 },
        { duration: "20s", target: 300 },
        { duration: "2m", target: 300 },
        { duration: "30s", target: 0 },
      ],
      exec: "reviewLoad",
      startTime: "6m40s",
    },
    // 시나리오 4: 300명 혼합 현실적 시나리오 (10m ~ 16m)
    mixed_realistic: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 50 },
        { duration: "30s", target: 150 },
        { duration: "30s", target: 300 },
        { duration: "3m", target: 300 },
        { duration: "1m", target: 100 },
        { duration: "30s", target: 0 },
      ],
      exec: "mixedRealistic",
      startTime: "10m",
    },
  },
  thresholds: {
    ...DEFAULT_THRESHOLDS,
    // 전체 HTTP (리뷰 쿼리 포함, 기본 3s보다 완화)
    http_req_duration: ["p(95)<10000"],
    // Quiz submit
    record_attempt_duration: ["p(95)<5000", "p(99)<8000"],
    record_attempt_errors: ["rate<0.03"],
    // Board activity
    post_list_duration: ["p(95)<2000"],
    post_create_duration: ["p(95)<3000"],
    comment_create_duration: ["p(95)<3000"],
    // Review load (순차 실행 기준, REST API 300명 동시접속 특성 반영)
    review_page_load: ["p(95)<60000"],
    wrong_query_duration: ["p(95)<30000"],
    bookmark_query_duration: ["p(95)<12000"],
    solved_query_duration: ["p(95)<15000"],
    review_query_errors: ["rate<0.05"],
    // Mixed realistic
    scenario_duration: ["p(95)<20000"],
    cloud_function_errors: ["rate<0.05"],
    firestore_errors: ["rate<0.05"],
  },
};

// ============================================================
// VU별 상태 저장 (모든 시나리오 공유)
// ============================================================

const vuState = {};

function ensureAuth() {
  const vuIndex = __VU - 1;

  if (!vuState[__VU]) {
    const creds = getTestUserCredentials(vuIndex);
    const authResult = signInWithEmail(creds.email, creds.password);

    if (!authResult) {
      return null;
    }

    vuState[__VU] = {
      token: authResult.idToken,
      userId: authResult.localId,
      refreshToken: authResult.refreshToken,
    };
  }

  return vuState[__VU];
}

// ============================================================
// setup / teardown
// ============================================================

export function setup() {
  if (!TEST_QUIZ_ID) {
    console.warn("⚠ TEST_QUIZ_ID 미설정: quiz_submit, mixed_realistic 시나리오에서 퀴즈 제출이 생략됩니다.");
  }

  return { quizId: TEST_QUIZ_ID };
}

export function teardown(data) {
  console.log("전체 순차 테스트 완료.");
  if (data.quizId) {
    console.log(`  퀴즈 ID: ${data.quizId}`);
  }
}

// ============================================================
// 시나리오 1: 퀴즈 제출 동시성 (quizSubmit)
// ============================================================

export function quizSubmit(data) {
  const auth = ensureAuth();
  if (!auth) {
    recordAttemptErrors.add(1);
    sleep(5);
    return;
  }

  const { token } = auth;

  // 10문제 랜덤 답안 생성
  const answers = [];
  for (let i = 0; i < 10; i++) {
    answers.push({
      questionId: `q${i}`,
      answer: Math.floor(Math.random() * 4),
    });
  }

  // 풀이 시간 시뮬레이션
  sleep(Math.random() * 2 + 0.5);

  // attemptNo를 VU+ITER 조합으로 고유하게 생성
  const attemptNo = __VU * 10000 + __ITER + 1;

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

  // 다음 반복 전 쿨다운 (rate limit 10회/분 준수: avg 5s → ~8.5회/분)
  sleep(Math.random() * 4 + 3);
}

// ============================================================
// 시나리오 2: 게시판 동시 읽기/쓰기 (boardActivity)
// ============================================================

export function boardActivity() {
  const auth = ensureAuth();
  if (!auth) {
    sleep(5);
    return;
  }

  const { token, userId } = auth;

  // 랜덤 액션 선택 (70% 읽기, 20% 글 작성, 10% 댓글)
  const action = Math.random();

  if (action < 0.7) {
    // === 게시판 목록 조회 ===
    group("게시판 목록 조회", function () {
      const startTime = Date.now();

      const res = firestoreQuery(
        http,
        "posts",
        {
          where: {
            compositeFilter: {
              op: "AND",
              filters: [
                {
                  fieldFilter: {
                    field: { fieldPath: "courseId" },
                    op: "EQUAL",
                    value: { stringValue: TEST_COURSE_ID },
                  },
                },
                {
                  fieldFilter: {
                    field: { fieldPath: "isNotice" },
                    op: "EQUAL",
                    value: { booleanValue: false },
                  },
                },
              ],
            },
          },
          orderBy: [
            {
              field: { fieldPath: "createdAt" },
              direction: "DESCENDING",
            },
          ],
          limit: 20,
        },
        token
      );

      postListDuration.add(Date.now() - startTime);

      check(res, {
        "게시판 목록 200 OK": (r) => r.status === 200,
      });
    });
  } else if (action < 0.9) {
    // === 글 작성 ===
    group("글 작성", function () {
      // Rate limit 체크
      const rateLimitRes = callFunction(
        http,
        "checkRateLimitCall",
        { type: "post" },
        token
      );

      if (rateLimitRes.status !== 200) {
        rateLimitHits.add(1);
        sleep(2);
        return;
      }
      rateLimitHits.add(0);

      // 글 작성 (Firestore REST API)
      const startTime = Date.now();
      const postData = {
        fields: {
          title: {
            stringValue: `[부하테스트] VU${__VU} 테스트 글 #${__ITER}`,
          },
          content: {
            stringValue: `부하 테스트 중 작성된 글입니다. (${new Date().toISOString()})`,
          },
          authorId: { stringValue: userId },
          authorNickname: { stringValue: `로드테스트${String(__VU).padStart(3, "0")}` },
          courseId: { stringValue: TEST_COURSE_ID },
          category: { stringValue: "general" },
          isNotice: { booleanValue: false },
          isPinned: { booleanValue: false },
          toProfessor: { booleanValue: false },
          commentCount: { integerValue: "0" },
          likes: { integerValue: "0" },
          likedBy: { arrayValue: { values: [] } },
          createdAt: {
            timestampValue: new Date().toISOString(),
          },
        },
      };

      const res = http.post(
        `${FIRESTORE_URL}/posts`,
        JSON.stringify(postData),
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          tags: { name: "create_post" },
        }
      );

      postCreateDuration.add(Date.now() - startTime);

      check(res, {
        "글 작성 200 OK": (r) => r.status === 200,
      });
    });
  } else {
    // === 댓글 작성 ===
    group("댓글 작성", function () {
      // 먼저 최근 글 1개 조회
      const postsRes = firestoreQuery(
        http,
        "posts",
        {
          where: {
            fieldFilter: {
              field: { fieldPath: "courseId" },
              op: "EQUAL",
              value: { stringValue: TEST_COURSE_ID },
            },
          },
          orderBy: [
            {
              field: { fieldPath: "createdAt" },
              direction: "DESCENDING",
            },
          ],
          limit: 1,
        },
        token
      );

      if (postsRes.status !== 200) return;

      let postId;
      try {
        const docs = JSON.parse(postsRes.body);
        if (!docs[0] || !docs[0].document) return;
        const docName = docs[0].document.name;
        postId = docName.split("/").pop();
      } catch {
        return;
      }

      if (!postId) return;

      // 댓글 작성
      const startTime = Date.now();
      const commentData = {
        fields: {
          postId: { stringValue: postId },
          content: {
            stringValue: `부하 테스트 댓글 (VU${__VU} #${__ITER})`,
          },
          authorId: { stringValue: userId },
          authorNickname: { stringValue: `로드테스트${String(__VU).padStart(3, "0")}` },
          createdAt: {
            timestampValue: new Date().toISOString(),
          },
        },
      };

      const res = http.post(
        `${FIRESTORE_URL}/comments`,
        JSON.stringify(commentData),
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          tags: { name: "create_comment" },
        }
      );

      commentCreateDuration.add(Date.now() - startTime);

      check(res, {
        "댓글 작성 200 OK": (r) => r.status === 200,
      });
    });
  }

  // 자연스러운 사용 간격
  sleep(Math.random() * 3 + 1);
}

// ============================================================
// 시나리오 3: 복습 대량 조회 (reviewLoad)
// ============================================================

// 리뷰 타입별 쿼리 생성 (실제 앱과 동일하게 courseId 필터 포함)
function buildReviewQuery(userId, reviewType) {
  const q = {
    where: {
      compositeFilter: {
        op: "AND",
        filters: [
          {
            fieldFilter: {
              field: { fieldPath: "userId" },
              op: "EQUAL",
              value: { stringValue: userId },
            },
          },
          {
            fieldFilter: {
              field: { fieldPath: "reviewType" },
              op: "EQUAL",
              value: { stringValue: reviewType },
            },
          },
          {
            fieldFilter: {
              field: { fieldPath: "courseId" },
              op: "EQUAL",
              value: { stringValue: TEST_COURSE_ID },
            },
          },
        ],
      },
    },
    orderBy: [
      {
        field: { fieldPath: "createdAt" },
        direction: "DESCENDING",
      },
    ],
  };

  // 앱과 동일하게 모든 리뷰 타입에 limit 적용 (무제한 스캔 방지)
  if (reviewType === "solved") {
    q.limit = 51;
  } else {
    q.limit = 101; // wrong, bookmark: REVIEW_PAGE_SIZE(100) + 1
  }

  return q;
}

export function reviewLoad() {
  const auth = ensureAuth();
  if (!auth) {
    queryErrors.add(1);
    sleep(5);
    return;
  }

  const { token, userId } = auth;
  const pageStart = Date.now();

  group("복습 페이지 로드", function () {
    // 오답 목록 조회
    group("오답 쿼리", function () {
      const start = Date.now();
      const res = firestoreQuery(
        http, "reviews", buildReviewQuery(userId, "wrong"), token
      );
      wrongQueryDuration.add(Date.now() - start);

      const ok = check(res, { "오답 쿼리 200": (r) => r.status === 200 });
      if (!ok) queryErrors.add(1);
      else queryErrors.add(0);
    });

    // 찜한 문제 조회
    group("찜 쿼리", function () {
      const start = Date.now();
      const res = firestoreQuery(
        http, "reviews", buildReviewQuery(userId, "bookmark"), token
      );
      bookmarkQueryDuration.add(Date.now() - start);
      check(res, { "찜 쿼리 200": (r) => r.status === 200 });
    });

    // 푼 문제 조회
    group("푼 문제 쿼리", function () {
      const start = Date.now();
      const res = firestoreQuery(
        http, "reviews", buildReviewQuery(userId, "solved"), token
      );
      solvedQueryDuration.add(Date.now() - start);
      check(res, { "푼 문제 쿼리 200": (r) => r.status === 200 });
    });

    // 퀴즈 결과 조회
    group("퀴즈 결과 쿼리", function () {
      firestoreQuery(http, "quizResults", {
        where: {
          compositeFilter: {
            op: "AND",
            filters: [
              {
                fieldFilter: {
                  field: { fieldPath: "userId" },
                  op: "EQUAL",
                  value: { stringValue: userId },
                },
              },
              {
                fieldFilter: {
                  field: { fieldPath: "courseId" },
                  op: "EQUAL",
                  value: { stringValue: TEST_COURSE_ID },
                },
              },
            ],
          },
        },
        orderBy: [
          { field: { fieldPath: "createdAt" }, direction: "DESCENDING" },
        ],
        limit: 50,
      }, token);
    });

    // 커스텀 폴더 조회
    group("커스텀 폴더 쿼리", function () {
      firestoreQuery(http, "customFolders", {
        where: {
          compositeFilter: {
            op: "AND",
            filters: [
              {
                fieldFilter: {
                  field: { fieldPath: "userId" },
                  op: "EQUAL",
                  value: { stringValue: userId },
                },
              },
              {
                fieldFilter: {
                  field: { fieldPath: "courseId" },
                  op: "EQUAL",
                  value: { stringValue: TEST_COURSE_ID },
                },
              },
            ],
          },
        },
      }, token);
    });
  });

  reviewPageDuration.add(Date.now() - pageStart);

  // 사용자가 복습 페이지를 보는 시간
  sleep(Math.random() * 5 + 3);
}

// ============================================================
// 시나리오 4: 300명 혼합 현실적 시나리오 (mixedRealistic)
// ============================================================

// VU를 역할에 매핑 (결정적)
function getVURole(vuIndex) {
  const mod = vuIndex % 20;
  if (mod < 8) return "quiz"; // 40%
  if (mod < 13) return "review"; // 25%
  if (mod < 16) return "board"; // 15%
  if (mod < 18) return "ranking"; // 10%
  return "profile"; // 10%
}

function mixedQuiz(token, userId, quizId) {
  group("퀴즈 풀기 플로우", function () {
    // 1. 퀴즈 목록 조회
    group("퀴즈 목록", function () {
      const res = firestoreQuery(
        http,
        "quizzes",
        {
          where: {
            compositeFilter: {
              op: "AND",
              filters: [
                {
                  fieldFilter: {
                    field: { fieldPath: "courseId" },
                    op: "EQUAL",
                    value: { stringValue: TEST_COURSE_ID },
                  },
                },
                {
                  fieldFilter: {
                    field: { fieldPath: "isPublic" },
                    op: "EQUAL",
                    value: { booleanValue: true },
                  },
                },
              ],
            },
          },
          orderBy: [
            {
              field: { fieldPath: "createdAt" },
              direction: "DESCENDING",
            },
          ],
          limit: 20,
        },
        token
      );

      const ok = check(res, { "퀴즈 목록 200": (r) => r.status === 200 });
      if (!ok) firestoreErrors.add(1);
      else firestoreErrors.add(0);
    });

    sleep(Math.random() * 2 + 1); // 목록 탐색 시간

    // 2. 퀴즈 상세 조회
    if (quizId) {
      group("퀴즈 상세", function () {
        const res = firestoreGet(http, `quizzes/${quizId}`, token);
        check(res, { "퀴즈 상세 200": (r) => r.status === 200 });
      });

      sleep(Math.random() * 10 + 5); // 문제 풀이 시간 (5~15초)

      // 3. 퀴즈 제출
      group("퀴즈 제출", function () {
        const answers = [];
        for (let i = 0; i < 10; i++) {
          answers.push({
            questionId: `q${i}`,
            answer: Math.floor(Math.random() * 4),
          });
        }

        const attemptNo = __VU * 10000 + __ITER + 1;

        const res = callFunction(http, "recordAttempt", {
          quizId,
          answers,
          attemptNo,
        }, token);

        const ok = check(res, {
          "recordAttempt 200": (r) => r.status === 200,
        });

        if (!ok) {
          cfErrors.add(1);
          try {
            const body = JSON.parse(res.body);
            const errorMsg = (body.error && body.error.message) || "";
            if (body.result && body.result.alreadySubmitted) {
              duplicateSubmissions.add(1);
            } else if (res.status === 429 || errorMsg.includes("RESOURCE_EXHAUSTED")) {
              rateLimitErrors.add(1);
            } else if (res.status === 409 || errorMsg.includes("ABORTED")) {
              contentionErrors.add(1);
            }
          } catch {
            // 파싱 실패 무시
          }
        } else {
          cfErrors.add(0);
        }
      });
    }
  });
}

function mixedReview(token, userId) {
  group("복습 페이지", function () {
    const reviewTypes = ["wrong", "bookmark", "solved"];

    for (const reviewType of reviewTypes) {
      const res = firestoreQuery(
        http, "reviews", buildReviewQuery(userId, reviewType), token
      );

      const ok = check(res, {
        [`${reviewType} 쿼리 200`]: (r) => r.status === 200,
      });
      if (!ok) firestoreErrors.add(1);
      else firestoreErrors.add(0);
    }
  });

  sleep(Math.random() * 5 + 3);
}

function mixedBoard(token, userId) {
  group("게시판 활동", function () {
    const res = firestoreQuery(
      http,
      "posts",
      {
        where: {
          compositeFilter: {
            op: "AND",
            filters: [
              {
                fieldFilter: {
                  field: { fieldPath: "courseId" },
                  op: "EQUAL",
                  value: { stringValue: TEST_COURSE_ID },
                },
              },
              {
                fieldFilter: {
                  field: { fieldPath: "isNotice" },
                  op: "EQUAL",
                  value: { booleanValue: false },
                },
              },
            ],
          },
        },
        orderBy: [
          {
            field: { fieldPath: "createdAt" },
            direction: "DESCENDING",
          },
        ],
        limit: 20,
      },
      token
    );

    const ok = check(res, { "게시판 목록 200": (r) => r.status === 200 });
    if (!ok) firestoreErrors.add(1);
    else firestoreErrors.add(0);

    sleep(Math.random() * 3 + 1);

    // 20% 확률로 글 작성
    if (Math.random() < 0.2) {
      const postData = {
        fields: {
          title: {
            stringValue: `[혼합테스트] VU${__VU} #${__ITER}`,
          },
          content: {
            stringValue: `혼합 부하 테스트 글입니다.`,
          },
          authorId: { stringValue: userId },
          authorNickname: {
            stringValue: `로드테스트${String(__VU).padStart(3, "0")}`,
          },
          courseId: { stringValue: TEST_COURSE_ID },
          category: { stringValue: "general" },
          isNotice: { booleanValue: false },
          isPinned: { booleanValue: false },
          toProfessor: { booleanValue: false },
          commentCount: { integerValue: "0" },
          likes: { integerValue: "0" },
          likedBy: { arrayValue: { values: [] } },
          createdAt: {
            timestampValue: new Date().toISOString(),
          },
        },
      };

      http.post(
        `${FIRESTORE_URL}/posts`,
        JSON.stringify(postData),
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          tags: { name: "create_post" },
        }
      );
    }
  });
}

function mixedRanking(token) {
  group("랭킹 조회", function () {
    const res = callFunction(http, "getLeaderboard", {
      classType: "all",
      limit: 50,
    }, token);

    const ok = check(res, { "랭킹 조회 200": (r) => r.status === 200 });
    if (!ok) cfErrors.add(1);
    else cfErrors.add(0);

    sleep(Math.random() * 3 + 2);

    // 반별 랭킹
    const classes = ["A", "B", "C", "D"];
    const myClass = classes[__VU % 4];

    callFunction(http, "getLeaderboard", {
      classType: myClass,
      limit: 20,
    }, token);
  });
}

function mixedProfile(token, userId) {
  group("프로필 조회", function () {
    const res = firestoreGet(http, `users/${userId}`, token);

    const ok = check(res, { "프로필 조회 200": (r) => r.status === 200 });
    if (!ok) firestoreErrors.add(1);
    else firestoreErrors.add(0);

    sleep(Math.random() * 2 + 1);

    callFunction(http, "getUserStats", {}, token);
  });
}

export function mixedRealistic(data) {
  const auth = ensureAuth();
  if (!auth) {
    sleep(5);
    return;
  }

  const { token, userId } = auth;
  const vuIndex = __VU - 1;
  const role = getVURole(vuIndex);

  const scenarioStart = Date.now();
  activeScenarios.add(1);

  switch (role) {
    case "quiz":
      mixedQuiz(token, userId, data.quizId);
      break;
    case "review":
      mixedReview(token, userId);
      break;
    case "board":
      mixedBoard(token, userId);
      break;
    case "ranking":
      mixedRanking(token);
      break;
    case "profile":
      mixedProfile(token, userId);
      break;
  }

  scenarioDuration.add(Date.now() - scenarioStart);

  // 다음 반복 전 자연스러운 대기
  sleep(Math.random() * 5 + 2);
}
