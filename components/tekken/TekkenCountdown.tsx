'use client';

/**
 * 3-2-1 FIGHT 카운트다운
 *
 * 서버 타임스탬프 기반 동기화
 * countdownStartedAt이 있으면 경과 시간 기반으로 카운트 계산
 */

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface TekkenCountdownProps {
  onComplete: () => void;
  countdownStartedAt?: number;
}

export default function TekkenCountdown({ onComplete, countdownStartedAt }: TekkenCountdownProps) {
  const [count, setCount] = useState(3);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const completedRef = useRef(false);
  // 컴포넌트 마운트 시점 기록 — 서버 시간이 이미 지났으면 마운트 시점 기준으로 카운트다운
  const mountTimeRef = useRef(Date.now());

  useEffect(() => {
    let completeTimer: ReturnType<typeof setTimeout> | null = null;

    // 서버 타임스탬프가 있으면 사용하되, 이미 지났으면 마운트 시점 기준
    const effectiveStart = countdownStartedAt
      ? Math.max(countdownStartedAt, mountTimeRef.current)
      : mountTimeRef.current;

    const tick = () => {
      const elapsed = Math.max(0, Date.now() - effectiveStart);
      const remaining = Math.max(0, 3000 - elapsed);
      const newCount = Math.ceil(remaining / 1000);

      setCount(newCount);

      if (remaining <= 0 && !completedRef.current) {
        completedRef.current = true;
        completeTimer = setTimeout(() => onCompleteRef.current(), 500);
      }
    };

    tick();
    const timer = setInterval(tick, 50);
    return () => {
      clearInterval(timer);
      if (completeTimer) clearTimeout(completeTimer);
    };
  }, [countdownStartedAt]);

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center">
      <AnimatePresence mode="wait">
        <motion.div
          key={count}
          initial={{ scale: 2.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.5, opacity: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className="text-center"
        >
          {count > 0 ? (
            <span className="text-[80px] font-black text-white drop-shadow-[0_4px_16px_rgba(255,100,100,0.5)]">
              {count}
            </span>
          ) : (
            <span className="text-[56px] font-black text-red-400 drop-shadow-[0_4px_16px_rgba(255,100,100,0.5)]">
              FIGHT!
            </span>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
