'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  type MotionValue,
} from 'framer-motion';
import { scaleCoord } from '@/lib/hooks/useViewportScale';


const SWIPE_THRESHOLD = 40;

/* 궤도 파라미터 (학생과 동일) */
const ORBIT_RX = 110;
const ORBIT_RY = 32;
const CHAR_SIZE = 115;
const CHAR_HALF = CHAR_SIZE / 2;
const ORBIT_Y_SHIFT = 135;

/* 교수님 홈에 표시할 토끼 후보 (rabbitId 0-indexed) */
const PROFESSOR_RABBIT_POOL = [21, 26, 56, 58, 59, 61];

/** 풀에서 랜덤 2마리 선택 */
function pickTwo(): [number, number] {
  const pool = [...PROFESSOR_RABBIT_POOL];
  const i1 = Math.floor(Math.random() * pool.length);
  const id1 = pool[i1];
  pool.splice(i1, 1);
  const i2 = Math.floor(Math.random() * pool.length);
  const id2 = pool[i2];
  return [id1, id2];
}

/**
 * 교수님 홈 캐릭터 박스 — 궤도 캐러셀 (이름/도감 없음)
 */
export default function ProfessorCharacterBox() {
  const [equipped, setEquipped] = useState<number[]>([]);

  useEffect(() => {
    setEquipped(pickTwo());
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
    touchStartX.current = scaleCoord(e.touches[0].clientX);
    touchStartY.current = scaleCoord(e.touches[0].clientY);
    swipeDir.current = null;
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (swipeDir.current === 'v') return;
    const dx = Math.abs(scaleCoord(e.touches[0].clientX) - touchStartX.current);
    const dy = Math.abs(scaleCoord(e.touches[0].clientY) - touchStartY.current);
    if (swipeDir.current === null && (dx > 8 || dy > 8)) {
      swipeDir.current = dx > dy ? 'h' : 'v';
    }
  }, []);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (swipeDir.current !== 'h') return;
    doOrbitSwap(scaleCoord(e.changedTouches[0].clientX) - touchStartX.current);
  }, [doOrbitSwap]);

  // PC 마우스 드래그
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (slotCount <= 1) return;
    isDragging.current = true;
    touchStartX.current = scaleCoord(e.clientX);
    e.preventDefault();
  }, [slotCount]);

  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      if (!isDragging.current) return;
      isDragging.current = false;
      doOrbitSwap(scaleCoord(e.clientX) - touchStartX.current);
    };
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, [doOrbitSwap]);

  const containerW = ORBIT_RX * 2 + CHAR_SIZE;
  const containerH = ORBIT_RY * 2 + CHAR_SIZE;

  if (equipped.length === 0) return null;

  return (
    <div className="flex flex-col items-center w-full">
      {/* 캐릭터 궤도 영역 */}
      <div
        className="relative select-none -mt-14"
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
    </div>
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
