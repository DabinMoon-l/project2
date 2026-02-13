/**
 * 시나리오 3: 복습 목록 대량 조회 테스트
 *
 * 복습 페이지는 여러 Firestore 쿼리를 동시에 실행합니다:
 * - reviews (wrong, bookmark, solved 각각)
 * - quizResults
 * - customFolders
 * - quizzes (privateQuizzes)
 *
 * 300명이 동시에 복습 페이지를 열었을 때의 읽기 부하를 검증합니다.
 *
 * 실행:
 *   k6 run --env FIREBASE_API_KEY=xxx load-tests/scenarios/review-load.js
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Trend, Rate } from "k6/metrics";
import {
  firestoreQuery,
  DEFAULT_THRESHOLDS,
  TEST_COURSE_ID,
} from "../helpers/config.js";
import {
  signInWithEmail,
  getTestUserCredentials,
} from "../helpers/firebase-auth.js";

// 커스텀 메트릭
const reviewPageDuration = new Trend("review_page_load", true);
const wrongQueryDuration = new Trend("wrong_query_duration", true);
const bookmarkQueryDuration = new Trend("bookmark_query_duration", true);
const solvedQueryDuration = new Trend("solved_query_duration", true);
const queryErrors = new Rate("review_query_errors");

export const options = {
  scenarios: {
    // 300명 동시 복습 페이지 접근
    review_spike: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "20s", target: 100 },
        { duration: "20s", target: 300 }, // 급격한 증가 (수업 종료 직후 시나리오)
        { duration: "2m", target: 300 }, // 300명 유지
        { duration: "30s", target: 0 },
      ],
    },
  },
  thresholds: {
    ...DEFAULT_THRESHOLDS,
    // 복습 페이지 전체 로드 95%가 4초 이내
    review_page_load: ["p(95)<4000"],
    // 개별 쿼리 95%가 2초 이내
    wrong_query_duration: ["p(95)<2000"],
    bookmark_query_duration: ["p(95)<2000"],
    solved_query_duration: ["p(95)<2000"],
    review_query_errors: ["rate<0.05"],
  },
};

const vuState = {};

// 리뷰 타입별 쿼리 생성
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

  // solved 타입은 페이지네이션 적용 (앱에서 50개씩 로드)
  if (reviewType === "solved") {
    q.limit = 51;
  }

  return q;
}

export default function () {
  const vuIndex = __VU - 1;

  // 로그인
  if (!vuState[__VU]) {
    const creds = getTestUserCredentials(vuIndex);
    const authResult = signInWithEmail(creds.email, creds.password);

    if (!authResult) {
      queryErrors.add(1);
      sleep(5);
      return;
    }

    vuState[__VU] = {
      token: authResult.idToken,
      userId: authResult.localId,
    };
  }

  const { token, userId } = vuState[__VU];
  const pageStart = Date.now();

  group("복습 페이지 로드", function () {
    // 오답 목록 조회
    group("오답 쿼리", function () {
      const start = Date.now();
      const res = firestoreQuery(
        http,
        "reviews",
        buildReviewQuery(userId, "wrong"),
        token
      );
      wrongQueryDuration.add(Date.now() - start);

      const ok = check(res, {
        "오답 쿼리 200": (r) => r.status === 200,
      });
      if (!ok) queryErrors.add(1);
      else queryErrors.add(0);
    });

    // 찜한 문제 조회
    group("찜 쿼리", function () {
      const start = Date.now();
      const res = firestoreQuery(
        http,
        "reviews",
        buildReviewQuery(userId, "bookmark"),
        token
      );
      bookmarkQueryDuration.add(Date.now() - start);

      check(res, {
        "찜 쿼리 200": (r) => r.status === 200,
      });
    });

    // 푼 문제 조회
    group("푼 문제 쿼리", function () {
      const start = Date.now();
      const res = firestoreQuery(
        http,
        "reviews",
        buildReviewQuery(userId, "solved"),
        token
      );
      solvedQueryDuration.add(Date.now() - start);

      check(res, {
        "푼 문제 쿼리 200": (r) => r.status === 200,
      });
    });

    // 퀴즈 결과 조회
    group("퀴즈 결과 쿼리", function () {
      firestoreQuery(
        http,
        "quizResults",
        {
          where: {
            fieldFilter: {
              field: { fieldPath: "userId" },
              op: "EQUAL",
              value: { stringValue: userId },
            },
          },
          orderBy: [
            {
              field: { fieldPath: "createdAt" },
              direction: "DESCENDING",
            },
          ],
          limit: 50,
        },
        token
      );
    });

    // 커스텀 폴더 조회
    group("커스텀 폴더 쿼리", function () {
      firestoreQuery(
        http,
        "customFolders",
        {
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
        },
        token
      );
    });
  });

  reviewPageDuration.add(Date.now() - pageStart);

  // 사용자가 복습 페이지를 보는 시간
  sleep(Math.random() * 5 + 3);
}
