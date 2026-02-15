/**
 * 시나리오 4: 300명 혼합 현실적 시나리오
 *
 * 수업 종료 후 300명이 동시 접속하는 피크 상황을 시뮬레이션합니다:
 * - 40% (120명): 퀴즈 목록 조회 → 퀴즈 풀기 → 제출
 * - 25% (75명): 복습 페이지 조회
 * - 15% (45명): 게시판 조회/글쓰기
 * - 10% (30명): 랭킹/리더보드 조회
 * - 10% (30명): 프로필/설정 조회
 *
 * 실행:
 *   k6 run --env FIREBASE_API_KEY=xxx --env TEST_QUIZ_ID=xxx load-tests/scenarios/mixed-realistic.js
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Trend, Rate, Counter } from "k6/metrics";
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

// 커스텀 메트릭
const scenarioDuration = new Trend("scenario_duration", true);
const cfErrors = new Rate("cloud_function_errors");
const firestoreErrors = new Rate("firestore_errors");
const activeScenarios = new Counter("active_scenarios");
const rateLimitErrors = new Counter("rate_limit_errors");
const contentionErrors = new Counter("contention_errors");
const duplicateSubmissions = new Counter("duplicate_submissions");

export const options = {
  scenarios: {
    // 현실적 사용 패턴: 점진적 증가 후 피크 유지
    realistic_load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 50 }, // 초기 접속
        { duration: "30s", target: 150 }, // 빠른 증가
        { duration: "30s", target: 300 }, // 피크 도달
        { duration: "3m", target: 300 }, // 3분간 피크 유지 (핵심 측정 구간)
        { duration: "1m", target: 100 }, // 점진적 감소
        { duration: "30s", target: 0 }, // 종료
      ],
    },
  },
  thresholds: {
    ...DEFAULT_THRESHOLDS,
    // 전체 HTTP (리뷰 순차 쿼리 포함, 기본 3s보다 완화)
    http_req_duration: ["p(95)<10000"],
    // 전체 시나리오 95%가 20초 이내 완료 (퀴즈 풀이 5~15s 포함)
    scenario_duration: ["p(95)<20000"],
    cloud_function_errors: ["rate<0.05"],
    firestore_errors: ["rate<0.05"],
  },
};

const vuState = {};

// VU를 역할에 매핑 (결정적)
function getVURole(vuIndex) {
  const mod = vuIndex % 20;
  if (mod < 8) return "quiz"; // 40%
  if (mod < 13) return "review"; // 25%
  if (mod < 16) return "board"; // 15%
  if (mod < 18) return "ranking"; // 10%
  return "profile"; // 10%
}

// 로그인 헬퍼
function ensureAuth(vuIndex) {
  if (!vuState[__VU]) {
    const creds = getTestUserCredentials(vuIndex);
    const authResult = signInWithEmail(creds.email, creds.password);

    if (!authResult) {
      return null;
    }

    vuState[__VU] = {
      token: authResult.idToken,
      userId: authResult.localId,
    };
  }
  return vuState[__VU];
}

// ============================================================
// 헬퍼 함수
// ============================================================

// 리뷰 타입별 쿼리 생성 (실제 앱과 동일하게 courseId 필터 포함)
function buildReviewQueryForMixed(userId, reviewType) {
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

  if (reviewType === "solved") {
    q.limit = 51;
  } else {
    q.limit = 101;
  }

  return q;
}

// ============================================================
// 시나리오별 함수
// ============================================================

function scenarioQuiz(token, userId) {
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
    if (TEST_QUIZ_ID) {
      group("퀴즈 상세", function () {
        const res = firestoreGet(http, `quizzes/${TEST_QUIZ_ID}`, token);
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

        // attemptNo를 VU+ITER 조합으로 고유하게 생성
        const attemptNo = __VU * 10000 + __ITER + 1;

        const res = callFunction(http, "recordAttempt", {
          quizId: TEST_QUIZ_ID,
          answers,
          attemptNo,
        }, token);

        const ok = check(res, {
          "recordAttempt 200": (r) => r.status === 200,
        });

        if (!ok) {
          cfErrors.add(1);
          // 에러 유형 분류
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

function scenarioReview(token, userId) {
  group("복습 페이지", function () {
    const reviewTypes = ["wrong", "bookmark", "solved"];

    for (const reviewType of reviewTypes) {
      const res = firestoreQuery(
        http, "reviews", buildReviewQueryForMixed(userId, reviewType), token
      );

      const ok = check(res, {
        [`${reviewType} 쿼리 200`]: (r) => r.status === 200,
      });
      if (!ok) firestoreErrors.add(1);
      else firestoreErrors.add(0);
    }
  });

  sleep(Math.random() * 5 + 3); // 복습 목록 탐색
}

function scenarioBoard(token, userId) {
  group("게시판 활동", function () {
    // 게시판 목록 조회
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

function scenarioRanking(token) {
  group("랭킹 조회", function () {
    const res = callFunction(http, "getLeaderboard", {
      classType: "all",
      limit: 50,
    }, token);

    const ok = check(res, { "랭킹 조회 200": (r) => r.status === 200 });
    if (!ok) cfErrors.add(1);
    else cfErrors.add(0);

    sleep(Math.random() * 3 + 2);

    // 반별 랭킹도 조회
    const classes = ["A", "B", "C", "D"];
    const myClass = classes[__VU % 4];

    callFunction(http, "getLeaderboard", {
      classType: myClass,
      limit: 20,
    }, token);
  });
}

function scenarioProfile(token, userId) {
  group("프로필 조회", function () {
    // 사용자 문서 조회
    const res = firestoreGet(http, `users/${userId}`, token);

    const ok = check(res, { "프로필 조회 200": (r) => r.status === 200 });
    if (!ok) firestoreErrors.add(1);
    else firestoreErrors.add(0);

    sleep(Math.random() * 2 + 1);

    // 통계 조회
    callFunction(http, "getUserStats", {}, token);
  });
}

// ============================================================
// 메인 실행
// ============================================================

export default function () {
  const vuIndex = __VU - 1;

  const auth = ensureAuth(vuIndex);
  if (!auth) {
    sleep(5);
    return;
  }

  const { token, userId } = auth;
  const role = getVURole(vuIndex);

  const scenarioStart = Date.now();
  activeScenarios.add(1);

  switch (role) {
    case "quiz":
      scenarioQuiz(token, userId);
      break;
    case "review":
      scenarioReview(token, userId);
      break;
    case "board":
      scenarioBoard(token, userId);
      break;
    case "ranking":
      scenarioRanking(token);
      break;
    case "profile":
      scenarioProfile(token, userId);
      break;
  }

  scenarioDuration.add(Date.now() - scenarioStart);

  // 다음 반복 전 자연스러운 대기
  sleep(Math.random() * 5 + 2);
}
