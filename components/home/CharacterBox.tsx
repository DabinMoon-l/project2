'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useSpring,
  useTransform,
  type MotionValue,
} from 'framer-motion';
import { useUser, useCourse, useMilestone } from '@/lib/contexts';
import { useTheme } from '@/styles/themes/useTheme';
import { useRabbitHoldings, useRabbitDoc, getRabbitStats } from '@/lib/hooks/useRabbit';
import { computeRabbitDisplayName } from '@/lib/utils/rabbitDisplayName';

import RabbitDogam from './RabbitDogam';
import TekkenMatchmakingModal from '@/components/tekken/TekkenMatchmakingModal';
import TekkenBattleConfirmModal from '@/components/tekken/TekkenBattleConfirmModal';
import TekkenBattleOverlay from '@/components/tekken/TekkenBattleOverlay';
import { useTekkenBattle } from '@/lib/hooks/useTekkenBattle';
import { BATTLE_CONFIG } from '@/lib/types/tekken';

const SWIPE_THRESHOLD = 40;

/* 궤도 파라미터 */
const ORBIT_RX = 175;
const ORBIT_RY = 50;
const CHAR_SIZE = 180;
const CHAR_HALF = CHAR_SIZE / 2;
const ORBIT_Y_SHIFT = 195;

/**
 * 캐릭터 섹션 — 궤도 캐러셀 + XP/도감 + EXP 바 + 마일스톤
 */
export default function CharacterBox() {
  const { profile } = useUser();
  const { userCourseId } = useCourse();
  const { theme } = useTheme();

  // 마일스톤 Context
  const milestone = useMilestone();

  // 토끼 홀딩 구독 (실제 스탯)
  const { holdings } = useRabbitHoldings(profile?.uid);

  // 캐러셀
  const [activeIndex, setActiveIndex] = useState(0);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const swipeDir = useRef<'h' | 'v' | null>(null);
  const isDragging = useRef(false);

  // 궤도 공전
  const rotationTarget = useRef(Math.PI / 2);
  const rotationMV = useMotionValue(Math.PI / 2);
  const springRotation = useSpring(rotationMV, { stiffness: 100, damping: 18 });

  // 도감
  const [showDogam, setShowDogam] = useState(false);

  // 철권퀴즈 — long press 진입
  const [showBattleConfirm, setShowBattleConfirm] = useState(false);
  const [showMatchmaking, setShowMatchmaking] = useState(false);
  const [showBattle, setShowBattle] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressStartPos = useRef({ x: 0, y: 0 });
  const longPressTriggered = useRef(false);
  const tekken = useTekkenBattle(profile?.uid);
  const isStudent = profile?.role !== 'professor';

  // 장착된 토끼 (항상 2슬롯: 빈 슬롯은 null로 표시)
  const equippedRabbits = profile?.equippedRabbits || [];
  const slot0 = equippedRabbits[0] || (userCourseId ? { rabbitId: 0, courseId: userCourseId } : null);
  const slot1 = equippedRabbits[1] || null;
  // 항상 2슬롯 배열 (빈 슬롯 = null)
  const slots: (typeof slot0)[] = slot0 ? [slot0, slot1] : [];
  const slotCount = slots.length;

  // EXP & 마일스톤 (Context)
  const totalExp = profile?.totalExp || 0;
  const { pendingCount, expBar } = milestone;

  // 앞 캐릭터의 실제 스탯 (홀딩에서)
  const frontSlot = slots[activeIndex] || slots[0] || null;
  const isEmptySlot = !frontSlot; // 빈 슬롯인지
  const frontHolding = frontSlot
    ? holdings.find(
        (h) => h.rabbitId === frontSlot.rabbitId && h.courseId === frontSlot.courseId
      )
    : null;
  const frontInfo = frontHolding ? getRabbitStats(frontHolding) : null;

  // 앞 토끼 이름 구독
  const { rabbit: frontRabbitDoc } = useRabbitDoc(frontSlot?.courseId, frontSlot?.rabbitId);
  const frontDisplayName = isEmptySlot
    ? '???'
    : frontHolding && frontRabbitDoc
      ? computeRabbitDisplayName(frontRabbitDoc.name, frontHolding.discoveryOrder, frontSlot!.rabbitId)
      : frontSlot?.rabbitId === 0
        ? '토끼'
        : null;

  // 도감/철권퀴즈 모달 열릴 때 자동 트리거 억제
  useEffect(() => {
    milestone.setSuppressAutoTrigger(showDogam || showBattleConfirm || showMatchmaking || showBattle);
  }, [showDogam, showBattleConfirm, showMatchmaking, showBattle, milestone]);

  // activeIndex 범위 보정
  useEffect(() => {
    if (activeIndex >= slotCount && slotCount > 0) setActiveIndex(0);
  }, [slotCount, activeIndex]);

  // 공전 실행
  const doOrbitSwap = useCallback((dx: number) => {
    if (slotCount <= 1) return;
    if (Math.abs(dx) > SWIPE_THRESHOLD) {
      rotationTarget.current += (dx < 0 ? 1 : -1) * Math.PI;
      rotationMV.set(rotationTarget.current);
      setActiveIndex(prev => (prev === 0 ? 1 : 0));
    }
  }, [slotCount, rotationMV]);

  // 철권퀴즈 long press 핸들러 (터치/마우스 핸들러보다 앞에 선언)
  const clearLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const onLongPressStart = useCallback((x: number, y: number) => {
    if (!isStudent || !userCourseId || equippedRabbits.length === 0) return;
    longPressStartPos.current = { x, y };
    longPressTriggered.current = false;
    clearLongPress();
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      if (navigator.vibrate) navigator.vibrate(50);
      setShowBattleConfirm(true);
    }, BATTLE_CONFIG.LONG_PRESS_MS);
  }, [isStudent, userCourseId, equippedRabbits.length, clearLongPress]);

  // 배틀 확인 → 매칭 시작
  const handleConfirmBattle = useCallback(() => {
    if (!userCourseId) return;
    setShowBattleConfirm(false);
    setShowMatchmaking(true);
    tekken.startMatchmaking(userCourseId);
  }, [userCourseId, tekken]);

  const onLongPressMove = useCallback((x: number, y: number) => {
    const dx = Math.abs(x - longPressStartPos.current.x);
    const dy = Math.abs(y - longPressStartPos.current.y);
    if (dx > 10 || dy > 10) {
      clearLongPress();
    }
  }, [clearLongPress]);

  const onLongPressEnd = useCallback(() => {
    clearLongPress();
  }, [clearLongPress]);

  // 모바일 터치
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    swipeDir.current = null;
    onLongPressStart(e.touches[0].clientX, e.touches[0].clientY);
  }, [onLongPressStart]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    onLongPressMove(e.touches[0].clientX, e.touches[0].clientY);
    if (swipeDir.current === 'v') return;
    const dx = Math.abs(e.touches[0].clientX - touchStartX.current);
    const dy = Math.abs(e.touches[0].clientY - touchStartY.current);
    if (swipeDir.current === null && (dx > 8 || dy > 8)) {
      swipeDir.current = dx > dy ? 'h' : 'v';
    }
  }, [onLongPressMove]);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    onLongPressEnd();
    if (longPressTriggered.current) return;
    if (swipeDir.current !== 'h') return;
    doOrbitSwap(e.changedTouches[0].clientX - touchStartX.current);
  }, [doOrbitSwap, onLongPressEnd]);

  // PC 마우스 드래그
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    touchStartX.current = e.clientX;
    onLongPressStart(e.clientX, e.clientY);
    e.preventDefault();
  }, [onLongPressStart]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging.current) onLongPressMove(e.clientX, e.clientY);
    };
    const handleMouseUp = (e: MouseEvent) => {
      onLongPressEnd();
      if (!isDragging.current) return;
      isDragging.current = false;
      if (longPressTriggered.current) return;
      if (slotCount <= 1) return;
      doOrbitSwap(e.clientX - touchStartX.current);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [doOrbitSwap, onLongPressMove, onLongPressEnd, slotCount]);

  // 매칭 성공 → 배틀 오버레이로 전환
  useEffect(() => {
    if (tekken.matchState === 'matched') {
      const timer = setTimeout(() => {
        setShowMatchmaking(false);
        setShowBattle(true);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [tekken.matchState]);

  const containerW = ORBIT_RX * 2 + CHAR_SIZE;
  const containerH = ORBIT_RY * 2 + CHAR_SIZE;

  return (
    <>
      <div className="flex flex-col items-center w-full">
        {/* XP / 도감 */}
        <div className="w-full flex items-center justify-between px-8 mb-2 mt-10 relative z-20">
          <div className="h-11 flex items-center gap-4 px-9 bg-black/40 border border-white/10 rounded-full backdrop-blur-xl">
            <span className="text-xl font-bold text-white">XP</span>
            <span className="font-bold text-xl text-white leading-none text-right">{totalExp}</span>
          </div>
          <button
            onClick={() => setShowDogam(true)}
            className="h-11 flex items-center justify-center px-9 bg-black/40 border border-white/10 rounded-full backdrop-blur-xl transition-transform duration-200 hover:scale-110 active:scale-95"
          >
            <span className="text-xl font-bold text-white">도감</span>
          </button>
        </div>

        {/* 캐릭터 영역 — 항상 2슬롯 궤도 캐러셀 */}
        {slotCount >= 2 ? (
          <div
            className="relative select-none -mt-24"
            style={{
              width: containerW,
              height: containerH,
              isolation: 'isolate',
              cursor: 'grab',
            }}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onMouseDown={onMouseDown}
          >
            {/* 궤도 타원 */}
            <div
              className="absolute pointer-events-none"
              style={{
                left: CHAR_HALF,
                right: CHAR_HALF,
                top: CHAR_HALF + ORBIT_Y_SHIFT,
                bottom: CHAR_HALF - ORBIT_Y_SHIFT,
                border: '3px solid rgba(0,0,0,0.25)',
                borderRadius: '50%',
                boxShadow: '0 0 12px 4px rgba(0,0,0,0.15), 0 0 24px 8px rgba(0,0,0,0.1), inset 0 0 8px 2px rgba(0,0,0,0.1)',
                zIndex: 0,
              }}
            />

            {/* 공전 캐릭터 (빈 슬롯은 "?" 표시) */}
            {slots.map((slot, idx) => (
              slot ? (
                <OrbitalCharacter
                  key={idx}
                  rabbitId={slot.rabbitId}
                  springRotation={springRotation}
                  charIndex={idx}
                />
              ) : (
                <OrbitalPlaceholder
                  key={`empty-${idx}`}
                  springRotation={springRotation}
                  charIndex={idx}
                />
              )
            ))}

            {/* 스탯 (앞 캐릭터 옆) */}
            <AnimatePresence mode="wait">
              <motion.div
                key={activeIndex}
                initial={{ opacity: 0, x: -5 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 5 }}
                transition={{ duration: 0.2 }}
                className="absolute flex flex-col gap-1.5"
                style={{
                  right: 50,
                  top: '58%',
                  zIndex: 15,
                }}
              >
                <StatBadge icon="heart" value={isEmptySlot ? '-' : frontInfo?.stats.hp ?? '-'} color="#f87171" />
                <StatBadge icon="attack" value={isEmptySlot ? '-' : frontInfo?.stats.atk ?? '-'} color="#fb923c" />
                <StatBadge icon="shield" value={isEmptySlot ? '-' : frontInfo?.stats.def ?? '-'} color="#60a5fa" />
              </motion.div>
            </AnimatePresence>
          </div>
        ) : null}

        {/* 토끼 이름 + 레벨 */}
        <div className="mt-[188px]">
          <AnimatePresence mode="wait">
            {isEmptySlot ? (
              <motion.div
                key="empty-slot"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="px-5 py-1.5 bg-black/30 border border-white/10 rounded-full backdrop-blur-xl"
              >
                <span className="text-[1.35rem] font-bold text-white/50 tracking-wide">
                  빈 슬롯
                </span>
              </motion.div>
            ) : frontInfo && frontDisplayName ? (
              <motion.div
                key={`${activeIndex}-${frontDisplayName}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="px-5 py-1.5 bg-black/30 border border-white/10 rounded-full backdrop-blur-xl"
              >
                <span className="text-[1.35rem] font-bold text-white tracking-wide">
                  Lv {frontInfo.level}.&nbsp; {frontDisplayName}
                </span>
              </motion.div>
            ) : (
              <motion.div className="h-[38px]" />
            )}
          </AnimatePresence>
        </div>

        {/* EXP 바 섹션 */}
        <div className="w-full px-8 mt-2 mb-6">
          {/* XP 라벨 */}
          <div className="flex items-center justify-end">
            <span className="text-base font-bold text-white/70">
              {expBar.current}/{expBar.max} XP
            </span>
          </div>
          {/* 마일스톤 버튼 + 배틀 힌트 */}
          <div className="flex items-center justify-between mb-1">
            {pendingCount > 0 && (
              <motion.button
                onClick={milestone.openMilestoneModal}
                className="flex items-center gap-1.5 h-11 px-4 bg-black/40 border border-white/10 rounded-full backdrop-blur-xl active:scale-95 mr-2"
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              >
                <svg className="w-7 h-7" viewBox="0 0 24 24">
                  <defs>
                    <linearGradient id="starGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#BBA46A" />
                      <stop offset="40%" stopColor="#C89A82" />
                      <stop offset="70%" stopColor="#C0929E" />
                      <stop offset="100%" stopColor="#AB96B4" />
                    </linearGradient>
                  </defs>
                  <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="url(#starGrad)" />
                </svg>
                <span className="text-lg font-bold text-white">
                  ×{pendingCount}
                </span>
              </motion.button>
            )}
            {isStudent && equippedRabbits.length > 0 && (
              <p className="text-sm text-white/70 font-bold ml-auto">
                캐릭터를 꾹 눌러서 배틀
              </p>
            )}
          </div>
          {/* EXP 바 */}
          <div className="px-3 py-1.5 bg-black/40 border border-white/10 rounded-full backdrop-blur-xl">
            <div className="h-3.5 overflow-hidden bg-white/20 rounded-full">
              <motion.div
                className="h-full rounded-full"
                style={{
                  background: 'linear-gradient(90deg, #BBA46A, #C89A82, #C0929E, #AB96B4)',
                }}
                initial={{ width: 0 }}
                animate={{
                  width: expBar.overflow
                    ? '100%'
                    : `${(expBar.current / expBar.max) * 100}%`,
                }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 도감 모달 */}
      {userCourseId && profile && (
        <RabbitDogam
          isOpen={showDogam}
          onClose={() => setShowDogam(false)}
          courseId={userCourseId}
          userId={profile.uid}
          equippedRabbits={equippedRabbits}
        />
      )}

      {/* 철권퀴즈 배틀 확인 모달 */}
      <TekkenBattleConfirmModal
        isOpen={showBattleConfirm}
        onConfirm={handleConfirmBattle}
        onCancel={() => setShowBattleConfirm(false)}
        equippedRabbits={equippedRabbits}
        holdings={holdings}
      />

      {/* 철권퀴즈 매칭 모달 */}
      <TekkenMatchmakingModal
        isOpen={showMatchmaking}
        onClose={() => {
          setShowMatchmaking(false);
          tekken.cancelMatch();
        }}
        matchState={tekken.matchState}
        waitTime={tekken.waitTime}
        error={tekken.error}
        onCancel={() => {
          setShowMatchmaking(false);
          tekken.cancelMatch();
        }}
      />

      {/* 철권퀴즈 배틀 오버레이 */}
      {showBattle && profile && (
        <TekkenBattleOverlay
          tekken={tekken}
          userId={profile.uid}
          onClose={() => {
            setShowBattle(false);
            tekken.leaveBattle();
          }}
        />
      )}
    </>
  );
}

/**
 * 궤도 위 캐릭터 — useTransform으로 타원 경로 공전
 */
function OrbitalCharacter({
  rabbitId,
  springRotation,
  charIndex,
}: {
  rabbitId: number;
  springRotation: MotionValue<number>;
  charIndex: number;
}) {
  const offset = charIndex * Math.PI;

  const x = useTransform(springRotation, r =>
    ORBIT_RX * (1 + Math.cos(r + offset))
  );
  const y = useTransform(springRotation, r =>
    ORBIT_RY * (1 + Math.sin(r + offset))
  );
  const scale = useTransform(springRotation, r => {
    const depth = (Math.sin(r + offset) + 1) / 2;
    return 0.5 + 0.5 * depth;
  });
  const zIndex = useTransform(springRotation, r =>
    Math.sin(r + offset) > -0.1 ? 10 : 1
  );
  const opacity = useTransform(springRotation, r => {
    const depth = (Math.sin(r + offset) + 1) / 2;
    return 0.4 + 0.6 * depth;
  });

  return (
    <motion.div
      className="absolute"
      style={{ left: 0, top: 0, x, y, scale, zIndex, opacity }}
    >
      <FloatingWrapper seed={charIndex}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/rabbit/rabbit-${String(rabbitId + 1).padStart(3, '0')}.png`}
          alt=""
          width={CHAR_SIZE}
          height={Math.round(CHAR_SIZE * (969 / 520))}
          draggable={false}
          className="drop-shadow-[0_4px_12px_rgba(0,0,0,0.3)]"
          style={{ filter: 'sepia(0.08) saturate(1.1) brightness(1.03) hue-rotate(-5deg)' }}
        />
      </FloatingWrapper>
    </motion.div>
  );
}

/**
 * 둥실둥실 떠다니는 래퍼
 */
function FloatingWrapper({ children, seed = 0 }: { children: React.ReactNode; seed?: number }) {
  const duration = 2.6 + seed * 0.4;
  return (
    <motion.div
      animate={{
        y: [0, -18, 0],
        rotate: [0, 2.5, 0, -2.5, 0],
      }}
      transition={{
        y: { duration, repeat: Infinity, ease: 'easeInOut' },
        rotate: { duration: duration * 1.6, repeat: Infinity, ease: 'easeInOut' },
      }}
    >
      {children}
    </motion.div>
  );
}

/** 스탯 배지 (빈 슬롯은 '-' 표시) */
function StatBadge({ icon, value, color }: { icon: string; value: number | string; color: string }) {
  return (
    <div className="flex items-center gap-2 px-3.5 py-1.5 bg-black/40 border border-white/10 rounded-full backdrop-blur-xl">
      {icon === 'heart' && (
        <svg className="w-6 h-6" viewBox="0 0 24 24" fill={color}>
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>
      )}
      {icon === 'attack' && (
        <svg className="w-6 h-6" viewBox="0 0 24 24" fill={color}>
          <path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z" />
        </svg>
      )}
      {icon === 'shield' && (
        <svg className="w-6 h-6" viewBox="0 0 24 24" fill={color}>
          <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
        </svg>
      )}
      <span className="text-white font-bold text-base">{value}</span>
    </div>
  );
}

/**
 * 궤도 위 빈 슬롯 플레이스홀더 — 흰색 "?" 표시
 */
function OrbitalPlaceholder({
  springRotation,
  charIndex,
}: {
  springRotation: MotionValue<number>;
  charIndex: number;
}) {
  const offset = charIndex * Math.PI;

  const x = useTransform(springRotation, r =>
    ORBIT_RX * (1 + Math.cos(r + offset))
  );
  const y = useTransform(springRotation, r =>
    ORBIT_RY * (1 + Math.sin(r + offset))
  );
  const scale = useTransform(springRotation, r => {
    const depth = (Math.sin(r + offset) + 1) / 2;
    return 0.5 + 0.5 * depth;
  });
  const zIndex = useTransform(springRotation, r =>
    Math.sin(r + offset) > -0.1 ? 10 : 1
  );
  const opacity = useTransform(springRotation, r => {
    const depth = (Math.sin(r + offset) + 1) / 2;
    return 0.3 + 0.5 * depth;
  });

  return (
    <motion.div
      className="absolute"
      style={{ left: 0, top: 0, x, y, scale, zIndex, opacity }}
    >
      <FloatingWrapper seed={charIndex}>
        <div
          className="flex items-center justify-center drop-shadow-[0_4px_12px_rgba(0,0,0,0.3)]"
          style={{ width: CHAR_SIZE, height: CHAR_SIZE, paddingTop: CHAR_SIZE * 0.55 }}
        >
          <span className="text-white font-black" style={{ fontSize: CHAR_SIZE * 0.7, lineHeight: 1, textShadow: '0 2px 8px rgba(0,0,0,0.3)' }}>
            ?
          </span>
        </div>
      </FloatingWrapper>
    </motion.div>
  );
}
