'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useUser, useCourse, useDetailPanel, useHomeOverlay } from '@/lib/contexts';
import { useWideMode } from '@/lib/hooks/useViewportScale';
import { getRabbitProfileUrl } from '@/lib/utils/rabbitProfile';
import CourseSwitcher from '@/components/common/CourseSwitcher';
import ProfessorCharacterBox from '@/components/home/ProfessorCharacterBox';
import ProfessorRankingSection from '@/components/home/ProfessorRankingSection';

const ProfileDrawer = dynamic(() => import('@/components/common/ProfileDrawer'), { ssr: false });
const AnnouncementChannel = dynamic(() => import('@/components/home/announcement'), { ssr: false });
const OpinionChannel = dynamic(() => import('@/components/home/opinion'), { ssr: false });

/**
 * `/professor` 교수 홈 페이지
 * - 가로모드: 홈 콘텐츠 직접 렌더 (배경은 layout에서 처리)
 * - 세로모드: 오버레이 열기 + 통계 탭으로 리다이렉트
 */
export default function ProfessorHomePage() {
  const { profile } = useUser();
  const { userCourseId, setProfessorCourse, assignedCourses } = useCourse();
  const { open, isOpen } = useHomeOverlay();
  const { openDetail, closeDetail } = useDetailPanel();
  const router = useRouter();
  const isWide = useWideMode();
  const [mounted, setMounted] = useState(false);

  const selectedCourse = (userCourseId as 'biology' | 'pathophysiology' | 'microbiology') || 'microbiology';

  useEffect(() => { setMounted(true); }, []);

  // 세로모드: 기존 동작 (오버레이 열기 + 리다이렉트)
  useEffect(() => {
    if (!mounted) return;
    if (isWide) return;
    if (!isOpen) open();
    router.replace('/professor/stats', { scroll: false });
  }, [mounted, isWide]); // eslint-disable-line react-hooks/exhaustive-deps

  // 2쪽 너비에 따른 동적 스케일 (iPad 기준 비율 유지)
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const updateZoom = useCallback(() => {
    const el = containerRef.current?.parentElement;
    if (!el) return;
    const width = el.clientWidth;
    // 470px = iPad Air 기준 2쪽 너비 ((1180 - 240) / 2)
    setZoom(Math.max(0.8, Math.min(width / 470, 1.4)));
  }, []);
  useEffect(() => {
    if (!mounted || !isWide) return;
    updateZoom();
    const el = containerRef.current?.parentElement;
    if (!el) return;
    const observer = new ResizeObserver(updateZoom);
    observer.observe(el);
    return () => observer.disconnect();
  }, [mounted, isWide, updateZoom]);

  if (!mounted || !isWide || !profile) return null;

  return (
    <div
      ref={containerRef}
      className="flex flex-col pt-1 pb-2"
      style={{ zoom, height: `${100 / zoom}%` }}
    >
      {/* ① 상단: 프로필 + 공지 + 의견 */}
      <div className="flex-none">
        <div className="px-8 flex items-center gap-3 mb-2 mt-10">
          <button
            className="w-14 h-14 flex items-center justify-center flex-shrink-0 rounded-xl overflow-hidden"
            style={{ background: 'rgba(0, 0, 0, 0.3)', border: '1px solid rgba(255, 255, 255, 0.1)' }}
            onClick={() => openDetail(<ProfileDrawer isOpen isPanelMode onClose={closeDetail} />)}
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
        <div className="px-10 mb-2 mt-1 relative z-30">
          <AnnouncementChannel
            overrideCourseId={selectedCourse}
            headerContent={
              <CourseSwitcher
                value={selectedCourse}
                onChange={setProfessorCourse}
                textClassName="text-2xl font-black text-white/90 tracking-wide inline-block"
                courseIds={assignedCourses}
              />
            }
            onOpenPanel={() => openDetail(
              <AnnouncementChannel
                isPanelMode
                onClosePanel={closeDetail}
                overrideCourseId={selectedCourse}
                headerContent={
                  <CourseSwitcher
                    value={selectedCourse}
                    onChange={setProfessorCourse}
                    textClassName="text-2xl font-black text-white/90 tracking-wide inline-block"
                    courseIds={assignedCourses}
                  />
                }
              />
            )}
          />
        </div>
        <div className="px-8 mb-1 relative z-20">
          <OpinionChannel onOpenPanel={() => openDetail(<OpinionChannel isPanelMode onClosePanel={closeDetail} />)} />
        </div>
      </div>

      <div className="flex-1" />

      <div className="flex-none">
        <ProfessorCharacterBox />
      </div>

      <div style={{ flex: '1 1 100px' }} />

      <div className="flex-none">
        <div className="mb-2 flex items-center justify-center px-8">
          <CourseSwitcher
            value={selectedCourse}
            onChange={setProfessorCourse}
            textClassName="text-2xl font-bold text-white tracking-widest inline-block"
            courseIds={assignedCourses}
          />
        </div>
        <ProfessorRankingSection overrideCourseId={selectedCourse} />
      </div>

      <div className="flex-1" />
    </div>
  );
}
