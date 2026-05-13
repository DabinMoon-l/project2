'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useSpring,
} from 'framer-motion';
import { useCourse } from '@/lib/contexts';
import { useRabbitDoc } from '@/lib/hooks/useRabbit';
import { computeRabbitDisplayName } from '@/lib/utils/rabbitDisplayName';
import { scaleCoord } from '@/lib/hooks/useViewportScale';
import { OrbitalCharacter } from './OrbitalCharacter';
import { useHomeScale } from './useHomeScale';
import { BASE_ORBIT_RX, BASE_ORBIT_RY, BASE_CHAR_SIZE, BASE_ORBIT_Y_SHIFT, SWIPE_THRESHOLD } from './characterBoxConstants';

/* 토끼 총 마릿수 (rabbitId 0~79) */
const TOTAL_RABBITS = 80;

/**
 * 교수님 홈 캐릭터 박스 — 80마리 전체 순환 궤도 캐러셀
 *
 * - 첫 마운트: 랜덤 N → 슬롯 [N, N+1]
 * - 스와이프 회전: 한 번 돌릴 때마다 슬롯이 한 칸씩 시프트
 *   ([N, N+1] → [N+1, N+2] → [N+2, N+3] ...)
 * - 80번 다음은 0번으로 순환 (wrap-around)
 * - 앞쪽 토끼의 닉네임(해당 과목 기준)을 사진 아래 칩으로 표시
 */
export default function ProfessorCharacterBox() {
  const { userCourseId } = useCourse();
  const scale = useHomeScale();

  // 교수 홈은 학생 홈과 달리 도감/EXP/스탯이 없어 공간이 넉넉 → 토끼·궤도 1.3배 부스트
  const PROFESSOR_SCALE = 1.3;
  const ORBIT_RX = Math.round(BASE_ORBIT_RX * scale * PROFESSOR_SCALE);
  const ORBIT_RY = Math.round(BASE_ORBIT_RY * scale * PROFESSOR_SCALE);
  const CHAR_SIZE = Math.round(BASE_CHAR_SIZE * scale * PROFESSOR_SCALE);
  const CHAR_HALF = CHAR_SIZE / 2;
  const ORBIT_Y_SHIFT = Math.round(BASE_ORBIT_Y_SHIFT * scale * PROFESSOR_SCALE);

  // 두 슬롯의 rabbitId — null=아직 결정 전
  const [slots, setSlots] = useState<[number, number] | null>(null);
  // 어느 슬롯이 앞쪽인지 (0 또는 1)
  const [activeIndex, setActiveIndex] = useState(0);

  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const swipeDir = useRef<'h' | 'v' | null>(null);
  const isDragging = useRef(false);

  // 궤도 공전
  const rotationTarget = useRef(Math.PI / 2);
  const rotationMV = useMotionValue(Math.PI / 2);
  const springRotation = useSpring(rotationMV, { stiffness: 100, damping: 18 });

  // 첫 마운트 — 80마리 중 랜덤 N 한 마리 + 그 다음 번호 자동 배치
  useEffect(() => {
    const n = Math.floor(Math.random() * TOTAL_RABBITS);
    setSlots([n, (n + 1) % TOTAL_RABBITS]);
  }, []);

  // 공전 — 양방향 스와이프 모두 "다음 번호로 전진"
  // 회전 시: activeIndex 토글 + 새로 뒤로 간 슬롯의 ID를 앞 ID+1로 교체 → 사실상 한 칸 시프트
  const doOrbitSwap = useCallback((dx: number) => {
    if (Math.abs(dx) <= SWIPE_THRESHOLD) return;
    rotationTarget.current += (dx < 0 ? 1 : -1) * Math.PI;
    rotationMV.set(rotationTarget.current);
    setActiveIndex(prev => {
      const next = prev === 0 ? 1 : 0;
      setSlots(curr => {
        if (!curr) return curr;
        const newSlots: [number, number] = [curr[0], curr[1]];
        // 새 뒤쪽 슬롯(=prev)의 토끼를 (새 앞쪽 슬롯 ID + 1)로 교체
        newSlots[prev] = (curr[next] + 1) % TOTAL_RABBITS;
        return newSlots;
      });
      return next;
    });
  }, [rotationMV]);

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
    isDragging.current = true;
    touchStartX.current = scaleCoord(e.clientX);
    e.preventDefault();
  }, []);

  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      if (!isDragging.current) return;
      isDragging.current = false;
      doOrbitSwap(scaleCoord(e.clientX) - touchStartX.current);
    };
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, [doOrbitSwap]);

  // 앞쪽 토끼의 닉네임 + 최초 발견자(이름 지은 사람) 조회
  const frontRabbitId = slots ? slots[activeIndex] : null;
  const { rabbit: frontRabbitDoc } = useRabbitDoc(userCourseId, frontRabbitId);
  const frontDisplayName = frontRabbitId === null
    ? null
    : computeRabbitDisplayName(frontRabbitDoc?.name, 1, frontRabbitId);
  const namedBy = frontRabbitDoc?.name ? frontRabbitDoc?.firstDiscovererName : null;

  const containerW = ORBIT_RX * 2 + CHAR_SIZE;
  const containerH = ORBIT_RY * 2 + CHAR_SIZE;

  if (!slots) return null;

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

        {/* 공전 캐릭터 2마리 — key는 슬롯 위치 고정(인스턴스 보존), rabbitId만 갱신 */}
        {slots.map((rabbitId, idx) => (
          <OrbitalCharacter
            key={`slot-${idx}`}
            rabbitId={rabbitId}
            springRotation={springRotation}
            charIndex={idx}
            orbitRx={ORBIT_RX}
            orbitRy={ORBIT_RY}
            charSize={CHAR_SIZE}
          />
        ))}
      </div>

      {/* 토끼 이름 칩 — 닉네임 + 지은이 */}
      <div style={{ marginTop: Math.round(120 * scale), position: 'relative', top: Math.round(16 * scale) }}>
        <AnimatePresence mode="wait">
          {frontDisplayName && (
            <motion.div
              key={`${frontRabbitId}-${frontDisplayName}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="px-5 py-2 flex flex-col items-center gap-0.5 bg-black/30 border border-white/10 rounded-2xl backdrop-blur-xl"
            >
              <span className="text-base font-bold text-white tracking-wide leading-none">
                {frontDisplayName}
              </span>
              {namedBy && (
                <span className="text-[11px] font-medium text-white/60 tracking-wide leading-none">
                  by {namedBy}
                </span>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
