'use client';

import { useState, useEffect } from 'react';
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

/**
 * 홈 화면 메인 페이지 — 리디자인
 *
 * 구조:
 * 1. 캐릭터 히어로 섹션 (60vh, 풀블리드)
 * 2. 바텀시트 스타일 콘텐츠 (40vh, 내부 스크롤)
 *    - 프로필 + 닉네임
 *    - 공지 채널
 *    - 랭킹 섹션
 *
 * 앱 최초 접속 시 /quiz로 리다이렉트 (세션당 1회)
 */
export default function HomePage() {
  const { theme } = useTheme();
  const { profile } = useUser();
  const [showProfileDrawer, setShowProfileDrawer] = useState(false);
  const router = useRouter();

  // 앱 최초 접속 시 /quiz로 리다이렉트 (세션당 1회)
  useEffect(() => {
    const key = 'session_home_visited';
    if (!sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, '1');
      router.replace('/quiz');
    }
  }, [router]);

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
    <div className="h-screen overflow-hidden flex flex-col scrollbar-hide">
      {/* 캐릭터 히어로 섹션 (60vh) */}
      <CharacterBox />

      {/* 콘텐츠 영역 — 배경 위로 겹쳐서 그라데이션 */}
      <div
        className="relative z-10 overflow-y-auto scrollbar-hide -mt-56"
        style={{ height: 'calc((100vh - 5rem) * 0.4 + 12rem)' }}
      >
        <div className="px-4 pb-28 space-y-4 pt-32"
          style={{
            background: 'linear-gradient(to bottom, transparent 0%, rgba(245,240,232,0.15) 40px, rgba(245,240,232,0.4) 80px, rgba(245,240,232,0.7) 120px, #F5F0E8 180px)',
          }}
        >
          {/* 프로필 + 닉네임 */}
          <div className="w-full flex items-center gap-4 pt-2">
            <button
              className="w-[72px] h-[72px] flex items-center justify-center flex-shrink-0 border-2 border-[#1A1A1A] overflow-hidden"
              style={{ backgroundColor: theme.colors.backgroundCard }}
              onClick={() => setShowProfileDrawer(true)}
            >
              {profile.profileRabbitId != null ? (
                <img
                  src={getRabbitProfileUrl(profile.profileRabbitId)}
                  alt="프로필"
                  className="w-full h-full object-cover"
                />
              ) : (
                <svg width={36} height={36} viewBox="0 0 24 24" fill="#1A1A1A">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M12 14c-4 0-8 2-8 4v2h16v-2c0-2-4-4-8-4z" />
                </svg>
              )}
            </button>
            <p className="font-bold text-5xl text-[#1A1A1A] truncate leading-normal pb-1">
              {profile.nickname}
            </p>
          </div>

          {/* 공지 채널 */}
          <AnnouncementChannel />

          {/* 구분선 */}
          <div className="px-8">
            <div className="h-px bg-[#D4CFC4]" />
          </div>

          {/* 랭킹 섹션 */}
          <RankingSection />
        </div>
      </div>

      {/* 프로필 드로어 */}
      <ProfileDrawer
        isOpen={showProfileDrawer}
        onClose={() => setShowProfileDrawer(false)}
      />
    </div>
  );
}
