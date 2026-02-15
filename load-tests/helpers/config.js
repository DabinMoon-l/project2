/**
 * k6 부하 테스트 공통 설정
 *
 * 실행 전 환경변수 설정 필요:
 *   export FIREBASE_PROJECT_ID=your-project-id
 *   export FIREBASE_API_KEY=your-api-key
 *   export FIREBASE_REGION=asia-northeast3
 */

// Firebase 프로젝트 설정
export const PROJECT_ID = __ENV.FIREBASE_PROJECT_ID || "project2-7a317";
export const API_KEY = __ENV.FIREBASE_API_KEY || "";
export const REGION = __ENV.FIREBASE_REGION || "asia-northeast3";

// 엔드포인트
export const FUNCTIONS_URL = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net`;
export const FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
export const AUTH_URL = "https://identitytoolkit.googleapis.com/v1";

// 테스트용 과목 ID
export const TEST_COURSE_ID = __ENV.TEST_COURSE_ID || "biology";

// 테스트용 퀴즈 ID (사전에 생성 필요)
export const TEST_QUIZ_ID = __ENV.TEST_QUIZ_ID || "";

// 공통 임계값
export const DEFAULT_THRESHOLDS = {
  // 95% 요청이 3초 이내 응답
  http_req_duration: ["p(95)<3000"],
  // 에러율 5% 미만
  http_req_failed: ["rate<0.05"],
};

// Cloud Function callable 호출 헬퍼
export function callFunction(http, functionName, data, token) {
  const url = `${FUNCTIONS_URL}/${functionName}`;
  const params = {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    tags: { name: functionName },
  };

  return http.post(url, JSON.stringify({ data }), params);
}

// Firestore REST API 읽기 헬퍼
export function firestoreGet(http, path, token) {
  const url = `${FIRESTORE_URL}/${path}`;
  const params = {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    tags: { name: `firestore_get_${path.split("/")[0]}` },
  };

  return http.get(url, params);
}

// Firestore REST API 쿼리 헬퍼
export function firestoreQuery(http, collectionId, structuredQuery, token) {
  const url = `${FIRESTORE_URL}:runQuery`;
  const params = {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    tags: { name: `firestore_query_${collectionId}` },
  };

  const body = {
    structuredQuery: {
      from: [{ collectionId }],
      ...structuredQuery,
    },
  };

  return http.post(url, JSON.stringify(body), params);
}

// http.batch()용 Firestore 쿼리 요청 빌더
// 반환값: ["POST", url, body, params] 형태로 http.batch()에 전달
export function buildFirestoreQueryRequest(collectionId, structuredQuery, token, tagName) {
  const url = `${FIRESTORE_URL}:runQuery`;
  const body = JSON.stringify({
    structuredQuery: {
      from: [{ collectionId }],
      ...structuredQuery,
    },
  });
  const params = {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    tags: { name: tagName || `firestore_query_${collectionId}` },
  };

  return ["POST", url, body, params];
}
