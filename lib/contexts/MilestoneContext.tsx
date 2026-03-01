'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  type ReactNode,
  type MutableRefObject,
} from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { useUser, useCourse } from '@/lib/contexts';
import { useRabbitHoldings } from '@/lib/hooks/useRabbit';
import { getPendingMilestones, getExpBarDisplay } from '@/lib/utils/milestone';
import type { RollResultData } from '@/components/home/GachaResultModal';
import MilestoneChoiceModal from '@/components/home/MilestoneChoiceModal';
import GachaResultModal from '@/components/home/GachaResultModal';
import LevelUpBottomSheet from '@/components/home/LevelUpBottomSheet';
import { useHideNav } from '@/lib/hooks/useHideNav';

interface MilestoneContextValue {
  // 상태
  pendingCount: number;
  expBar: ReturnType<typeof getExpBarDisplay>;
  allRabbitsDiscovered: boolean;

  // 모달 제어
  showMilestoneModal: boolean;
  openMilestoneModal: () => void;
  closeMilestoneModal: () => void;

  // 별 버튼 ref (요술지니 origin용)
  milestoneButtonRef: MutableRefObject<HTMLElement | null>;
  buttonRect: { x: number; y: number; width: number; height: number } | null;

  // 외부 모달 억제 (도감/철권퀴즈 등)
  suppressAutoTrigger: boolean;
  setSuppressAutoTrigger: (v: boolean) => void;
}

const defaultRef = { current: null };
const MilestoneContext = createContext<MilestoneContextValue | null>(null);

/** MilestoneProvider 밖에서 호출 시 안전한 기본값 (교수 등) */
const NOOP_MILESTONE: MilestoneContextValue = {
  pendingCount: 0,
  expBar: { current: 0, max: 50, overflow: false, pendingCount: 0 },
  allRabbitsDiscovered: false,
  showMilestoneModal: false,
  openMilestoneModal: () => {},
  closeMilestoneModal: () => {},
  milestoneButtonRef: defaultRef,
  buttonRect: null,
  suppressAutoTrigger: false,
  setSuppressAutoTrigger: () => {},
};

export function useMilestone() {
  const ctx = useContext(MilestoneContext);
  return ctx ?? NOOP_MILESTONE;
}

export function MilestoneProvider({ children }: { children: ReactNode }) {
  const { profile } = useUser();
  const { userCourseId } = useCourse();
  const { holdings } = useRabbitHoldings(profile?.uid);

  // 모달 상태
  const [showMilestoneModal, setShowMilestoneModal] = useState(false);
  const [showGachaModal, setShowGachaModal] = useState(false);
  const [showLevelUpSheet, setShowLevelUpSheet] = useState(false);

  // 별 버튼 ref + rect (요술지니 origin용)
  const milestoneButtonRef = useRef<HTMLElement | null>(null);
  const [buttonRect, setButtonRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  // 뽑기 상태
  const [rollResult, setRollResult] = useState<RollResultData | null>(null);
  const [isGachaAnimating, setIsGachaAnimating] = useState(false);
  const [spinError, setSpinError] = useState<string | null>(null);

  // 자동 트리거 억제
  const [suppressAutoTrigger, setSuppressAutoTrigger] = useState(false);

  // 자동 트리거 dismiss 상태 (사용자가 명시적으로 닫았을 때 재트리거 방지)
  const [userDismissed, setUserDismissed] = useState(false);

  // EXP & 마일스톤
  const totalExp = profile?.totalExp || 0;
  const lastGachaExp = profile?.lastGachaExp || 0;
  const pendingCount = getPendingMilestones(totalExp, lastGachaExp);
  const expBar = useMemo(
    () => getExpBarDisplay(totalExp, lastGachaExp),
    [totalExp, lastGachaExp]
  );
  const allRabbitsDiscovered = userCourseId
    ? holdings.filter((h) => h.courseId === userCourseId).length >= 80
    : false;

  // 네비게이션 숨김 (마일스톤 관련 모달 중 하나라도 열려있을 때)
  useHideNav(showMilestoneModal || showGachaModal || showLevelUpSheet);

  // 프로필 초기 로드 완료 여부 (초기 로드 시 자동 트리거 방지)
  const profileStableRef = useRef(false);
  const prevPendingRef = useRef<number>(0);

  // 프로필 초기 로드 — 현재 pendingCount 기록, 자동 트리거 안 함
  useEffect(() => {
    if (!profile) return;
    if (!profileStableRef.current) {
      profileStableRef.current = true;
      prevPendingRef.current = pendingCount;
      // 초기 로드 시 pending이 있어도 자동 트리거 안 함
      if (pendingCount > 0) setUserDismissed(true);
    }
  }, [profile, pendingCount]);

  // pendingCount 변경 감지 → dismiss 리셋 (마일스톤 획득/소비 시)
  useEffect(() => {
    if (!profileStableRef.current) return;
    if (pendingCount !== prevPendingRef.current) {
      prevPendingRef.current = pendingCount;
      // 마일스톤 소비/획득으로 pendingCount 변경 → dismiss 리셋
      setUserDismissed(false);
    }
  }, [pendingCount]);

  // 마일스톤 자동 트리거
  // pending > 0, 모든 모달 닫힘, dismiss 안 됨, suppress 안 됨 → 600ms 후 자동 오픈
  useEffect(() => {
    if (!profileStableRef.current) return;
    if (pendingCount <= 0) return;
    if (userDismissed || suppressAutoTrigger) return;
    if (showMilestoneModal || showGachaModal || showLevelUpSheet) return;

    const timer = setTimeout(() => {
      if (milestoneButtonRef.current) {
        const r = milestoneButtonRef.current.getBoundingClientRect();
        setButtonRect({ x: r.x, y: r.y, width: r.width, height: r.height });
      }
      setShowMilestoneModal(true);
    }, 600);
    return () => clearTimeout(timer);
  }, [pendingCount, userDismissed, suppressAutoTrigger, showMilestoneModal, showGachaModal, showLevelUpSheet]);

  // 마일스톤 모달 → 선택 (dismiss 설정 → 액션 완료 시 pendingCount 변경으로 리셋됨)
  const handleChooseGacha = useCallback(() => {
    setShowMilestoneModal(false);
    setShowGachaModal(true);
    setUserDismissed(true);
  }, []);

  const handleChooseLevelUp = useCallback(() => {
    setShowMilestoneModal(false);
    setShowLevelUpSheet(true);
    setUserDismissed(true);
  }, []);

  // 뽑기 (스핀)
  const handleSpin = useCallback(async () => {
    if (!profile || !userCourseId || pendingCount <= 0) return;
    setIsGachaAnimating(true);
    setSpinError(null);
    try {
      const spinRabbitGacha = httpsCallable<{ courseId: string }, RollResultData>(
        functions, 'spinRabbitGacha'
      );
      const [result] = await Promise.all([
        spinRabbitGacha({ courseId: userCourseId }),
        new Promise(resolve => setTimeout(resolve, 2000)),
      ]);
      setRollResult(result.data);
    } catch (error: any) {
      console.error('뽑기 실패:', error);
      const msg = error?.message || '';
      if (msg.includes('모든 토끼를 발견')) {
        setSpinError('모든 토끼를 발견했습니다!');
      } else {
        setSpinError('뽑기에 실패했습니다.');
      }
    } finally {
      setIsGachaAnimating(false);
    }
  }, [profile, userCourseId, pendingCount]);

  // 발견하기
  const handleDiscover = useCallback(async (
    result: RollResultData,
    name?: string,
    equipSlot?: number
  ) => {
    if (!userCourseId) return;
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
    // dismiss 설정하지 않음 → pendingCount 변경으로 자동 재트리거
  }, [userCourseId]);

  const openMilestoneModal = useCallback(() => {
    if (milestoneButtonRef.current) {
      const r = milestoneButtonRef.current.getBoundingClientRect();
      setButtonRect({ x: r.x, y: r.y, width: r.width, height: r.height });
    }
    setShowMilestoneModal(true);
  }, []);

  const closeMilestoneModal = useCallback(() => setShowMilestoneModal(false), []);

  // 마일스톤 선택 모달 닫기 (사용자가 선택하지 않고 닫음 → dismiss)
  const handleMilestoneClose = useCallback(() => {
    setShowMilestoneModal(false);
    setUserDismissed(true);
  }, []);

  // 뽑기 모달 닫기 ("나중에 하기" → dismiss)
  const handleGachaClose = useCallback(() => {
    setShowGachaModal(false);
    setRollResult(null);
    setSpinError(null);
    setUserDismissed(true);
  }, []);

  // 레벨업 닫기 (dismiss 설정 → 레벨업 완료 시 pendingCount 변경으로 리셋됨)
  const handleLevelUpClose = useCallback(() => {
    setShowLevelUpSheet(false);
    setUserDismissed(true);
  }, []);

  // Context 값 메모이제이션 (불필요한 소비자 리렌더 방지)
  const value = useMemo<MilestoneContextValue>(() => ({
    pendingCount,
    expBar,
    allRabbitsDiscovered,
    showMilestoneModal,
    openMilestoneModal,
    closeMilestoneModal,
    milestoneButtonRef,
    buttonRect,
    suppressAutoTrigger,
    setSuppressAutoTrigger,
  }), [
    pendingCount, expBar, allRabbitsDiscovered, showMilestoneModal,
    openMilestoneModal, closeMilestoneModal, buttonRect, suppressAutoTrigger,
  ]);

  return (
    <MilestoneContext.Provider value={value}>
      {children}

      {/* 마일스톤 선택 모달 */}
      <MilestoneChoiceModal
        isOpen={showMilestoneModal}
        onClose={handleMilestoneClose}
        pendingCount={pendingCount}
        onChooseLevelUp={handleChooseLevelUp}
        onChooseGacha={handleChooseGacha}
        allRabbitsDiscovered={allRabbitsDiscovered}
        buttonRect={buttonRect}
      />

      {/* 레벨업 바텀시트 */}
      {userCourseId && (
        <LevelUpBottomSheet
          isOpen={showLevelUpSheet}
          onClose={handleLevelUpClose}
          courseId={userCourseId}
          holdings={holdings}
        />
      )}

      {/* 뽑기 모달 */}
      <GachaResultModal
        isOpen={showGachaModal}
        onClose={handleGachaClose}
        result={rollResult}
        isAnimating={isGachaAnimating}
        onSpin={handleSpin}
        canGacha={pendingCount > 0}
        onDiscover={handleDiscover}
        spinError={spinError}
      />
    </MilestoneContext.Provider>
  );
}
