/**
 * 오프라인 상태 배너
 *
 * 네트워크 연결이 끊기면 상단에 배너를 표시하고,
 * 복귀하면 잠깐 "다시 연결됨" 메시지 후 사라짐
 */

'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useOnlineStatus } from '@/lib/hooks/useOnlineStatus';

export default function OfflineBanner() {
  const isOnline = useOnlineStatus();
  const [show, setShow] = useState(false);
  const [reconnected, setReconnected] = useState(false);
  const wasOfflineRef = useRef(false);

  useEffect(() => {
    if (!isOnline) {
      // 오프라인 전환
      setShow(true);
      setReconnected(false);
      wasOfflineRef.current = true;
    } else if (wasOfflineRef.current) {
      // 오프라인→온라인 복귀
      setReconnected(true);
      wasOfflineRef.current = false;
      // 2초 후 배너 숨김
      const timer = setTimeout(() => {
        setShow(false);
        setReconnected(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isOnline]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className={`fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center py-1.5 text-xs font-bold text-white ${
            reconnected
              ? 'bg-green-600'
              : 'bg-[#5C5C5C]'
          }`}
          style={{ paddingTop: 'max(6px, env(safe-area-inset-top))' }}
        >
          {reconnected ? (
            <span className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              다시 연결됨
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728M5.636 18.364a9 9 0 010-12.728" />
                <line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
              </svg>
              오프라인 모드 — 일부 기능이 제한됩니다
            </span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
