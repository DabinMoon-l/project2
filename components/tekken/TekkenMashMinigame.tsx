'use client';

/**
 * 연타 미니게임 — 땅따먹기 게이지
 *
 * 퀴즈 영역 크기 컴포넌트 (fixed 제거)
 * 한 줄 바: 왼=나(채도 낮은 빨강), 우=상대(채도 낮은 파랑)
 * 50:50 시작, 연타 속도에 따라 비율 변동
 * 3초 제한
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
    if (navigator.vibrate) navigator.vibrate(10);
  }, [submitted, timeLeft]);

  // 50:50 시작, 내 탭으로 비율 이동 (30탭 기준으로 한쪽 끝 도달)
  // myPercent: 0(상대 완승) ~ 100(내 완승), 50이 균형
  const myPercent = Math.min(100, Math.max(0, 50 + (taps / 30) * 50));

  return (
    <div className="w-full px-4 flex-1 flex flex-col items-center justify-center">
      {/* 제목 */}
      <div className="text-center mb-5">
        <h2 className="text-2xl font-black text-white mb-1">
          연타 배틀!
        </h2>
        <p className="text-sm text-white/60">
          {isMyFault ? '오답 패널티! 버튼을 연타하세요!' : '보너스 찬스! 버튼을 연타하세요!'}
        </p>
      </div>

      {/* 땅따먹기 게이지 */}
      <div className="w-full max-w-xs mb-3">
        {/* 라벨 */}
        <div className="flex justify-between mb-1">
          <span className="text-xs font-bold text-[#C06060]">나</span>
          <span className="text-xs font-bold text-[#6060A0]">상대</span>
        </div>

        {/* 게이지 바 */}
        <div className="h-8 rounded-full overflow-hidden border-2 border-white/20 relative bg-[#6060A0]">
          <motion.div
            className="h-full rounded-full bg-[#C06060]"
            initial={{ width: '50%' }}
            animate={{ width: `${myPercent}%` }}
            transition={{ duration: 0.08 }}
          />
          {/* 중앙 기준선 */}
          <div className="absolute top-0 left-1/2 -translate-x-px h-full w-0.5 bg-white/30" />
        </div>

        {/* 탭 수 + 타이머 */}
        <div className="flex justify-between mt-1.5">
          <span className="text-sm font-bold text-white/60">{taps}탭</span>
          <span className={`text-sm font-bold ${timeLeft < 1000 ? 'text-red-400' : 'text-white/60'}`}>
            {(timeLeft / 1000).toFixed(1)}초
          </span>
        </div>
      </div>

      {/* 연타 버튼 */}
      <motion.button
        onClick={handleTap}
        onTouchStart={(e) => {
          e.preventDefault();
          handleTap();
        }}
        className="w-44 h-20 rounded-2xl bg-white/10 border-2 border-white/20 flex items-center justify-center active:scale-90 transition-transform backdrop-blur-sm"
        whileTap={{ scale: 0.9 }}
        disabled={submitted}
      >
        <span className="text-3xl font-black text-white">
          {submitted ? '대기 중...' : '연타!'}
        </span>
      </motion.button>
    </div>
  );
}
