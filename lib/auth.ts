/**
 * Firebase Authentication 인증 로직
 *
 * 학번+비밀번호 방식 (학번 → {학번}@rabbitory.internal 매핑)
 * 교수님은 기존 이메일로 로그인.
 */

import {
  signOut as firebaseSignOut,
  onAuthStateChanged as firebaseOnAuthStateChanged,
  signInWithEmailAndPassword,
  User,
  UserCredential,
  NextOrObserver,
  Unsubscribe,
} from 'firebase/auth';
import { auth } from './firebase';

// ============================================================
// 학번 ↔ 이메일 변환 헬퍼
// ============================================================

/** 학번을 내부 이메일로 변환 */
export const formatStudentEmail = (studentId: string): string =>
  `${studentId}@rabbitory.internal`;

/** 내부 이메일 여부 확인 */
export const isStudentEmail = (email: string): boolean =>
  email.endsWith('@rabbitory.internal');

/** 내부 이메일에서 학번 추출 */
export const extractStudentId = (email: string): string =>
  email.replace('@rabbitory.internal', '');

// ============================================================
// 인증 함수들
// ============================================================

/**
 * 로그아웃
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
 */
export const getCurrentUser = (): User | null => {
  return auth.currentUser;
};

/**
 * 인증 상태 변경 리스너
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
 * 이메일/비밀번호로 로그인
 * 학번 로그인과 교수님 이메일 로그인 모두 이 함수 사용
 */
export const signInWithEmail = async (
  email: string,
  password: string
): Promise<UserCredential> => {
  try {
    const result = await signInWithEmailAndPassword(auth, email, password);
    return result;
  } catch (error: unknown) {
    console.error('로그인 실패:', error);

    if (error instanceof Error) {
      const firebaseError = error as { code?: string };
      switch (firebaseError.code) {
        case 'auth/user-not-found':
          throw new Error('등록되지 않은 계정입니다.');
        case 'auth/wrong-password':
        case 'auth/invalid-credential':
          throw new Error('비밀번호가 올바르지 않습니다.');
        case 'auth/invalid-email':
          throw new Error('유효하지 않은 형식입니다.');
        case 'auth/too-many-requests':
          throw new Error('너무 많은 시도가 있었습니다. 잠시 후 다시 시도해주세요.');
        default:
          throw new Error('로그인에 실패했습니다. 다시 시도해주세요.');
      }
    }
    throw new Error('알 수 없는 오류가 발생했습니다.');
  }
};

// ============================================================
// 타입 내보내기
// ============================================================

export type { User, UserCredential };
