'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { ThemeProvider } from '@/styles/themes/ThemeProvider';
import { useRequireAuth } from '@/lib/hooks/useAuth';
import Navigation from '@/components/common/Navigation';
import { NotificationProvider } from '@/components/common';
import { UserProvider, useUser } from '@/lib/contexts';
import type { ClassType } from '@/styles/themes';

/**
 * 내부 레이아웃 컴포넌트
 * UserProvider 내부에서 useUser 사용
 */
function MainLayoutContent({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { profile, loading: profileLoading, isProfessor } = useUser();
  const [userClassType, setUserClassType] = useState<ClassType>('A');
  const [waitCount, setWaitCount] = useState(0);

  // 프로필이 없으면 온보딩으로 리다이렉트
  useEffect(() => {
    if (!profileLoading && !profile) {
      // 온보딩 방금 완료한 경우 플래그 확인
      const justCompleted = localStorage.getItem('onboarding_just_completed');

      if (justCompleted) {
        // 플래그가 있으면 잠시 대기 후 다시 체크
        localStorage.removeItem('onboarding_just_completed');
        setWaitCount(prev => prev + 1);
        return;
      }

      // 3번까지 대기 (총 약 3초)
      if (waitCount < 3) {
        const timer = setTimeout(() => {
          setWaitCount(prev => prev + 1);
        }, 1000);
        return () => clearTimeout(timer);
      }

      // 대기 후에도 profile이 없으면 온보딩으로
      router.replace('/onboarding');
    }
  }, [profile, profileLoading, router, waitCount]);

  // 프로필에서 반 타입 가져오기
  useEffect(() => {
    if (profile?.classType) {
      setUserClassType(profile.classType);
      // 로컬 스토리지에도 저장 (테마 유지용)
      localStorage.setItem('hero-quiz-class-type', profile.classType);
    }
  }, [profile?.classType]);

  // 프로필 로딩 중이거나 프로필이 없으면 로딩 표시
  if (profileLoading || !profile) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#4A0E0E]">
        <motion.div
          className="flex flex-col items-center gap-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <motion.div
            className="w-12 h-12 border-4 border-[#D4AF37] border-t-transparent rounded-full"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          />
          <p className="text-[#D4AF37] text-sm">프로필 확인 중...</p>
        </motion.div>
      </div>
    );
  }

  return (
    <ThemeProvider initialClassType={userClassType}>
      <NotificationProvider>
        <div className="min-h-screen pb-20">
          {/* 페이지 전환 애니메이션 */}
          <AnimatePresence mode="wait">
            <motion.main
              key="main-content"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {children}
            </motion.main>
          </AnimatePresence>

          {/* 하단 네비게이션 바 */}
          <Navigation role={isProfessor ? 'professor' : 'student'} />
        </div>
      </NotificationProvider>
    </ThemeProvider>
  );
}

/**
 * 메인 레이아웃
 * - UserProvider로 프로필 전역 관리
 * - ThemeProvider 적용
 * - Navigation 바 포함
 * - 인증 체크 (미로그인 시 로그인 페이지로 리다이렉트)
 */
export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useRequireAuth();

  // 로딩 중일 때 스피너 표시
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#4A0E0E]">
        <motion.div
          className="flex flex-col items-center gap-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          {/* 로딩 스피너 */}
          <motion.div
            className="w-12 h-12 border-4 border-[#D4AF37] border-t-transparent rounded-full"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          />
          <p className="text-[#D4AF37] text-sm">로딩 중...</p>
        </motion.div>
      </div>
    );
  }

  // 로그인되지 않은 경우 (리다이렉트 중)
  if (!user) {
    return null;
  }

  return (
    <UserProvider>
      <MainLayoutContent>{children}</MainLayoutContent>
    </UserProvider>
  );
}
