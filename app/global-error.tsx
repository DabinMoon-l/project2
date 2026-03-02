'use client';

/**
 * 전역 에러 바운더리
 * 루트 레이아웃 포함 최상위 에러를 잡아 하얀 화면 방지
 */

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('전역 에러:', error);
  }, [error]);

  return (
    <html lang="ko">
      <body
        style={{
          margin: 0,
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
          앱에 문제가 생겼습니다. 새로고침해 주세요.
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
          새로고침
        </button>
      </body>
    </html>
  );
}
