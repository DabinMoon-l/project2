/**
 * 인증 관련 커스텀 훅
 *
 * useAuth: 현재 사용자 상태, 로딩 상태, 에러 관리
 * useRequireAuth: 미로그인 시 로그인 페이지로 리다이렉트
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  onAuthStateChanged,
  signInWithApple,
  signInWithGoogle,
  signInWithNaver,
  signInWithEmail,
  signUpWithEmail,
  sendEmailVerification,
  isEmailVerified,
  signOut,
  User,
} from '../auth';

// ============================================================
// 타입 정의
// ============================================================

/**
 * useAuth 훅의 반환 타입
 */
interface UseAuthReturn {
  /** 현재 로그인된 사용자 (없으면 null) */
  user: User | null;
  /** 인증 상태 로딩 중 여부 */
  loading: boolean;
  /** 인증 관련 에러 메시지 */
  error: string | null;
  /** Apple 로그인 함수 */
  loginWithApple: () => Promise<void>;
  /** Google 로그인 함수 */
  loginWithGoogle: () => Promise<void>;
  /** Naver 로그인 함수 (리다이렉트) */
  loginWithNaver: () => void;
  /** 이메일/비밀번호 로그인 함수 */
  loginWithEmail: (email: string, password: string) => Promise<void>;
  /** 이메일/비밀번호 회원가입 함수 */
  signUpWithEmailPassword: (email: string, password: string) => Promise<void>;
  /** 인증 메일 발송 함수 */
  sendVerificationEmail: () => Promise<void>;
  /** 이메일 인증 여부 확인 */
  emailVerified: boolean;
  /** 로그아웃 함수 */
  logout: () => Promise<void>;
  /** 에러 초기화 함수 */
  clearError: () => void;
}

/**
 * useRequireAuth 훅의 옵션
 */
interface UseRequireAuthOptions {
  /** 미로그인 시 리다이렉트할 경로 (기본값: '/login') */
  redirectTo?: string;
}

// ============================================================
// useAuth 훅
// ============================================================

/**
 * 인증 상태를 관리하는 커스텀 훅
 *
 * Firebase Authentication의 인증 상태를 구독하고,
 * 소셜 로그인/로그아웃 함수를 제공합니다.
 *
 * @example
 * ```tsx
 * const { user, loading, error, loginWithGoogle, logout } = useAuth();
 *
 * if (loading) return <LoadingSpinner />;
 * if (user) return <UserProfile user={user} />;
 * return <LoginButton onClick={loginWithGoogle} />;
 * ```
 */
export const useAuth = (): UseAuthReturn => {
  // 상태 관리
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // 인증 상태 구독
  useEffect(() => {
    const unsubscribe = onAuthStateChanged((firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
    });

    // 컴포넌트 언마운트 시 구독 해제
    return () => unsubscribe();
  }, []);

  /**
   * Apple 로그인 처리
   */
  const loginWithApple = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setError(null);
      await signInWithApple();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Apple 로그인에 실패했습니다.';
      setError(errorMessage);
      console.error('Apple 로그인 에러:', errorMessage);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Google 로그인 처리
   */
  const loginWithGoogle = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setError(null);
      await signInWithGoogle();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Google 로그인에 실패했습니다.';
      setError(errorMessage);
      console.error('Google 로그인 에러:', errorMessage);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Naver 로그인 처리
   * 페이지 리다이렉트 방식이므로 loading 상태만 설정
   */
  const loginWithNaver = useCallback((): void => {
    try {
      setLoading(true);
      setError(null);
      signInWithNaver();
      // 리다이렉트되므로 loading은 자동으로 유지됨
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Naver 로그인에 실패했습니다.';
      setError(errorMessage);
      setLoading(false);
      console.error('Naver 로그인 에러:', errorMessage);
    }
  }, []);

  /**
   * 로그아웃 처리
   */
  const logout = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setError(null);
      await signOut();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '로그아웃에 실패했습니다.';
      setError(errorMessage);
      console.error('로그아웃 에러:', errorMessage);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * 이메일/비밀번호 로그인 처리
   */
  const loginWithEmail = useCallback(async (email: string, password: string): Promise<void> => {
    try {
      setLoading(true);
      setError(null);
      await signInWithEmail(email, password);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '이메일 로그인에 실패했습니다.';
      setError(errorMessage);
      console.error('이메일 로그인 에러:', errorMessage);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * 이메일/비밀번호 회원가입 처리
   */
  const signUpWithEmailPassword = useCallback(async (email: string, password: string): Promise<void> => {
    try {
      setLoading(true);
      setError(null);
      const result = await signUpWithEmail(email, password);
      // 회원가입 성공 후 인증 메일 발송
      if (result.user) {
        await sendEmailVerification(result.user);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '회원가입에 실패했습니다.';
      setError(errorMessage);
      console.error('회원가입 에러:', errorMessage);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * 인증 메일 재발송
   */
  const sendVerificationEmail = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setError(null);
      if (user) {
        await sendEmailVerification(user);
      } else {
        throw new Error('로그인된 사용자가 없습니다.');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '인증 메일 발송에 실패했습니다.';
      setError(errorMessage);
      console.error('인증 메일 발송 에러:', errorMessage);
    } finally {
      setLoading(false);
    }
  }, [user]);

  /**
   * 에러 초기화
   */
  const clearError = useCallback((): void => {
    setError(null);
  }, []);

  return {
    user,
    loading,
    error,
    loginWithApple,
    loginWithGoogle,
    loginWithNaver,
    loginWithEmail,
    signUpWithEmailPassword,
    sendVerificationEmail,
    emailVerified: isEmailVerified(user),
    logout,
    clearError,
  };
};

// ============================================================
// useRequireAuth 훅
// ============================================================

/**
 * 인증이 필요한 페이지에서 사용하는 훅
 *
 * 로그인되지 않은 사용자를 자동으로 로그인 페이지로 리다이렉트합니다.
 * 인증 상태 확인 중에는 loading: true를 반환합니다.
 *
 * @param options - 리다이렉트 옵션
 * @returns 현재 사용자와 로딩 상태
 *
 * @example
 * ```tsx
 * // 기본 사용법 (로그인 페이지로 리다이렉트)
 * const { user, loading } = useRequireAuth();
 *
 * // 커스텀 리다이렉트 경로
 * const { user, loading } = useRequireAuth({ redirectTo: '/welcome' });
 *
 * if (loading) return <LoadingSpinner />;
 * // user는 항상 존재 (미로그인 시 리다이렉트됨)
 * return <ProtectedContent user={user!} />;
 * ```
 */
export const useRequireAuth = (
  options: UseRequireAuthOptions = {}
): { user: User | null; loading: boolean } => {
  const { redirectTo = '/login' } = options;
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged((firebaseUser) => {
      if (firebaseUser) {
        // 로그인된 경우 사용자 정보 설정
        setUser(firebaseUser);
        setLoading(false);
      } else {
        // 미로그인 시 리다이렉트
        setUser(null);
        setLoading(false);
        router.replace(redirectTo);
      }
    });

    return () => unsubscribe();
  }, [router, redirectTo]);

  return { user, loading };
};

// 기본 내보내기
export default useAuth;
