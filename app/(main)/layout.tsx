'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { ThemeProvider } from '@/styles/themes/ThemeProvider';
import { useRequireAuth } from '@/lib/hooks/useAuth';
import Navigation from '@/components/common/Navigation';
import { NotificationProvider, ExpToastProvider } from '@/components/common';
import { AIQuizContainer } from '@/components/ai-quiz';
import { UserProvider, useUser, CourseProvider, useCourse } from '@/lib/contexts';
import type { ClassType } from '@/styles/themes';

/**
 * 내부 레이아웃 컴포넌트
 * UserProvider 내부에서 useUser 사용
 */
function MainLayoutContent({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { profile, loading: profileLoading, isProfessor } = useUser();
  const { userCourseId } = useCourse();
  const [userClassType, setUserClassType] = useState<ClassType>('A');
  const [waitCount, setWaitCount] = useState(0);

  // 네비게이션 바를 숨길 페이지
  // - 퀴즈 풀이/결과/피드백 (/quiz/[id]/*)
  // - 수정 페이지 (/edit 포함)
  // - 랭킹 페이지 (/ranking)
  // - 랜덤 복습 페이지 (/review/random)
  const hideNavigation =
    pathname?.match(/^\/quiz\/[^/]+/) !== null ||
    pathname?.includes('/edit') ||
    pathname === '/ranking' ||
    pathname === '/review/random';

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

      // 대기 후에도 profile이 없으면 학적정보 입력으로 직접 이동
      router.replace('/onboarding/student-info');
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
      <div className="flex items-center justify-center min-h-screen" style={{ backgroundColor: '#F5F0E8' }}>
        <div className="flex flex-col items-center gap-4">
          <div
            className="w-10 h-10 border-2 border-[#1A1A1A] border-t-transparent rounded-full animate-spin"
          />
          <p className="text-[#3A3A3A] text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <ThemeProvider initialClassType={userClassType} courseId={userCourseId}>
      <NotificationProvider>
        <ExpToastProvider>
          <div className={`min-h-screen ${hideNavigation ? '' : 'pb-20'}`}>
            {/* 메인 콘텐츠 */}
            <main>
              {children}
            </main>

            {/* 하단 네비게이션 바 (퀴즈 풀이 중에는 숨김) */}
            {!hideNavigation && (
              <Navigation role={isProfessor ? 'professor' : 'student'} />
            )}

            {/* AI 퀴즈 플로팅 버튼 (학생 전용, 퀴즈 페이지에서만, 관리 모드 제외) */}
            {!isProfessor && pathname === '/quiz' && searchParams.get('manage') !== 'true' && <AIQuizContainer />}
          </div>
        </ExpToastProvider>
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

  // 로딩 중이거나 로그인되지 않은 경우 로딩 화면 표시
  if (loading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen" style={{ backgroundColor: '#F5F0E8' }}>
        <div className="flex flex-col items-center gap-4">
          <div
            className="w-10 h-10 border-2 border-[#1A1A1A] border-t-transparent rounded-full animate-spin"
          />
          <p className="text-[#3A3A3A] text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <UserProvider>
      <CourseProvider>
        <MainLayoutContent>{children}</MainLayoutContent>
      </CourseProvider>
    </UserProvider>
  );
}
