/**
 * 인증 페이지 공통 레이아웃
 *
 * 배경(비디오): position fixed → 화면 전체 커버 (safe area 뒤까지)
 * 콘텐츠: normal flow + min-height dvh + safe area 패딩
 */

'use client';

import { useEffect } from 'react';
import Image from 'next/image';
import { lockScroll, unlockScroll } from '@/lib/utils/scrollLock';
import { useKeyboardCSSVariable } from '@/lib/hooks/useKeyboardAware';
import { useWideMode } from '@/lib/hooks/useViewportScale';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  // Auth 페이지: 스크롤 방지
  useEffect(() => {
    lockScroll();
    return () => unlockScroll();
  }, []);

  // --kb-offset CSS 변수 설정 (로그인 키보드 대응)
  useKeyboardCSSVariable();
  const isWide = useWideMode();

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
          minHeight: '100dvh',
          zIndex: 0,
          backgroundColor: '#000',
          overflow: 'hidden',
        }}
      >
        {isWide ? (
          // 가로모드: 정적 이미지 배경
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/images/home-wide.png"
            alt=""
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        ) : (
          // 세로모드: 비디오 배경
          <video
            autoPlay
            loop
            muted
            playsInline
            poster="/images/home-bg.jpg"
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
        )}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            // 가로모드: 오버레이 약간 진하게 → 폼 가독성 향상
            backgroundColor: isWide ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.2)',
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
