'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { LazyMotion, domAnimation } from 'framer-motion';
import { ThemeProvider } from '@/styles/themes/ThemeProvider';
import { useRequireAuth } from '@/lib/hooks/useAuth';
import Navigation from '@/components/common/Navigation';
import { NotificationProvider, ExpToastProvider, SwipeBack, ComposeProviders } from '@/components/common';
import { UserProvider, useUser, CourseProvider, useCourse, MilestoneProvider, HomeOverlayProvider, DetailPanelProvider, useDetailPanel } from '@/lib/contexts';
import { useHomeOverlay } from '@/lib/contexts/HomeOverlayContext';
import { useActivityTracker } from '@/lib/hooks/useActivityTracker';

import { usePageViewLogger } from '@/lib/hooks/usePageViewLogger';
import type { ClassType } from '@/styles/themes';

// 대형 오버레이/컨테이너 lazy load (역할별 조건부 렌더링)
const HomeOverlay = dynamic(() => import('@/components/home/HomeOverlay'), { ssr: false });
const ProfessorHomeOverlay = dynamic(() => import('@/components/home/ProfessorHomeOverlay'), { ssr: false });
const AIQuizContainer = dynamic(() => import('@/components/ai-quiz/AIQuizContainer'), { ssr: false });
const LibraryJobToast = dynamic(() => import('@/components/professor/library/LibraryJobToast'), { ssr: false });

// 라우트 사이드바 lazy load (가로모드 전용)
const QuizListSidebar = dynamic(() => import('@/components/quiz/QuizListSidebar'), { ssr: false });
const BoardListSidebar = dynamic(() => import('@/components/board/BoardListSidebar'), { ssr: false });
import { useViewportScale, useWideMode } from '@/lib/hooks/useViewportScale';
import { useScrollDismissKeyboard, useKeyboardCSSVariable } from '@/lib/hooks/useKeyboardAware';
import OfflineBanner from '@/components/common/OfflineBanner';



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
  // userClassType은 profile.classType에서 직접 파생 (불필요한 state 제거)
  const [waitCount, setWaitCount] = useState(0);

  // 뷰포트 스케일링 (세로모드: zoom, 가로모드: 1)
  useViewportScale();
  const isWide = useWideMode();

  // 스크롤 시 키보드 자동 닫기 (iOS 네이티브 앱 UX 패턴)
  useScrollDismissKeyboard();

  // --kb-offset CSS 변수 전역 설정 (키보드 부드러운 모션)
  useKeyboardCSSVariable();

  // 접속 추적 (lastActiveAt + currentActivity)
  useActivityTracker();


  // 페이지뷰 로깅 (연구용)
  usePageViewLogger();

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

  // 프로필에서 반 타입 → 로컬 스토리지 동기화 (테마 유지용)
  useEffect(() => {
    if (profile?.classType) {
      localStorage.setItem('hero-quiz-class-type', profile.classType);
    }
  }, [profile?.classType]);
  const userClassType = (profile?.classType as ClassType) || 'A';

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
    <ComposeProviders providers={[
      [ThemeProvider, { initialClassType: userClassType, courseId: userCourseId }],
      [NotificationProvider],
      [ExpToastProvider],
      [MilestoneWrapper, { isProfessor }],
      [HomeOverlayProvider],
      [DetailPanelProvider],
    ]}>
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
    </ComposeProviders>
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
  const { content: detailContent, isDetailOpen, closeDetail, isLocked } = useDetailPanel();
  const { isOpen: isHomeOverlayOpen } = useHomeOverlay();

  // 라우트 기반 사이드바 타입 감지 (가로모드 전용)
  const routeSidebarType = useMemo(() => {
    if (!isWide) return null;
    // /quiz/[id]/* (NOT /quiz/create, /professor/quiz/create)
    if (/^\/quiz\/[^/]+/.test(pathname) && pathname !== '/quiz/create') return 'quiz' as const;
    // 게시판·복습: 라우트 사이드바 사용 안 함 → 2쪽 메인 고정, 3쪽에서 상세 표시
    // /professor/quiz/[id]/preview
    if (/^\/professor\/quiz\/[^/]+\/preview/.test(pathname)) return 'quiz' as const;
    return null;
  }, [isWide, pathname]);

  // 잠금 해제 시 상세 라우트에 있으면 탭 루트로 복귀
  // (잠금 중 2쪽에서 상세 페이지를 볼 수 있는데, 해제 후 2쪽은 메인이어야 함)
  const router = useRouter();
  const prevLockedRef = useRef(isLocked);
  useEffect(() => {
    const wasLocked = prevLockedRef.current;
    prevLockedRef.current = isLocked;

    // 잠금 → 해제 전환 감지
    if (wasLocked && !isLocked && isWide) {
      const tabRoots = ['/', '/quiz', '/review', '/board', '/professor', '/professor/stats', '/professor/quiz', '/professor/students', '/settings', '/profile', '/ranking', '/review/random'];
      if (!tabRoots.includes(pathname)) {
        // 현재 탭의 루트로 이동
        const tabRoot = tabRoots.find(r => r !== '/' && pathname.startsWith(r)) || '/';
        router.replace(tabRoot);
      }
    }
  }, [isLocked, isWide, pathname, router]);

  // 라우트 사이드바 표시 여부 (컨텍스트 디테일 > 라우트 사이드바, 잠금 시 억제)
  const hasRouteSidebar = !!routeSidebarType && !isDetailOpen && !isLocked;

  // iOS PWA 핀치 줌 차단 — viewport user-scalable=no를 iOS가 무시하므로 JS로 보강
  useEffect(() => {
    const preventZoom = (e: Event) => { e.preventDefault(); };
    document.addEventListener('gesturestart', preventZoom, { passive: false });
    document.addEventListener('gesturechange', preventZoom, { passive: false });
    return () => {
      document.removeEventListener('gesturestart', preventZoom);
      document.removeEventListener('gesturechange', preventZoom);
    };
  }, []);

  // 배포 후 chunk 로드 실패 시 자동 새로고침 (SW 캐시 ↔ 서버 불일치 대응)
  useEffect(() => {
    const handleError = (e: ErrorEvent) => {
      if (e.message?.includes('ChunkLoadError') || e.message?.includes('Loading chunk') || e.message?.includes('Failed to fetch dynamically imported module')) {
        window.location.reload();
      }
    };
    const handleRejection = (e: PromiseRejectionEvent) => {
      const msg = e.reason?.message || String(e.reason);
      if (msg.includes('ChunkLoadError') || msg.includes('Loading chunk') || msg.includes('Failed to fetch dynamically imported module')) {
        window.location.reload();
      }
    };
    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);
    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  // CSS 변수를 body에 설정 (createPortal로 body에 렌더되는 모달/바텀시트가 상속받도록)
  useEffect(() => {
    const body = document.body;
    if (isWide) {
      // --modal-left: 모달/바텀시트 백드롭 시작점 (항상 사이드바 너비)
      body.style.setProperty('--modal-left', '240px');
      // --detail-panel-left: 잠금 시 main 영역 기준, 그 외 우측 패널 시작점
      body.style.setProperty('--detail-panel-left', isLocked ? '240px' : 'calc(50% + 120px)');
      // --home-sheet-left: 홈 오버레이 바텀시트 위치 (우측 패널)
      body.style.setProperty('--home-sheet-left', 'calc(50% + 120px)');
    } else {
      body.style.setProperty('--modal-left', '0px');
      body.style.setProperty('--detail-panel-left', '0px');
      body.style.setProperty('--home-sheet-left', '0px');
    }
    return () => {
      body.style.removeProperty('--modal-left');
      body.style.removeProperty('--detail-panel-left');
      body.style.removeProperty('--home-sheet-left');
    };
  }, [isWide, isLocked]);

  // --modal-right: 가로모드에서 모달을 2쪽 안에 가두기 (aside가 항상 존재)
  useEffect(() => {
    const body = document.body;
    if (isWide && !hasRouteSidebar) {
      body.style.setProperty('--modal-right', 'calc(50% - 120px)');
    } else {
      body.style.setProperty('--modal-right', '0px');
    }
  }, [isWide, hasRouteSidebar]);

  const isBoardDetail = /^\/board\/[^/]+$/.test(pathname) && pathname !== '/board/manage';

  return (
    <>
      <LibraryJobToast />
      <OfflineBanner />

      {/* 가로모드: 사이드바 뒤 배경 (플로팅 패널 갭에 보임) */}
      {isWide && (
        <div
          className="fixed left-0 top-0 bottom-0 z-40"
          style={{ width: '240px', backgroundColor: '#F5F0E8' }}
        >
          {/* 홈 오버레이 열릴 때: 1쪽 배경 이미지로 전환 */}
          <div
            className="absolute inset-0 transition-opacity duration-300"
            style={{
              backgroundImage: 'url(/images/home-bg-1.jpg)',
              backgroundSize: '100% 100%',
              opacity: isHomeOverlayOpen ? 1 : 0,
            }}
          />
        </div>
      )}

      <SwipeBack enabled={!isWide && !isTabRoot && !isBoardDetail}>
        <div
          data-main-content
          className="min-h-screen"
          style={{
            paddingTop: 'env(safe-area-inset-top, 0px)',
            ...(!hideNavigation && !isWide
              ? { paddingBottom: 'calc(4.25rem + env(safe-area-inset-bottom, 0px))' }
              : {}),
            ...(isWide ? { marginLeft: '240px' } : {}),
            // fixed 요소 좌측 위치 조정용 CSS 변수
            // 모바일: 0, 잠금 시: 240px (main 영역은 nav 오프셋만)
            // 가로모드(디테일/사이드바 열림): calc(50% + 120px), 그 외: 240px
            '--detail-panel-left': !isWide
              ? '0'
              : isLocked
                ? '240px'
                : (routeSidebarType || isDetailOpen)
                  ? 'calc(50% + 120px)'
                  : '240px',
          } as React.CSSProperties & Record<string, string>}
        >
          <div className={isWide ? 'flex h-screen overflow-hidden' : ''}>
            {/* 라우트 사이드바 (가로모드 좌측 — 퀴즈/복습 목록) */}
            {hasRouteSidebar && (
              <div
                className="w-1/2 flex-shrink-0 overflow-x-hidden overflow-y-auto h-screen"
                style={{ borderRight: '1px solid #B0A898' }}
              >
                {routeSidebarType === 'quiz' && <QuizListSidebar />}
              </div>
            )}

            {/* 메인 콘텐츠 (2쪽) — 독립 스크롤 */}
            <main
              className={
                isWide
                  ? 'w-1/2 flex-shrink-0 overflow-x-hidden overflow-y-auto h-screen'
                  : ''
              }
            >
              {children}
              {!isProfessor && pathname === '/quiz' && searchParams?.get('manage') !== 'true' && <AIQuizContainer />}
              {isProfessor && pathname === '/professor/quiz' && <AIQuizContainer />}
            </main>

            {/* 우측 디테일 패널 (3쪽) — 독립 스크롤 */}
            {/* fixed 요소는 뷰포트 기준 + --detail-panel-left CSS 변수로 3쪽 영역에 고정 */}
            {isWide && !hasRouteSidebar && (
              <aside
                className="w-1/2 flex-shrink-0 overflow-x-hidden overflow-y-auto h-screen relative"
                style={{
                  borderLeft: isHomeOverlayOpen && !isDetailOpen ? 'none' : '1px solid #B0A898',
                  backgroundColor: isDetailOpen ? '#F5F0E8' : 'transparent',
                  paddingRight: 'env(safe-area-inset-right, 0px)',
                  // 홈 오버레이 열림 + 3쪽 비어있을 때 배경 이미지
                  ...(isHomeOverlayOpen && !isDetailOpen ? {
                    backgroundImage: 'url(/images/home-bg-3.jpg)',
                    backgroundSize: '100% 100%',
                  } : {}),
                } as React.CSSProperties}
              >
                {isDetailOpen && (
                  <div className="h-full">
                    {detailContent}
                  </div>
                )}
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
    <LazyMotion features={domAnimation}>
      <UserProvider>
        <CourseProvider>
          <MainLayoutContent>{children}</MainLayoutContent>
        </CourseProvider>
      </UserProvider>
    </LazyMotion>
  );
}
