'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useTheme } from '@/styles/themes/useTheme';
import { useUser, useCourse } from '@/lib/contexts';
import { calculateRankInfo } from '@/components/home';
import { ProfileDrawer } from '@/components/common';
import { classColors, type ClassType } from '@/styles/themes';
import { COURSES } from '@/lib/types/course';

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
 * 홈 화면 메인 페이지 - 빈티지 신문 스타일
 */
export default function HomePage() {
  const { theme, classType } = useTheme();
  const { profile } = useUser();
  const { semesterSettings, userCourseId } = useCourse();
  const [showProfileDrawer, setShowProfileDrawer] = useState(false);

  // 과목 정보
  const course = userCourseId ? COURSES[userCourseId] : null;

  // 학기 표시 (예: "2026 1st Semester")
  const semesterLabel = semesterSettings
    ? `${semesterSettings.currentYear} ${semesterSettings.currentSemester === 1 ? '1st' : '2nd'} Semester`
    : '';

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

  const rankInfo = calculateRankInfo(profile.totalExp);
  const expProgress = rankInfo.maxExp > 0
    ? Math.min((rankInfo.currentExp / rankInfo.maxExp) * 100, 100)
    : 100;
  const correctRate = profile.totalQuizzes > 0
    ? Math.round((profile.correctAnswers / profile.totalQuizzes) * 100)
    : 0;

  // 반별 참여도 (임시 데이터)
  const classParticipation: Record<ClassType, number> = {
    A: 75,
    B: 60,
    C: 45,
    D: 30,
  };

  const sortedClasses = (['A', 'B', 'C', 'D'] as ClassType[])
    .sort((a, b) => classParticipation[b] - classParticipation[a]);

  return (
    <div
      className="min-h-screen pb-28"
      style={{ backgroundColor: theme.colors.background }}
    >
      {/* 학기/과목 헤더 */}
      <div className="px-4 pt-4">
        <div
          className="text-center py-2 border-2 border-[#1A1A1A]"
          style={{ backgroundColor: theme.colors.backgroundCard }}
        >
          <p
            className="font-serif-display text-xs tracking-widest"
            style={{ color: theme.colors.textSecondary }}
          >
            {semesterLabel}
            {course && ` · ${course.nameEn}`}
          </p>
        </div>
      </div>

      {/* 상단 장식 테두리 */}
      <div className="border-b-2 border-[#1A1A1A] mx-4 mt-4" />

      {/* 헤더 */}
      <header className="px-6 pt-8 pb-6">
        <div className="flex items-start justify-between">
          {/* 프로필 */}
          <button
            className="flex items-center gap-3"
            onClick={() => setShowProfileDrawer(true)}
          >
            <div
              className="w-16 h-16 flex items-center justify-center"
              style={{
                border: '2px solid #1A1A1A',
                backgroundColor: theme.colors.backgroundCard,
              }}
            >
              <VintageProfileIcon size={32} />
            </div>
            <div className="text-left">
              <p
                className="font-serif-display text-2xl font-bold"
                style={{ color: theme.colors.text }}
              >
                {profile.nickname}
              </p>
              <p
                className="text-sm"
                style={{ color: theme.colors.textSecondary }}
              >
                {profile.classType}반 · {rankInfo.name}
              </p>
            </div>
          </button>

          {/* 반 배지 */}
          <div
            className="px-3 py-1 font-serif-display font-bold"
            style={{
              backgroundColor: theme.colors.accent,
              color: '#F5F0E8',
            }}
          >
            {classType}반
          </div>
        </div>
      </header>

      {/* 장식 구분선 */}
      <div className="flex items-center justify-center gap-4 px-4 mb-6">
        <div className="flex-1 h-px bg-[#1A1A1A]" />
        <div className="text-[#1A1A1A] text-lg">✦</div>
        <div className="flex-1 h-px bg-[#1A1A1A]" />
      </div>

      {/* 캐릭터 영역 */}
      <section className="px-4 mb-6">
        <div
          className="relative overflow-hidden"
          style={{
            border: '2px solid #1A1A1A',
            backgroundColor: theme.colors.backgroundCard,
          }}
        >
          {/* 장식 코너 */}
          <div className="absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 border-[#1A1A1A]" />
          <div className="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-[#1A1A1A]" />
          <div className="absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-[#1A1A1A]" />
          <div className="absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2 border-[#1A1A1A]" />

          <div className="w-full h-56 flex items-center justify-center">
            <div className="text-8xl grayscale-[20%]">🐰</div>
          </div>

          {/* 경험치 바 */}
          <div className="px-4 pb-4">
            <div className="flex justify-between mb-1">
              <span
                className="text-xs font-serif-display"
                style={{ color: theme.colors.accent }}
              >
                {rankInfo.name}
              </span>
              <span
                className="text-xs"
                style={{ color: theme.colors.textSecondary }}
              >
                {rankInfo.currentExp} / {rankInfo.maxExp} XP
              </span>
            </div>
            <div
              className="h-2 overflow-hidden"
              style={{
                backgroundColor: theme.colors.backgroundSecondary,
                border: '1px solid #1A1A1A',
              }}
            >
              <motion.div
                className="h-full"
                style={{ backgroundColor: theme.colors.accent }}
                initial={{ width: 0 }}
                animate={{ width: `${expProgress}%` }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* 프로필 드로어 */}
      <ProfileDrawer
        isOpen={showProfileDrawer}
        onClose={() => setShowProfileDrawer(false)}
      />

      {/* 내 전적 */}
      <section className="px-4 pb-6">
        <h2
          className="font-serif-display text-xl font-bold mb-4 flex items-center gap-2"
          style={{ color: theme.colors.text }}
        >
          <span>MY RECORDS</span>
          <div className="flex-1 h-px bg-[#1A1A1A]" />
        </h2>

        <div className="grid grid-cols-3 gap-3">
          {[
            { value: profile.totalQuizzes, label: '퀴즈' },
            { value: `${correctRate}%`, label: '정답률' },
            { value: `상위 ${100 - profile.participationRate}%`, label: '기여도' },
          ].map((item, index) => (
            <div
              key={index}
              className="text-center p-4"
              style={{
                border: '1px solid #1A1A1A',
                backgroundColor: theme.colors.backgroundCard,
              }}
            >
              <p
                className="font-serif-display text-xl font-bold"
                style={{ color: theme.colors.text }}
              >
                {item.value}
              </p>
              <p
                className="text-xs mt-1"
                style={{ color: theme.colors.textSecondary }}
              >
                {item.label}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* 반별 레이스 */}
      <section className="px-4 pb-8">
        <h2
          className="font-serif-display text-xl font-bold mb-4 flex items-center gap-2"
          style={{ color: theme.colors.text }}
        >
          <span>CLASS RACE</span>
          <div className="flex-1 h-px bg-[#1A1A1A]" />
        </h2>

        <div
          className="p-4"
          style={{
            border: '1px solid #1A1A1A',
            backgroundColor: theme.colors.backgroundCard,
          }}
        >
          <div className="space-y-3">
            {(['A', 'B', 'C', 'D'] as ClassType[]).map((cls) => {
              const position = classParticipation[cls];
              const rank = sortedClasses.indexOf(cls) + 1;
              const isMyClass = cls === classType;

              return (
                <div key={cls} className="relative">
                  <div className="flex items-center gap-3">
                    {/* 반 라벨 */}
                    <div
                      className="w-10 text-center py-1 text-xs font-serif-display font-bold"
                      style={{
                        backgroundColor: classColors[cls],
                        color: '#F5F0E8',
                        border: isMyClass ? '2px solid #1A1A1A' : 'none',
                      }}
                    >
                      {cls}
                    </div>

                    {/* 진행바 */}
                    <div className="flex-1 relative">
                      <div
                        className="h-6 overflow-hidden"
                        style={{
                          backgroundColor: theme.colors.backgroundSecondary,
                          border: '1px solid #D4CFC4',
                        }}
                      >
                        <motion.div
                          className="h-full flex items-center justify-end pr-2"
                          style={{ backgroundColor: `${classColors[cls]}30` }}
                          initial={{ width: '10%' }}
                          animate={{ width: `${position}%` }}
                          transition={{ duration: 1, ease: 'easeOut' }}
                        >
                          <span className="text-xs">🐰</span>
                        </motion.div>
                      </div>
                    </div>

                    {/* 순위 */}
                    <div
                      className="w-8 text-center font-serif-display font-bold text-sm"
                      style={{ color: classColors[cls] }}
                    >
                      {rank}위
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div
            className="mt-4 text-center py-2 border-t"
            style={{ borderColor: theme.colors.border }}
          >
            <span style={{ color: theme.colors.text }}>
              우리 반은 현재{' '}
              <span className="font-serif-display font-bold" style={{ color: classColors[classType] }}>
                {sortedClasses.indexOf(classType) + 1}위
              </span>
              !
            </span>
          </div>
        </div>
      </section>

      {/* 하단 장식 */}
      <div className="px-4">
        <div className="border-t-2 border-[#1A1A1A]" />
      </div>
    </div>
  );
}
