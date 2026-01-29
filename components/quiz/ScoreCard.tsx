'use client';

import { useEffect, useState } from 'react';
import { motion, useAnimation } from 'framer-motion';

/**
 * ScoreCard Props 타입
 */
interface ScoreCardProps {
  /** 정답 수 */
  correctCount: number;
  /** 총 문제 수 */
  totalCount: number;
  /** 획득 골드 */
  earnedGold: number;
  /** 소요 시간 (초) */
  timeSpentSeconds: number;
  /** 추가 클래스명 */
  className?: string;
}

/**
 * 시간 포맷팅 함수
 * @param seconds 초 단위 시간
 * @returns "X분 Y초" 형식 문자열
 */
function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes === 0) {
    return `${remainingSeconds}초`;
  }

  return `${minutes}분 ${remainingSeconds}초`;
}

/**
 * 점수 카드 컴포넌트
 *
 * 퀴즈 결과에서 점수, 획득 골드, 소요 시간을 표시합니다.
 * 점수는 줌아웃 애니메이션과 함께 카운트업 효과로 표시됩니다.
 *
 * @example
 * ```tsx
 * <ScoreCard
 *   correctCount={8}
 *   totalCount={10}
 *   earnedGold={70}
 *   timeSpentSeconds={332}
 * />
 * ```
 */
export default function ScoreCard({
  correctCount,
  totalCount,
  earnedGold,
  timeSpentSeconds,
  className = '',
}: ScoreCardProps) {
  const [displayCount, setDisplayCount] = useState(0);
  const controls = useAnimation();

  // 점수 카운트업 애니메이션
  useEffect(() => {
    let frame: number;
    const duration = 1000; // 1초
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // easeOut 함수 적용
      const easeProgress = 1 - Math.pow(1 - progress, 3);
      const currentCount = Math.round(easeProgress * correctCount);

      setDisplayCount(currentCount);

      if (progress < 1) {
        frame = requestAnimationFrame(animate);
      }
    };

    // 초기 애니메이션 시작 딜레이
    const timeout = setTimeout(() => {
      frame = requestAnimationFrame(animate);
    }, 500);

    return () => {
      clearTimeout(timeout);
      cancelAnimationFrame(frame);
    };
  }, [correctCount]);

  // 카드 애니메이션 실행
  useEffect(() => {
    controls.start({
      scale: [0.8, 1.05, 1],
      opacity: [0, 1, 1],
      transition: {
        duration: 0.6,
        times: [0, 0.7, 1],
        ease: 'easeOut',
      },
    });
  }, [controls]);

  // 점수 비율에 따른 색상
  const scoreRatio = correctCount / totalCount;
  const getScoreColor = () => {
    if (scoreRatio >= 0.9) return 'text-green-600';
    if (scoreRatio >= 0.7) return 'text-blue-600';
    if (scoreRatio >= 0.5) return 'text-yellow-600';
    return 'text-red-600';
  };

  // 점수 비율에 따른 배경 그라데이션
  const getBackgroundGradient = () => {
    if (scoreRatio >= 0.9) return 'from-green-50 to-emerald-50';
    if (scoreRatio >= 0.7) return 'from-blue-50 to-indigo-50';
    if (scoreRatio >= 0.5) return 'from-yellow-50 to-amber-50';
    return 'from-red-50 to-orange-50';
  };

  return (
    <motion.div
      animate={controls}
      className={`
        relative overflow-hidden
        bg-gradient-to-br ${getBackgroundGradient()}
        rounded-3xl p-6 shadow-lg
        ${className}
      `}
    >
      {/* 배경 장식 */}
      <div className="absolute -right-6 -top-6 w-24 h-24 bg-white/30 rounded-full blur-2xl" />
      <div className="absolute -left-6 -bottom-6 w-32 h-32 bg-white/20 rounded-full blur-3xl" />

      {/* 점수 영역 */}
      <div className="relative text-center mb-6">
        <div className="flex items-baseline justify-center gap-1">
          {/* 정답 수 */}
          <motion.span
            className={`text-6xl font-black ${getScoreColor()}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            {displayCount}
          </motion.span>

          {/* 구분자 */}
          <span className="text-3xl text-gray-400 font-light mx-1">/</span>

          {/* 총 문제 수 */}
          <motion.span
            className="text-3xl font-bold text-gray-500"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            {totalCount}
          </motion.span>
        </div>

        {/* 백분율 */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
          className={`text-lg font-semibold mt-2 ${getScoreColor()}`}
        >
          {Math.round(scoreRatio * 100)}점
        </motion.p>
      </div>

      {/* 획득 정보 영역 */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8 }}
        className="flex items-center justify-center gap-6"
      >
        {/* 획득 골드 */}
        <div className="flex items-center gap-2 bg-white/60 backdrop-blur-sm px-4 py-2 rounded-xl">
          <span className="text-2xl">💰</span>
          <span className="text-lg font-bold text-yellow-700">
            +{earnedGold}
          </span>
        </div>

        {/* 소요 시간 */}
        <div className="flex items-center gap-2 bg-white/60 backdrop-blur-sm px-4 py-2 rounded-xl">
          <span className="text-2xl">⏱</span>
          <span className="text-lg font-bold text-gray-700">
            {formatTime(timeSpentSeconds)}
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
}
