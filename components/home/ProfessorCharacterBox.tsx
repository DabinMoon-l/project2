'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useSpring,
  useTransform,
  type MotionValue,
} from 'framer-motion';

import RabbitImage from '@/components/common/RabbitImage';
import ProfessorRabbitDogam from './ProfessorRabbitDogam';
import {
  getProfessorEquipped,
  setProfessorEquipped,
  getProfessorRabbitName,
} from '@/lib/utils/professorRabbit';

const SWIPE_THRESHOLD = 40;

/* 궤도 파라미터 (학생 CharacterBox와 동일) */
const ORBIT_RX = 175;
const ORBIT_RY = 50;
const CHAR_SIZE = 180;
const CHAR_HALF = CHAR_SIZE / 2;
const ORBIT_Y_SHIFT = 195;

/**
 * 교수님 홈 캐릭터 박스 — 궤도 캐러셀 + 도감 + 토끼 이름
 */
export default function ProfessorCharacterBox() {
  // localStorage에서 장착 토끼 로드 (없으면 랜덤 2마리)
  const [equipped, setEquipped] = useState<number[]>([]);
  const [showDogam, setShowDogam] = useState(false);
  const [nameRefreshKey, setNameRefreshKey] = useState(0);

  useEffect(() => {
    let saved = getProfessorEquipped();
    if (saved.length === 0) {
      // 초기: 랜덤 2마리 배정
      const id1 = Math.floor(Math.random() * 80);
      let id2 = Math.floor(Math.random() * 79);
      if (id2 >= id1) id2++;
      saved = [id1, id2];
      setProfessorEquipped(saved);
    }
    setEquipped(saved);
  }, []);

  // 장착 변경 핸들러 (도감에서 호출)
  const handleEquipChange = useCallback((newEquipped: number[]) => {
    setEquipped([...newEquipped]);
    setProfessorEquipped(newEquipped);
    setNameRefreshKey(k => k + 1);
  }, []);

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

  const slotCount = equipped.length;

  // 앞 토끼 이름
  const frontRabbitId = equipped[activeIndex] ?? equipped[0] ?? null;
  const frontName = useMemo(() => {
    if (frontRabbitId === null) return null;
    return getProfessorRabbitName(frontRabbitId) || null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frontRabbitId, nameRefreshKey]);

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

  const containerW = ORBIT_RX * 2 + CHAR_SIZE;
  const containerH = ORBIT_RY * 2 + CHAR_SIZE;

  if (equipped.length === 0) return null;

  return (
    <>
      <div className="flex flex-col items-center w-full">
        {/* 도감 버튼 */}
        <div className="w-full flex items-center justify-end px-8 mb-4 mt-6 relative z-20">
          <button
            onClick={() => setShowDogam(true)}
            className="h-11 flex items-center justify-center px-9 bg-black/40 border border-white/10 rounded-full backdrop-blur-xl transition-transform duration-200 hover:scale-110 active:scale-95"
          >
            <span className="text-xl font-bold text-white">도감</span>
          </button>
        </div>

        {/* 캐릭터 궤도 영역 */}
        {slotCount >= 2 ? (
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

            {/* 공전 캐릭터 2마리 */}
            {equipped.map((rabbitId, idx) => (
              <OrbitalCharacter
                key={`${rabbitId}-${idx}`}
                rabbitId={rabbitId}
                springRotation={springRotation}
                charIndex={idx}
              />
            ))}
          </div>
        ) : equipped.length === 1 ? (
          /* 1마리만 장착 시 단독 표시 */
          <div className="flex justify-center -mt-10">
            <FloatingWrapper seed={0}>
              <RabbitImage
                rabbitId={equipped[0]}
                size={CHAR_SIZE}
                priority
                className="drop-shadow-[0_4px_12px_rgba(0,0,0,0.3)]"
                style={{ filter: 'sepia(0.08) saturate(1.1) brightness(1.03) hue-rotate(-5deg)' }}
              />
            </FloatingWrapper>
          </div>
        ) : null}

        {/* 토끼 이름 (레벨 없이) — 캐릭터와 과목체인지 중간 */}
        <div className={slotCount >= 2 ? 'mt-[160px]' : 'mt-4'}>
          <AnimatePresence mode="wait">
            {frontName ? (
              <motion.div
                key={`${activeIndex}-${frontName}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="px-5 py-1.5 bg-black/30 border border-white/10 rounded-full backdrop-blur-xl"
              >
                <span className="text-2xl font-bold text-white tracking-wide">
                  {frontName}
                </span>
              </motion.div>
            ) : (
              <motion.div className="h-[38px]" />
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* 도감 모달 */}
      <ProfessorRabbitDogam
        isOpen={showDogam}
        onClose={() => setShowDogam(false)}
        equipped={equipped}
        onEquipChange={handleEquipChange}
      />
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
