/**
 * 인증 페이지 공통 레이아웃
 *
 * 배경(비디오): position fixed → 화면 전체 커버 (safe area 뒤까지)
 * 콘텐츠: normal flow + min-height dvh + safe area 패딩
 */

'use client';

import { useEffect } from 'react';
import Image from 'next/image';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  // Auth 페이지: body 배경 검정 + 스크롤 방지
  useEffect(() => {
    const prevBg = document.body.style.backgroundColor;
    const prevOverflow = document.body.style.overflow;
    document.body.style.backgroundColor = '#000';
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.backgroundColor = prevBg;
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  return (
    <>
      {/* 비디오 배경 — fixed로 전체 물리 화면 커버 */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 0,
          backgroundColor: '#000',
          overflow: 'hidden',
        }}
      >
        <video
          autoPlay
          loop
          muted
          playsInline
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        >
          <source src="/videos/login-bg.mp4" type="video/mp4" />
        </video>
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(0,0,0,0.2)',
          }}
        />
      </div>

      {/* 콘텐츠 — normal flow, 배경 위에 표시 */}
      <div className="auth-content">
        {/* 좌측 상단 장식 이미지 */}
        <div style={{ position: 'absolute', top: 64, left: 32, zIndex: 10 }}>
          <Image
            src="/images/corner-image.png"
            alt="장식 이미지"
            width={180}
            height={90}
            style={{ width: 'auto', height: 'auto', maxWidth: '46vw' }}
            className="drop-shadow-lg"
          />
        </div>

        {children}
      </div>
    </>
  );
}
