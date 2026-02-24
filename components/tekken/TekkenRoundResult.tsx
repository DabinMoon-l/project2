'use client';

/**
 * 라운드 결과 애니메이션
 *
 * 데미지 숫자 팝업 + 크리티컬 효과
 */

import { motion } from 'framer-motion';
import type { RoundResultData } from '@/lib/types/tekken';

interface TekkenRoundResultProps {
  myResult: RoundResultData | null;
  opponentResult: RoundResultData | null;
}

export default function TekkenRoundResult({
  myResult,
  opponentResult,
}: TekkenRoundResultProps) {
  if (!myResult && !opponentResult) return null;

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
      <div className="flex flex-col items-center gap-4">
        {/* 내가 준 데미지 (상대에게) */}
        {myResult?.isCorrect && myResult.damage > 0 && (
          <motion.div
            initial={{ scale: 0, y: 20 }}
            animate={{ scale: 1, y: -30 }}
            transition={{ type: 'spring', damping: 8 }}
            className="text-center"
          >
            <span className={`text-4xl font-black ${myResult.isCritical ? 'text-yellow-300' : 'text-red-400'}`}>
              -{myResult.damage}
            </span>
            {myResult.isCritical && (
              <motion.span
                className="block text-sm font-black text-yellow-300"
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ duration: 0.3, repeat: 2 }}
              >
                CRITICAL!
              </motion.span>
            )}
          </motion.div>
        )}

        {/* 내 오답 셀프데미지 */}
        {myResult && !myResult.isCorrect && myResult.selfDamage > 0 && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="text-center"
          >
            <span className="text-2xl font-black text-orange-400">
              미스! -{myResult.selfDamage}
            </span>
          </motion.div>
        )}

        {/* 상대가 준 데미지 (나에게) */}
        {opponentResult?.isCorrect && opponentResult.damage > 0 && (
          <motion.div
            initial={{ scale: 0, y: -20 }}
            animate={{ scale: 1, y: 30 }}
            transition={{ type: 'spring', damping: 8, delay: 0.3 }}
            className="text-center"
          >
            <span className={`text-3xl font-black ${opponentResult.isCritical ? 'text-yellow-300' : 'text-red-400'}`}>
              -{opponentResult.damage}
            </span>
            {opponentResult.isCritical && (
              <span className="block text-xs font-black text-yellow-300">
                CRITICAL!
              </span>
            )}
          </motion.div>
        )}

        {/* 정답/오답 표시 */}
        {myResult && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            <span className={`text-lg font-black ${myResult.isCorrect ? 'text-green-400' : 'text-red-400'}`}>
              {myResult.isCorrect ? '정답!' : '오답...'}
            </span>
          </motion.div>
        )}
      </div>
    </div>
  );
}
