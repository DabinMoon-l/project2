'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ThemeProvider } from '@/styles/themes/ThemeProvider';
import { useRequireAuth } from '@/lib/hooks/useAuth';
import Navigation from '@/components/common/Navigation';
import { NotificationProvider, ExpToastProvider, SwipeBack } from '@/components/common';
import { AIQuizContainer } from '@/components/ai-quiz';
import { UserProvider, useUser, CourseProvider, useCourse, MilestoneProvider, HomeOverlayProvider, DetailPanelProvider, useDetailPanel } from '@/lib/contexts';
import { HomeOverlay, ProfessorHomeOverlay } from '@/components/home';
import { useActivityTracker } from '@/lib/hooks/useActivityTracker';
import type { ClassType } from '@/styles/themes';
import LibraryJobToast from '@/components/professor/library/LibraryJobToast';
import { useViewportScale, useWideMode } from '@/lib/hooks/useViewportScale';
import { useScrollDismissKeyboard } from '@/lib/hooks/useKeyboardAware';
import OfflineBanner from '@/components/common/OfflineBanner';

// 가로모드 라우트 사이드바 (lazy load)
const QuizListSidebar = dynamic(() => import('@/components/quiz/QuizListSidebar'), {
  loading: () => <div style={{ backgroundColor: '#F5F0E8', minHeight: '100vh' }} />,
});
const BoardListSidebar = dynamic(() => import('@/components/board/BoardListSidebar'), {
  loading: () => <div style={{ backgroundColor: '#F5F0E8', minHeight: '100vh' }} />,
});
const ReviewListSidebar = dynamic(() => import('@/components/review/ReviewListSidebar'), {
  loading: () => <div style={{ backgroundColor: '#F5F0E8', minHeight: '100vh' }} />,
});

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

  // 스크롤 시 키보드 자동 닫기 (iOS 네이티브 앱 UX 패턴)
  useScrollDismissKeyboard();

  // 접속 추적 (lastActiveAt + currentActivity)
  useActivityTracker();

  // 네비게이션 숨김 (홈 오버레이는 body attribute으로 처리)
  // Navigation.tsx의 shouldHideByPath와 동기화 필수
  const hideNavigation =
    (pathname?.match(/^\/quiz\/[^/]+/) !== null && pathname !== '/quiz/create') ||
    pathname?.includes('/edit') ||
    pathname?.match(/^\/board\/[^/]+/) !== null ||
    pathname === '/ranking' ||
    pathname === '/review/random' ||
    /^\/review\/[^/]+\/[^/]+/.test(pathname || '') ||
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
    pathname === '/settings' ||
    pathname === '/ranking' ||
    pathname === '/review/random';

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
              <DetailPanelProvider>
                <MainLayoutGrid
                  isWide={isWide}
                  hideNavigation={!!hideNavigation}
                  isProfessor={isProfessor}
                  isTabRoot={!!isTabRoot}
                  pathname={pathname || ''}
                  searchParams={searchParams}
                >
                  {children}
                </MainLayoutGrid>
              </DetailPanelProvider>
            </HomeOverlayProvider>
          </MilestoneWrapper>
        </ExpToastProvider>
      </NotificationProvider>
    </ThemeProvider>
  );
}

/**
 * 가로모드 3패널 그리드 레이아웃
 * DetailPanelProvider 내부에서 useDetailPanel 사용
 *
 * 세로모드: 단일 열 (기존과 동일)
 * 가로모드 (디테일 닫힘): 센터 max-w-640px
 * 가로모드 (라우트 사이드바): 50/50 2열 (사이드바 + 페이지)
 * 가로모드 (컨텍스트 디테일): 50/50 2열 (페이지 + 디테일 패널)
 */
function MainLayoutGrid({
  children,
  isWide,
  hideNavigation,
  isProfessor,
  isTabRoot,
  pathname,
  searchParams,
}: {
  children: React.ReactNode;
  isWide: boolean;
  hideNavigation: boolean;
  isProfessor: boolean;
  isTabRoot: boolean;
  pathname: string;
  searchParams: ReturnType<typeof useSearchParams>;
}) {
  const { content: detailContent, isDetailOpen, closeDetail } = useDetailPanel();

  // 가로모드 라우트 기반 사이드바 감지
  // 상세 페이지 진입 시 좌측에 목록 사이드바 표시
  const routeSidebarType = useMemo(() => {
    if (!isWide) return null;
    // 퀴즈 상세 (/quiz/[id], /quiz/[id]/result, /quiz/[id]/feedback, ...)
    if (pathname.match(/^\/quiz\/[^/]+/) && pathname !== '/quiz/create') return 'quiz';
    // 게시판 상세 (/board/[id], /board/[id]/edit)
    if (pathname.match(/^\/board\/[^/]+/) && pathname !== '/board/write' && pathname !== '/board/manage') return 'board';
    // 복습 상세 (/review/[type]/[id], /review/random)
    if (/^\/review\/[^/]+\/[^/]+/.test(pathname) || pathname === '/review/random') return 'review';
    // 교수 퀴즈 미리보기 (/professor/quiz/[id]/preview)
    if (pathname.match(/^\/professor\/quiz\/[^/]+\/preview/)) return 'quiz';
    return null;
  }, [isWide, pathname]);

  // 분할 레이아웃 활성 여부 (컨텍스트 디테일 > 라우트 사이드바 우선)
  const showSplit = isDetailOpen || routeSidebarType !== null;

  // CSS 변수를 body에 설정 (createPortal로 body에 렌더되는 모달/바텀시트가 상속받도록)
  useEffect(() => {
    const body = document.body;
    if (isWide) {
      // --modal-left: 모달/바텀시트 백드롭 시작점 (항상 사이드바 너비)
      body.style.setProperty('--modal-left', '240px');
      // --detail-panel-left: 활성 패널의 좌측 (분할 시 우측 패널 시작점)
      body.style.setProperty(
        '--detail-panel-left',
        routeSidebarType && !isDetailOpen ? 'calc(50% + 120px)' : '240px'
      );
    } else {
      body.style.setProperty('--modal-left', '0px');
      body.style.setProperty('--detail-panel-left', '0px');
    }
    return () => {
      body.style.removeProperty('--modal-left');
      body.style.removeProperty('--detail-panel-left');
    };
  }, [isWide, routeSidebarType, isDetailOpen]);

  // 라우트 사이드바 컴포넌트 렌더
  const renderRouteSidebar = () => {
    switch (routeSidebarType) {
      case 'quiz': return <QuizListSidebar />;
      case 'board': return <BoardListSidebar />;
      case 'review': return <ReviewListSidebar />;
      default: return null;
    }
  };

  return (
    <>
      <LibraryJobToast />
      <OfflineBanner />
      <SwipeBack enabled={!isWide && !isTabRoot}>
        <div
          data-main-content
          className="min-h-screen"
          style={{
            ...(!hideNavigation && !isWide
              ? { paddingBottom: 'calc(4.25rem + env(safe-area-inset-bottom, 0px))' }
              : {}),
            ...(isWide ? { marginLeft: '240px' } : {}),
            // fixed 요소 좌측 위치 조정용 CSS 변수
            // 모바일: 0, 가로모드: 240px (사이드바), 라우트 사이드바: calc(50% + 120px) (우측 패널)
            '--detail-panel-left': isWide
              ? (routeSidebarType && !isDetailOpen ? 'calc(50% + 120px)' : '240px')
              : '0',
          } as React.CSSProperties & Record<string, string>}
        >
          <div className={isWide && showSplit ? 'flex min-h-screen' : ''}>
            {/* 좌측: 라우트 사이드바 또는 메인 콘텐츠 */}
            <main
              className={
                isWide
                  ? showSplit
                    ? 'w-1/2 flex-shrink-0 overflow-y-auto min-h-screen'
                    : 'max-w-[640px] mx-auto w-full'
                  : ''
              }
            >
              {isWide && routeSidebarType && !isDetailOpen
                ? renderRouteSidebar()
                : <>
                    {children}
                    {!isProfessor && pathname === '/quiz' && searchParams?.get('manage') !== 'true' && <AIQuizContainer />}
                  </>
              }
            </main>

            {/* 우측: 라우트 페이지 또는 컨텍스트 디테일 패널 */}
            {isWide && showSplit && (
              <aside
                className="w-1/2 flex-shrink-0 overflow-y-auto min-h-screen relative"
                style={{
                  borderLeft: '1px solid #D4CFC4',
                  backgroundColor: '#F5F0E8',
                  paddingRight: 'env(safe-area-inset-right, 0px)',
                }}
              >
                {isDetailOpen ? (
                  <>
                    {/* 컨텍스트 디테일: 닫기 버튼 + 콘텐츠 */}
                    <button
                      onClick={closeDetail}
                      className="sticky top-3 float-right mr-3 z-10 w-8 h-8 rounded-full flex items-center justify-center"
                      style={{ backgroundColor: 'rgba(26, 26, 26, 0.08)' }}
                      aria-label="패널 닫기"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="#1A1A1A" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                    <div className="max-w-[640px]">
                      {detailContent}
                    </div>
                  </>
                ) : routeSidebarType ? (
                  // 라우트 사이드바: 페이지 children을 우측에 렌더
                  children
                ) : null}
              </aside>
            )}
          </div>

          {/* 하단 네비게이션 (가로모드에서는 사이드바이므로 항상 표시) */}
          {(!hideNavigation || isWide) && (
            <Navigation role={isProfessor ? 'professor' : 'student'} />
          )}
        </div>
      </SwipeBack>
      {!isProfessor ? <HomeOverlay /> : <ProfessorHomeOverlay />}
    </>
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
