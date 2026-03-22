'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWideMode } from '@/lib/hooks/useViewportScale';

interface SplashScreenProps {
  children: React.ReactNode;
}

/**
 * 스플래시 화면 컴포넌트
 * 앱 진입 시 2.5초간 로고를 보여주고 메인 콘텐츠로 전환
 * 가로모드(태블릿): 스플래시 건너뛰기
 */
export default function SplashScreen({ children }: SplashScreenProps) {
  const [showSplash, setShowSplash] = useState(true);
  const [isClient, setIsClient] = useState(false);
  const isWide = useWideMode();

  useEffect(() => {
    setIsClient(true);

    // 가로모드: 스플래시 즉시 건너뛰기
    if (window.matchMedia('(orientation: landscape) and (min-width: 1024px)').matches) {
      setShowSplash(false);
      return;
    }

    const timer = setTimeout(() => {
      setShowSplash(false);
    }, 3000);

    return () => clearTimeout(timer);
  }, []);

  // 스플래시 중 가로 전환 시에도 즉시 닫기
  useEffect(() => {
    if (isWide && showSplash) setShowSplash(false);
  }, [isWide, showSplash]);

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
