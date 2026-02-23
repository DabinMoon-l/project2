'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { useTheme } from '@/styles/themes/useTheme';
import { useUser } from '@/lib/contexts';
import { ProfileDrawer } from '@/components/common';
import { getRabbitProfileUrl } from '@/lib/utils/rabbitProfile';
import {
  AnnouncementChannel,
  CharacterBox,
  RankingSection,
} from '@/components/home';

const SWIPE_THRESHOLD = 120;
const WHEEL_THRESHOLD = 80;

/**
 * 배경 이미지 경로
 */
const HOME_BG_IMAGE = '/images/home-bg.jpg';

/**
 * 홈 화면 메인 페이지 — 풀스크린 배경
 *
 * 구조 (위→아래):
 * 1. 상단: 프로필 + 닉네임 + 공지 (부드러운 그라데이션 오버레이)
 * 2. 중앙: 캐릭터 슬롯 + XP/도감 + EXP 바 (오버레이 없음)
 * 3. 하단: 랭킹 섹션 (부드러운 그라데이션 오버레이)
 */
export default function HomePage() {
  const { theme } = useTheme();
  const { profile, isProfessor } = useUser();
  const [showProfileDrawer, setShowProfileDrawer] = useState(false);
  const router = useRouter();

  // 교수님은 /professor 홈으로 리다이렉트
  useEffect(() => {
    if (isProfessor) {
      router.replace('/professor');
    }
  }, [isProfessor, router]);

  // 스와이프 업 → 이전 페이지로 복귀
  const [pullY, setPullY] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const startY = useRef(0);
  const pulling = useRef(false);
  const wheelAccum = useRef(0);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 복귀 페이지 미리 로드
  useEffect(() => {
    const returnPath = sessionStorage.getItem('home_return_path') || '/quiz';
    router.prefetch(returnPath);
  }, [router]);

  const navigateReturn = useCallback(() => {
    setTransitioning(true);
    setPullY(window.innerHeight);
    const returnPath = sessionStorage.getItem('home_return_path') || '/quiz';
    setTimeout(() => {
      router.push(returnPath);
    }, 300);
  }, [router]);

  // 모달/바텀시트 열림 여부
  const isModalOpen = () => document.body.hasAttribute('data-hide-nav');

  // 모바일 터치
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (transitioning || isModalOpen()) return;
    startY.current = e.touches[0].clientY;
    pulling.current = true;
  }, [transitioning]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!pulling.current || transitioning) return;
    const delta = startY.current - e.touches[0].clientY;
    if (delta > 0) {
      setPullY(delta * 0.4);
    } else {
      pulling.current = false;
      setPullY(0);
    }
  }, [transitioning]);

  const onTouchEnd = useCallback(() => {
    if (!pulling.current || transitioning) return;
    pulling.current = false;
    if (pullY > SWIPE_THRESHOLD) {
      navigateReturn();
    } else {
      setPullY(0);
    }
  }, [pullY, transitioning, navigateReturn]);

  // PC 마우스 휠 (아래로 스크롤 → 이전 페이지)
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (transitioning || isModalOpen()) return;
      if (e.deltaY > 0) {
        wheelAccum.current += e.deltaY;

        // 데드존: 누적 40 이상부터 시각 피드백
        const visual = Math.max(0, wheelAccum.current - 40) * 0.6;
        if (visual > 0) {
          setPullY(Math.min(visual, SWIPE_THRESHOLD * 1.2));
        }

        if (wheelAccum.current > WHEEL_THRESHOLD) {
          wheelAccum.current = 0;
          navigateReturn();
          return;
        }
        if (wheelTimer.current) clearTimeout(wheelTimer.current);
        wheelTimer.current = setTimeout(() => {
          wheelAccum.current = 0;
          setPullY(0);
        }, 300);
      }
    };
    window.addEventListener('wheel', handleWheel, { passive: true });
    return () => window.removeEventListener('wheel', handleWheel);
  }, [transitioning, navigateReturn]);


  if (!profile) {
    return (
      <div
        className="h-screen flex items-center justify-center"
        style={{ backgroundColor: theme.colors.background }}
      >
        <motion.div
          className="w-10 h-10 border-4 rounded-full"
          style={{
            borderColor: theme.colors.borderDark,
            borderTopColor: 'transparent',
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        />
      </div>
    );
  }

  return (
    <>
      {/* 대상 페이지 배경 미리보기 — 홈 뒤에 아이보리 깔림 */}
      {(pullY > 5 || transitioning) && (
        <div
          className="fixed inset-0 pointer-events-none"
          style={{ zIndex: 0, backgroundColor: '#F5F0E8' }}
        />
      )}

      {/* 홈 화면 (슬라이드) */}
      <div
        className="h-screen overflow-hidden flex flex-col scrollbar-hide"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{
          position: 'relative',
          zIndex: 1,
          backgroundImage: `url(${HOME_BG_IMAGE})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center 5%',
          backgroundColor: '#2a2018',
          transform: pullY > 5 ? `translateY(-${pullY}px)` : undefined,
          transition: pulling.current ? 'none' : 'transform 0.3s cubic-bezier(0.2, 0, 0, 1)',
          willChange: pullY > 5 ? 'transform' : undefined,
        }}
      >

        {/* 콘텐츠 — 하나의 연속 흐름 */}
        <div className="relative z-[2] flex-1 flex flex-col pt-16 pb-16">
          {/* 프로필 + 닉네임 */}
          <div className="px-5 flex items-center gap-4 mb-5">
            <button
              className="w-20 h-20 flex items-center justify-center flex-shrink-0 rounded-xl overflow-hidden"
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
            <p className="font-bold text-6xl text-white truncate leading-normal flex-1">
              {profile.nickname}
            </p>
          </div>

          {/* 공지 */}
          <div className="px-5 -mb-4">
            <AnnouncementChannel />
          </div>

          {/* 캐릭터 영역 */}
          <CharacterBox />

          {/* 랭킹 — 하단 */}
          <div className="mt-auto -translate-y-[80px]">
            <RankingSection />
          </div>

          {/* 스와이프 힌트 — 하단 고정 */}
          <div className="absolute bottom-8 left-0 right-0 flex flex-col items-center gap-1 pointer-events-none">
            <span className="text-sm font-bold text-white/60 backdrop-blur-sm">
              아래로 스와이프하여 학습 시작
            </span>
            <motion.svg
              className="w-5 h-5 text-white/50"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              animate={{ y: [0, 6, 0] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
            </motion.svg>
          </div>
        </div>

        {/* 스와이프 업 인디케이터 */}
        {pullY > 10 && !transitioning && (
          <div
            className="fixed bottom-0 left-0 right-0 z-50 flex justify-center pb-4 pointer-events-none"
            style={{ opacity: Math.min(pullY / SWIPE_THRESHOLD, 1) }}
          >
            <div className="flex flex-col items-center gap-1">
              <svg
                className="w-5 h-5 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                style={{
                  transform: pullY > SWIPE_THRESHOLD ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.2s',
                }}
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
              <span className="text-xs font-bold text-white">
                {pullY > SWIPE_THRESHOLD ? '놓으면 이동' : '위로 스와이프'}
              </span>
            </div>
          </div>
        )}

        {/* 프로필 드로어 */}
        <ProfileDrawer
          isOpen={showProfileDrawer}
          onClose={() => setShowProfileDrawer(false)}
        />
      </div>
    </>
  );
}
