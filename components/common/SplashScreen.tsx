'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWideMode } from '@/lib/hooks/useViewportScale';

interface SplashScreenProps {
  children: React.ReactNode;
}

/**
 * 스플래시 화면 컴포넌트
 * - PC 환경(hover+fine pointer 또는 1024px+ landscape): 항상 건너뛰기
 * - 모바일: localStorage(`splash_seen`) 기록 후 첫 진입에만 표시 — 새로고침·재방문 시엔 즉시 건너뛰기
 */
const SPLASH_SEEN_KEY = 'splash_seen_v1';

export default function SplashScreen({ children }: SplashScreenProps) {
  // 첫 렌더부터 결정: SSR 중에는 항상 false(스플래시 안 보임), 클라이언트 마운트 시 조건 평가
  const [showSplash, setShowSplash] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const isWide = useWideMode();

  useEffect(() => {
    setIsClient(true);

    // PC 환경 식별: 큰 가로 화면(태블릿/데스크탑) 또는 마우스 hover가 가능한 환경
    const isLandscapeLarge = window.matchMedia('(orientation: landscape) and (min-width: 1024px)').matches;
    const isDesktopInput = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (isLandscapeLarge || isDesktopInput) {
      // PC: 항상 건너뛰기
      return;
    }

    // 모바일: 이미 본 적 있으면 건너뛰기
    try {
      if (localStorage.getItem(SPLASH_SEEN_KEY)) {
        return;
      }
      // 첫 진입 — 스플래시 표시 + 본 기록 저장
      localStorage.setItem(SPLASH_SEEN_KEY, String(Date.now()));
    } catch {
      // localStorage 접근 불가(시크릿 모드 등) — 그대로 표시
    }

    setShowSplash(true);
    const timer = setTimeout(() => {
      setShowSplash(false);
    }, 3000);

    return () => clearTimeout(timer);
  }, []);

  // 스플래시 중 가로 전환 시에도 즉시 닫기
  useEffect(() => {
    if (isWide && showSplash) setShowSplash(false);
  }, [isWide, showSplash]);

  // 서버 사이드 렌더링 중이거나 스플래시 자체가 비활성(PC 또는 재방문 모바일)이면 children만 즉시 렌더링
  if (!isClient || !showSplash) {
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
