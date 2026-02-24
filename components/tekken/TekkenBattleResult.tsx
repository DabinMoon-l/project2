'use client';

/**
 * 배틀 결과 화면
 *
 * 승/패/무승부 + XP 표시
 */

import { motion } from 'framer-motion';
import type { BattleResult } from '@/lib/types/tekken';
import { calcBattleXp } from '@/lib/utils/tekkenDamage';

interface TekkenBattleResultProps {
  result: BattleResult;
  userId: string;
  opponentNickname: string;
  onClose: () => void;
}

export default function TekkenBattleResult({
  result,
  userId,
  opponentNickname,
  onClose,
}: TekkenBattleResultProps) {
  const isWinner = result.winnerId === userId;
  const isDraw = result.isDraw;
  const xp = calcBattleXp(isWinner, 0); // 클라이언트에서는 연승 모르므로 기본값

  const endReasonText = {
    ko: 'K.O!',
    timeout: '시간 종료',
    disconnect: '연결 끊김',
  }[result.endReason] || '';

  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      {/* 결과 텍스트 */}
      <motion.div
        className="text-center mb-8"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', damping: 10, delay: 0.3 }}
      >
        {isDraw ? (
          <h1 className="text-6xl font-black text-white mb-2">DRAW</h1>
        ) : isWinner ? (
          <h1 className="text-6xl font-black text-yellow-400 mb-2">WIN!</h1>
        ) : (
          <h1 className="text-6xl font-black text-red-400 mb-2">LOSE</h1>
        )}
        <p className="text-lg text-white/60">{endReasonText}</p>
      </motion.div>

      {/* 대전 상대 */}
      <motion.div
        className="text-center mb-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
      >
        <p className="text-sm text-white/50">vs</p>
        <p className="text-xl font-bold text-white">{opponentNickname}</p>
      </motion.div>

      {/* XP 획득 */}
      <motion.div
        className="flex items-center gap-3 px-8 py-4 bg-black/40 border border-white/10 rounded-2xl backdrop-blur-xl mb-10"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.9 }}
      >
        <span className="text-2xl">⭐</span>
        <div>
          <p className="text-sm text-white/50">획득 XP</p>
          <p className="text-3xl font-black text-yellow-400">+{xp}</p>
        </div>
      </motion.div>

      {/* 닫기 버튼 */}
      <motion.button
        onClick={onClose}
        className="px-10 py-3 bg-white/10 border border-white/20 rounded-full text-white font-bold text-lg active:scale-95 transition-transform"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2 }}
      >
        돌아가기
      </motion.button>
    </motion.div>
  );
}
