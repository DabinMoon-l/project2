'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { useUser, useCourse } from '@/lib/contexts';
import { useTheme } from '@/styles/themes/useTheme';
import { useRabbitDoc, useRabbitHoldings } from '@/lib/hooks/useRabbit';
import { computeRabbitDisplayName } from '@/lib/utils/rabbitDisplayName';
import GachaResultModal, { type RollResultData } from './GachaResultModal';
import RabbitReplaceModal from './RabbitReplaceModal';
import RabbitDogam from './RabbitDogam';
import MyRabbitsDrawer from './MyRabbitsDrawer';

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
 * 서버사이드 뽑기 (2단계: Roll → Claim) + 토끼 집사 시스템
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

  // 교체 모달
  const [showReplace, setShowReplace] = useState(false);
  const [pendingRollResult, setPendingRollResult] = useState<RollResultData | null>(null);
  const [pendingNewName, setPendingNewName] = useState('');

  // 도감 / 내 토끼
  const [showDogam, setShowDogam] = useState(false);
  const [showMyRabbits, setShowMyRabbits] = useState(false);

  // 장착된 토끼 문서 구독
  const equippedRabbitId = profile?.equippedRabbitId;
  const equippedCourseId = profile?.equippedRabbitCourseId || userCourseId;
  const { rabbit: equippedRabbit } = useRabbitDoc(equippedCourseId, equippedRabbitId);

  // 내 토끼 목록
  const { holdings } = useRabbitHoldings(profile?.uid);
  const courseHoldings = holdings.filter((h) => h.courseId === userCourseId);

  // 현재 EXP (50 단위로 순환)
  const currentExp = profile ? profile.totalExp % 50 : 0;
  const totalExp = profile?.totalExp || 0;

  // 장착된 토끼 holding에서 generationIndex 찾기
  const equippedHolding = holdings.find(
    (h) => h.rabbitId === equippedRabbitId && h.courseId === equippedCourseId
  );

  // 장착 토끼 표시 이름
  const equippedDisplayName = equippedRabbit
    ? computeRabbitDisplayName(
        equippedRabbit.currentName,
        equippedHolding?.generationIndex || 1,
        equippedRabbit.rabbitId
      )
    : '토끼';

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

  // Claim 호출 헬퍼
  const callClaim = useCallback(async (
    rabbitId: number,
    name?: string,
    replaceKey?: string
  ) => {
    if (!userCourseId) return;
    const claimGachaRabbit = httpsCallable(functions, 'claimGachaRabbit');
    await claimGachaRabbit({
      courseId: userCourseId,
      rabbitId,
      action: 'adopt',
      name,
      replaceKey,
    });
  }, [userCourseId]);

  // 미발견 토끼 집사되기
  const handleAdoptAsButler = useCallback(async (result: RollResultData, name: string) => {
    if (result.ownedCount >= 3) {
      // 교체 모달 열기
      setPendingRollResult(result);
      setPendingNewName(name);
      setShowGachaModal(false);
      setRollResult(null);
      setShowReplace(true);
      return;
    }

    try {
      await callClaim(result.rabbitId, name);
      setShowGachaModal(false);
      setRollResult(null);
    } catch (error) {
      console.error('집사되기 실패:', error);
    }
  }, [callClaim]);

  // 발견된 토끼 데려오기
  const handleAdoptAsGeneration = useCallback(async (result: RollResultData) => {
    if (result.ownedCount >= 3) {
      // 교체 모달 열기
      setPendingRollResult(result);
      setPendingNewName('');
      setShowGachaModal(false);
      setRollResult(null);
      setShowReplace(true);
      return;
    }

    try {
      await callClaim(result.rabbitId);
      setShowGachaModal(false);
      setRollResult(null);
    } catch (error) {
      console.error('데려오기 실패:', error);
    }
  }, [callClaim]);

  // 토끼 이름 맵 (교체 모달용)
  const rabbitNames = new Map<string, string | null>();
  // courseHoldings의 이름은 rabbit 문서에서 가져와야 하지만, 간단히 처리
  courseHoldings.forEach((h) => {
    rabbitNames.set(h.id, null);
  });

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

        {/* 총XP / 도감 / 내 토끼 */}
        <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-12 pt-14">
          {/* 총 XP 배지 */}
          <button
            onClick={() => setShowMyRabbits(true)}
            className="flex items-center gap-3 px-4 py-1.5 bg-black/40 rounded-full backdrop-blur-sm"
          >
            <span className="text-base font-bold text-yellow-300">XP</span>
            <span className="font-bold text-base text-white leading-none min-w-[3ch] text-right">{totalExp}</span>
          </button>

          {/* 도감 버튼 */}
          <button
            onClick={() => setShowDogam(true)}
            title="도감"
          >
            <img src="/images/home-book.png" alt="도감" className="w-20 object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]" style={{ transform: 'scaleY(1.15)' }} />
          </button>
        </div>

        {/* 캐릭터 (중앙 약간 아래) */}
        <div className="absolute inset-0 z-[5] flex items-center justify-center" style={{ paddingTop: '2rem' }}>
          <div className="relative">
            <div className="text-8xl grayscale-[10%]">🐰</div>

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
        <div className="absolute bottom-28 left-0 right-0 z-10 px-12">
          <div className="flex justify-between mb-1.5">
            <span className="text-2xl font-bold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]">
              {equippedDisplayName}
            </span>
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
        onAdoptAsButler={handleAdoptAsButler}
        onAdoptAsGeneration={handleAdoptAsGeneration}
      />

      {/* 교체 모달 */}
      {pendingRollResult && (
        <RabbitReplaceModal
          isOpen={showReplace}
          onClose={() => {
            setShowReplace(false);
            setPendingRollResult(null);
            setPendingNewName('');
          }}
          rollResult={pendingRollResult}
          newName={pendingNewName || undefined}
          courseId={userCourseId || ''}
          courseHoldings={courseHoldings}
          rabbitNames={rabbitNames}
        />
      )}

      {/* 도감 모달 */}
      {userCourseId && (
        <RabbitDogam
          isOpen={showDogam}
          onClose={() => setShowDogam(false)}
          courseId={userCourseId}
        />
      )}

      {/* 내 토끼 드로어 */}
      {profile && userCourseId && (
        <MyRabbitsDrawer
          isOpen={showMyRabbits}
          onClose={() => setShowMyRabbits(false)}
          userId={profile.uid}
          courseId={userCourseId}
          equippedRabbitId={equippedRabbitId}
        />
      )}
    </>
  );
}
