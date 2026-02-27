'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { ThemeProvider } from '@/styles/themes/ThemeProvider';
import { useRequireAuth } from '@/lib/hooks/useAuth';
import Navigation from '@/components/common/Navigation';
import { NotificationProvider, ExpToastProvider, SwipeBack } from '@/components/common';
import { AIQuizContainer } from '@/components/ai-quiz';
import { UserProvider, useUser, CourseProvider, useCourse, MilestoneProvider, HomeOverlayProvider } from '@/lib/contexts';
import { HomeOverlay, ProfessorHomeOverlay } from '@/components/home';
import { useActivityTracker } from '@/lib/hooks/useActivityTracker';
import type { ClassType } from '@/styles/themes';
import LibraryJobToast from '@/components/professor/library/LibraryJobToast';
import { useViewportScale, useWideMode } from '@/lib/hooks/useViewportScale';

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

  // 뷰포트 스케일링 (세로모드: zoom, 가로모드: 1)
  useViewportScale();
  const isWide = useWideMode();

  // 접속 추적 (lastActiveAt + currentActivity)
  useActivityTracker();

  // 네비게이션 숨김 (홈 오버레이는 body attribute으로 처리)
  const hideNavigation =
    pathname?.match(/^\/quiz\/[^/]+/) !== null ||
    pathname?.includes('/edit') ||
    pathname?.match(/^\/board\/[^/]+/) !== null ||
    pathname === '/ranking' ||
    pathname === '/review/random' ||
    pathname?.match(/^\/professor\/quiz\/[^/]+\/preview/) !== null ||
    pathname === '/quiz/create' ||
    pathname === '/professor/quiz/create';

  // 탭 루트 페이지에서는 SwipeBack 비활성화 (router.back()이 엉뚱한 곳으로 감)
  const isTabRoot =
    pathname === '/' ||
    pathname === '/quiz' ||
    pathname === '/review' ||
    pathname === '/board' ||
    pathname === '/professor' ||
    pathname === '/professor/stats' ||
    pathname === '/professor/quiz' ||
    pathname === '/professor/students' ||
    pathname === '/profile' ||
    pathname === '/settings';

  // 프로필이 없으면 로그인으로 리다이렉트
  useEffect(() => {
    if (!profileLoading && !profile) {
      // 가입 직후 프로필 로딩 대기 (Firestore 반영 지연)
      if (waitCount < 3) {
        const timer = setTimeout(() => {
          setWaitCount(prev => prev + 1);
        }, 1000);
        return () => clearTimeout(timer);
      }

      // 대기 후에도 profile이 없으면 로그인으로 이동
      router.replace('/login');
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
          <MilestoneWrapper isProfessor={isProfessor}>
            <HomeOverlayProvider>
              <LibraryJobToast />
              <SwipeBack enabled={!isWide && !isTabRoot}>
                <div
                  data-main-content
                  className={`min-h-screen ${hideNavigation || isWide ? '' : 'pb-20'}`}
                  style={isWide ? { marginLeft: '72px' } : undefined}
                >
                  {/* 메인 콘텐츠 */}
                  <main className={isWide ? 'max-w-[640px] mx-auto' : ''}>
                    {children}
                    {!isProfessor && pathname === '/quiz' && searchParams.get('manage') !== 'true' && <AIQuizContainer />}
                  </main>

                  {/* 하단 네비게이션 바 */}
                  {!hideNavigation && (
                    <Navigation role={isProfessor ? 'professor' : 'student'} />
                  )}
                </div>
              </SwipeBack>
              {!isProfessor ? <HomeOverlay /> : <ProfessorHomeOverlay />}
            </HomeOverlayProvider>
          </MilestoneWrapper>
        </ExpToastProvider>
      </NotificationProvider>
    </ThemeProvider>
  );
}

/**
 * 학생 전용 MilestoneProvider 래퍼 — 교수는 뽑기 없으므로 passthrough
 */
function MilestoneWrapper({ isProfessor, children }: { isProfessor: boolean; children: React.ReactNode }) {
  if (isProfessor) return <>{children}</>;
  return <MilestoneProvider>{children}</MilestoneProvider>;
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
