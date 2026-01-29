'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ONBOARDING_STEPS } from '@/components/onboarding/StepIndicator';

/**
 * 온보딩 메인 페이지
 * 사용자를 첫 번째 온보딩 단계로 리다이렉트합니다.
 */
export default function OnboardingPage() {
  const router = useRouter();

  useEffect(() => {
    // 약간의 딜레이 후 첫 번째 단계로 이동
    const timer = setTimeout(() => {
      router.push(ONBOARDING_STEPS[0].path);
    }, 1500);

    return () => clearTimeout(timer);
  }, [router]);

  return (
    <div className="min-h-screen bg-[var(--theme-background)] flex flex-col items-center justify-center p-6">
      {/* 로딩 애니메이션 */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="text-center"
      >
        {/* 용사 아이콘 */}
        <motion.div
          className="w-24 h-24 mx-auto mb-6 rounded-full bg-[var(--theme-accent)] flex items-center justify-center"
          animate={{
            scale: [1, 1.1, 1],
            rotate: [0, 5, -5, 0],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        >
          <svg
            className="w-12 h-12 text-white"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
            />
          </svg>
        </motion.div>

        {/* 타이틀 */}
        <motion.h1
          className="text-2xl font-bold text-[var(--theme-text)] mb-3"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          용사의 여정을 시작합니다
        </motion.h1>

        {/* 설명 */}
        <motion.p
          className="text-[var(--theme-text-secondary)] mb-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          잠시만 기다려주세요...
        </motion.p>

        {/* 로딩 도트 */}
        <div className="flex justify-center gap-2">
          {[0, 1, 2].map((index) => (
            <motion.div
              key={index}
              className="w-3 h-3 rounded-full bg-[var(--theme-accent)]"
              animate={{
                y: [0, -10, 0],
                opacity: [0.5, 1, 0.5],
              }}
              transition={{
                duration: 0.8,
                repeat: Infinity,
                delay: index * 0.15,
              }}
            />
          ))}
        </div>
      </motion.div>
    </div>
  );
}
