'use client';

/**
 * 포켓몬 스타일 캐릭터 영역 (v5)
 *
 * 상단: 상대 이름/Lv/HP(좌) + 상대 토끼(우) + 발판
 * 하단: 내 토끼(좌) + 발판 + 내 이름/Lv/HP(우)
 *
 * v5 변경사항:
 * - 데미지 팝업 확실히 소멸 (#1)
 * - 양쪽 오답 데미지 팝업 (#2)
 * - 토끼 하단 잘림 방지 (#3)
 * - 토끼 피격 CSS filter 빨개지기 (#7)
 * - 토끼 교체 1회 깜빡임 (#10)
 * - 데미지 숫자 잘림 방지 (#12)
 * - 데미지 모션 부드럽게 (#13)
 * - HP 바에 토끼 이름 표시 (#14)
 * - 라운드 결과 시 정답 표시 (#15)
 */

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { computeRabbitDisplayName } from '@/lib/utils/rabbitDisplayName';
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
      initial={{ opacity: 0, scale: 0.5, y: 0 }}
      animate={{ opacity: 1, scale: data.isCritical ? 1.4 : 1.1, y: isOpponentHit ? -20 : 20 }}
      exit={{ opacity: 0, y: isOpponentHit ? -40 : 40, scale: 0.8 }}
      transition={{ type: 'spring', damping: 15, stiffness: 150 }}
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
  rabbitName,
  isBot,
}: {
  rabbit: BattleRabbit | null;
  nickname: string;
  rabbitName?: string;
  isBot?: boolean;
}) {
  const hp = rabbit?.currentHp ?? 0;
  const maxHp = rabbit?.maxHp ?? 1;
  const level = rabbit ? Math.max(1, Math.floor((rabbit.atk + rabbit.def + maxHp) / 10)) : 1;
  const hpPercent = Math.max(0, (hp / maxHp) * 100);
  const hpColor = hpPercent > 50 ? 'bg-green-500' : hpPercent > 25 ? 'bg-yellow-500' : 'bg-red-500';

  return (
    <div
      className="relative px-3 py-2 rounded-xl border-2 bg-black/30 border-white/15 backdrop-blur-sm"
      style={{ minWidth: 160, maxWidth: 200 }}
    >
      {/* 이름 + 레벨 */}
      <div className="flex items-center justify-between mb-1">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-black text-white truncate block">
              {nickname}
            </span>
            {isBot && (
              <span className="text-[9px] px-1 py-px bg-white/20 rounded text-white/60 flex-shrink-0">
                BOT
              </span>
            )}
          </div>
          {rabbitName && (
            <span className="text-[10px] text-white/50 truncate block">
              {rabbitName}
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
      {/* 토끼 이미지 — key에서 isSwapping 제거하여 2번 깜빡임 방지 */}
      <AnimatePresence mode="wait">
        <motion.div
          key={rabbitId}
          initial={isSwapping ? { scale: 0, opacity: 0, y: 20 } : false}
          animate={{
            scale: 1,
            opacity: isDead ? 0.3 : 1,
            y: 0,
          }}
          exit={{ scale: 0, opacity: 0 }}
          transition={{
            type: 'spring',
            damping: 15,
            stiffness: 200,
          }}
          style={{ width: size, height: size * 1.2 }}
          className={isOpponent ? 'scale-x-[-1]' : ''}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt=""
            className="w-full h-full object-contain drop-shadow-[0_4px_12px_rgba(0,0,0,0.4)] transition-[filter] duration-300"
            style={isHit ? {
              filter: 'sepia(1) saturate(60) hue-rotate(335deg) brightness(0.6)',
            } : undefined}
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
  correctChoiceText?: string;
}

export default function TekkenBattleArena({
  myPlayer,
  opponent,
  myActiveRabbit,
  opponentActiveRabbit,
  myResult,
  opponentResult,
  showResult,
  correctChoiceText,
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

  // 라운드 결과 → 데미지 팝업 + 히트 플래시
  useEffect(() => {
    if (!showResult) {
      setHitMe(false);
      setHitOp(false);
      setPopups([]); // #1: showResult=false 시 팝업 즉시 클리어
      return;
    }

    const newPopups: DamagePopupData[] = [];
    let shouldHitMe = false;
    let shouldHitOp = false;

    // 내가 받은 데미지 → 내 토끼에 표시
    if (myResult && myResult.damageReceived > 0) {
      newPopups.push({
        id: ++popupIdCounter,
        value: myResult.damageReceived,
        target: 'me',
      });
      shouldHitMe = true;
    }

    // 상대가 받은 데미지 → 상대 토끼에 표시
    if (myResult?.damage && myResult.damage > 0) {
      // 내가 준 데미지 (내가 정답)
      newPopups.push({
        id: ++popupIdCounter,
        value: myResult.damage,
        target: 'opponent',
        isCritical: myResult.isCritical,
      });
      shouldHitOp = true;
    } else if (opponentResult && opponentResult.damageReceived > 0) {
      // 상호 데미지 (양쪽 오답) — 내가 준 데미지가 없을 때만
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

  // 안정적인 rabbitId 캐시 (undefined 깜빡임 방지)
  const stableMyRabbitIdRef = useRef(myActiveRabbit?.rabbitId ?? myPlayer?.profileRabbitId ?? 0);
  const stableOpRabbitIdRef = useRef(opponentActiveRabbit?.rabbitId ?? opponent?.profileRabbitId ?? 0);
  if (myActiveRabbit?.rabbitId !== undefined) stableMyRabbitIdRef.current = myActiveRabbit.rabbitId;
  if (opponentActiveRabbit?.rabbitId !== undefined) stableOpRabbitIdRef.current = opponentActiveRabbit.rabbitId;
  const myRabbitId = stableMyRabbitIdRef.current;
  const opponentRabbitId = stableOpRabbitIdRef.current;

  // 토끼 이름 계산
  const myRabbitName = myActiveRabbit
    ? computeRabbitDisplayName(myActiveRabbit.name, myActiveRabbit.discoveryOrder ?? 1, myActiveRabbit.rabbitId)
    : undefined;
  const opponentRabbitName = opponentActiveRabbit
    ? computeRabbitDisplayName(opponentActiveRabbit.name, opponentActiveRabbit.discoveryOrder ?? 1, opponentActiveRabbit.rabbitId)
    : undefined;

  return (
    <div className="relative flex-1 flex flex-col justify-between px-3 pt-2 pb-0">
      {/* ── 상대 영역 (상단) ── */}
      <div className="flex items-start justify-between">
        {/* 상대 HP 바 (좌) */}
        <PokemonHpBar
          rabbit={opponentActiveRabbit}
          nickname={opponent?.nickname ?? '상대방'}
          rabbitName={opponentRabbitName}
          isBot={opponent?.isBot}
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
          rabbitName={myRabbitName}
        />
      </div>

      {/* ── 데미지 팝업 오버레이 ── */}
      <AnimatePresence>
        {popups.map((p) => (
          <DamagePopup key={p.id} data={p} />
        ))}
      </AnimatePresence>

      {/* ── 정답/오답 + 정답 텍스트 (중앙) ── */}
      <AnimatePresence>
        {showResult && myResult && (
          <motion.div
            className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ delay: 0.1 }}
          >
            <span className={`text-2xl font-black drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)] ${myResult.isCorrect ? 'text-green-400' : 'text-red-400'}`}>
              {myResult.isCorrect ? '정답!' : '오답...'}
            </span>
            {correctChoiceText && (
              <span className="text-sm text-white/70 mt-1 px-4 text-center drop-shadow-[0_1px_4px_rgba(0,0,0,0.5)]">
                정답: {correctChoiceText}
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
