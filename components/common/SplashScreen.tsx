'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface SplashScreenProps {
  children: React.ReactNode;
}

/**
 * 스플래시 화면 컴포넌트
 * 앱 진입 시 2.5초간 로고를 보여주고 메인 콘텐츠로 전환
 */
/**
 * 스플래시 표시 여부 판별
 * - PWA 재활성화(메모리 킬 후 복원)에서는 건너뛰기
 * - 완전히 새로 연 경우만 표시
 */
function shouldShowSplash(): boolean {
  if (typeof window === 'undefined') return false;
  // 이미 로그인된 상태(Firebase IndexedDB 캐시)면 재활성화 → 스킵
  if (document.cookie.includes('firebase') || localStorage.getItem('firebase:host:')) return false;
  // performance.navigation으로 리로드 감지
  if (performance?.navigation?.type === 1) return false;
  // PWA standalone에서 visibilityState가 hidden→visible 전환이면 재활성화
  if (document.visibilityState === 'hidden') return false;
  // sessionStorage에 앱 사용 흔적이 있으면 재활성화
  if (sessionStorage.length > 0) return false;
  return true;
}

export default function SplashScreen({ children }: SplashScreenProps) {
  const [showSplash, setShowSplash] = useState(false);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
    const show = shouldShowSplash();
    if (show) {
      setShowSplash(true);
      const timer = setTimeout(() => setShowSplash(false), 3000);
      return () => clearTimeout(timer);
    }
  }, []);

  // 서버 사이드 렌더링 중에는 children만 렌더링
  if (!isClient) {
    return <>{children}</>;
  }

  return (
    <>
      <AnimatePresence mode="wait">
        {showSplash && (
          <motion.div
            key="splash"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className="fixed inset-0 z-[9999] flex flex-col items-center bg-black"
            style={{ minHeight: '100dvh' }}
          >
            {/* 비디오 배경 */}
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
              {/* 어두운 오버레이 */}
              <div className="absolute inset-0 bg-black/40" />
            </div>

            {/* 로딩 인디케이터 */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.8 }}
              className="absolute bottom-20 left-1/2 -translate-x-1/2"
            >
              <div className="flex gap-1.5">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="w-2 h-2 rounded-full bg-white"
                    animate={{
                      scale: [1, 1.2, 1],
                      opacity: [0.5, 1, 0.5],
                    }}
                    transition={{
                      duration: 0.8,
                      repeat: Infinity,
                      delay: i * 0.15,
                    }}
                  />
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 메인 콘텐츠 — plain div 사용 (motion.div는 transform을 적용해 fixed 자식의 기준점을 깨뜨림) */}
      <div
        style={{
          opacity: showSplash ? 0 : 1,
          transition: showSplash ? 'none' : 'opacity 0.3s ease 0.2s',
        }}
      >
        {children}
      </div>
    </>
  );
}
