/**
 * 인증 페이지 공통 레이아웃
 *
 * 로그인/회원가입/비밀번호찾기에서 비디오 배경과 코너 이미지를
 * 공유하여 페이지 전환 시 깜빡임 방지
 *
 * fixed inset-0: 비디오가 노치 영역까지 덮고, 키보드가 올라와도 스크롤 방지
 */

import Image from 'next/image';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 overflow-hidden">
      {/* 비디오 배경 — 노치 영역까지 덮음 */}
      <div className="absolute inset-0 overflow-hidden">
        <video
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
        >
          <source src="/videos/login-bg.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-black/20" />
      </div>

      {/* 콘텐츠 영역 — safe area 패딩 적용 */}
      <div
        className="absolute inset-0 flex flex-col items-center justify-center"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        {/* 좌측 상단 장식 이미지 */}
        <div className="absolute left-8 z-10" style={{ top: 'clamp(40px, 8dvh, 68px)' }}>
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
