'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  useMotionValue,
  useSpring,
} from 'framer-motion';
import { scaleCoord } from '@/lib/hooks/useViewportScale';
import { OrbitalCharacter } from './OrbitalCharacter';
import { useHomeScale } from './useHomeScale';
import { BASE_ORBIT_RX, BASE_ORBIT_RY, BASE_CHAR_SIZE, BASE_ORBIT_Y_SHIFT, SWIPE_THRESHOLD } from './characterBoxConstants';

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
  const scale = useHomeScale();

  // 스케일 적용된 궤도 파라미터
  const ORBIT_RX = Math.round(BASE_ORBIT_RX * scale);
  const ORBIT_RY = Math.round(BASE_ORBIT_RY * scale);
  const CHAR_SIZE = Math.round(BASE_CHAR_SIZE * scale);
  const CHAR_HALF = CHAR_SIZE / 2;
  const ORBIT_Y_SHIFT = Math.round(BASE_ORBIT_Y_SHIFT * scale);

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
        className="relative select-none"
        style={{
          width: containerW,
          height: containerH,
          marginTop: Math.round(-56 * scale),
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
            orbitRx={ORBIT_RX}
            orbitRy={ORBIT_RY}
            charSize={CHAR_SIZE}
          />
        ))}
      </div>
    </div>
  );
}
