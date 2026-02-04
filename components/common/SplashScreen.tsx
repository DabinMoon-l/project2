'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';

interface SplashScreenProps {
  children: React.ReactNode;
}

/**
 * 스플래시 화면 컴포넌트
 * 앱 진입 시 2.5초간 로고를 보여주고 메인 콘텐츠로 전환
 */
export default function SplashScreen({ children }: SplashScreenProps) {
  const [showSplash, setShowSplash] = useState(true);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);

    // 3초 후 스플래시 화면 숨기기
    const timer = setTimeout(() => {
      setShowSplash(false);
    }, 3000);

    return () => clearTimeout(timer);
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
            className="fixed inset-0 z-[9999] flex flex-col items-center"
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

            {/* 로고 - 상단에서 30% 위치 */}
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{
                duration: 0.6,
                ease: [0.34, 1.56, 0.64, 1], // 바운스 효과
                delay: 0.2
              }}
              className="relative z-10 mt-[25vh]"
            >
              <Image
                src="/images/logo.png"
                alt="QuizBunny"
                width={360}
                height={360}
                priority
                className="drop-shadow-2xl"
                style={{ width: 'auto', height: 'auto' }}
              />
            </motion.div>

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

      {/* 메인 콘텐츠 */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: showSplash ? 0 : 1 }}
        transition={{ duration: 0.3, delay: showSplash ? 0 : 0.2 }}
      >
        {children}
      </motion.div>
    </>
  );
}
