/**
 * Firebase Auth 헬퍼
 *
 * 부하 테스트용 사용자 인증 토큰을 발급합니다.
 *
 * 사전 준비:
 * 1. Firebase Console > Authentication > Sign-in method에서 이메일/비밀번호 활성화
 * 2. 테스트 사용자 생성 스크립트 실행 (아래 setupTestUsers 참고)
 */

import http from "k6/http";
import { AUTH_URL, API_KEY } from "./config.js";

/**
 * Firebase Auth 이메일/비밀번호 로그인으로 ID 토큰 발급
 *
 * @param {string} email - 테스트 사용자 이메일
 * @param {string} password - 테스트 사용자 비밀번호
 * @returns {{ idToken: string, localId: string } | null}
 */
export function signInWithEmail(email, password) {
  const url = `${AUTH_URL}/accounts:signInWithPassword?key=${API_KEY}`;
  const res = http.post(
    url,
    JSON.stringify({
      email,
      password,
      returnSecureToken: true,
    }),
    {
      headers: { "Content-Type": "application/json" },
      tags: { name: "auth_signIn" },
    }
  );

  if (res.status !== 200) {
    console.error(`로그인 실패 (${email}): ${res.status} ${res.body}`);
    return null;
  }

  const body = JSON.parse(res.body);
  return {
    idToken: body.idToken,
    localId: body.localId,
    refreshToken: body.refreshToken,
  };
}

/**
 * ID 토큰 갱신 (1시간 만료 대비)
 */
export function refreshIdToken(refreshToken) {
  const url = `https://securetoken.googleapis.com/v1/token?key=${API_KEY}`;
  const res = http.post(
    url,
    JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    {
      headers: { "Content-Type": "application/json" },
      tags: { name: "auth_refresh" },
    }
  );

  if (res.status !== 200) {
    return null;
  }

  const body = JSON.parse(res.body);
  return {
    idToken: body.id_token,
    refreshToken: body.refresh_token,
  };
}

/**
 * VU 번호 기반 테스트 사용자 자격 증명 생성
 *
 * @param {number} vuIndex - VU 번호 (0부터)
 * @returns {{ email: string, password: string }}
 */
export function getTestUserCredentials(vuIndex) {
  const paddedIndex = String(vuIndex).padStart(3, "0");
  return {
    email: `loadtest-user-${paddedIndex}@test.com`,
    password: "LoadTest2024!",
  };
}
