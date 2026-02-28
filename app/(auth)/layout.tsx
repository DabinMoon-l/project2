/**
 * 인증 페이지 공통 레이아웃
 *
 * fixed 대신 일반 플로우 래퍼 + min-height dvh 폴백 체인
 * 배경(비디오)은 safe area 무시하고 전체 커버
 * 콘텐츠만 safe area 패딩 적용
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
    <div className="auth-viewport">
      {/* 비디오 배경 — 래퍼 전체 커버 (safe area 포함) */}
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
      {/* 어두운 오버레이 */}
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

      {/* 콘텐츠 영역 — safe area 패딩 적용 */}
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
    </div>
  );
}
