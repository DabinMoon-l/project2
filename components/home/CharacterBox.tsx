'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { useUser, useCourse } from '@/lib/contexts';
import { useTheme } from '@/styles/themes/useTheme';

import RabbitImage from '@/components/common/RabbitImage';
import GachaResultModal, { type RollResultData } from './GachaResultModal';
import RabbitDogam from './RabbitDogam';

/**
 * 말풍선 메시지 목록
 */
const GACHA_MESSAGES = [
  '탈피가 시작됐어요!',
  '윽... 몸이 이상해요!',
  '뭔가 변하고 있어요!',
  '두근두근...!',
  '새로운 모습이 될 것 같아요!',
];

/**
 * 배경 이미지 경로 (공통)
 */
const HOME_BG_IMAGE = '/images/home-bg.jpg';

/**
 * 반별 폴백 배경색 (이미지 로딩 전/실패 시)
 */
const classBackgrounds: Record<string, string> = {
  A: '#FEE2E2',
  B: '#FEF9C3',
  C: '#DCFCE7',
  D: '#DBEAFE',
};

/**
 * 캐릭터 히어로 섹션 컴포넌트
 *
 * 토끼 2마리 나란히 표시 (각 ~100px, 1마리면 중앙 크게)
 * 서버사이드 뽑기 (2단계: Roll → Claim) + 발견/장착 시스템
 */
export default function CharacterBox() {
  const { profile } = useUser();
  const { userCourseId } = useCourse();
  const { theme, classType } = useTheme();

  // 뽑기 상태
  const [canGacha, setCanGacha] = useState(false);
  const [showGachaModal, setShowGachaModal] = useState(false);
  const [showGachaBubble, setShowGachaBubble] = useState(false);
  const [bubbleMessage, setBubbleMessage] = useState('');
  const [rollResult, setRollResult] = useState<RollResultData | null>(null);
  const [isGachaAnimating, setIsGachaAnimating] = useState(false);

  // 도감
  const [showDogam, setShowDogam] = useState(false);

  // 장착된 토끼 (최대 2마리, 슬롯0 기본 토끼 폴백)
  const equippedRabbits = profile?.equippedRabbits || [];
  const slot0 = equippedRabbits[0] || (userCourseId ? { rabbitId: 0, courseId: userCourseId } : null);
  const slot1 = equippedRabbits[1] || null;

  // 현재 EXP (50 단위로 순환)
  const currentExp = profile ? profile.totalExp % 50 : 0;
  const totalExp = profile?.totalExp || 0;

  // 뽑기 가능 여부 체크 (50의 배수 도달 시)
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

  // 서버사이드 뽑기 실행 (Roll Only)
  const handleSpin = useCallback(async () => {
    if (!profile || !userCourseId || !canGacha) return;

    setIsGachaAnimating(true);

    try {
      const spinRabbitGacha = httpsCallable<{ courseId: string }, RollResultData>(
        functions,
        'spinRabbitGacha'
      );

      // 최소 애니메이션 시간 보장
      const [result] = await Promise.all([
        spinRabbitGacha({ courseId: userCourseId }),
        new Promise((resolve) => setTimeout(resolve, 2000)),
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

  // 발견하기 콜백 (통합)
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

  const bgImage = HOME_BG_IMAGE;
  const fallbackBg = classBackgrounds[classType] || '#F5F0E8';

  return (
    <>
      {/* 캐릭터 히어로 섹션 — 풀블리드 */}
      <div
        className="relative w-full overflow-hidden"
        style={{
          height: 'calc((100vh - 5rem) * 0.6)',
          backgroundColor: fallbackBg,
          backgroundImage: `url(${bgImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center 5%',
        }}
      >

        {/* 총XP / 도감 */}
        <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-12 pt-14">
          {/* 총 XP 배지 */}
          <div
            className="h-10 flex items-center gap-3 px-5 bg-black/40 rounded-full backdrop-blur-sm"
          >
            <span className="text-xl font-bold text-yellow-300">XP</span>
            <span className="font-bold text-xl text-white leading-none min-w-[3ch] text-right">{totalExp}</span>
          </div>

          {/* 도감 버튼 */}
          <button
            onClick={() => setShowDogam(true)}
            className="h-10 flex items-center justify-center px-8 bg-black/40 rounded-full backdrop-blur-sm transition-transform duration-200 hover:scale-110 active:scale-95"
          >
            <span className="text-xl font-bold text-yellow-300 tracking-widest">도감</span>
          </button>
        </div>

        {/* 캐릭터 (중앙 아래) — 항상 2슬롯 */}
        <div className="absolute inset-0 z-[5] flex items-start justify-center" style={{ paddingTop: '8.5rem' }}>
          <div className="relative">
            <div className="flex items-center gap-12">
              {/* 슬롯 1 */}
              <div className="relative">
                <div
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[42%] pointer-events-none"
                  style={{ width: '36vw', maxWidth: '170px', aspectRatio: '3 / 4' }}
                >
                  <img src="/images/character-card-bg.png" alt="" className="w-full h-full" />
                </div>
                {slot0 ? (
                  <RabbitImage rabbitId={slot0.rabbitId} size={140} priority className="relative drop-shadow-[0_4px_12px_rgba(0,0,0,0.3)]" />
                ) : (
                  <div
                    className="relative flex items-center justify-center"
                    style={{ width: 140, height: 140 }}
                  >
                    <div className="w-24 h-24 rounded-full border-2 border-dashed border-black/40 flex items-center justify-center">
                      <span className="text-3xl text-black/40">?</span>
                    </div>
                  </div>
                )}
              </div>

              {/* 슬롯 2 */}
              <div className="relative">
                <div
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[42%] pointer-events-none"
                  style={{ width: '36vw', maxWidth: '170px', aspectRatio: '3 / 4' }}
                >
                  <img src="/images/character-card-bg.png" alt="" className="w-full h-full" />
                </div>
                {slot1 ? (
                  <RabbitImage rabbitId={slot1.rabbitId} size={140} priority className="relative drop-shadow-[0_4px_12px_rgba(0,0,0,0.3)]" />
                ) : (
                  <div
                    className="relative flex items-center justify-center"
                    style={{ width: 140, height: 140 }}
                  >
                    <div className="w-24 h-24 rounded-full border-2 border-dashed border-black/40 flex items-center justify-center">
                      <span className="text-3xl text-black/40">?</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 뽑기 말풍선 */}
            <AnimatePresence>
              {showGachaBubble && (
                <motion.button
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  onClick={() => setShowGachaModal(true)}
                  className="absolute -top-14 left-1/2 -translate-x-1/2 px-4 py-2 bg-white border-2 border-[#1A1A1A] whitespace-nowrap"
                  style={{ boxShadow: '3px 3px 0 #1A1A1A' }}
                >
                  <span className="text-sm font-bold">{bubbleMessage}</span>
                  <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-white border-r-2 border-b-2 border-[#1A1A1A] rotate-45" />
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* EXP 바 — 게임 HUD 스타일 */}
        <div className="absolute bottom-36 left-0 right-0 z-20 px-12">
          <div className="flex justify-end mb-1.5">
            <span className="text-2xl font-bold text-yellow-300 drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]">
              {currentExp}/50 XP
            </span>
          </div>
          <div className="px-3 py-2 bg-black/40 rounded-full backdrop-blur-sm">
            <div className="h-2.5 overflow-hidden bg-white/20 rounded-full">
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
        onClose={() => {
          setShowGachaModal(false);
          setRollResult(null);
        }}
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
