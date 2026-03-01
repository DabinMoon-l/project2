/**
 * 인증 관련 커스텀 훅
 *
 * useAuth: 학번+비밀번호 로그인/로그아웃 상태 관리
 * useRequireAuth: 미로그인 시 로그인 페이지로 리다이렉트
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { httpsCallable } from 'firebase/functions';
import {
  onAuthStateChanged,
  signInWithEmail,
  formatStudentEmail,
  signOut,
  User,
} from '../auth';
import { functions } from '../firebase';

// ============================================================
// 타입 정의
// ============================================================

interface UseAuthReturn {
  /** 현재 로그인된 사용자 (없으면 null) */
  user: User | null;
  /** 인증 상태 로딩 중 여부 */
  loading: boolean;
  /** 인증 관련 에러 메시지 */
  error: string | null;
  /** 학번+비밀번호 로그인 */
  loginWithStudentId: (studentId: string, password: string) => Promise<void>;
  /** 이메일+비밀번호 로그인 (교수님용) */
  loginWithEmail: (email: string, password: string) => Promise<void>;
  /** 학번+비밀번호 회원가입 (CF 호출) */
  signUpWithStudentId: (studentId: string, password: string, courseId: string, classId: string, nickname: string, name?: string) => Promise<{
    success: boolean;
    uid?: string;
  }>;
  /** 로그아웃 함수 */
  logout: () => Promise<void>;
  /** 에러 초기화 함수 */
  clearError: () => void;
}

interface UseRequireAuthOptions {
  redirectTo?: string;
}

// ============================================================
// useAuth 훅
// ============================================================

export const useAuth = (): UseAuthReturn => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // 인증 상태 구독
  useEffect(() => {
    const unsubscribe = onAuthStateChanged((firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  /**
   * 학번 + 비밀번호 로그인
   */
  const loginWithStudentId = useCallback(async (studentId: string, password: string): Promise<void> => {
    try {
      setLoading(true);
      setError(null);
      const email = formatStudentEmail(studentId);
      await signInWithEmail(email, password);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '로그인에 실패했습니다.';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * 이메일 + 비밀번호 로그인 (교수님용)
   */
  const loginWithEmail = useCallback(async (email: string, password: string): Promise<void> => {
    try {
      setLoading(true);
      setError(null);
      await signInWithEmail(email, password);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '로그인에 실패했습니다.';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * 학번 + 비밀번호 회원가입 (registerStudent CF 호출)
   */
  const signUpWithStudentId = useCallback(async (
    studentId: string,
    password: string,
    courseId: string,
    classId: string,
    nickname: string,
    name?: string
  ): Promise<{ success: boolean; uid?: string }> => {
    try {
      setLoading(true);
      setError(null);

      const registerStudentFn = httpsCallable<
        { studentId: string; password: string; courseId: string; classId: string; nickname: string; name?: string },
        { success: boolean; uid: string }
      >(functions, 'registerStudent');

      const result = await registerStudentFn({ studentId, password, courseId, classId, nickname, name });

      // 가입 성공 후 바로 로그인
      const email = formatStudentEmail(studentId);
      await signInWithEmail(email, password);

      return result.data;
    } catch (err: unknown) {
      // Firebase Functions 에러 처리
      const firebaseError = err as { code?: string; message?: string };
      let errorMessage = '회원가입에 실패했습니다.';

      if (firebaseError.message) {
        // CF에서 보낸 한글 메시지 사용
        errorMessage = firebaseError.message;
      }

      setError(errorMessage);
      return { success: false };
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * 로그아웃
   */
  const logout = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setError(null);
      await signOut();
      // 퀴즈 생성 관련 localStorage 정리
      localStorage.removeItem('quiz_extracted_images');
      localStorage.removeItem('quiz_create_draft');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '로그아웃에 실패했습니다.';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, []);

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
    loginWithStudentId,
    loginWithEmail,
    signUpWithStudentId,
    logout,
    clearError,
  };
};

// ============================================================
// useRequireAuth 훅
// ============================================================

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
        setUser(firebaseUser);
        setLoading(false);
      } else {
        setUser(null);
        setLoading(false);
        router.replace(redirectTo);
      }
    });

    return () => unsubscribe();
  }, [router, redirectTo]);

  return { user, loading };
};

export default useAuth;
