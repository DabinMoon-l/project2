'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
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

export function useMilestone() {
  const ctx = useContext(MilestoneContext);
  if (!ctx) throw new Error('useMilestone은 MilestoneProvider 안에서만 사용 가능');
  return ctx;
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

  // 이전 pendingCount 추적
  const prevPendingRef = useRef<number | null>(null);

  // EXP & 마일스톤
  const totalExp = profile?.totalExp || 0;
  const lastGachaExp = profile?.lastGachaExp || 0;
  const pendingCount = getPendingMilestones(totalExp, lastGachaExp);
  const expBar = getExpBarDisplay(totalExp, lastGachaExp);
  const allRabbitsDiscovered = userCourseId
    ? holdings.filter((h) => h.courseId === userCourseId).length >= 80
    : false;

  // 네비게이션 숨김 (마일스톤 관련 모달 중 하나라도 열려있을 때)
  const milestoneNavHiddenRef = useRef(false);
  useEffect(() => {
    const anyOpen = showMilestoneModal || showGachaModal || showLevelUpSheet;
    if (anyOpen) {
      document.body.setAttribute('data-hide-nav', '');
      milestoneNavHiddenRef.current = true;
    } else if (milestoneNavHiddenRef.current) {
      // 우리가 설정한 경우에만 제거
      document.body.removeAttribute('data-hide-nav');
      milestoneNavHiddenRef.current = false;
    }
    return () => {
      if (milestoneNavHiddenRef.current) {
        document.body.removeAttribute('data-hide-nav');
        milestoneNavHiddenRef.current = false;
      }
    };
  }, [showMilestoneModal, showGachaModal, showLevelUpSheet]);

  // 프로필 초기 로드 완료 여부 (초기 로드 시 자동 트리거 방지)
  const profileStableRef = useRef(false);

  // 마일스톤 자동 트리거 (세션 중 pendingCount가 0→>0 되었을 때만)
  useEffect(() => {
    // 프로필이 아직 로드 안 됨 — 무시
    if (!profile) {
      prevPendingRef.current = 0;
      return;
    }

    // 프로필 최초 로드 완료 — 현재 값 기록만, 자동 트리거 안 함
    if (!profileStableRef.current) {
      profileStableRef.current = true;
      prevPendingRef.current = pendingCount;
      return;
    }

    if (
      pendingCount > 0 &&
      prevPendingRef.current === 0 &&
      !showMilestoneModal &&
      !showGachaModal &&
      !showLevelUpSheet &&
      !suppressAutoTrigger
    ) {
      const timer = setTimeout(() => {
        // 별 버튼 위치 캡쳐 (자동 트리거)
        if (milestoneButtonRef.current) {
          const r = milestoneButtonRef.current.getBoundingClientRect();
          setButtonRect({ x: r.x, y: r.y, width: r.width, height: r.height });
        }
        setShowMilestoneModal(true);
      }, 600);
      prevPendingRef.current = pendingCount;
      return () => clearTimeout(timer);
    }
    prevPendingRef.current = pendingCount;
  }, [profile, pendingCount, showMilestoneModal, showGachaModal, showLevelUpSheet, suppressAutoTrigger]);

  // 마일스톤 모달 → 선택
  const handleChooseGacha = useCallback(() => {
    setShowMilestoneModal(false);
    setShowGachaModal(true);
  }, []);

  const handleChooseLevelUp = useCallback(() => {
    setShowMilestoneModal(false);
    setShowLevelUpSheet(true);
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
  }, [userCourseId]);

  const value: MilestoneContextValue = {
    pendingCount,
    expBar,
    allRabbitsDiscovered,
    showMilestoneModal,
    openMilestoneModal: () => {
      if (milestoneButtonRef.current) {
        const r = milestoneButtonRef.current.getBoundingClientRect();
        setButtonRect({ x: r.x, y: r.y, width: r.width, height: r.height });
      }
      setShowMilestoneModal(true);
    },
    closeMilestoneModal: () => setShowMilestoneModal(false),
    milestoneButtonRef,
    buttonRect,
    suppressAutoTrigger,
    setSuppressAutoTrigger,
  };

  return (
    <MilestoneContext.Provider value={value}>
      {children}

      {/* 마일스톤 선택 모달 */}
      <MilestoneChoiceModal
        isOpen={showMilestoneModal}
        onClose={() => setShowMilestoneModal(false)}
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
          onClose={() => setShowLevelUpSheet(false)}
          courseId={userCourseId}
          holdings={holdings}
        />
      )}

      {/* 뽑기 모달 */}
      <GachaResultModal
        isOpen={showGachaModal}
        onClose={() => { setShowGachaModal(false); setRollResult(null); setSpinError(null); }}
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
