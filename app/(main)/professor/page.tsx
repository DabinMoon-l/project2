'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import Image from 'next/image';
import { useTheme } from '@/styles/themes/useTheme';
import { useUser, useCourse } from '@/lib/contexts';
import { ProfileDrawer } from '@/components/common';
import CourseSwitcher from '@/components/common/CourseSwitcher';
import { getRabbitProfileUrl } from '@/lib/utils/rabbitProfile';
import { AnnouncementChannel } from '@/components/home';
import ProfessorRankingSection from '@/components/home/ProfessorRankingSection';
import ProfessorCharacterBox from '@/components/home/ProfessorCharacterBox';
import type { CourseId } from '@/lib/types/course';

const SWIPE_THRESHOLD = 120;
const WHEEL_THRESHOLD = 80;
const HOME_BG_IMAGE = '/images/home-bg.jpg';

/**
 * 교수님 홈 — 학생 홈과 동일 레이아웃
 * 공지 + 랭킹은 과목 전환(CourseSwitcher) 지원
 */
export default function ProfessorHomePage() {
  const { theme } = useTheme();
  const { profile } = useUser();
  const { userCourseId } = useCourse();
  const [showProfileDrawer, setShowProfileDrawer] = useState(false);
  const router = useRouter();

  // 과목 전환 (공지 + 랭킹 공유) — CourseContext에서 학기 기반 기본값 제공
  const [selectedCourse, setSelectedCourse] = useState<CourseId>(
    (userCourseId as CourseId) || 'microbiology'
  );

  // CourseContext의 userCourseId가 로딩되면 동기화
  useEffect(() => {
    if (userCourseId) {
      setSelectedCourse(userCourseId as CourseId);
    }
  }, [userCourseId]);

  // 스와이프 업 → 이전 페이지로 복귀
  const [pullY, setPullY] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const startY = useRef(0);
  const pulling = useRef(false);
  const wheelAccum = useRef(0);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const returnPath = sessionStorage.getItem('home_return_path') || '/professor/stats';
    router.prefetch(returnPath);
  }, [router]);

  const navigateReturn = useCallback(() => {
    setTransitioning(true);
    setPullY(window.innerHeight);
    const returnPath = sessionStorage.getItem('home_return_path') || '/professor/stats';
    setTimeout(() => {
      router.push(returnPath);
    }, 300);
  }, [router]);

  const isModalOpen = () => document.body.hasAttribute('data-hide-nav');

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

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (transitioning || isModalOpen()) return;
      if (e.deltaY > 0) {
        wheelAccum.current += e.deltaY;
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
          style={{ borderColor: theme.colors.borderDark, borderTopColor: 'transparent' }}
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        />
      </div>
    );
  }

  return (
    <>
      {(pullY > 5 || transitioning) && (
        <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 0, backgroundColor: '#F5F0E8' }} />
      )}

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
          overscrollBehavior: 'none',
        }}
      >
        <div className="relative z-[2] flex-1 flex flex-col pt-16 pb-16">
          {/* 프로필 + 닉네임 */}
          <div className="px-5 flex items-center gap-4 mb-5">
            <button
              className="w-20 h-20 flex items-center justify-center flex-shrink-0 rounded-xl overflow-hidden"
              style={{ background: 'rgba(0, 0, 0, 0.3)', border: '1px solid rgba(255, 255, 255, 0.1)' }}
              onClick={() => setShowProfileDrawer(true)}
            >
              {profile.profileRabbitId != null ? (
                <Image
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

          {/* 공지 — 과목 전환은 바텀시트 내부 */}
          <div className="px-5 -mb-4">
            <AnnouncementChannel
              overrideCourseId={selectedCourse}
              headerContent={
                <CourseSwitcher
                  value={selectedCourse}
                  onChange={setSelectedCourse}
                  textClassName="text-4xl font-black text-white/90 tracking-wide inline-block"
                />
              }
            />
          </div>

          {/* 캐릭터 — 랜덤 토끼 2마리 */}
          <ProfessorCharacterBox />

          {/* 랭킹 — 하단 (과목 전환 포함) */}
          <div className="mt-auto -translate-y-[120px]">
            {/* 과목 스위처 */}
            <div className="mb-5">
              <CourseSwitcher
                value={selectedCourse}
                onChange={setSelectedCourse}
                textClassName="text-4xl font-bold text-white tracking-widest inline-block"
              />
            </div>
            <ProfessorRankingSection overrideCourseId={selectedCourse} />
          </div>

          {/* 스와이프 힌트 */}
          <div className="absolute bottom-8 left-0 right-0 flex flex-col items-center gap-1 pointer-events-none">
            <span className="text-sm font-bold text-white/60 backdrop-blur-sm">
              아래로 스와이프하여 시작
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
                style={{ transform: pullY > SWIPE_THRESHOLD ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
              <span className="text-xs font-bold text-white">
                {pullY > SWIPE_THRESHOLD ? '놓으면 이동' : '위로 스와이프'}
              </span>
            </div>
          </div>
        )}

        <ProfileDrawer
          isOpen={showProfileDrawer}
          onClose={() => setShowProfileDrawer(false)}
        />
      </div>
    </>
  );
}
