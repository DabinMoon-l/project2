/**
 * Firebase Authentication 인증 로직
 *
 * Apple, Google, Naver 소셜 로그인을 처리합니다.
 * - Apple/Google: Firebase signInWithPopup 사용
 * - Naver: 커스텀 OAuth URL 리다이렉트 방식
 */

import {
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged as firebaseOnAuthStateChanged,
  GoogleAuthProvider,
  OAuthProvider,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification as firebaseSendEmailVerification,
  User,
  UserCredential,
  NextOrObserver,
  Unsubscribe,
} from 'firebase/auth';
import { auth } from './firebase';

// ============================================================
// Provider 설정
// ============================================================

/**
 * Google 인증 Provider
 * 추가 스코프로 이메일과 프로필 정보를 요청합니다.
 */
const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('email');
googleProvider.addScope('profile');

/**
 * Apple 인증 Provider
 * 이름과 이메일 스코프를 요청합니다.
 */
const appleProvider = new OAuthProvider('apple.com');
appleProvider.addScope('email');
appleProvider.addScope('name');

// ============================================================
// Naver OAuth 설정
// ============================================================

/**
 * Naver OAuth 설정
 * 환경 변수에서 클라이언트 ID와 콜백 URL을 가져옵니다.
 */
const NAVER_CLIENT_ID = process.env.NEXT_PUBLIC_NAVER_CLIENT_ID;
const NAVER_CALLBACK_URL = process.env.NEXT_PUBLIC_NAVER_CALLBACK_URL;

/**
 * Naver OAuth 인증 URL 생성
 * state 파라미터는 CSRF 방지용으로 사용됩니다.
 */
const generateNaverAuthUrl = (): string => {
  // CSRF 방지를 위한 랜덤 state 생성
  const state = Math.random().toString(36).substring(2, 15);

  // state를 sessionStorage에 저장 (콜백에서 검증용)
  if (typeof window !== 'undefined') {
    sessionStorage.setItem('naver_oauth_state', state);
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: NAVER_CLIENT_ID || '',
    redirect_uri: NAVER_CALLBACK_URL || '',
    state: state,
  });

  return `https://nid.naver.com/oauth2.0/authorize?${params.toString()}`;
};

// ============================================================
// 인증 함수들
// ============================================================

/**
 * Apple 소셜 로그인
 *
 * Firebase signInWithPopup을 사용하여 Apple 로그인을 처리합니다.
 * 팝업 창에서 Apple 로그인 진행 후 결과를 반환합니다.
 *
 * @returns Promise<UserCredential> - 로그인 성공 시 사용자 자격 증명
 * @throws Error - 로그인 실패 시 에러
 */
export const signInWithApple = async (): Promise<UserCredential> => {
  try {
    const result = await signInWithPopup(auth, appleProvider);
    return result;
  } catch (error: unknown) {
    console.error('Apple 로그인 실패:', error);

    // 에러 메시지 한글화
    if (error instanceof Error) {
      const firebaseError = error as { code?: string };
      switch (firebaseError.code) {
        case 'auth/popup-closed-by-user':
          throw new Error('로그인 팝업이 닫혔습니다. 다시 시도해주세요.');
        case 'auth/popup-blocked':
          throw new Error('팝업이 차단되었습니다. 팝업 차단을 해제해주세요.');
        case 'auth/cancelled-popup-request':
          throw new Error('로그인 요청이 취소되었습니다.');
        case 'auth/account-exists-with-different-credential':
          throw new Error('이미 다른 로그인 방식으로 가입된 계정입니다.');
        default:
          throw new Error('Apple 로그인에 실패했습니다. 다시 시도해주세요.');
      }
    }
    throw new Error('알 수 없는 오류가 발생했습니다.');
  }
};

/**
 * Google 소셜 로그인
 *
 * Firebase signInWithPopup을 사용하여 Google 로그인을 처리합니다.
 * 팝업 창에서 Google 로그인 진행 후 결과를 반환합니다.
 *
 * @returns Promise<UserCredential> - 로그인 성공 시 사용자 자격 증명
 * @throws Error - 로그인 실패 시 에러
 */
export const signInWithGoogle = async (): Promise<UserCredential> => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result;
  } catch (error: unknown) {
    console.error('Google 로그인 실패:', error);

    // 에러 메시지 한글화
    if (error instanceof Error) {
      const firebaseError = error as { code?: string };
      switch (firebaseError.code) {
        case 'auth/popup-closed-by-user':
          throw new Error('로그인 팝업이 닫혔습니다. 다시 시도해주세요.');
        case 'auth/popup-blocked':
          throw new Error('팝업이 차단되었습니다. 팝업 차단을 해제해주세요.');
        case 'auth/cancelled-popup-request':
          throw new Error('로그인 요청이 취소되었습니다.');
        case 'auth/account-exists-with-different-credential':
          throw new Error('이미 다른 로그인 방식으로 가입된 계정입니다.');
        default:
          throw new Error('Google 로그인에 실패했습니다. 다시 시도해주세요.');
      }
    }
    throw new Error('알 수 없는 오류가 발생했습니다.');
  }
};

/**
 * Naver 소셜 로그인
 *
 * Naver는 Firebase에서 직접 지원하지 않으므로 커스텀 OAuth를 사용합니다.
 * OAuth URL로 리다이렉트하고, 콜백에서 토큰을 받아 Firebase Custom Token으로 교환합니다.
 *
 * 주의: 이 함수는 페이지를 리다이렉트하므로 Promise를 반환하지 않습니다.
 */
export const signInWithNaver = (): void => {
  try {
    // Naver OAuth 설정이 없으면 에러
    if (!NAVER_CLIENT_ID || !NAVER_CALLBACK_URL) {
      throw new Error('Naver OAuth 설정이 필요합니다.');
    }

    // Naver 로그인 페이지로 리다이렉트
    const authUrl = generateNaverAuthUrl();
    window.location.href = authUrl;
  } catch (error) {
    console.error('Naver 로그인 시작 실패:', error);
    throw new Error('Naver 로그인을 시작할 수 없습니다.');
  }
};

/**
 * 로그아웃
 *
 * Firebase Authentication에서 현재 사용자를 로그아웃합니다.
 *
 * @returns Promise<void>
 * @throws Error - 로그아웃 실패 시 에러
 */
export const signOut = async (): Promise<void> => {
  try {
    await firebaseSignOut(auth);
  } catch (error) {
    console.error('로그아웃 실패:', error);
    throw new Error('로그아웃에 실패했습니다. 다시 시도해주세요.');
  }
};

/**
 * 현재 로그인된 사용자 조회
 *
 * Firebase Authentication의 현재 사용자를 반환합니다.
 * 로그인되어 있지 않으면 null을 반환합니다.
 *
 * @returns User | null - 현재 사용자 또는 null
 */
export const getCurrentUser = (): User | null => {
  return auth.currentUser;
};

/**
 * 인증 상태 변경 리스너
 *
 * Firebase onAuthStateChanged의 래퍼 함수입니다.
 * 사용자의 로그인/로그아웃 상태가 변경될 때마다 콜백이 호출됩니다.
 *
 * @param callback - 인증 상태 변경 시 호출될 콜백 함수
 * @returns Unsubscribe - 리스너 해제 함수
 */
export const onAuthStateChanged = (
  callback: NextOrObserver<User>
): Unsubscribe => {
  return firebaseOnAuthStateChanged(auth, callback);
};

// ============================================================
// 이메일/비밀번호 인증
// ============================================================

/**
 * 이메일/비밀번호로 회원가입
 *
 * @param email - 사용자 이메일
 * @param password - 비밀번호
 * @returns Promise<UserCredential> - 회원가입 성공 시 사용자 자격 증명
 */
export const signUpWithEmail = async (
  email: string,
  password: string
): Promise<UserCredential> => {
  try {
    const result = await createUserWithEmailAndPassword(auth, email, password);
    return result;
  } catch (error: unknown) {
    console.error('이메일 회원가입 실패:', error);

    if (error instanceof Error) {
      const firebaseError = error as { code?: string };
      switch (firebaseError.code) {
        case 'auth/email-already-in-use':
          throw new Error('이미 사용 중인 이메일입니다.');
        case 'auth/invalid-email':
          throw new Error('유효하지 않은 이메일 형식입니다.');
        case 'auth/weak-password':
          throw new Error('비밀번호는 6자 이상이어야 합니다.');
        default:
          throw new Error('회원가입에 실패했습니다. 다시 시도해주세요.');
      }
    }
    throw new Error('알 수 없는 오류가 발생했습니다.');
  }
};

/**
 * 이메일/비밀번호로 로그인
 *
 * @param email - 사용자 이메일
 * @param password - 비밀번호
 * @returns Promise<UserCredential> - 로그인 성공 시 사용자 자격 증명
 */
export const signInWithEmail = async (
  email: string,
  password: string
): Promise<UserCredential> => {
  try {
    const result = await signInWithEmailAndPassword(auth, email, password);
    return result;
  } catch (error: unknown) {
    console.error('이메일 로그인 실패:', error);

    if (error instanceof Error) {
      const firebaseError = error as { code?: string };
      switch (firebaseError.code) {
        case 'auth/user-not-found':
          throw new Error('등록되지 않은 이메일입니다.');
        case 'auth/wrong-password':
          throw new Error('비밀번호가 올바르지 않습니다.');
        case 'auth/invalid-email':
          throw new Error('유효하지 않은 이메일 형식입니다.');
        case 'auth/too-many-requests':
          throw new Error('너무 많은 시도가 있었습니다. 잠시 후 다시 시도해주세요.');
        default:
          throw new Error('로그인에 실패했습니다. 다시 시도해주세요.');
      }
    }
    throw new Error('알 수 없는 오류가 발생했습니다.');
  }
};

/**
 * 이메일 인증 메일 발송
 *
 * @param user - 인증 메일을 보낼 사용자
 * @returns Promise<void>
 */
export const sendEmailVerification = async (user: User): Promise<void> => {
  try {
    await firebaseSendEmailVerification(user);
  } catch (error: unknown) {
    console.error('인증 메일 발송 실패:', error);

    if (error instanceof Error) {
      const firebaseError = error as { code?: string };
      switch (firebaseError.code) {
        case 'auth/too-many-requests':
          throw new Error('너무 많은 요청이 있었습니다. 잠시 후 다시 시도해주세요.');
        default:
          throw new Error('인증 메일 발송에 실패했습니다. 다시 시도해주세요.');
      }
    }
    throw new Error('알 수 없는 오류가 발생했습니다.');
  }
};

/**
 * 이메일 인증 여부 확인
 *
 * @param user - 확인할 사용자
 * @returns boolean - 이메일 인증 완료 여부
 */
export const isEmailVerified = (user: User | null): boolean => {
  if (!user) return false;
  return user.emailVerified;
};

// ============================================================
// 타입 내보내기
// ============================================================

export type { User, UserCredential };
