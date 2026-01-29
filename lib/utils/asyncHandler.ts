/**
 * 비동기 작업 핸들러 유틸리티
 *
 * 반복되는 try-catch-finally 패턴을 추상화합니다.
 */

import { useState, useCallback } from 'react';

// ============================================================
// 타입 정의
// ============================================================

/**
 * 비동기 작업 상태
 */
export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/**
 * 비동기 작업 결과
 */
export interface AsyncResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * 비동기 작업 옵션
 */
export interface AsyncOptions {
  /** 에러 메시지 커스터마이징 */
  errorMessage?: string;
  /** 에러 발생 시 콜백 */
  onError?: (error: unknown) => void;
  /** 성공 시 콜백 */
  onSuccess?: () => void;
}

// ============================================================
// 비동기 작업 래퍼
// ============================================================

/**
 * 비동기 작업을 안전하게 실행
 *
 * @example
 * ```ts
 * const result = await safeAsync(
 *   () => fetchData(),
 *   { errorMessage: '데이터를 불러오는데 실패했습니다.' }
 * );
 *
 * if (result.success) {
 *   console.log(result.data);
 * } else {
 *   console.error(result.error);
 * }
 * ```
 */
export async function safeAsync<T>(
  asyncFn: () => Promise<T>,
  options: AsyncOptions = {}
): Promise<AsyncResult<T>> {
  const { errorMessage, onError, onSuccess } = options;

  try {
    const data = await asyncFn();
    onSuccess?.();
    return { success: true, data };
  } catch (error) {
    const message = errorMessage || getErrorMessage(error);
    onError?.(error);
    console.error('Async operation failed:', error);
    return { success: false, error: message };
  }
}

/**
 * 에러 객체에서 메시지 추출
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return '알 수 없는 오류가 발생했습니다.';
}

// ============================================================
// 비동기 상태 훅
// ============================================================

/**
 * 비동기 작업 상태를 관리하는 훅
 *
 * @example
 * ```tsx
 * const { execute, loading, error, data } = useAsyncState<User[]>();
 *
 * const loadUsers = async () => {
 *   await execute(
 *     () => fetchUsers(),
 *     { errorMessage: '사용자 목록을 불러오는데 실패했습니다.' }
 *   );
 * };
 * ```
 */
export function useAsyncState<T>() {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async (
    asyncFn: () => Promise<T>,
    options: AsyncOptions = {}
  ): Promise<AsyncResult<T>> => {
    setLoading(true);
    setError(null);

    const result = await safeAsync(asyncFn, options);

    if (result.success) {
      setData(result.data ?? null);
    } else {
      setError(result.error ?? null);
    }

    setLoading(false);
    return result;
  }, []);

  const reset = useCallback(() => {
    setData(null);
    setLoading(false);
    setError(null);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    data,
    loading,
    error,
    execute,
    reset,
    clearError,
    setData,
  };
}

/**
 * 단순 로딩/에러 상태 관리 훅
 *
 * @example
 * ```tsx
 * const { loading, error, withLoading, setError, clearError } = useLoadingState();
 *
 * const handleSubmit = async () => {
 *   const result = await withLoading(async () => {
 *     await submitForm(data);
 *   }, '제출에 실패했습니다.');
 *
 *   if (result) {
 *     showSuccessToast();
 *   }
 * };
 * ```
 */
export function useLoadingState() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const withLoading = useCallback(async <T>(
    asyncFn: () => Promise<T>,
    errorMessage?: string
  ): Promise<T | null> => {
    setLoading(true);
    setError(null);

    try {
      const result = await asyncFn();
      return result;
    } catch (err) {
      const message = errorMessage || getErrorMessage(err);
      setError(message);
      console.error('Operation failed:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    loading,
    error,
    withLoading,
    setLoading,
    setError,
    clearError,
  };
}

// ============================================================
// Firebase 에러 핸들링
// ============================================================

/**
 * Firebase 에러를 사용자 친화적 메시지로 변환
 */
export function handleFirebaseError(error: unknown): string {
  const errorCode = (error as { code?: string })?.code;

  const errorMessages: Record<string, string> = {
    // Auth 에러
    'auth/user-not-found': '사용자를 찾을 수 없습니다.',
    'auth/wrong-password': '비밀번호가 올바르지 않습니다.',
    'auth/email-already-in-use': '이미 사용 중인 이메일입니다.',
    'auth/weak-password': '비밀번호가 너무 약합니다.',
    'auth/invalid-email': '유효하지 않은 이메일 형식입니다.',
    'auth/popup-closed-by-user': '로그인 팝업이 닫혔습니다.',
    'auth/popup-blocked': '팝업이 차단되었습니다. 팝업을 허용해주세요.',

    // Firestore 에러
    'permission-denied': '접근 권한이 없습니다.',
    'not-found': '요청한 데이터를 찾을 수 없습니다.',
    'already-exists': '이미 존재하는 데이터입니다.',
    'resource-exhausted': '요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.',
    'failed-precondition': '작업을 수행할 수 없는 상태입니다.',
    'aborted': '작업이 중단되었습니다.',
    'unavailable': '서비스를 일시적으로 사용할 수 없습니다.',

    // 네트워크 에러
    'network-request-failed': '네트워크 연결을 확인해주세요.',
  };

  if (errorCode && errorMessages[errorCode]) {
    return errorMessages[errorCode];
  }

  return getErrorMessage(error);
}
