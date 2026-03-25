'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useUser, useHomeOverlay, useDetailPanel } from '@/lib/contexts';
import { useWideMode } from '@/lib/hooks/useViewportScale';
import { getRabbitProfileUrl } from '@/lib/utils/rabbitProfile';
import { CharacterBox, RankingSection } from '@/components/home';

const ProfileDrawer = dynamic(() => import('@/components/common/ProfileDrawer'), { ssr: false });
const AnnouncementChannel = dynamic(() => import('@/components/home/announcement'), { ssr: false });
const OpinionChannel = dynamic(() => import('@/components/home/opinion'), { ssr: false });

/**
 * `/` 홈 페이지
 * - 가로모드: 홈 콘텐츠 직접 렌더 (일반 라우트)
 * - 세로모드: 오버레이 열기 + 퀴즈 탭으로 리다이렉트 (기존 동작)
 */
export default function HomePage() {
  const { profile, isProfessor } = useUser();
  const { open, isOpen } = useHomeOverlay();
  const { openDetail, closeDetail } = useDetailPanel();
  const router = useRouter();
  const isWide = useWideMode();
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // 세로모드: 기존 동작 (오버레이 열기 + 리다이렉트)
  useEffect(() => {
    if (!mounted) return;
    if (isWide) return;
    if (isProfessor) {
      router.replace('/professor');
      return;
    }
    if (!isOpen) open();
    router.replace('/quiz', { scroll: false });
  }, [mounted, isWide]); // eslint-disable-line react-hooks/exhaustive-deps

  // 가로모드 학생 전용 렌더
  if (!mounted || !isWide || isProfessor || !profile) return null;

  // createPortal: <main>(w-1/2) 안에서 fixed가 뷰포트 대신 main 기준으로 잡히는 문제 방지
  return createPortal(
    <div
      className="fixed inset-0 overflow-y-auto flex flex-col scrollbar-hide"
      style={{
        zIndex: 44,
        backgroundImage: 'url(/images/home-wide.png)',
        backgroundSize: 'cover',
        backgroundPosition: 'center top',
        backgroundRepeat: 'no-repeat',
        backgroundColor: '#C8A090',
        paddingTop: 'env(safe-area-inset-top, 0px)',
      }}
    >
      {/* 2쪽↔3쪽 구분선 */}
      <div className="absolute top-0 bottom-0 z-[3] pointer-events-none" style={{
        left: 'calc(50vw + 119px)',
        width: '3px',
        background: 'linear-gradient(to right, rgba(0,0,0,0.15), rgba(255,255,255,0.08))',
      }} />

      {/* 콘텐츠 (2쪽 영역) */}
      <div
        className="relative z-[2] flex-1 flex flex-col pt-1 pb-2"
        style={{ marginLeft: '240px', marginRight: 'calc(50vw - 120px)' }}
      >
        {/* ① 상단: 프로필 + 공지 + 의견 */}
        <div className="flex-none">
          <div className="px-8 flex items-center gap-3 mb-2 mt-10">
            <button
              className="w-14 h-14 flex items-center justify-center flex-shrink-0 rounded-xl overflow-hidden"
              style={{
                background: 'rgba(0, 0, 0, 0.3)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
              }}
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
          <div className="px-8 mb-2 mt-1 relative z-30">
            <AnnouncementChannel onOpenPanel={() => openDetail(<AnnouncementChannel isPanelMode onClosePanel={closeDetail} />)} />
          </div>
          <div className="px-8 mb-1 relative z-20">
            <OpinionChannel onOpenPanel={() => openDetail(<OpinionChannel isPanelMode onClosePanel={closeDetail} />)} />
          </div>
        </div>

        <div className="flex-1" />
        <CharacterBox />
        <div className="flex-1" />

        <div className="flex-none">
          <RankingSection />
        </div>
        <div className="flex-1" />
      </div>
    </div>,
    document.body
  );
}
