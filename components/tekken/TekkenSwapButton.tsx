'use client';

/**
 * 토끼 교체 버튼
 *
 * 문제 표시 중 + 답변 전에만 활성화
 */

import { motion } from 'framer-motion';
import type { BattlePlayer } from '@/lib/types/tekken';

interface TekkenSwapButtonProps {
  myPlayer: BattlePlayer | null;
  onSwap: () => void;
  disabled: boolean;
  hasAnswered: boolean;
}

export default function TekkenSwapButton({
  myPlayer,
  onSwap,
  disabled,
  hasAnswered,
}: TekkenSwapButtonProps) {
  if (!myPlayer) return null;

  // 1마리만 장착 → 교체 불가
  const rabbits = myPlayer.rabbits || [];
  if (rabbits.length < 2) return null;

  const otherIndex = myPlayer.activeRabbitIndex === 0 ? 1 : 0;
  const otherRabbit = rabbits[otherIndex];
  const canSwap = !disabled && !hasAnswered && otherRabbit && otherRabbit.currentHp > 0;

  return (
    <motion.button
      onClick={canSwap ? onSwap : undefined}
      disabled={!canSwap}
      className={`
        flex items-center gap-2 px-4 py-2 rounded-full border-2 font-bold text-sm transition-all
        ${canSwap
          ? 'border-blue-400/50 bg-blue-400/10 text-blue-300 active:scale-95'
          : 'border-white/10 bg-white/5 text-white/30 cursor-default'
        }
      `}
      whileTap={canSwap ? { scale: 0.95 } : {}}
    >
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M16 17.01V10h-2v7.01h-3L15 21l4-3.99h-3zM9 3L5 6.99h3V14h2V6.99h3L9 3z" />
      </svg>
      교체
      {canSwap && otherRabbit && (
        <span className="text-xs text-white/50">
          (HP {otherRabbit.currentHp})
        </span>
      )}
    </motion.button>
  );
}
