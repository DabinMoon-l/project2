'use client';

/**
 * 메인 라우트 에러 바운더리
 * 컴포넌트 에러 시 하얀 화면 대신 안내 UI 표시
 */

import { useEffect } from 'react';

export default function MainError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('메인 라우트 에러:', error);
  }, [error]);

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#F5F0E8',
        color: '#1A1A1A',
        padding: '2rem',
        fontFamily: 'Noto Sans KR, sans-serif',
      }}
    >
      <h2
        style={{
          fontFamily: 'Playfair Display, serif',
          fontSize: '1.5rem',
          marginBottom: '0.75rem',
        }}
      >
        오류가 발생했습니다
      </h2>
      <p
        style={{
          color: '#5C5C5C',
          fontSize: '0.95rem',
          marginBottom: '1.5rem',
          textAlign: 'center',
        }}
      >
        일시적인 문제일 수 있습니다. 아래 버튼을 눌러 다시 시도해 주세요.
      </p>
      <button
        onClick={reset}
        style={{
          padding: '0.625rem 1.5rem',
          backgroundColor: '#1A1A1A',
          color: '#F5F0E8',
          border: 'none',
          borderRadius: '6px',
          fontSize: '0.95rem',
          cursor: 'pointer',
          fontFamily: 'Noto Sans KR, sans-serif',
        }}
      >
        다시 시도
      </button>
    </div>
  );
}
