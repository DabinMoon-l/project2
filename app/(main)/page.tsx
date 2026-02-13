'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useTheme } from '@/styles/themes/useTheme';
import { useUser } from '@/lib/contexts';
import { ProfileDrawer } from '@/components/common';
import {
  AnnouncementChannel,
  CharacterBox,
  RankingSection,
  RandomReviewBanner,
} from '@/components/home';

/**
 * 빈티지 프로필 아이콘
 */
const VintageProfileIcon = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="#1A1A1A">
    <circle cx="12" cy="8" r="4" />
    <path d="M12 14c-4 0-8 2-8 4v2h16v-2c0-2-4-4-8-4z" />
  </svg>
);

/**
 * 홈 화면 메인 페이지 - 개편된 버전
 *
 * 구조:
 * 1. 프로필 헤더
 * 2. 공지 채널
 * 3. 캐릭터 박스 (총XP, 도감, 캐릭터, EXP바)
 * 4. 랭킹 섹션 (반별 + 개인)
 * 5. 랜덤 복습 배너
 */
export default function HomePage() {
  const { theme } = useTheme();
  const { profile } = useUser();
  const [showProfileDrawer, setShowProfileDrawer] = useState(false);

  if (!profile) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
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
    <div
      className="min-h-screen pb-28"
      style={{ backgroundColor: theme.colors.background }}
    >
      {/* 프로필 헤더 */}
      <header className="px-4 pt-6 pb-4">
        <button
          className="flex items-center gap-3"
          onClick={() => setShowProfileDrawer(true)}
        >
          <div
            className="w-14 h-14 flex items-center justify-center"
            style={{
              border: '2px solid #1A1A1A',
              backgroundColor: theme.colors.backgroundCard,
            }}
          >
            <VintageProfileIcon size={28} />
          </div>
          <div className="text-left">
            <p
              className="font-bold text-xl"
              style={{ color: theme.colors.text }}
            >
              {profile.nickname}
            </p>
            <p
              className="text-sm"
              style={{ color: theme.colors.textSecondary }}
            >
              {profile.classType}반
            </p>
          </div>
        </button>
      </header>

      {/* 메인 콘텐츠 */}
      <div className="px-4 space-y-4">
        {/* 공지 채널 */}
        <AnnouncementChannel />

        {/* 캐릭터 박스 */}
        <CharacterBox />

        {/* 랭킹 섹션 */}
        <RankingSection />

        {/* 랜덤 복습 배너 */}
        <RandomReviewBanner />
      </div>

      {/* 프로필 드로어 */}
      <ProfileDrawer
        isOpen={showProfileDrawer}
        onClose={() => setShowProfileDrawer(false)}
      />
    </div>
  );
}
