'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { useUser } from '@/lib/contexts';
import { useHomeOverlay } from '@/lib/contexts/HomeOverlayContext';
import { ProfileDrawer } from '@/components/common';
import { getRabbitProfileUrl } from '@/lib/utils/rabbitProfile';
import {
  AnnouncementChannel,
  CharacterBox,
  RankingSection,
} from '@/components/home';
import { useWideMode, scaleCoord } from '@/lib/hooks/useViewportScale';

const SWIPE_THRESHOLD = 120;
const WHEEL_THRESHOLD = 80;
const PULL_DEAD_ZONE = 15; // 탭과 스와이프 구분 최소 이동 거리 (px)
const HOME_BG_IMAGE = '/images/home-bg.jpg';
const OPEN_MS = 400;   // 열기: 스케일 확장
const CLOSE_MS = 350;  // 닫기: 슬라이드 다운

type Phase = 'hidden' | 'entering' | 'open' | 'exiting';

/**
 * 학생 홈 오버레이 — z-45 (네비 z-50 아래)
 *
 * 애플뮤직 스타일: 홈 버튼에서 확장 / 홈 버튼으로 축소
 * 네비게이션은 항상 위에 표시되어 탭 이동 가능
 */
export default function HomeOverlay() {
  const { profile } = useUser();
  const { isOpen, isCloseRequested, close, buttonRect } = useHomeOverlay();
  const [showProfileDrawer, setShowProfileDrawer] = useState(false);
  const isWide = useWideMode();
  const [mounted, setMounted] = useState(false);

  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<Phase>('hidden');
  const phaseRef = useRef<Phase>('hidden');

  const [pullY, setPullY] = useState(0);
  const startY = useRef(0);
  const pulling = useRef(false);
  const wheelAccum = useRef(0);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noTransitionRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => { setMounted(true); }, []);

  // 열기 전용: 홈 버튼에서 확장하는 transformOrigin
  const getOpenOrigin = useCallback(() => {
    if (!buttonRect) {
      return isWide ? '36px 40px' : 'center calc(100% - 3rem)';
    }
    const cx = buttonRect.x + buttonRect.width / 2;
    const cy = buttonRect.y + buttonRect.height / 2;
    const offsetX = isWide ? 72 : 0;
    return `${cx - offsetX}px ${cy}px`;
  }, [buttonRect, isWide]);

  // isOpen → 열기 애니메이션
  useEffect(() => {
    if (isOpen && (phaseRef.current === 'hidden' || phaseRef.current === 'entering')) {
      setVisible(true);
      setPhase('entering');
      phaseRef.current = 'entering';
      const rafId1 = requestAnimationFrame(() => {
        const rafId2 = requestAnimationFrame(() => {
          if (phaseRef.current === 'entering') {
            setPhase('open');
            phaseRef.current = 'open';
          }
        });
        // cleanup 내부 rAF
        cleanupRef.current = () => cancelAnimationFrame(rafId2);
      });
      return () => {
        cancelAnimationFrame(rafId1);
        cleanupRef.current?.();
      };
    }
  }, [isOpen]);

  // 외부 즉시 닫기 시 stuck 복구
  useEffect(() => {
    if (!isOpen && phaseRef.current !== 'hidden' && phaseRef.current !== 'exiting') {
      setVisible(false);
      setPhase('hidden');
      phaseRef.current = 'hidden';
      setPullY(0);
    }
  }, [isOpen]);

  // 닫기: 위로 슬라이드 애니메이션
  const runExitAnimation = useCallback(() => {
    if (phaseRef.current === 'exiting') return;
    setPhase('exiting');
    phaseRef.current = 'exiting';
    setPullY(0);
    pulling.current = false;
    noTransitionRef.current = false;
    setTimeout(() => {
      close();
      setVisible(false);
      setPhase('hidden');
      phaseRef.current = 'hidden';
    }, CLOSE_MS);
  }, [close]);

  // closeAnimated() 요청 감지 → 축소 애니메이션
  useEffect(() => {
    if (isCloseRequested && phaseRef.current === 'open') {
      runExitAnimation();
    }
  }, [isCloseRequested, runExitAnimation]);

  const isModalOpen = () => document.body.hasAttribute('data-hide-nav');

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (phaseRef.current !== 'open' || isModalOpen()) return;
    startY.current = scaleCoord(e.touches[0].clientY);
    // 바로 pulling 시작하지 않음 — dead zone 통과 후 시작
    pulling.current = false;
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (phaseRef.current !== 'open') return;
    const cy = scaleCoord(e.touches[0].clientY);
    const delta = startY.current - cy;

    // 아직 pulling 시작 전 → dead zone 체크
    if (!pulling.current) {
      if (delta > PULL_DEAD_ZONE) {
        pulling.current = true;
        noTransitionRef.current = true;
        startY.current = cy; // 기준점 리셋
      }
      return;
    }

    // pulling 중 — 위로 스와이프
    if (delta > 0) {
      setPullY(delta * 0.6);
    } else {
      pulling.current = false;
      noTransitionRef.current = false;
      setPullY(0);
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    if (!pulling.current) return; // 탭이었으면 무시
    if (phaseRef.current !== 'open') return;
    pulling.current = false;
    noTransitionRef.current = false;
    if (pullY > SWIPE_THRESHOLD) {
      runExitAnimation();
    } else {
      setPullY(0);
    }
  }, [pullY, runExitAnimation]);

  useEffect(() => {
    if (!visible) return;
    const handleWheel = (e: WheelEvent) => {
      if (phaseRef.current !== 'open' || isModalOpen()) return;
      // 아래로 스크롤 → 슬라이드 다운 dismiss
      if (e.deltaY > 0) {
        noTransitionRef.current = true;
        wheelAccum.current += e.deltaY;
        const visual = Math.max(0, wheelAccum.current - 40) * 1.5;
        if (visual > 0) {
          setPullY(Math.min(visual, SWIPE_THRESHOLD * 1.2));
        }
        if (wheelAccum.current > WHEEL_THRESHOLD) {
          wheelAccum.current = 0;
          noTransitionRef.current = false;
          runExitAnimation();
          return;
        }
        if (wheelTimer.current) clearTimeout(wheelTimer.current);
        wheelTimer.current = setTimeout(() => {
          wheelAccum.current = 0;
          noTransitionRef.current = false;
          setPullY(0);
        }, 300);
      }
    };
    window.addEventListener('wheel', handleWheel, { passive: true });
    return () => window.removeEventListener('wheel', handleWheel);
  }, [visible, runExitAnimation]);

  if (!mounted || !visible || !profile) return null;

  const pullProgress = Math.min(pullY / (SWIPE_THRESHOLD * 1.5), 1);

  // 열기: 스케일 확장, 닫기: 위로 슬라이드 (바텀시트처럼 실체감)
  const getTransform = () => {
    if (phase === 'entering') return 'scale(0)';
    if (phase === 'exiting') return 'translateY(-100%)';
    if (pullY > 0) return `translateY(${-pullY}px)`;
    return 'scale(1)';
  };
  const getOpacity = () => {
    // 열기만 페이드, 닫기/스와이프는 불투명 유지
    if (phase === 'entering') return 0;
    return 1;
  };
  const getRadius = () => {
    if (phase === 'entering') return 24;
    if (phase === 'exiting') return 16;
    return pullProgress * 16;
  };

  const isOpening = phase === 'entering' || (phase === 'open' && pullY === 0);
  const useTransition = !noTransitionRef.current;
  const transition = useTransition
    ? phase === 'exiting'
      ? `transform ${CLOSE_MS}ms cubic-bezier(0.32, 0.72, 0, 1), border-radius ${CLOSE_MS}ms ease-out`
      : `transform ${OPEN_MS}ms cubic-bezier(0.4, 0, 0.2, 1), opacity ${OPEN_MS}ms cubic-bezier(0.4, 0, 0.2, 1), border-radius ${OPEN_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`
    : 'none';

  return createPortal(
    <div
      className="overflow-hidden flex flex-col scrollbar-hide"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{
        position: 'fixed',
        top: 0,
        bottom: 0,
        right: 0,
        left: isWide ? '72px' : 0,
        zIndex: 100,
        backgroundImage: `url(${HOME_BG_IMAGE})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center top',
        backgroundRepeat: 'no-repeat',
        backgroundColor: '#C8A090',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        transform: getTransform(),
        opacity: getOpacity(),
        borderRadius: `${getRadius()}px`,
        transformOrigin: isOpening ? getOpenOrigin() : 'center center',
        transition,
        willChange: phase !== 'open' || pullY > 0 ? 'transform, opacity' : undefined,
        overscrollBehavior: 'none',
      }}
    >
      <div className="relative z-[2] flex-1 flex flex-col pt-1 pb-2">
        {/* 프로필 + 닉네임 */}
        <div className="px-8 flex items-center gap-3 mb-2 mt-10">
          <button
            className="w-14 h-14 flex items-center justify-center flex-shrink-0 rounded-xl overflow-hidden"
            style={{
              background: 'rgba(0, 0, 0, 0.3)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
            }}
            onClick={() => setShowProfileDrawer(true)}
          >
            {profile.profileRabbitId != null ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={getRabbitProfileUrl(profile.profileRabbitId)}
                alt="프로필"
                width={80}
                height={80}
                className="w-full h-full object-cover"
              />
            ) : (
              <svg width={40} height={40} viewBox="0 0 24 24" fill="white">
                <circle cx="12" cy="8" r="4" />
                <path d="M12 14c-4 0-8 2-8 4v2h16v-2c0-2-4-4-8-4z" />
              </svg>
            )}
          </button>
          <p className="font-bold text-4xl text-white truncate leading-normal flex-1">
            {profile.nickname}
          </p>
        </div>

        {/* 공지 */}
        <div className="px-8 mb-2 mt-1 relative z-30">
          <AnnouncementChannel />
        </div>

        {/* 캐릭터 영역 */}
        <CharacterBox />

        {/* 랭킹 */}
        <RankingSection />

        {/* 스와이프 힌트 — 하단 (가로모드에서는 숨김) */}
        {!isWide && (
          <div className="absolute bottom-5 left-0 right-0 flex flex-col items-center gap-0.5 pointer-events-none">
            <motion.svg
              className="w-4 h-4 text-white/50"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              animate={{ y: [0, -6, 0] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
            </motion.svg>
            <span className="text-[10px] font-bold text-white/50 backdrop-blur-sm">
              위로 스와이프하여 학습 시작
            </span>
          </div>
        )}
      </div>

      {/* 프로필 드로어 */}
      <ProfileDrawer
        isOpen={showProfileDrawer}
        onClose={() => setShowProfileDrawer(false)}
      />
    </div>,
    document.body
  );
}
