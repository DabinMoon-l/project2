'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { ThemeProvider } from '@/styles/themes/ThemeProvider';
import { useRequireAuth } from '@/lib/hooks/useAuth';
import Navigation from '@/components/common/Navigation';
import { NotificationProvider, ExpToastProvider, PullToHome } from '@/components/common';
import { AIQuizContainer } from '@/components/ai-quiz';
import { UserProvider, useUser, CourseProvider, useCourse } from '@/lib/contexts';
import { useActivityTracker } from '@/lib/hooks/useActivityTracker';
import type { ClassType } from '@/styles/themes';
import LibraryJobToast from '@/components/professor/library/LibraryJobToast';

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
  // 접속 추적 (lastActiveAt + currentActivity)
  useActivityTracker();

  const isHome = pathname === '/';
  const isProfHome = pathname === '/professor';

  const hideNavigation =
    isHome ||
    isProfHome ||
    pathname?.match(/^\/quiz\/[^/]+/) !== null ||
    pathname?.includes('/edit') ||
    pathname?.match(/^\/board\/[^/]+/) !== null ||
    pathname === '/ranking' ||
    pathname === '/review/random' ||
    pathname?.match(/^\/professor\/quiz\/[^/]+\/preview/) !== null ||
    pathname === '/quiz/create' ||
    pathname === '/professor/quiz/create';

  // 학생용 스와이프 다운으로 홈 이동 가능한 페이지
  const enablePullToHome =
    !isProfessor &&
    !isHome &&
    (pathname === '/quiz' || pathname === '/review' || pathname === '/board');

  // 교수용 PullToHome (통계/퀴즈/학생/게시판 → /professor 홈)
  const isProfessorHome = pathname === '/professor';
  const enableProfessorPullToHome =
    isProfessor &&
    !isProfessorHome &&
    (pathname === '/professor/stats' || pathname === '/professor/quiz' || pathname === '/professor/students' || pathname === '/board');

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
          <LibraryJobToast />
          <div className={`min-h-screen ${hideNavigation ? '' : 'pb-20'}`}>
            {/* 메인 콘텐츠 */}
            <main>
              {enablePullToHome ? (
                <PullToHome>
                  {children}
                  {/* AI 퀴즈 플로팅 버튼 — PullToHome 안에 넣어야 같이 슬라이드됨 */}
                  {pathname === '/quiz' && searchParams.get('manage') !== 'true' && <AIQuizContainer />}
                  {/* 네비게이션도 같이 슬라이드 */}
                  {!hideNavigation && (
                    <Navigation role="student" />
                  )}
                </PullToHome>
              ) : enableProfessorPullToHome ? (
                <PullToHome homePath="/professor" tabPaths={['/professor/stats', '/professor/quiz', '/professor/students', '/board']}>
                  {children}
                  {!hideNavigation && (
                    <Navigation role="professor" />
                  )}
                </PullToHome>
              ) : (
                <>
                  {children}
                  {!isProfessor && pathname === '/quiz' && searchParams.get('manage') !== 'true' && <AIQuizContainer />}
                </>
              )}
            </main>

            {/* 하단 네비게이션 바 (PullToHome 미적용 페이지) */}
            {!enablePullToHome && !enableProfessorPullToHome && !hideNavigation && (
              <Navigation role={isProfessor ? 'professor' : 'student'} />
            )}
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
