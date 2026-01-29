'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import dynamic from 'next/dynamic';

// Lottie 동적 import (클라이언트 전용)
const Lottie = dynamic(() => import('lottie-react'), { ssr: false });

/**
 * ResultHeader Props 타입
 */
interface ResultHeaderProps {
  /** 퀴즈 제목 */
  title?: string;
  /** 획득 골드 */
  earnedGold: number;
  /** 획득 경험치 */
  earnedExp: number;
  /** 만점 여부 (축하 애니메이션 표시) */
  isPerfectScore?: boolean;
  /** 추가 클래스명 */
  className?: string;
}

// 축하 애니메이션 (만점 시 표시)
// 실제 Lottie JSON이 없을 경우를 대비한 더미 애니메이션 데이터
const celebrationAnimation = {
  v: '5.7.4',
  fr: 30,
  ip: 0,
  op: 60,
  w: 200,
  h: 200,
  nm: 'Celebration',
  layers: [
    {
      ddd: 0,
      ind: 1,
      ty: 4,
      nm: 'Star',
      ks: {
        o: { a: 1, k: [{ t: 0, s: [100] }, { t: 30, s: [100] }, { t: 60, s: [0] }] },
        r: { a: 1, k: [{ t: 0, s: [0] }, { t: 60, s: [360] }] },
        p: { a: 0, k: [100, 100] },
        s: { a: 1, k: [{ t: 0, s: [0, 0] }, { t: 15, s: [120, 120] }, { t: 60, s: [100, 100] }] },
      },
      shapes: [
        {
          ty: 'sr',
          sy: 1,
          d: 1,
          pt: { a: 0, k: 5 },
          p: { a: 0, k: [0, 0] },
          r: { a: 0, k: 0 },
          ir: { a: 0, k: 20 },
          is: { a: 0, k: 0 },
          or: { a: 0, k: 50 },
          os: { a: 0, k: 0 },
        },
        {
          ty: 'fl',
          c: { a: 0, k: [1, 0.84, 0, 1] },
          o: { a: 0, k: 100 },
        },
      ],
    },
  ],
};

/**
 * 결과 헤더 컴포넌트
 *
 * 퀴즈 완료 후 표시되는 헤더로, 제목과 획득 보상을 보여줍니다.
 * 만점일 경우 축하 애니메이션이 재생됩니다.
 *
 * @example
 * ```tsx
 * <ResultHeader
 *   title="1주차 복습 퀴즈"
 *   earnedGold={70}
 *   earnedExp={50}
 *   isPerfectScore={true}
 * />
 * ```
 */
export default function ResultHeader({
  title,
  earnedGold,
  earnedExp,
  isPerfectScore = false,
  className = '',
}: ResultHeaderProps) {
  const [showCelebration, setShowCelebration] = useState(false);

  // 만점일 경우 축하 애니메이션 표시
  useEffect(() => {
    if (isPerfectScore) {
      setShowCelebration(true);
      // 애니메이션 종료 후 숨김
      const timer = setTimeout(() => {
        setShowCelebration(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [isPerfectScore]);

  return (
    <div className={`relative text-center py-6 ${className}`}>
      {/* 만점 축하 애니메이션 */}
      {showCelebration && (
        <div className="absolute inset-0 pointer-events-none z-10 flex items-center justify-center">
          <div className="w-64 h-64">
            <Lottie
              animationData={celebrationAnimation}
              loop={false}
              autoplay={true}
            />
          </div>
        </div>
      )}

      {/* 헤더 컨텐츠 */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      >
        {/* 완료 이모지 */}
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{
            delay: 0.2,
            type: 'spring',
            stiffness: 300,
            damping: 15
          }}
          className="text-5xl mb-3"
        >
          {isPerfectScore ? '🎉' : '✨'}
        </motion.div>

        {/* 완료 메시지 */}
        <motion.h1
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="text-2xl font-bold text-gray-900 mb-1"
        >
          {isPerfectScore ? '만점!' : '퀴즈 완료!'}
        </motion.h1>

        {/* 퀴즈 제목 */}
        {title && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="text-sm text-gray-500 mb-4"
          >
            {title}
          </motion.p>
        )}

        {/* 획득 보상 */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="flex items-center justify-center gap-4"
        >
          {/* 골드 */}
          <div className="flex items-center gap-1 bg-yellow-50 px-3 py-1.5 rounded-full">
            <span className="text-lg">💰</span>
            <span className="text-sm font-bold text-yellow-700">
              +{earnedGold}
            </span>
          </div>

          {/* 경험치 */}
          <div className="flex items-center gap-1 bg-purple-50 px-3 py-1.5 rounded-full">
            <span className="text-lg">⭐</span>
            <span className="text-sm font-bold text-purple-700">
              +{earnedExp} EXP
            </span>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
