'use client';

/**
 * 포켓몬 스타일 캐릭터 영역 (v4)
 *
 * 상단: 상대 이름/Lv/HP(좌) + 상대 토끼(우) + 발판
 * 하단: 내 토끼(좌) + 발판 + 내 이름/Lv/HP(우)
 *
 * 변경사항:
 * - 상대 토끼 크기 증가 (80→110)
 * - 히트 플래시: 데미지 받을 때 빨간 깜빡임
 * - 데미지 팝업: 토끼 근처에서 확대 → 위로 사라짐
 * - 스왑 애니메이션: HP 0 → 다른 토끼로 전환 시에만 트리거
 */

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { BattlePlayer, BattleRabbit, RoundResultData } from '@/lib/types/tekken';

// ── 데미지 팝업 ──
interface DamagePopupData {
  id: number;
  value: number;
  target: 'opponent' | 'me';
  isCritical?: boolean;
}

let popupIdCounter = 0;

function DamagePopup({ data }: { data: DamagePopupData }) {
  const isOpponentHit = data.target === 'opponent';

  return (
    <motion.div
      className={`absolute z-30 pointer-events-none ${
        isOpponentHit
          ? 'top-[15%] right-[15%]'
          : 'bottom-[15%] left-[15%]'
      }`}
      initial={{ opacity: 0, scale: 0.3, y: 0 }}
      animate={{ opacity: 1, scale: data.isCritical ? 1.5 : 1.2, y: isOpponentHit ? -30 : 30 }}
      exit={{ opacity: 0, y: isOpponentHit ? -60 : 60, scale: 0.6 }}
      transition={{ type: 'spring', damping: 8, stiffness: 180, duration: 1.5 }}
    >
      <span className={`font-black drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)] ${
        data.isCritical ? 'text-5xl text-yellow-400' : 'text-4xl text-red-500'
      }`}>
        -{data.value}
      </span>
      {data.isCritical && (
        <motion.span
          className="absolute -top-3 left-1/2 -translate-x-1/2 text-xs font-black text-yellow-300"
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
        >
          CRITICAL!
        </motion.span>
      )}
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
  isHit,
}: {
  rabbitId: number;
  isOpponent?: boolean;
  isDead?: boolean;
  isSwapping?: boolean;
  isHit?: boolean;
}) {
  const src = `/rabbit/rabbit-${String(rabbitId + 1).padStart(3, '0')}.png`;
  const size = isOpponent ? 110 : 120;

  return (
    <div className="relative flex flex-col items-center">
      {/* 토끼 이미지 */}
      <AnimatePresence mode="wait">
        <motion.div
          key={`${rabbitId}-${isSwapping ? 'swap' : 'normal'}`}
          initial={isSwapping ? { scale: 0, opacity: 0 } : { scale: 1, opacity: 1 }}
          animate={{
            scale: 1,
            opacity: isDead ? 0.3 : 1,
          }}
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
          {/* 히트 플래시 오버레이 */}
          {isHit && (
            <motion.div
              className="absolute inset-0 bg-red-500/50 rounded-lg mix-blend-multiply"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.8, 0, 0.6, 0] }}
              transition={{ duration: 0.6, times: [0, 0.1, 0.3, 0.4, 0.6] }}
            />
          )}
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
  const prevMyActiveIndex = useRef(myPlayer?.activeRabbitIndex ?? 0);
  const prevOpActiveIndex = useRef(opponent?.activeRabbitIndex ?? 0);

  // 토끼 교체 감지 — 실제 교체(HP 0 → 다른 토끼)만 애니메이션
  useEffect(() => {
    const currentIndex = myPlayer?.activeRabbitIndex ?? 0;
    const prevIndex = prevMyActiveIndex.current;

    if (currentIndex !== prevIndex && prevMyRabbitId.current !== undefined) {
      const prevRabbit = myPlayer?.rabbits?.[prevIndex];
      if (prevRabbit && prevRabbit.currentHp <= 0) {
        setSwappingTarget('me');
        const timer = setTimeout(() => setSwappingTarget(null), 2000);
        prevMyActiveIndex.current = currentIndex;
        prevMyRabbitId.current = myActiveRabbit?.rabbitId;
        return () => clearTimeout(timer);
      }
    }

    prevMyActiveIndex.current = currentIndex;
    prevMyRabbitId.current = myActiveRabbit?.rabbitId;
  }, [myPlayer?.activeRabbitIndex, myActiveRabbit?.rabbitId, myPlayer?.rabbits]);

  useEffect(() => {
    const currentIndex = opponent?.activeRabbitIndex ?? 0;
    const prevIndex = prevOpActiveIndex.current;

    if (currentIndex !== prevIndex && prevOpponentRabbitId.current !== undefined) {
      const prevRabbit = opponent?.rabbits?.[prevIndex];
      if (prevRabbit && prevRabbit.currentHp <= 0) {
        setSwappingTarget('opponent');
        const timer = setTimeout(() => setSwappingTarget(null), 2000);
        prevOpActiveIndex.current = currentIndex;
        prevOpponentRabbitId.current = opponentActiveRabbit?.rabbitId;
        return () => clearTimeout(timer);
      }
    }

    prevOpActiveIndex.current = currentIndex;
    prevOpponentRabbitId.current = opponentActiveRabbit?.rabbitId;
  }, [opponent?.activeRabbitIndex, opponentActiveRabbit?.rabbitId, opponent?.rabbits]);

  // 히트 플래시 상태
  const [hitMe, setHitMe] = useState(false);
  const [hitOp, setHitOp] = useState(false);

  // 라운드 결과 → 데미지 팝업 + 히트 플래시 (단일 이펙트)
  useEffect(() => {
    if (!showResult) {
      setHitMe(false);
      setHitOp(false);
      return;
    }

    const newPopups: DamagePopupData[] = [];
    let shouldHitMe = false;
    let shouldHitOp = false;

    // 내가 정답 → 상대에게 데미지
    if (myResult?.isCorrect && myResult.damage > 0) {
      newPopups.push({
        id: ++popupIdCounter,
        value: myResult.damage,
        target: 'opponent',
        isCritical: myResult.isCritical,
      });
      shouldHitOp = true;
    }

    // 내가 받은 데미지 (상대 정답 or 상호 데미지)
    if (myResult && myResult.damageReceived > 0) {
      newPopups.push({
        id: ++popupIdCounter,
        value: myResult.damageReceived,
        target: 'me',
      });
      shouldHitMe = true;
    }

    // 상대가 받은 데미지 (상호 데미지 시)
    if (opponentResult && opponentResult.damageReceived > 0 && !(myResult?.isCorrect && myResult.damage > 0)) {
      newPopups.push({
        id: ++popupIdCounter,
        value: opponentResult.damageReceived,
        target: 'opponent',
      });
      shouldHitOp = true;
    }

    if (newPopups.length > 0) setPopups(newPopups);
    setHitMe(shouldHitMe);
    setHitOp(shouldHitOp);

    const hitTimer = setTimeout(() => {
      setHitMe(false);
      setHitOp(false);
    }, 700);
    const popupTimer = setTimeout(() => setPopups([]), 1800);
    return () => {
      clearTimeout(hitTimer);
      clearTimeout(popupTimer);
    };
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
            isHit={hitOp}
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
            isHit={hitMe}
          />
        </div>

        {/* 내 HP 바 (우) */}
        <PokemonHpBar
          rabbit={myActiveRabbit}
          nickname={myPlayer?.nickname ?? '나'}
        />
      </div>

      {/* ── 데미지 팝업 오버레이 ── */}
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
