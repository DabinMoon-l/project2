/**
 * 인증 페이지 공통 레이아웃
 *
 * 로그인/회원가입/비밀번호찾기에서 비디오 배경과 코너 이미지를
 * 공유하여 페이지 전환 시 깜빡임 방지
 *
 * 모든 위치/크기를 인라인 스타일로 지정 (CSS shorthand 호환성 이슈 방지)
 */

import Image from 'next/image';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        overflow: 'hidden',
        backgroundColor: '#000',
      }}
    >
      {/* 비디오 배경 */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}>
        <video
          autoPlay
          loop
          muted
          playsInline
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        >
          <source src="/videos/login-bg.mp4" type="video/mp4" />
        </video>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.2)' }} />
      </div>

      {/* 콘텐츠 영역 */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          paddingTop: 'env(safe-area-inset-top, 0px)',
        }}
      >
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
