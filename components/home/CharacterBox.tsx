'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useSpring,
} from 'framer-motion';
import { useBattleSessionStore } from '@/lib/stores/battleSessionStore';
import { useUser, useCourse, useMilestone, useDetailPanel } from '@/lib/contexts';
import { useTheme } from '@/styles/themes/useTheme';
import { useWideMode } from '@/lib/hooks/useViewportScale';
import { useRabbitDoc, getRabbitStats } from '@/lib/hooks/useRabbit';
import { computeRabbitDisplayName } from '@/lib/utils/rabbitDisplayName';
import dynamic from 'next/dynamic';
import { useExpToast } from '@/components/common/ExpToast';
import { calcBattleXp } from '@/lib/utils/tekkenDamage';

import TekkenMatchmakingModal from '@/components/tekken/TekkenMatchmakingModal';
import TekkenBattleConfirmModal from '@/components/tekken/TekkenBattleConfirmModal';
import { useTekkenBattle } from '@/lib/hooks/useTekkenBattle';

const BattleInviteSheet = dynamic(() => import('@/components/tekken/BattleInviteSheet'), { ssr: false });

// 대형 컴포넌트 lazy load (조건부 렌더링 — 버튼 클릭/배틀 시작 시에만 로드)
const RabbitDogam = dynamic(() => import('./RabbitDogam'), { ssr: false });
const TekkenBattleOverlay = dynamic(() => import('@/components/tekken/TekkenBattleOverlay'), { ssr: false });
import { BATTLE_CONFIG } from '@/lib/types/tekken';
import { scaleCoord } from '@/lib/hooks/useViewportScale';
import { SWIPE_THRESHOLD, BASE_ORBIT_RX, BASE_ORBIT_RY, BASE_CHAR_SIZE, BASE_ORBIT_Y_SHIFT } from './characterBoxConstants';
import { useHomeScale } from './useHomeScale';
import { StatBadge } from './StatBadge';
import { FloatingWrapper } from './FloatingWrapper';
import { OrbitalCharacter } from './OrbitalCharacter';
import { OrbitalPlaceholder } from './OrbitalPlaceholder';

/**
 * 캐릭터 섹션 — 궤도 캐러셀 + XP/도감 + EXP 바 + 마일스톤
 */
export default function CharacterBox() {
  const { profile } = useUser();
  const { userCourseId } = useCourse();
  const { theme } = useTheme();
  const isWide = useWideMode();
  const { openDetail: openDetailPanel, closeDetail: closeDetailPanel, lockDetail, unlockDetail } = useDetailPanel();

  // 마일스톤 Context (holdings 포함 — 중복 onSnapshot 방지)
  const milestone = useMilestone();
  const { holdings } = milestone;
  const { showExpToast } = useExpToast();

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
  const dogamBtnRef = useRef<HTMLButtonElement>(null);
  const [dogamRect, setDogamRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  // 철권퀴즈 — long press 진입
  const [showBattleConfirm, setShowBattleConfirm] = useState(false);
  const [showMatchmaking, setShowMatchmaking] = useState(false);
  const [showBattle, setShowBattle] = useState(false);
  // 실시간 배틀 신청 바텀시트
  const [showInviteSheet, setShowInviteSheet] = useState(false);
  const [inviteChapters, setInviteChapters] = useState<string[]>([]);
  /** 현재 배틀 세션이 AI 전용 매칭인지 — overlay가 선(先) 카운트다운 활성화 판단용 */
  const [battleAiOnly, setBattleAiOnly] = useState(false);
  const [isPressing, setIsPressing] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressStartPos = useRef({ x: 0, y: 0 });
  const longPressTriggered = useRef(false);
  const tekken = useTekkenBattle(profile?.uid);
  const isStudent = profile?.role !== 'professor';
  const scale = useHomeScale();

  // 스케일 적용된 궤도 파라미터
  const ORBIT_RX = Math.round(BASE_ORBIT_RX * scale);
  const ORBIT_RY = Math.round(BASE_ORBIT_RY * scale);
  const CHAR_SIZE = Math.round(BASE_CHAR_SIZE * scale);
  const CHAR_HALF = CHAR_SIZE / 2;
  const ORBIT_Y_SHIFT = Math.round(BASE_ORBIT_Y_SHIFT * scale);

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
  // 홀딩이 있으면 실제 스탯, 없으면 기본 토끼(#0)는 베이스 스탯 폴백
  const frontInfo = frontHolding
    ? getRabbitStats(frontHolding)
    : frontSlot
      ? { level: 1, stats: { hp: 25, atk: 8, def: 5 } } // 베이스 스탯 폴백
      : null;

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

  // 배틀 flow 중 3쪽 패널 잠금 (배틀준비~매칭~배틀~결과)
  const isBattleActive = showBattleConfirm || showMatchmaking || showBattle;
  useEffect(() => {
    if (!isWide) return;
    if (isBattleActive) {
      lockDetail();
      return () => { unlockDetail(); };
    }
  }, [isBattleActive, isWide, lockDetail, unlockDetail]);

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
    if (!isStudent || !userCourseId || slotCount === 0) return;
    longPressStartPos.current = { x, y };
    longPressTriggered.current = false;
    setIsPressing(true);
    clearLongPress();
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      setIsPressing(false);
      if (navigator.vibrate) navigator.vibrate(50);
      setShowBattleConfirm(true);
    }, BATTLE_CONFIG.LONG_PRESS_MS);
  }, [isStudent, userCourseId, slotCount, clearLongPress]);

  // 배틀 확인 → 매칭 시작
  // aiOnly=true면 "상대 찾는 중" 모달 건너뛰고 바로 배틀 오버레이로 전환 후
  // 5초 자체 카운트다운이 CF matchWithBot의 배틀 데이터 생성 대기를 겸함
  const handleConfirmBattle = useCallback((chapters: string[], aiOnly: boolean) => {
    if (!userCourseId) return;
    setShowBattleConfirm(false);
    setBattleAiOnly(aiOnly);
    if (aiOnly) {
      setShowBattle(true);
    } else {
      setShowMatchmaking(true);
    }
    tekken.startMatchmaking(userCourseId, chapters, aiOnly);
  }, [userCourseId, tekken]);

  // "배틀 신청" — 접속자 바텀시트만 띄우고 확인 모달은 뒤에 유지
  const handleRequestInvite = useCallback((chapters: string[]) => {
    if (!userCourseId) return;
    setInviteChapters(chapters);
    setShowInviteSheet(true);
  }, [userCourseId]);

  // 신청이 수락됨 — 매칭 단계 스킵하고 바로 배틀 오버레이로 (countdown 즉시)
  const handleInviteAccepted = useCallback((battleId: string) => {
    setShowInviteSheet(false);
    setShowBattleConfirm(false);
    setBattleAiOnly(false);
    tekken.attachBattleId(battleId);
    setShowBattle(true);
  }, [tekken]);

  // 배틀 신청 수락 → zustand store 로 전달된 pending 배틀 시작
  // (Next.js searchParams 는 re-render 타이밍 이슈로 불안정)
  const pendingBattle = useBattleSessionStore((s) => s.pending);
  const consumePendingBattle = useBattleSessionStore((s) => s.consume);
  useEffect(() => {
    if (!pendingBattle) return;
    tekken.attachBattleId(pendingBattle.battleId);
    setBattleAiOnly(pendingBattle.aiOnly);
    setShowBattle(true);
    consumePendingBattle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingBattle]);

  const onLongPressMove = useCallback((x: number, y: number) => {
    const dx = Math.abs(x - longPressStartPos.current.x);
    const dy = Math.abs(y - longPressStartPos.current.y);
    if (dx > 10 || dy > 10) {
      clearLongPress();
      setIsPressing(false);
    }
  }, [clearLongPress]);

  const onLongPressEnd = useCallback(() => {
    clearLongPress();
    setIsPressing(false);
  }, [clearLongPress]);

  // 모바일 터치
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = scaleCoord(e.touches[0].clientX);
    touchStartY.current = scaleCoord(e.touches[0].clientY);
    swipeDir.current = null;
    onLongPressStart(scaleCoord(e.touches[0].clientX), scaleCoord(e.touches[0].clientY));
  }, [onLongPressStart]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const cx = scaleCoord(e.touches[0].clientX);
    const cy = scaleCoord(e.touches[0].clientY);
    onLongPressMove(cx, cy);
    if (swipeDir.current === 'v') return;
    const dx = Math.abs(cx - touchStartX.current);
    const dy = Math.abs(cy - touchStartY.current);
    if (swipeDir.current === null && (dx > 8 || dy > 8)) {
      swipeDir.current = dx > dy ? 'h' : 'v';
    }
  }, [onLongPressMove]);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    onLongPressEnd();
    if (longPressTriggered.current) return;
    if (swipeDir.current !== 'h') return;
    doOrbitSwap(scaleCoord(e.changedTouches[0].clientX) - touchStartX.current);
  }, [doOrbitSwap, onLongPressEnd]);

  // PC 마우스 드래그
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    touchStartX.current = scaleCoord(e.clientX);
    onLongPressStart(scaleCoord(e.clientX), scaleCoord(e.clientY));
    e.preventDefault();
  }, [onLongPressStart]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging.current) onLongPressMove(scaleCoord(e.clientX), scaleCoord(e.clientY));
    };
    const handleMouseUp = (e: MouseEvent) => {
      onLongPressEnd();
      if (!isDragging.current) return;
      isDragging.current = false;
      if (longPressTriggered.current) return;
      if (slotCount <= 1) return;
      doOrbitSwap(scaleCoord(e.clientX) - touchStartX.current);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [doOrbitSwap, onLongPressMove, onLongPressEnd, slotCount]);

  // 매칭 성공 + 배틀 데이터 수신 확인 후 전환
  const hasBattleData = !!tekken.battle;
  useEffect(() => {
    if (tekken.matchState === 'matched' && hasBattleData) {
      const timer = setTimeout(() => {
        setShowMatchmaking(false);
        setShowBattle(true);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [tekken.matchState, hasBattleData]);

  const containerW = ORBIT_RX * 2 + CHAR_SIZE;
  const containerH = ORBIT_RY * 2 + CHAR_SIZE;

  return (
    <>
      <div className="flex-none flex flex-col items-center w-full">
        {/* XP / 도감 */}
        <div className="w-full flex items-center justify-between px-8 mb-1 mt-1 relative z-20">
          <div className="flex items-center gap-2.5 bg-black/40 border border-white/10 rounded-full backdrop-blur-xl" style={{ height: Math.round(36 * scale), paddingLeft: Math.round(20 * scale), paddingRight: Math.round(20 * scale) }}>
            <span className="font-bold text-white" style={{ fontSize: Math.round(17 * scale) }}>XP</span>
            <span className="font-bold text-white leading-none text-right" style={{ fontSize: Math.round(17 * scale) }}>{totalExp}</span>
          </div>
          <button
            ref={dogamBtnRef}
            onClick={() => {
              if (isWide && userCourseId && profile) {
                // 가로모드: 3쪽 디테일 패널에 도감 렌더링
                openDetailPanel(
                  <RabbitDogam
                    isPanelMode
                    isOpen
                    onClose={closeDetailPanel}
                    courseId={userCourseId}
                    userId={profile.uid}
                    equippedRabbits={equippedRabbits}
                    holdings={holdings}
                  />
                );
              } else {
                // 세로모드: 기존 포탈 모달
                if (dogamBtnRef.current) {
                  const r = dogamBtnRef.current.getBoundingClientRect();
                  setDogamRect({ x: r.x, y: r.y, width: r.width, height: r.height });
                }
                setShowDogam(true);
              }
            }}
            className="flex items-center justify-center bg-black/40 border border-white/10 rounded-full backdrop-blur-xl transition-transform duration-200 hover:scale-110 active:scale-95"
            style={{ height: Math.round(36 * scale), paddingLeft: Math.round(20 * scale), paddingRight: Math.round(20 * scale) }}
          >
            <span className="font-bold text-white" style={{ fontSize: Math.round(17 * scale) }}>도감</span>
          </button>
        </div>

        {/* 간격: 도감줄 ↔ 캐릭터 */}

        {/* 캐릭터 영역 — 항상 2슬롯 궤도 캐러셀 */}
        {slotCount >= 2 ? (
          <div
            className="relative select-none"
            style={{
              width: containerW,
              height: containerH,
              marginTop: Math.round(-56 * scale),
              isolation: 'isolate',
              cursor: 'grab',
              WebkitTouchCallout: 'none',
              touchAction: 'none',
            }}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onMouseDown={onMouseDown}
            onContextMenu={(e) => e.preventDefault()}
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
                  isPressing={isPressing}
                  orbitRx={ORBIT_RX}
                  orbitRy={ORBIT_RY}
                  charSize={CHAR_SIZE}
                />
              ) : (
                <OrbitalPlaceholder
                  key={`empty-${idx}`}
                  springRotation={springRotation}
                  charIndex={idx}
                  orbitRx={ORBIT_RX}
                  orbitRy={ORBIT_RY}
                  charSize={CHAR_SIZE}
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
                className="absolute flex flex-col gap-1"
                style={{
                  right: Math.round(16 * scale),
                  top: '58%',
                  zIndex: 15,
                  transform: `scale(${Math.max(0.85, scale)})`,
                  transformOrigin: 'right center',
                }}
              >
                <StatBadge icon="heart" value={isEmptySlot ? '-' : frontInfo?.stats.hp ?? '-'} color="#f87171" />
                <StatBadge icon="attack" value={isEmptySlot ? '-' : frontInfo?.stats.atk ?? '-'} color="#fb923c" />
                <StatBadge icon="shield" value={isEmptySlot ? '-' : frontInfo?.stats.def ?? '-'} color="#60a5fa" />
              </motion.div>
            </AnimatePresence>
          </div>
        ) : null}

        {/* 간격: 캐릭터 ↔ 닉네임 */}

        {/* 토끼 이름 + 레벨 */}
        <div style={{ marginTop: Math.round(88 * scale), position: 'relative', top: Math.round(16 * scale) }}>
          <AnimatePresence mode="wait">
            {isEmptySlot ? (
              <motion.div
                key="empty-slot"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="px-4 py-1.5 flex items-center justify-center bg-black/30 border border-white/10 rounded-full backdrop-blur-xl"
              >
                <span className="text-[11px] font-bold text-white/50 tracking-wide leading-none">
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
                className="px-4 py-1.5 flex items-center justify-center bg-black/30 border border-white/10 rounded-full backdrop-blur-xl"
              >
                <span className="text-[11px] font-bold text-white tracking-wide leading-none">
                  Lv {frontInfo.level}.&nbsp; {frontDisplayName}
                </span>
              </motion.div>
            ) : (
              <motion.div className="h-[22px]" />
            )}
          </AnimatePresence>
        </div>

        {/* EXP 바 섹션 */}
        <div className="w-full px-8 mt-1 mb-1">
          {/* XP라벨 + 배틀힌트 + 마일스톤 별 */}
          <div className="flex items-end justify-between mb-1">
            {/* 마일스톤 별 (좌측) */}
            <div>
              {pendingCount > 0 && (
                <motion.button
                  ref={milestone.milestoneButtonRef as React.RefObject<HTMLButtonElement>}
                  onClick={milestone.openMilestoneModal}
                  className="flex items-center gap-1 h-7 px-2.5 bg-black/40 border border-white/10 rounded-full backdrop-blur-xl active:scale-95"
                  animate={{ scale: [1, 1.05, 1] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
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
                  <span className="text-sm font-bold text-white">
                    ×{pendingCount}
                  </span>
                </motion.button>
              )}
            </div>
            {/* XP라벨 + 배틀힌트 (우측) */}
            <div className="flex flex-col items-end">
              <span className="text-[11px] font-bold text-white/70">
                {expBar.current}/{expBar.max} XP
              </span>
              {isStudent && slotCount > 0 && (
                <p className="text-[10px] text-white/60 font-bold">
                  캐릭터를 꾹 눌러서 배틀
                </p>
              )}
            </div>
          </div>
          {/* EXP 바 */}
          <div className="bg-black/40 border border-white/10 rounded-full backdrop-blur-xl" style={{ padding: `${Math.round(6 * scale)}px ${Math.round(12 * scale)}px` }}>
            <div className="overflow-hidden bg-white/20 rounded-full" style={{ height: Math.round(12 * scale) }}>
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
          buttonRect={dogamRect}
          holdings={holdings}
        />
      )}

      {/* 철권퀴즈 배틀 확인 모달 */}
      <TekkenBattleConfirmModal
        isOpen={showBattleConfirm}
        onConfirm={handleConfirmBattle}
        onCancel={() => setShowBattleConfirm(false)}
        onRequestInvite={handleRequestInvite}
        equippedRabbits={[slot0, slot1].filter((s): s is { rabbitId: number; courseId: string } => s !== null)}
        holdings={holdings}
        courseId={userCourseId || 'biology'}
      />

      {/* 접속자 바텀시트 — 실시간 배틀 신청 */}
      {userCourseId && (
        <BattleInviteSheet
          isOpen={showInviteSheet}
          courseId={userCourseId}
          chapters={inviteChapters}
          onClose={() => setShowInviteSheet(false)}
          onAccepted={handleInviteAccepted}
        />
      )}

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
          aiOnly={battleAiOnly}
          onClose={() => {
            // 배틀 결과에서 XP 토스트 표시
            if (tekken.result && profile) {
              const isWinner = tekken.result.winnerId === profile.uid;
              const xp = calcBattleXp(isWinner, 0);
              showExpToast(xp, isWinner ? '배틀 승리' : '배틀 참여');
            }
            setShowBattle(false);
            setBattleAiOnly(false);
            tekken.leaveBattle();
          }}
        />
      )}
    </>
  );
}

// OrbitalCharacter, OrbitalPlaceholder, FloatingWrapper, StatBadge → 별도 파일로 분리됨
