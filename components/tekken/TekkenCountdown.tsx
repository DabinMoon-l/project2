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

  // 클라이언트 전용 카운트다운 (서버 타임스탬프 없을 때)
  useEffect(() => {
    if (countdownStartedAt) return; // 서버 경로 사용 시 스킵

    if (count === 0) {
      const timer = setTimeout(() => {
        if (!completedRef.current) {
          completedRef.current = true;
          onCompleteRef.current();
        }
      }, 800);
      return () => clearTimeout(timer);
    }

    const timer = setTimeout(() => {
      setCount((prev) => prev - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [count, countdownStartedAt]);

  // 서버 타임스탬프 기반 카운트다운
  useEffect(() => {
    if (!countdownStartedAt) return; // 서버 타임스탬프 없으면 스킵

    let completeTimer: ReturnType<typeof setTimeout> | null = null;

    const tick = () => {
      const elapsed = Date.now() - countdownStartedAt;
      const remaining = Math.max(0, 3000 - elapsed);
      const newCount = Math.ceil(remaining / 1000);

      setCount(newCount);

      if (remaining <= 0 && !completedRef.current) {
        completedRef.current = true;
        completeTimer = setTimeout(() => onCompleteRef.current(), 800);
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
