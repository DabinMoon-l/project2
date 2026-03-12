/**
 * 비동기 작업 핸들러 유틸리티
 *
 * 반복되는 try-catch-finally 패턴을 추상화합니다.
 */

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

