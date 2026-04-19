'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from 'react';
import { useWideMode } from '@/lib/hooks/useViewportScale';
import { pruneAllStaleHiders } from '@/lib/hooks/useHideNav';
import { useHomeOverlay } from '@/lib/contexts/HomeOverlayContext';
import { useUser } from '@/lib/contexts/UserContext';
import { getRabbitProfileUrl } from '@/lib/utils/rabbitProfile';
import { useDetailPanel } from '@/lib/contexts/DetailPanelContext';
import { useLearningQuizzes } from '@/lib/hooks/useLearningQuizzes';
import { useCompletedQuizzes } from '@/lib/hooks/useCompletedQuizzes';
import { useAuth } from '@/lib/hooks/useAuth';
import { useCourse } from '@/lib/contexts/CourseContext';
import PdfSidebarSection from '@/components/pdf/PdfSidebarSection';

export type UserRole = 'student' | 'professor';

interface NavItem {
  icon: (isActive: boolean) => React.ReactNode;
  path: string;
  label: string;
}

interface NavigationProps {
  role: UserRole;
}

// 통일된 색상
const ACTIVE_COLOR = '#FFFFFF';
const INACTIVE_COLOR = '#1A1A1A';

// 홈 아이콘 (탭바 + 사이드바 공용)
const homeIcon = (isActive: boolean) => (
  <svg className="w-6 h-6" fill="none" stroke={isActive ? ACTIVE_COLOR : INACTIVE_COLOR} strokeWidth={isActive ? 2 : 1.5} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
  </svg>
);

// 학생용 네비게이션 탭
const studentTabs: NavItem[] = [
  {
    icon: homeIcon,
    path: '/',
    label: '홈',
  },
  {
    // 퀴즈 아이콘 - 물음표
    icon: (isActive) => (
      <svg className="w-6 h-6" fill="none" stroke={isActive ? ACTIVE_COLOR : INACTIVE_COLOR} strokeWidth={isActive ? 2.5 : 2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 8c0-2.5 2.5-4.5 5-4.5s5 2 5 4.5c0 2-1.5 3.5-3.5 4-.7.2-1.5.8-1.5 1.5v2" />
        <circle cx="12" cy="19" r="1" fill={isActive ? ACTIVE_COLOR : INACTIVE_COLOR} />
      </svg>
    ),
    path: '/quiz',
    label: '퀴즈',
  },
  {
    // 복습 아이콘 - 책
    icon: (isActive) => (
      <svg className="w-6 h-6" fill="none" stroke={isActive ? ACTIVE_COLOR : INACTIVE_COLOR} strokeWidth={isActive ? 2 : 1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    ),
    path: '/review',
    label: '복습',
  },
  {
    // 게시판 아이콘 - 신문
    icon: (isActive) => (
      <svg className="w-6 h-6" fill="none" stroke={isActive ? ACTIVE_COLOR : INACTIVE_COLOR} strokeWidth={isActive ? 2 : 1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5M6 7.5h3v3H6v-3z" />
      </svg>
    ),
    path: '/board',
    label: '게시판',
  },
];

// 교수님용 네비게이션 탭: 홈 / 통계 / 퀴즈 / 학생 / 게시판
const professorTabs: NavItem[] = [
  {
    icon: homeIcon,
    path: '/professor',
    label: '홈',
  },
  {
    // 통계 아이콘 - 막대 차트
    icon: (isActive) => (
      <svg className="w-6 h-6" fill="none" stroke={isActive ? ACTIVE_COLOR : INACTIVE_COLOR} strokeWidth={isActive ? 2 : 1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
    path: '/professor/stats',
    label: '통계',
  },
  {
    // 퀴즈 아이콘 - 클립보드
    icon: (isActive) => (
      <svg className="w-6 h-6" fill="none" stroke={isActive ? ACTIVE_COLOR : INACTIVE_COLOR} strokeWidth={isActive ? 2 : 1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
      </svg>
    ),
    path: '/professor/quiz',
    label: '퀴즈',
  },
  {
    // 학생 아이콘 - 사람들
    icon: (isActive) => (
      <svg className="w-6 h-6" fill="none" stroke={isActive ? ACTIVE_COLOR : INACTIVE_COLOR} strokeWidth={isActive ? 2 : 1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
    path: '/professor/students',
    label: '학생',
  },
  {
    // 게시판 아이콘 - 신문
    icon: (isActive) => (
      <svg className="w-6 h-6" fill="none" stroke={isActive ? ACTIVE_COLOR : INACTIVE_COLOR} strokeWidth={isActive ? 2 : 1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5M6 7.5h3v3H6v-3z" />
      </svg>
    ),
    path: '/board',
    label: '게시판',
  },
];

function isActiveTab(pathname: string, tabPath: string): boolean {
  if (tabPath === '/' || tabPath === '/professor') {
    return pathname === tabPath;
  }
  return pathname.startsWith(tabPath);
}

/**
 * 복습 탭 하위 서재 퀴즈 바로가기 (가로모드 전용)
 * "서재" 헤더 없이 문제지 목록만 표시
 * 클릭 시 2쪽=FolderDetailPage + 3쪽=ReviewPractice 자동 시작
 */
function SidebarLibraryItems({ textColor, onItemClick }: { textColor: string; onItemClick?: () => void }) {
  const router = useRouter();
  const { user } = useAuth();
  const { userCourseId } = useCourse();
  const { quizzes: libraryQuizzesRaw, loading: libraryLoading } = useLearningQuizzes();
  const { completedQuizzes, completedLoading } = useCompletedQuizzes(user, userCourseId, libraryQuizzesRaw);
  const { isDetailOpen, unlockDetail } = useDetailPanel();
  const [activeQuizId, setActiveQuizId] = useState<string | null>(null);

  // 서재 전체 목록 (AI 생성 + 비공개 커스텀 + 완료된 교수 퀴즈)
  const quizzes = useMemo(() => {
    return [...libraryQuizzesRaw, ...completedQuizzes];
  }, [libraryQuizzesRaw, completedQuizzes]);
  const loading = libraryLoading || completedLoading;

  // 바로가기 클릭: 3쪽 잠금만 해제(콘텐츠 유지) + 네비게이션
  // 콘텐츠를 유지해야 layout의 "탭 루트 복귀"가 isDetailOpen 체크로 스킵됨
  // FolderDetailPage autoStart가 실제 콘텐츠 교체 처리
  const handleClick = useCallback((quizId: string) => {
    onItemClick?.();
    unlockDetail(false); // 잠금만 해제, 콘텐츠 유지
    setActiveQuizId(quizId);
    prevDetailOpenRef.current = false;
    router.push(`/review/library/${quizId}?autoStart=all`);
  }, [onItemClick, unlockDetail, router]);

  // 3쪽이 열렸다가 닫힌 경우 하이라이트 해제 (탭 전환 시 컴포넌트 언마운트로 자동 초기화)
  const prevDetailOpenRef = useRef(false);
  useEffect(() => {
    if (activeQuizId && prevDetailOpenRef.current && !isDetailOpen) {
      setActiveQuizId(null);
    }
    prevDetailOpenRef.current = isDetailOpen;
  }, [isDetailOpen, activeQuizId]);

  if (loading || quizzes.length === 0) return null;

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
      className="overflow-hidden"
    >
      <div
        className="py-1 overflow-y-auto scrollbar-sidebar"
        style={{ maxHeight: 'calc(100vh - 400px)' }}
      >
        {quizzes.map((quiz) => {
          const isSelected = activeQuizId === quiz.id;
          return (
            <button
              key={quiz.id}
              onClick={() => handleClick(quiz.id)}
              className="w-full flex items-center gap-2 pl-10 pr-3 py-1.5 rounded-xl transition-all duration-200 text-left"
              style={{
                backgroundColor: isSelected ? 'rgba(0, 0, 0, 0.07)' : 'transparent',
                opacity: isSelected ? 1 : 0.5,
              }}
            >
              <span
                className="text-xs truncate flex-1 font-semibold transition-colors duration-300"
                style={{ color: textColor }}
              >
                {quiz.title}
              </span>
              <span
                className="text-[10px] flex-shrink-0 tabular-nums font-semibold transition-colors duration-300"
                style={{ color: textColor }}
              >
                {quiz.questionCount}문
              </span>
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}

/**
 * 네비게이션 — 세로모드: 하단 바 / 가로모드: 좌측 사이드바
 * 오버레이가 열려 있어도 항상 표시 (z-50 > 오버레이 z-45)
 */
export default function Navigation({ role }: NavigationProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isHidden, setIsHidden] = useState(false);
  const isWide = useWideMode();
  const {
    open: openHomeOverlay,
    close: closeOverlay,
    closeAnimated: closeOverlayAnimated,
    isOpen: isOverlayOpen,
    homeButtonRef,
  } = useHomeOverlay();
  const { profile } = useUser();
  const { closeDetail, clearQueue, isLocked } = useDetailPanel();

  // 경로 기반 네비게이션 숨김 — layout.tsx hideNavigation과 동기화
  const shouldHideByPath = useMemo(() => {
    if (/^\/quiz\/[^/]+/.test(pathname) && pathname !== '/quiz/create') return true;
    if (pathname.includes('/edit')) return true;
    if (/^\/board\/[^/]+/.test(pathname)) return true;
    if (pathname === '/ranking') return true;
    if (pathname === '/review/random') return true;
    if (/^\/review\/[^/]+\/[^/]+/.test(pathname)) return true;
    if (/^\/professor\/quiz\/[^/]+\/preview/.test(pathname)) return true;
    if (pathname === '/quiz/create') return true;
    if (pathname === '/professor/quiz/create') return true;
    return false;
  }, [pathname]);

  // body attribute 감지 (모달, 홈 오버레이 등)
  // + 5초마다 자가 복구 (attribute ↔ 상태 불일치 시 보정)
  const [isOverlayAttr, setIsOverlayAttr] = useState(false);
  useEffect(() => {
    const syncState = () => {
      const hideNav = document.body.hasAttribute('data-hide-nav');
      const hideNavOnly = document.body.hasAttribute('data-hide-nav-only');
      const overlayOpen = document.body.hasAttribute('data-home-overlay-open');
      setIsHidden(hideNav || hideNavOnly || overlayOpen);
      setIsOverlayAttr(overlayOpen);
    };
    syncState();
    const observer = new MutationObserver(syncState);
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-hide-nav', 'data-hide-nav-only', 'data-home-overlay-open'] });
    // 5초마다 자가 복구 (고아 ID 정리 + attribute ↔ 상태 보정)
    const healthCheck = setInterval(() => {
      pruneAllStaleHiders();
      syncState();
    }, 5000);
    return () => {
      observer.disconnect();
      clearInterval(healthCheck);
    };
  }, []);

  const tabs = role === 'professor' ? professorTabs : studentTabs;
  const homePath = role === 'professor' ? '/professor' : '/';

  // 가로모드 홈 페이지 여부 (라우트 기반)
  const isHomePage = isWide && pathname === homePath;

  // 홈 버튼: 가로모드 → 라우트 이동, 세로모드 → 오버레이 토글
  const handleHomeClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (isWide) {
      // 가로모드: 이미 홈이면 무시, 아니면 라우트 이동
      if (pathname === homePath) return;
      // 잠금 시 대기열만 정리, 비잠금 시 3쪽 닫기
      if (isLocked) clearQueue();
      else closeDetail();
      router.push(homePath);
      return;
    }
    // 세로모드: 오버레이 토글
    if (isOverlayOpen) {
      closeOverlayAnimated();
    } else {
      sessionStorage.setItem('home_return_path', pathname);
      openHomeOverlay();
    }
  }, [pathname, homePath, openHomeOverlay, closeOverlayAnimated, isOverlayOpen, isWide, router, isLocked, closeDetail]);

  // 다른 탭 클릭: 오버레이 닫기 + 홈 페이지 3쪽 정리
  const handleTabClick = useCallback(() => {
    // 세로모드: 오버레이 열려있으면 닫기
    if (isOverlayOpen) {
      closeOverlay();
      if (!isLocked) closeDetail();
    }
    // 가로모드: 홈 페이지에서 다른 탭으로 → 비잠금 디테일 닫기
    if (isWide && pathname === homePath && !isLocked) {
      closeDetail();
    }
  }, [isOverlayOpen, closeOverlay, isLocked, closeDetail, isWide, pathname, homePath]);

  // 가로모드 사이드바는 항상 유지 (퀴즈 풀이 등 상세 페이지에서도 좌측 네비 표시)
  if (shouldHideByPath && !isWide) return null;
  if (isHidden && !isWide) return null;
  if (isHidden && isWide && !isOverlayAttr) return null;

  // 가로모드: 프로스티드 글래스 사이드바 (Apple Music 스타일)
  // 홈 오버레이 열림 → 핑크 글래스 + 흰 글씨, 닫힘 → 화이트 글래스 + 어두운 글씨
  if (isWide) {
    const isHome = isHomePage || isOverlayOpen;
    const textColor = '#1A1A1A';

    return (
      <nav
        className="fixed z-50 flex flex-col overflow-hidden transition-colors duration-300"
        style={{
          left: '8px',
          top: '8px',
          bottom: '8px',
          width: '224px',
          borderRadius: '14px',
          backgroundColor: isHome
            ? 'rgba(120, 80, 100, 0.52)'     // 핑크 글래스 (진하게)
            : 'rgba(200, 195, 188, 0.75)',   // 크림 글래스 (따뜻하게)
          backdropFilter: 'saturate(180%) blur(24px)',
          WebkitBackdropFilter: 'saturate(180%) blur(24px)',
          boxShadow: isHome
            ? '0 2px 20px rgba(0, 0, 0, 0.15)'
            : '0 2px 20px rgba(0, 0, 0, 0.08), 0 0 0 0.5px rgba(0, 0, 0, 0.06)',
        }}
      >
        {/* 프로필 섹션 */}
        <div
          className="px-5 pb-4 flex items-center gap-3"
          style={{ paddingTop: 'calc(1.5rem + env(safe-area-inset-top, 0px))' }}
        >
          <div
            className="w-11 h-11 flex items-center justify-center flex-shrink-0 rounded-xl overflow-hidden"
            style={{
              background: 'rgba(0, 0, 0, 0.05)',
              border: '1px solid rgba(0, 0, 0, 0.08)',
            }}
          >
            {profile?.profileRabbitId != null ? (
              <img src={getRabbitProfileUrl(profile.profileRabbitId)} alt="프로필" className="w-full h-full object-cover" />
            ) : (
              <svg width={28} height={28} viewBox="0 0 24 24" fill={textColor}>
                <circle cx="12" cy="8" r="4" />
                <path d="M12 14c-4 0-8 2-8 4v2h16v-2c0-2-4-4-8-4z" />
              </svg>
            )}
          </div>
          <p className="font-bold text-lg truncate flex-1 transition-colors duration-300" style={{ color: textColor }}>
            {profile?.nickname || ''}
          </p>
        </div>

        {/* 구분선 */}
        <div className="mx-5 border-t mb-2" style={{ borderColor: 'rgba(0,0,0,0.1)' }} />

        {/* 네비게이션 아이템 + 복습 하위 서재 바로가기 */}
        <div className="flex-1 px-3 flex flex-col gap-1 overflow-hidden">
          {tabs.map((tab) => {
            const isHomeTab = tab.path === homePath;
            const isActive = (isHomePage || isOverlayOpen)
              ? isHomeTab
              : isActiveTab(pathname, tab.path);
            const isReviewTab = tab.path === '/review';
            const showLibrary = isReviewTab && role === 'student' && isActive && !isOverlayOpen && !isHomePage;

            return (
              <Fragment key={tab.path}>
                <Link
                  href={tab.path}
                  ref={isHomeTab ? (el: HTMLAnchorElement | null) => { homeButtonRef.current = el; } : undefined}
                  onClick={isHomeTab ? handleHomeClick : handleTabClick}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 flex-shrink-0"
                  style={{
                    backgroundColor: isActive ? 'rgba(0, 0, 0, 0.07)' : 'transparent',
                    opacity: isActive ? 1 : 0.5,
                  }}
                  aria-label={tab.label}
                >
                  {tab.icon(false)}
                  <span className="text-sm font-semibold flex-1 transition-colors duration-300" style={{ color: textColor }}>
                    {tab.label}
                  </span>
                  {/* 복습 드롭다운 화살표 (학생 전용) */}
                  {isReviewTab && role === 'student' && !isOverlayOpen && !isHomePage && (
                    <motion.svg
                      className="w-3 h-3 flex-shrink-0"
                      fill="none"
                      stroke={textColor}
                      strokeWidth={2.5}
                      viewBox="0 0 24 24"
                      animate={{ rotate: isActive ? 90 : 0 }}
                      transition={{ duration: 0.2 }}
                      style={{ opacity: 0.4 }}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </motion.svg>
                  )}
                </Link>
                {/* 복습 탭 하위: 서재 퀴즈 바로가기 */}
                <AnimatePresence>
                  {showLibrary && (
                    <SidebarLibraryItems
                      key="library-items"
                      textColor={textColor}
                      onItemClick={isOverlayOpen ? closeOverlay : undefined}
                    />
                  )}
                </AnimatePresence>
              </Fragment>
            );
          })}

          {/* PDF 뷰어 섹션 — 가로모드 전용, 게시판 탭 아래 */}
          <PdfSidebarSection />
        </div>

        <div className="flex-shrink-0 px-6 py-2.5 pb-4">
          <p className="text-sm font-semibold transition-colors duration-300" style={{ color: textColor, opacity: 0.45 }}>
            Prof. Jin-A Kim
          </p>
        </div>
      </nav>
    );
  }

  // 세로모드: 하단 플로팅 네비게이션 바
  // iOS 26: bottom: 0 + paddingBottom으로 safe area 갭을 nav 내부로 흡수
  // backgroundColor로 safe area 영역 채움 + Liquid Glass 툴바 틴팅 소스 제공
  return (
    <nav
      className="fixed left-0 right-0 bottom-0 z-50"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="flex justify-center px-4 py-1.5">
        <div
          className="relative flex items-stretch rounded-2xl overflow-hidden"
          style={{
            backgroundColor: '#F5F0E8',
            border: '2px solid #1A1A1A',
            boxShadow: '4px 4px 0px #1A1A1A',
            maxWidth: role === 'professor' ? '420px' : '340px',
            width: '100%',
          }}
        >
          {/* 슬라이드 배경 */}
          <motion.div
            className="absolute rounded-xl"
            style={{
              width: `calc(${100 / tabs.length}% - 8px)`,
              top: 4,
              bottom: 4,
              backgroundColor: 'rgba(26, 26, 26, 0.85)',
            }}
            initial={false}
            animate={{
              left: `calc(${(tabs.findIndex((tab) => isActiveTab(pathname, tab.path)) / tabs.length) * 100}% + 4px)`,
            }}
            transition={{
              type: 'spring',
              stiffness: 500,
              damping: 35,
            }}
          />

          {tabs.map((tab) => {
            const isActive = isActiveTab(pathname, tab.path);
            const isHome = tab.path === homePath;

            return (
              <Link
                key={tab.path}
                href={tab.path}
                ref={isHome ? (el: HTMLAnchorElement | null) => { homeButtonRef.current = el; } : undefined}
                onClick={isHome ? handleHomeClick : handleTabClick}
                className="relative z-10 flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-all duration-200"
                aria-label={tab.label}
              >
                <motion.div
                  animate={{ scale: isActive ? 1.1 : 1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                >
                  {tab.icon(isActive)}
                </motion.div>
                <span
                  className="text-xs font-bold"
                  style={{ color: isActive ? ACTIVE_COLOR : INACTIVE_COLOR }}
                >
                  {tab.label}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
