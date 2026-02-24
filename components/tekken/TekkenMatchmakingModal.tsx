'use client';

/**
 * 매칭 대기 모달
 *
 * portal → body로 렌더링 (z-index 우회)
 * 매칭 중 애니메이션 + 대기 시간 표시
 */

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import type { MatchState } from '@/lib/types/tekken';

interface TekkenMatchmakingModalProps {
  isOpen: boolean;
  onClose: () => void;
  matchState: MatchState;
  waitTime: number;
  error: string | null;
  onCancel: () => void;
}

export default function TekkenMatchmakingModal({
  isOpen,
  onClose,
  matchState,
  waitTime,
  error,
  onCancel,
}: TekkenMatchmakingModalProps) {
  // data-hide-nav 설정
  useEffect(() => {
    if (isOpen) {
      document.body.setAttribute('data-hide-nav', '');
    } else {
      document.body.removeAttribute('data-hide-nav');
    }
    return () => {
      document.body.removeAttribute('data-hide-nav');
    };
  }, [isOpen]);

  if (typeof window === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* 배틀 아이콘 */}
          <motion.div
            className="mb-8"
            animate={{ rotate: [0, 10, -10, 0], scale: [1, 1.1, 1] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          >
            <svg className="w-24 h-24 text-red-400" viewBox="0 0 24 24" fill="currentColor">
              <path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z" />
            </svg>
          </motion.div>

          {/* 상태 텍스트 */}
          <div className="text-center mb-6">
            {matchState === 'searching' && (
              <>
                <h2 className="text-2xl font-black text-white mb-2">
                  상대를 찾는 중...
                </h2>
                <div className="flex items-center justify-center gap-2">
                  {/* 스피너 */}
                  <motion.div
                    className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  />
                  <span className="text-lg text-white/70">
                    {waitTime}초
                  </span>
                </div>
                {waitTime >= 20 && (
                  <p className="text-sm text-white/50 mt-2">
                    곧 봇과 매칭됩니다...
                  </p>
                )}
              </>
            )}

            {matchState === 'matched' && (
              <motion.h2
                className="text-3xl font-black text-red-400"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', damping: 10 }}
              >
                상대 발견!
              </motion.h2>
            )}

            {matchState === 'error' && (
              <>
                <h2 className="text-2xl font-black text-red-400 mb-2">
                  매칭 실패
                </h2>
                <p className="text-sm text-white/70">{error}</p>
              </>
            )}
          </div>

          {/* 취소 버튼 */}
          {matchState === 'searching' && (
            <button
              onClick={onCancel}
              className="px-8 py-3 bg-white/10 border border-white/20 rounded-full text-white font-bold active:scale-95 transition-transform"
            >
              취소
            </button>
          )}

          {matchState === 'error' && (
            <button
              onClick={onClose}
              className="px-8 py-3 bg-white/10 border border-white/20 rounded-full text-white font-bold active:scale-95 transition-transform"
            >
              닫기
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
