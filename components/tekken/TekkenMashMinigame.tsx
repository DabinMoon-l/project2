'use client';

/**
 * 연타 미니게임 — tug-of-war 게이지
 *
 * 3초간 화면 터치/클릭으로 탭 수 카운트
 * 양쪽 탭 수 비교하여 게이지 이동
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';

interface TekkenMashMinigameProps {
  endsAt: number;
  triggeredBy: string; // 오답 낸 사람
  userId: string;
  onSubmit: (taps: number) => void;
}

export default function TekkenMashMinigame({
  endsAt,
  triggeredBy,
  userId,
  onSubmit,
}: TekkenMashMinigameProps) {
  const [taps, setTaps] = useState(0);
  const [timeLeft, setTimeLeft] = useState(3000);
  const [submitted, setSubmitted] = useState(false);
  const tapsRef = useRef(0);
  const isMyFault = triggeredBy === userId;

  // 타이머
  useEffect(() => {
    const tick = setInterval(() => {
      const remaining = Math.max(0, endsAt - Date.now());
      setTimeLeft(remaining);

      if (remaining === 0 && !submitted) {
        setSubmitted(true);
        onSubmit(tapsRef.current);
      }
    }, 50);

    return () => clearInterval(tick);
  }, [endsAt, submitted, onSubmit]);

  // 탭 핸들러
  const handleTap = useCallback(() => {
    if (submitted || timeLeft <= 0) return;
    tapsRef.current += 1;
    setTaps(tapsRef.current);
    // 햅틱
    if (navigator.vibrate) navigator.vibrate(10);
  }, [submitted, timeLeft]);

  const progress = Math.min(100, (taps / 30) * 100); // 30탭 기준 100%

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-black text-white mb-1">
          연타 배틀!
        </h2>
        <p className="text-sm text-white/60">
          {isMyFault ? '오답 패널티! 화면을 연타하세요!' : '보너스 찬스! 화면을 연타하세요!'}
        </p>
      </div>

      {/* 게이지 */}
      <div className="w-[80%] max-w-xs mb-8">
        <div className="h-8 bg-black/40 rounded-full overflow-hidden border-2 border-white/20">
          <motion.div
            className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full"
            initial={false}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.1 }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-sm font-bold text-white/60">{taps}탭</span>
          <span className={`text-sm font-bold ${timeLeft < 1000 ? 'text-red-400' : 'text-white/60'}`}>
            {(timeLeft / 1000).toFixed(1)}초
          </span>
        </div>
      </div>

      {/* 탭 영역 */}
      <motion.button
        onClick={handleTap}
        onTouchStart={(e) => {
          e.preventDefault();
          handleTap();
        }}
        className="w-40 h-40 rounded-full bg-red-500/30 border-4 border-red-400/50 flex items-center justify-center active:scale-90 transition-transform"
        whileTap={{ scale: 0.9 }}
        disabled={submitted}
      >
        <span className="text-5xl font-black text-white">
          {submitted ? '!' : '👊'}
        </span>
      </motion.button>

      {submitted && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-lg font-bold text-white/70 mt-4"
        >
          결과 대기 중...
        </motion.p>
      )}
    </div>
  );
}
