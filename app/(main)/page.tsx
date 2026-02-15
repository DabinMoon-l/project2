'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useTheme } from '@/styles/themes/useTheme';
import { useUser } from '@/lib/contexts';
import { ProfileDrawer } from '@/components/common';
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
 */
export default function HomePage() {
  const { theme } = useTheme();
  const { profile } = useUser();
  const [showProfileDrawer, setShowProfileDrawer] = useState(false);

  // 홈 화면은 h-screen overflow-hidden 컨테이너로 스크롤 방지

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
        className="relative z-10 overflow-y-auto scrollbar-hide -mt-32"
        style={{ height: 'calc((100vh - 5rem) * 0.4 + 8rem)' }}
      >
        {/* 그라데이션 오버레이 */}
        <div className="sticky top-0 h-32 pointer-events-none" style={{ background: 'linear-gradient(to bottom, transparent 0%, rgba(245,240,232,0.5) 40%, #F5F0E8 100%)' }} />
        <div className="px-4 pb-28 space-y-4" style={{ backgroundColor: '#F5F0E8' }}>
          {/* 프로필 + 닉네임 */}
          <button
            className="w-full text-left flex items-center gap-4 pt-2"
            onClick={() => setShowProfileDrawer(true)}
          >
            <div
              className="w-14 h-14 flex items-center justify-center flex-shrink-0 border-2 border-[#1A1A1A]"
              style={{ backgroundColor: theme.colors.backgroundCard }}
            >
              <svg width={28} height={28} viewBox="0 0 24 24" fill="#1A1A1A">
                <circle cx="12" cy="8" r="4" />
                <path d="M12 14c-4 0-8 2-8 4v2h16v-2c0-2-4-4-8-4z" />
              </svg>
            </div>
            <p className="font-bold text-4xl text-[#1A1A1A] truncate">
              {profile.nickname}
            </p>
          </button>

          {/* 공지 채널 */}
          <AnnouncementChannel />

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
