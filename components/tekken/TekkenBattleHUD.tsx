'use client';

/**
 * 배틀 HUD — HP 바, 타이머, 토끼 프로필
 */

import { motion } from 'framer-motion';
import type { BattlePlayer, BattleRabbit } from '@/lib/types/tekken';

interface HpBarProps {
  rabbit: BattleRabbit | null;
  nickname: string;
  profileRabbitId: number;
  isOpponent?: boolean;
  isBot?: boolean;
}

function HpBar({ rabbit, nickname, profileRabbitId, isOpponent, isBot }: HpBarProps) {
  const hp = rabbit?.currentHp ?? 0;
  const maxHp = rabbit?.maxHp ?? 1;
  const hpPercent = Math.max(0, (hp / maxHp) * 100);
  const hpColor = hpPercent > 50 ? 'bg-green-500' : hpPercent > 25 ? 'bg-yellow-500' : 'bg-red-500';

  return (
    <div className={`flex items-center gap-2 ${isOpponent ? 'flex-row' : 'flex-row-reverse'}`}>
      {/* 토끼 프로필 */}
      <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-white/30 bg-black/30 flex-shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/rabbit_profile/rabbit-${String(profileRabbitId + 1).padStart(3, '0')}-pf.png`}
          alt=""
          className="w-full h-full object-cover"
        />
      </div>

      {/* 닉네임 + HP */}
      <div className="flex-1 min-w-0">
        <div className={`flex items-center gap-1 mb-0.5 ${isOpponent ? '' : 'justify-end'}`}>
          <span className="text-sm font-bold text-white truncate">
            {nickname}
          </span>
          {isBot && (
            <span className="text-[10px] px-1 bg-white/20 rounded text-white/60">BOT</span>
          )}
        </div>
        <div className="h-4 bg-black/40 rounded-full overflow-hidden border border-white/10">
          <motion.div
            className={`h-full rounded-full ${hpColor}`}
            initial={false}
            animate={{ width: `${hpPercent}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        </div>
        <div className={`text-xs text-white/60 mt-0.5 ${isOpponent ? '' : 'text-right'}`}>
          HP {hp}/{maxHp}
          {rabbit && (
            <span className="ml-2 text-white/40">
              ATK {rabbit.atk} / DEF {rabbit.def}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

interface TekkenBattleHUDProps {
  myPlayer: BattlePlayer | null;
  opponent: BattlePlayer | null;
  myActiveRabbit: BattleRabbit | null;
  opponentActiveRabbit: BattleRabbit | null;
  battleTimeLeft: number;
  currentRound: number;
  totalRounds: number;
}

export default function TekkenBattleHUD({
  myPlayer,
  opponent,
  myActiveRabbit,
  opponentActiveRabbit,
  battleTimeLeft,
  currentRound,
  totalRounds,
}: TekkenBattleHUDProps) {
  const minutes = Math.floor(battleTimeLeft / 60000);
  const seconds = Math.floor((battleTimeLeft % 60000) / 1000);
  const timeStr = `${minutes}:${String(seconds).padStart(2, '0')}`;

  return (
    <div className="w-full px-4 pt-2 pb-1">
      {/* 상대 HP */}
      <HpBar
        rabbit={opponentActiveRabbit}
        nickname={opponent?.nickname ?? '상대방'}
        profileRabbitId={opponent?.profileRabbitId ?? 0}
        isOpponent
        isBot={opponent?.isBot}
      />

      {/* 타이머 + 라운드 */}
      <div className="flex items-center justify-center gap-3 my-3">
        <span className="text-xs text-white/50 font-bold">
          R{currentRound + 1}/{totalRounds}
        </span>
        <div className="px-4 py-1 bg-black/40 border border-white/10 rounded-full">
          <span className={`text-lg font-black ${battleTimeLeft < 30000 ? 'text-red-400' : 'text-white'}`}>
            {timeStr}
          </span>
        </div>
      </div>

      {/* 내 HP */}
      <HpBar
        rabbit={myActiveRabbit}
        nickname={myPlayer?.nickname ?? '나'}
        profileRabbitId={myPlayer?.profileRabbitId ?? 0}
      />
    </div>
  );
}
