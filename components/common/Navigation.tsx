'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useWideMode } from '@/lib/hooks/useViewportScale';
import { useHomeOverlay } from '@/lib/contexts/HomeOverlayContext';
import { useUser } from '@/lib/contexts/UserContext';
import { getRabbitProfileUrl } from '@/lib/utils/rabbitProfile';

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
 * 네비게이션 — 세로모드: 하단 바 / 가로모드: 좌측 사이드바
 * 오버레이가 열려 있어도 항상 표시 (z-50 > 오버레이 z-45)
 */
export default function Navigation({ role }: NavigationProps) {
  const pathname = usePathname();
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
    // 5초마다 자가 복구 (MutationObserver가 놓친 경우 대비)
    const healthCheck = setInterval(syncState, 5000);
    return () => {
      observer.disconnect();
      clearInterval(healthCheck);
    };
  }, []);

  const tabs = role === 'professor' ? professorTabs : studentTabs;
  const homePath = role === 'professor' ? '/professor' : '/';

  // 홈 버튼: 오버레이 토글 (열려있으면 축소 애니메이션으로 닫기)
  const handleHomeClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (isOverlayOpen) {
      closeOverlayAnimated();
    } else {
      sessionStorage.setItem('home_return_path', pathname);
      openHomeOverlay();
    }
  }, [pathname, openHomeOverlay, closeOverlayAnimated, isOverlayOpen]);

  // 다른 탭 클릭: 오버레이가 열려있으면 즉시 닫기
  const handleTabClick = useCallback(() => {
    if (isOverlayOpen) {
      closeOverlay();
    }
  }, [isOverlayOpen, closeOverlay]);

  // 가로모드 사이드바는 오버레이 열려도 유지 (오버레이가 left:240px로 사이드바 오른쪽에만)
  if (shouldHideByPath) return null;
  if (isHidden && !isWide) return null;
  if (isHidden && isWide && !isOverlayAttr) return null;

  // 가로모드: 블랙 글래스 사이드바 (프로필 + 네비게이션)
  if (isWide) {
    return (
      <nav
        className="fixed left-0 top-0 bottom-0 z-50 flex flex-col"
        style={{
          width: '240px',
          backgroundColor: 'rgba(0, 0, 0, 0.82)',
          backdropFilter: 'blur(40px)',
          WebkitBackdropFilter: 'blur(40px)',
          borderRight: '1px solid rgba(255, 255, 255, 0.08)',
        }}
      >
        {/* 프로필 섹션 */}
        <div
          className="px-5 pb-4 flex items-center gap-3"
          style={{ paddingTop: 'calc(1.5rem + env(safe-area-inset-top, 0px))' }}
        >
          <div
            className="w-11 h-11 flex items-center justify-center flex-shrink-0 rounded-xl overflow-hidden"
            style={{ background: 'rgba(255, 255, 255, 0.1)', border: '1px solid rgba(255, 255, 255, 0.15)' }}
          >
            {profile?.profileRabbitId != null ? (
              <img src={getRabbitProfileUrl(profile.profileRabbitId)} alt="프로필" className="w-full h-full object-cover" />
            ) : (
              <svg width={28} height={28} viewBox="0 0 24 24" fill="white">
                <circle cx="12" cy="8" r="4" />
                <path d="M12 14c-4 0-8 2-8 4v2h16v-2c0-2-4-4-8-4z" />
              </svg>
            )}
          </div>
          <p className="font-bold text-lg text-white truncate flex-1">
            {profile?.nickname || ''}
          </p>
        </div>

        {/* 구분선 */}
        <div className="mx-5 border-t border-white/10 mb-2" />

        {/* 네비게이션 아이템 */}
        <div className="flex-1 px-3 flex flex-col gap-1">
          {tabs.map((tab) => {
            const isActive = isActiveTab(pathname, tab.path);
            const isHome = tab.path === homePath;

            return (
              <Link
                key={tab.path}
                href={tab.path}
                ref={isHome ? (el: HTMLAnchorElement | null) => { homeButtonRef.current = el; } : undefined}
                onClick={isHome ? handleHomeClick : handleTabClick}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200"
                style={{
                  backgroundColor: isActive ? 'rgba(255, 255, 255, 0.15)' : 'transparent',
                  opacity: isActive ? 1 : 0.6,
                }}
                aria-label={tab.label}
              >
                {tab.icon(true)}
                <span className="text-sm font-semibold text-white">
                  {tab.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    );
  }

  // 세로모드: 하단 바
  return (
    <nav
      className="fixed left-4 right-4 z-50 flex justify-center"
      style={{ bottom: 'max(1rem, calc(env(safe-area-inset-bottom, 0px) + 0.5rem))' }}
    >
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
    </nav>
  );
}
