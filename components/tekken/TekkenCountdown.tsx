'use client';

/**
 * 3-2-1 FIGHT 카운트다운
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface TekkenCountdownProps {
  onComplete: () => void;
}

export default function TekkenCountdown({ onComplete }: TekkenCountdownProps) {
  const [count, setCount] = useState(3);

  useEffect(() => {
    if (count === 0) {
      const timer = setTimeout(onComplete, 800);
      return () => clearTimeout(timer);
    }

    const timer = setTimeout(() => {
      setCount((prev) => prev - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [count, onComplete]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <AnimatePresence mode="wait">
        <motion.div
          key={count}
          initial={{ scale: 3, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.5, opacity: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="text-center"
        >
          {count > 0 ? (
            <span className="text-[120px] font-black text-white drop-shadow-[0_4px_20px_rgba(255,100,100,0.5)]">
              {count}
            </span>
          ) : (
            <span className="text-[80px] font-black text-red-400 drop-shadow-[0_4px_20px_rgba(255,100,100,0.5)]">
              FIGHT!
            </span>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
