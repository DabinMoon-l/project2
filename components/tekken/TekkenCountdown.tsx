'use client';

/**
 * 3-2-1 FIGHT 카운트다운
 *
 * 부모 컨테이너 내부에서 전체 영역 차지
 */

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface TekkenCountdownProps {
  onComplete: () => void;
}

export default function TekkenCountdown({ onComplete }: TekkenCountdownProps) {
  const [count, setCount] = useState(3);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (count === 0) {
      const timer = setTimeout(() => onCompleteRef.current(), 800);
      return () => clearTimeout(timer);
    }

    const timer = setTimeout(() => {
      setCount((prev) => prev - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [count]);

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
