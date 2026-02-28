'use client';

/**
 * 포켓몬 스타일 캐릭터 영역 (v2)
 *
 * 상단: 상대 이름/Lv/HP(좌) + 상대 토끼(우) + 발판
 * 하단: 내 토끼(좌) + 발판 + 내 이름/Lv/HP(우)
 *
 * 변경사항:
 * - 데미지 텍스트: 숫자만, 빨간 굵은 글씨, 토끼 머리맡
 * - 발판: 포켓몬 스타일 회색 글래스 그라데이션 타원
 */

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { BattlePlayer, BattleRabbit, RoundResultData } from '@/lib/types/tekken';

// ── 데미지 팝업 ──
interface DamagePopupData {
  id: number;
  value: number;
  target: 'opponent' | 'me';
}

let popupIdCounter = 0;

function DamagePopup({ data }: { data: DamagePopupData }) {
  // 상대 토끼 맞음 → 상대 토끼 머리맡 (우상단)
  // 내 토끼 맞음 → 내 토끼 머리맡 (좌하단)
  const isOpponentHit = data.target === 'opponent';

  return (
    <motion.div
      className={`absolute z-20 pointer-events-none ${
        isOpponentHit ? 'top-4 right-8' : 'bottom-4 left-8'
      }`}
      initial={{ opacity: 0, scale: 0.5, y: 0 }}
      animate={{ opacity: 1, scale: 1.2, y: isOpponentHit ? -20 : 20 }}
      exit={{ opacity: 0, y: isOpponentHit ? -50 : 50, scale: 0.8 }}
      transition={{ type: 'spring', damping: 10, stiffness: 200, duration: 1.2 }}
    >
      <span className="text-4xl font-black text-red-500 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
        -{data.value}
      </span>
    </motion.div>
  );
}

// ── HP 바 (포켓몬 스타일) ──
function PokemonHpBar({
  rabbit,
  nickname,
  isBot,
  isOpponent,
}: {
  rabbit: BattleRabbit | null;
  nickname: string;
  isBot?: boolean;
  isOpponent?: boolean;
}) {
  const hp = rabbit?.currentHp ?? 0;
  const maxHp = rabbit?.maxHp ?? 1;
  const level = rabbit ? Math.max(1, Math.floor((rabbit.atk + rabbit.def + maxHp) / 10)) : 1;
  const hpPercent = Math.max(0, (hp / maxHp) * 100);
  const hpColor = hpPercent > 50 ? 'bg-green-500' : hpPercent > 25 ? 'bg-yellow-500' : 'bg-red-500';

  return (
    <div
      className={`
        relative px-3 py-2 rounded-xl border-2
        ${isOpponent
          ? 'bg-black/30 border-white/15 backdrop-blur-sm'
          : 'bg-black/30 border-white/15 backdrop-blur-sm'
        }
      `}
      style={{ minWidth: 160, maxWidth: 200 }}
    >
      {/* 이름 + 레벨 */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm font-black text-white truncate">
            {nickname}
          </span>
          {isBot && (
            <span className="text-[9px] px-1 py-px bg-white/20 rounded text-white/60 flex-shrink-0">
              BOT
            </span>
          )}
        </div>
        <span className="text-xs font-bold text-white/60 flex-shrink-0 ml-1">
          Lv.{level}
        </span>
      </div>

      {/* HP 바 */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-bold text-white/50">HP</span>
        <div className="flex-1 h-3 bg-black/50 rounded-full overflow-hidden border border-white/10">
          <motion.div
            className={`h-full rounded-full ${hpColor}`}
            initial={false}
            animate={{ width: `${hpPercent}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        </div>
      </div>

      {/* HP 숫자 */}
      <div className="text-right mt-0.5">
        <span className="text-[10px] font-bold text-white/50">
          {hp}/{maxHp}
        </span>
      </div>
    </div>
  );
}

// ── 토끼 캐릭터 (글래스 그라데이션 발판) ──
function RabbitCharacter({
  rabbitId,
  isOpponent,
  isDead,
  isSwapping,
}: {
  rabbitId: number;
  isOpponent?: boolean;
  isDead?: boolean;
  isSwapping?: boolean;
}) {
  const src = `/rabbit/rabbit-${String(rabbitId + 1).padStart(3, '0')}.png`;
  const size = isOpponent ? 80 : 120;

  return (
    <div className="relative flex flex-col items-center">
      {/* 토끼 이미지 */}
      <AnimatePresence mode="wait">
        <motion.div
          key={`${rabbitId}-${isSwapping ? 'swap' : 'normal'}`}
          initial={isSwapping ? { scale: 0, opacity: 0 } : { scale: 1, opacity: 1 }}
          animate={{ scale: 1, opacity: isDead ? 0.3 : 1 }}
          exit={{ scale: 0, opacity: 0 }}
          transition={{
            type: 'spring',
            damping: 12,
            stiffness: 200,
            duration: isSwapping ? 1.2 : 0.3,
          }}
          style={{ width: size, height: size * 1.2 }}
          className={isOpponent ? 'scale-x-[-1]' : ''}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt=""
            className="w-full h-full object-contain drop-shadow-[0_4px_12px_rgba(0,0,0,0.4)]"
          />
        </motion.div>
      </AnimatePresence>

      {/* 포켓몬 스타일 글래스 그라데이션 타원 발판 */}
      <div
        className="rounded-[50%] -mt-3"
        style={{
          width: size * 1.2,
          height: size * 0.25,
          background: 'radial-gradient(ellipse at center, rgba(180,180,190,0.5) 0%, rgba(120,120,130,0.3) 40%, rgba(80,80,90,0.1) 70%, transparent 100%)',
          boxShadow: '0 2px 16px rgba(0,0,0,0.3), inset 0 1px 2px rgba(255,255,255,0.15)',
        }}
      />
    </div>
  );
}

// ── 메인 Arena 컴포넌트 ──
interface TekkenBattleArenaProps {
  myPlayer: BattlePlayer | null;
  opponent: BattlePlayer | null;
  myActiveRabbit: BattleRabbit | null;
  opponentActiveRabbit: BattleRabbit | null;
  myResult: RoundResultData | null;
  opponentResult: RoundResultData | null;
  showResult: boolean;
}

export default function TekkenBattleArena({
  myPlayer,
  opponent,
  myActiveRabbit,
  opponentActiveRabbit,
  myResult,
  opponentResult,
  showResult,
}: TekkenBattleArenaProps) {
  const [popups, setPopups] = useState<DamagePopupData[]>([]);
  const [swappingTarget, setSwappingTarget] = useState<'me' | 'opponent' | null>(null);
  const prevMyRabbitId = useRef(myActiveRabbit?.rabbitId);
  const prevOpponentRabbitId = useRef(opponentActiveRabbit?.rabbitId);

  // 토끼 교체 감지
  useEffect(() => {
    if (myActiveRabbit && prevMyRabbitId.current !== undefined && prevMyRabbitId.current !== myActiveRabbit.rabbitId) {
      setSwappingTarget('me');
      const timer = setTimeout(() => setSwappingTarget(null), 2000);
      return () => clearTimeout(timer);
    }
    prevMyRabbitId.current = myActiveRabbit?.rabbitId;
  }, [myActiveRabbit?.rabbitId, myActiveRabbit]);

  useEffect(() => {
    if (opponentActiveRabbit && prevOpponentRabbitId.current !== undefined && prevOpponentRabbitId.current !== opponentActiveRabbit.rabbitId) {
      setSwappingTarget('opponent');
      const timer = setTimeout(() => setSwappingTarget(null), 2000);
      return () => clearTimeout(timer);
    }
    prevOpponentRabbitId.current = opponentActiveRabbit?.rabbitId;
  }, [opponentActiveRabbit?.rabbitId, opponentActiveRabbit]);

  // 라운드 결과 → 데미지 팝업 (숫자만)
  useEffect(() => {
    if (!showResult) return;

    const newPopups: DamagePopupData[] = [];

    // 내가 정답 → 상대에게 데미지
    if (myResult?.isCorrect && myResult.damage > 0) {
      newPopups.push({
        id: ++popupIdCounter,
        value: myResult.damage,
        target: 'opponent',
      });
    }

    // 내 오답 → 범실 셀프 데미지
    if (myResult && !myResult.isCorrect && myResult.selfDamage > 0) {
      newPopups.push({
        id: ++popupIdCounter,
        value: myResult.selfDamage,
        target: 'me',
      });
    }

    // 상대가 정답 → 나에게 데미지
    if (opponentResult?.isCorrect && opponentResult.damage > 0) {
      newPopups.push({
        id: ++popupIdCounter,
        value: opponentResult.damage,
        target: 'me',
      });
    }

    // 상대 오답 → 상대 셀프 데미지
    if (opponentResult && !opponentResult.isCorrect && opponentResult.selfDamage > 0) {
      newPopups.push({
        id: ++popupIdCounter,
        value: opponentResult.selfDamage,
        target: 'opponent',
      });
    }

    if (newPopups.length > 0) {
      setPopups(newPopups);
      const timer = setTimeout(() => setPopups([]), 1800);
      return () => clearTimeout(timer);
    }
  }, [showResult, myResult, opponentResult]);

  const myRabbitId = myActiveRabbit?.rabbitId ?? myPlayer?.profileRabbitId ?? 0;
  const opponentRabbitId = opponentActiveRabbit?.rabbitId ?? opponent?.profileRabbitId ?? 0;

  return (
    <div className="relative flex-1 flex flex-col justify-between px-3 py-2 overflow-hidden">
      {/* ── 상대 영역 (상단) ── */}
      <div className="flex items-start justify-between">
        {/* 상대 HP 바 (좌) */}
        <PokemonHpBar
          rabbit={opponentActiveRabbit}
          nickname={opponent?.nickname ?? '상대방'}
          isBot={opponent?.isBot}
          isOpponent
        />

        {/* 상대 토끼 (우) */}
        <div className="relative">
          <RabbitCharacter
            rabbitId={opponentRabbitId}
            isOpponent
            isDead={opponentActiveRabbit ? opponentActiveRabbit.currentHp <= 0 : false}
            isSwapping={swappingTarget === 'opponent'}
          />
        </div>
      </div>

      {/* ── 내 영역 (하단) ── */}
      <div className="flex items-end justify-between">
        {/* 내 토끼 (좌) */}
        <div className="relative">
          <RabbitCharacter
            rabbitId={myRabbitId}
            isDead={myActiveRabbit ? myActiveRabbit.currentHp <= 0 : false}
            isSwapping={swappingTarget === 'me'}
          />
        </div>

        {/* 내 HP 바 (우) */}
        <PokemonHpBar
          rabbit={myActiveRabbit}
          nickname={myPlayer?.nickname ?? '나'}
        />
      </div>

      {/* ── 데미지 팝업 오버레이 (숫자만, 빨간색) ── */}
      <AnimatePresence>
        {popups.map((p) => (
          <DamagePopup key={p.id} data={p} />
        ))}
      </AnimatePresence>

      {/* ── 정답/오답 텍스트 (중앙) ── */}
      <AnimatePresence>
        {showResult && myResult && (
          <motion.div
            className="absolute inset-0 flex items-center justify-center pointer-events-none z-10"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ delay: 0.1 }}
          >
            <span className={`text-2xl font-black drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)] ${myResult.isCorrect ? 'text-green-400' : 'text-red-400'}`}>
              {myResult.isCorrect ? '정답!' : '오답...'}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
