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
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { useUser, useCourse } from '@/lib/contexts';
import { useTheme } from '@/styles/themes/useTheme';

import RabbitImage from '@/components/common/RabbitImage';
import GachaResultModal, { type RollResultData } from './GachaResultModal';
import RabbitDogam from './RabbitDogam';

const GACHA_MESSAGES = [
  '탈피가 시작됐어요!',
  '윽... 몸이 이상해요!',
  '뭔가 변하고 있어요!',
  '두근두근...!',
  '새로운 모습이 될 것 같아요!',
];

const SWIPE_THRESHOLD = 40;

/* 궤도 파라미터 */
const ORBIT_RX = 175;
const ORBIT_RY = 50;
const CHAR_SIZE = 180;
const CHAR_HALF = CHAR_SIZE / 2;
const ORBIT_Y_SHIFT = 195; // 궤도를 아래로 — 앞 캐릭터 하체

/** 플레이스홀더 스탯 (추후 실제 데이터로 교체) */
function getPlaceholderStats(rabbitId: number) {
  return {
    hp: 10 + ((rabbitId * 3) % 20),
    atk: 3 + ((rabbitId * 7) % 12),
    def: 2 + ((rabbitId * 5) % 8),
  };
}

/**
 * 캐릭터 섹션 — 궤도 캐러셀 + XP/도감 + EXP 바
 *
 * 2마리 장착: 타원 궤도를 따라 공전 (터치 + 마우스 드래그)
 * 1마리 장착: 가운데 표시 + 스탯
 */
export default function CharacterBox() {
  const { profile } = useUser();
  const { userCourseId } = useCourse();
  const { theme } = useTheme();

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

  // 뽑기 상태
  const [canGacha, setCanGacha] = useState(false);
  const [showGachaModal, setShowGachaModal] = useState(false);
  const [showGachaBubble, setShowGachaBubble] = useState(false);
  const [bubbleMessage, setBubbleMessage] = useState('');
  const [rollResult, setRollResult] = useState<RollResultData | null>(null);
  const [isGachaAnimating, setIsGachaAnimating] = useState(false);

  // 도감
  const [showDogam, setShowDogam] = useState(false);

  // 장착된 토끼
  const equippedRabbits = profile?.equippedRabbits || [];
  const slot0 = equippedRabbits[0] || (userCourseId ? { rabbitId: 0, courseId: userCourseId } : null);
  const slot1 = equippedRabbits[1] || null;
  const slots = slot1 ? [slot0!, slot1] : slot0 ? [slot0] : [];
  const slotCount = slots.length;

  // EXP
  const currentExp = profile ? profile.totalExp % 50 : 0;
  const totalExp = profile?.totalExp || 0;

  // 뽑기 가능 여부
  useEffect(() => {
    if (!profile) return;
    const lastGachaExp = profile.lastGachaExp || 0;
    const currentMilestone = Math.floor(profile.totalExp / 50) * 50;
    if (currentMilestone > lastGachaExp && profile.totalExp >= 50) {
      setCanGacha(true);
      setShowGachaBubble(true);
      setBubbleMessage(GACHA_MESSAGES[Math.floor(Math.random() * GACHA_MESSAGES.length)]);
    } else {
      setCanGacha(false);
      setShowGachaBubble(false);
    }
  }, [profile?.totalExp, profile?.lastGachaExp]);

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

  // 모바일 터치
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    swipeDir.current = null;
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (swipeDir.current === 'v') return;
    const dx = Math.abs(e.touches[0].clientX - touchStartX.current);
    const dy = Math.abs(e.touches[0].clientY - touchStartY.current);
    if (swipeDir.current === null && (dx > 8 || dy > 8)) {
      swipeDir.current = dx > dy ? 'h' : 'v';
    }
  }, []);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (swipeDir.current !== 'h') return;
    doOrbitSwap(e.changedTouches[0].clientX - touchStartX.current);
  }, [doOrbitSwap]);

  // PC 마우스 드래그
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (slotCount <= 1) return;
    isDragging.current = true;
    touchStartX.current = e.clientX;
    e.preventDefault();
  }, [slotCount]);

  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      if (!isDragging.current) return;
      isDragging.current = false;
      doOrbitSwap(e.clientX - touchStartX.current);
    };
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, [doOrbitSwap]);

  // 뽑기
  const handleSpin = useCallback(async () => {
    if (!profile || !userCourseId || !canGacha) return;
    setIsGachaAnimating(true);
    try {
      const spinRabbitGacha = httpsCallable<{ courseId: string }, RollResultData>(
        functions, 'spinRabbitGacha'
      );
      const [result] = await Promise.all([
        spinRabbitGacha({ courseId: userCourseId }),
        new Promise(resolve => setTimeout(resolve, 2000)),
      ]);
      setRollResult(result.data);
      setCanGacha(false);
      setShowGachaBubble(false);
    } catch (error) {
      console.error('뽑기 실패:', error);
    } finally {
      setIsGachaAnimating(false);
    }
  }, [profile, userCourseId, canGacha]);

  // 발견하기
  const handleDiscover = useCallback(async (
    result: RollResultData,
    name?: string,
    equipSlot?: number
  ) => {
    if (!userCourseId) return;
    try {
      const claimGachaRabbit = httpsCallable(functions, 'claimGachaRabbit');
      await claimGachaRabbit({
        courseId: userCourseId,
        rabbitId: result.rabbitId,
        action: 'discover',
        name,
        equipSlot,
      });
      setShowGachaModal(false);
      setRollResult(null);
    } catch (error) {
      console.error('발견하기 실패:', error);
    }
  }, [userCourseId]);

  // 앞 캐릭터 스탯
  const frontSlot = slots[activeIndex] || slots[0] || null;
  const frontStats = frontSlot ? getPlaceholderStats(frontSlot.rabbitId) : null;

  const containerW = ORBIT_RX * 2 + CHAR_SIZE;
  const containerH = ORBIT_RY * 2 + CHAR_SIZE;

  return (
    <>
      <div className="flex flex-col items-center w-full">
        {/* XP / 도감 */}
        <div className="w-full flex items-center justify-between px-8 mb-8 mt-20 relative z-20">
          <div className="h-11 flex items-center gap-12 px-9 bg-black/40 border border-white/10 rounded-full backdrop-blur-xl">
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

        {/* 캐릭터 영역 */}
        {slotCount > 1 ? (
          <div
            className="relative select-none -mt-20"
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
            {/* 궤도 타원 (몸통 위치, 캐릭터 뒤) */}
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

            {/* 공전 캐릭터 */}
            {slots.map((slot, idx) => (
              <OrbitalCharacter
                key={idx}
                rabbitId={slot.rabbitId}
                springRotation={springRotation}
                charIndex={idx}
              />
            ))}

            {/* 스탯 (앞 캐릭터 옆, 세로 배치) */}
            <AnimatePresence mode="wait">
              {frontStats && (
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
                  <StatBadge icon="heart" value={frontStats.hp} color="#f87171" />
                  <StatBadge icon="attack" value={frontStats.atk} color="#fb923c" />
                  <StatBadge icon="shield" value={frontStats.def} color="#60a5fa" />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : slots[0] ? (
          /* 1마리 — 가운데 + 스탯 옆 */
          <div className="flex items-center gap-8 -mt-20">
            <FloatingWrapper seed={0}>
              <RabbitImage
                rabbitId={slots[0].rabbitId}
                size={180}
                priority
                className="drop-shadow-[0_4px_12px_rgba(0,0,0,0.3)]"
                style={{ filter: 'sepia(0.08) saturate(1.1) brightness(1.03) hue-rotate(-5deg)' }}
              />
            </FloatingWrapper>
            {frontStats && (
              <div className="flex flex-col gap-1.5">
                <StatBadge icon="heart" value={frontStats.hp} color="#f87171" />
                <StatBadge icon="attack" value={frontStats.atk} color="#fb923c" />
                <StatBadge icon="shield" value={frontStats.def} color="#60a5fa" />
              </div>
            )}
          </div>
        ) : null}

        {/* 뽑기 말풍선 */}
        <AnimatePresence>
          {showGachaBubble && (
            <motion.button
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              onClick={() => setShowGachaModal(true)}
              className="px-4 py-2 bg-white border-2 border-[#1A1A1A] whitespace-nowrap"
              style={{ boxShadow: '3px 3px 0 #1A1A1A' }}
            >
              <span className="text-sm font-bold">{bubbleMessage}</span>
            </motion.button>
          )}
        </AnimatePresence>

        {/* EXP 바 */}
        <div className="w-full px-8 mt-[180px]">
          <div className="text-right mb-1">
            <span className="text-lg font-bold text-white/70">
              {currentExp}/50 XP
            </span>
          </div>
          <div className="px-3 py-1.5 bg-black/40 border border-white/10 rounded-full backdrop-blur-xl">
            <div className="h-3.5 overflow-hidden bg-white/20 rounded-full">
              <motion.div
                className="h-full rounded-full"
                style={{ backgroundColor: theme.colors.accent }}
                initial={{ width: 0 }}
                animate={{ width: `${(currentExp / 50) * 100}%` }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 뽑기 모달 */}
      <GachaResultModal
        isOpen={showGachaModal}
        onClose={() => { setShowGachaModal(false); setRollResult(null); }}
        result={rollResult}
        isAnimating={isGachaAnimating}
        onSpin={handleSpin}
        canGacha={canGacha}
        onDiscover={handleDiscover}
      />

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
    </>
  );
}

/**
 * 궤도 위 캐릭터 — useTransform으로 타원 경로 공전
 * 아래(sin>0) = 앞(크고 선명), 위(sin<0) = 뒤(작고 흐림)
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
        <RabbitImage
          rabbitId={rabbitId}
          size={CHAR_SIZE}
          priority
          className="drop-shadow-[0_4px_12px_rgba(0,0,0,0.3)]"
          style={{ filter: 'sepia(0.08) saturate(1.1) brightness(1.03) hue-rotate(-5deg)' }}
        />
      </FloatingWrapper>
    </motion.div>
  );
}

/**
 * 둥실둥실 떠다니는 래퍼
 * seed로 캐릭터마다 타이밍을 살짝 다르게 하여 자연스러움 연출
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

/** 스탯 배지 */
function StatBadge({ icon, value, color }: { icon: string; value: number; color: string }) {
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
