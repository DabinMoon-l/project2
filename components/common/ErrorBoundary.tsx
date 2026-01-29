/**
 * 에러 바운더리 컴포넌트
 *
 * React 컴포넌트 트리에서 발생하는 JavaScript 에러를 캐치하고
 * 폴백 UI를 표시합니다.
 */

'use client';

import { Component, type ReactNode, type ErrorInfo } from 'react';
import { motion } from 'framer-motion';

// ============================================================
// 타입 정의
// ============================================================

interface ErrorBoundaryProps {
  /** 자식 컴포넌트 */
  children: ReactNode;
  /** 커스텀 폴백 UI */
  fallback?: ReactNode;
  /** 에러 발생 시 콜백 */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /** 재시도 버튼 표시 여부 */
  showRetry?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

// ============================================================
// 에러 바운더리 컴포넌트
// ============================================================

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });

    // 에러 로깅
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    // 콜백 호출
    this.props.onError?.(error, errorInfo);

    // TODO: 에러 리포팅 서비스로 전송 (Sentry 등)
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    const { hasError, error } = this.state;
    const { children, fallback, showRetry = true } = this.props;

    if (hasError) {
      // 커스텀 폴백이 있으면 사용
      if (fallback) {
        return fallback;
      }

      // 기본 에러 UI
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-md w-full bg-white rounded-2xl shadow-lg p-6 text-center"
          >
            {/* 에러 아이콘 */}
            <div className="w-16 h-16 mx-auto mb-4 bg-red-100 rounded-full flex items-center justify-center">
              <span className="text-3xl">😵</span>
            </div>

            {/* 제목 */}
            <h2 className="text-xl font-bold text-gray-800 mb-2">
              앗, 문제가 발생했어요
            </h2>

            {/* 설명 */}
            <p className="text-gray-600 text-sm mb-4">
              예상치 못한 오류가 발생했습니다.
              <br />
              잠시 후 다시 시도해주세요.
            </p>

            {/* 에러 메시지 (개발 모드에서만) */}
            {process.env.NODE_ENV === 'development' && error && (
              <div className="bg-gray-100 rounded-lg p-3 mb-4 text-left">
                <p className="text-xs font-mono text-red-600 break-all">
                  {error.message}
                </p>
              </div>
            )}

            {/* 버튼 */}
            {showRetry && (
              <div className="flex gap-3 justify-center">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={this.handleReset}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm font-medium"
                >
                  다시 시도
                </motion.button>

                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={this.handleReload}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium"
                >
                  페이지 새로고침
                </motion.button>
              </div>
            )}
          </motion.div>
        </div>
      );
    }

    return children;
  }
}

// ============================================================
// 에러 폴백 컴포넌트 (재사용 가능)
// ============================================================

interface ErrorFallbackProps {
  /** 에러 객체 */
  error?: Error | null;
  /** 재시도 핸들러 */
  onRetry?: () => void;
  /** 제목 */
  title?: string;
  /** 설명 */
  description?: string;
}

export function ErrorFallback({
  error,
  onRetry,
  title = '문제가 발생했어요',
  description = '잠시 후 다시 시도해주세요.',
}: ErrorFallbackProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      <div className="w-12 h-12 mb-3 bg-red-100 rounded-full flex items-center justify-center">
        <span className="text-2xl">⚠️</span>
      </div>

      <h3 className="text-lg font-bold text-gray-800 mb-1">{title}</h3>
      <p className="text-sm text-gray-600 mb-4">{description}</p>

      {process.env.NODE_ENV === 'development' && error && (
        <p className="text-xs text-red-500 mb-4 font-mono">{error.message}</p>
      )}

      {onRetry && (
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={onRetry}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium"
        >
          다시 시도
        </motion.button>
      )}
    </div>
  );
}

// ============================================================
// 섹션 에러 바운더리 (작은 영역용)
// ============================================================

interface SectionErrorBoundaryProps {
  children: ReactNode;
  /** 에러 시 표시할 메시지 */
  errorMessage?: string;
}

export function SectionErrorBoundary({
  children,
  errorMessage = '이 섹션을 불러올 수 없습니다.',
}: SectionErrorBoundaryProps) {
  return (
    <ErrorBoundary
      fallback={
        <div className="bg-gray-100 rounded-xl p-4 text-center">
          <span className="text-2xl mb-2 block">😅</span>
          <p className="text-sm text-gray-600">{errorMessage}</p>
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}

export default ErrorBoundary;
