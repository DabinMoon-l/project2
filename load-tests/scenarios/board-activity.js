/**
 * 시나리오 2: 게시판 동시 읽기/쓰기 테스트
 *
 * 동시 사용자가 게시판 목록 조회, 글 작성, 댓글 작성을 수행하는 시나리오.
 * Firestore 읽기/쓰기 동시성과 도배 방지 rate limit을 검증합니다.
 *
 * 실행:
 *   k6 run --env FIREBASE_API_KEY=xxx load-tests/scenarios/board-activity.js
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend } from "k6/metrics";
import {
  callFunction,
  firestoreQuery,
  firestoreGet,
  DEFAULT_THRESHOLDS,
  FIRESTORE_URL,
  TEST_COURSE_ID,
} from "../helpers/config.js";
import {
  signInWithEmail,
  getTestUserCredentials,
} from "../helpers/firebase-auth.js";

// 커스텀 메트릭
const postListDuration = new Trend("post_list_duration", true);
const postCreateDuration = new Trend("post_create_duration", true);
const commentCreateDuration = new Trend("comment_create_duration", true);
const rateLimitHits = new Rate("rate_limit_hits");

export const options = {
  scenarios: {
    // 게시판 동시 접속: 100명
    board_users: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "20s", target: 30 },
        { duration: "30s", target: 100 },
        { duration: "2m", target: 100 }, // 2분간 100명 유지
        { duration: "20s", target: 0 },
      ],
    },
  },
  thresholds: {
    ...DEFAULT_THRESHOLDS,
    post_list_duration: ["p(95)<2000"],
    post_create_duration: ["p(95)<3000"],
    comment_create_duration: ["p(95)<3000"],
  },
};

const vuState = {};

export default function () {
  const vuIndex = __VU - 1;

  // 로그인
  if (!vuState[__VU]) {
    const creds = getTestUserCredentials(vuIndex);
    const authResult = signInWithEmail(creds.email, creds.password);

    if (!authResult) {
      sleep(5);
      return;
    }

    vuState[__VU] = {
      token: authResult.idToken,
      userId: authResult.localId,
    };
  }

  const { token, userId } = vuState[__VU];

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
        // 문서 이름에서 ID 추출
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
