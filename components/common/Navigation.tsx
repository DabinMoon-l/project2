'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useState, useEffect, useMemo } from 'react';

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

// 학생용 네비게이션 탭 (홈은 스와이프로 접근)
const studentTabs: NavItem[] = [
  {
    // 퀴즈 아이콘 - 물음표
    icon: (isActive) => (
      <svg className="w-8 h-8" fill="none" stroke={isActive ? ACTIVE_COLOR : INACTIVE_COLOR} strokeWidth={isActive ? 2.5 : 2} viewBox="0 0 24 24">
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
      <svg className="w-8 h-8" fill="none" stroke={isActive ? ACTIVE_COLOR : INACTIVE_COLOR} strokeWidth={isActive ? 2 : 1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    ),
    path: '/review',
    label: '복습',
  },
  {
    // 게시판 아이콘 - 신문
    icon: (isActive) => (
      <svg className="w-8 h-8" fill="none" stroke={isActive ? ACTIVE_COLOR : INACTIVE_COLOR} strokeWidth={isActive ? 2 : 1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5M6 7.5h3v3H6v-3z" />
      </svg>
    ),
    path: '/board',
    label: '게시판',
  },
];

// 교수님용 네비게이션 탭: 통계 / 퀴즈 / 학생 / 게시판 (홈은 스와이프로 접근)
const professorTabs: NavItem[] = [
  {
    // 통계 아이콘 - 막대 차트
    icon: (isActive) => (
      <svg className="w-8 h-8" fill="none" stroke={isActive ? ACTIVE_COLOR : INACTIVE_COLOR} strokeWidth={isActive ? 2 : 1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
    path: '/professor/stats',
    label: '통계',
  },
  {
    // 퀴즈 아이콘 - 클립보드
    icon: (isActive) => (
      <svg className="w-8 h-8" fill="none" stroke={isActive ? ACTIVE_COLOR : INACTIVE_COLOR} strokeWidth={isActive ? 2 : 1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
      </svg>
    ),
    path: '/professor/quiz',
    label: '퀴즈',
  },
  {
    // 학생 아이콘 - 사람들
    icon: (isActive) => (
      <svg className="w-8 h-8" fill="none" stroke={isActive ? ACTIVE_COLOR : INACTIVE_COLOR} strokeWidth={isActive ? 2 : 1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
    path: '/professor/students',
    label: '학생',
  },
  {
    // 게시판 아이콘 - 신문
    icon: (isActive) => (
      <svg className="w-8 h-8" fill="none" stroke={isActive ? ACTIVE_COLOR : INACTIVE_COLOR} strokeWidth={isActive ? 2 : 1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5M6 7.5h3v3H6v-3z" />
      </svg>
    ),
    path: '/board',
    label: '게시판',
  },
];

function isActiveTab(pathname: string, tabPath: string): boolean {
  if (tabPath === '/') {
    return pathname === tabPath;
  }
  return pathname.startsWith(tabPath);
}

/**
 * 심플 하단 네비게이션 - 아이콘만
 */
export default function Navigation({ role }: NavigationProps) {
  const pathname = usePathname();
  const [isHidden, setIsHidden] = useState(false);

  // 경로 기반 네비게이션 숨김
  const shouldHideByPath = useMemo(() => {
    // /quiz/[id] 하위 경로 (풀이, 결과, 피드백)
    if (/^\/quiz\/[^/]+/.test(pathname) && pathname !== '/quiz/create') return true;
    // /edit 포함 경로 (퀴즈 수정)
    if (pathname.includes('/edit')) return true;
    // /ranking 경로
    if (pathname === '/ranking') return true;
    // /review/random 경로
    if (pathname === '/review/random') return true;
    // /review/[type]/[id] 상세 경로
    if (/^\/review\/[^/]+\/[^/]+/.test(pathname)) return true;
    return false;
  }, [pathname]);

  // body의 data-hide-nav attribute를 감지하여 네비게이션 숨김 (모달 등)
  useEffect(() => {
    const checkHideNav = () => {
      const shouldHide = document.body.hasAttribute('data-hide-nav');
      setIsHidden(shouldHide);
    };

    // 초기 체크
    checkHideNav();

    // MutationObserver로 body attribute 변경 감지
    const observer = new MutationObserver(checkHideNav);
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-hide-nav'] });

    return () => observer.disconnect();
  }, []);

  const tabs = role === 'professor' ? professorTabs : studentTabs;

  // 숨김 상태면 렌더링하지 않음 (경로 기반 또는 data-hide-nav attribute)
  if (isHidden || shouldHideByPath) return null;

  return (
    <nav className="fixed bottom-4 left-4 right-4 z-50 flex justify-center">
      <div
        className="relative flex items-stretch rounded-2xl overflow-hidden"
        style={{
          backgroundColor: '#F5F0E8',
          border: '2px solid #1A1A1A',
          boxShadow: '4px 4px 0px #1A1A1A',
          maxWidth: '340px',
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

          return (
            <Link
              key={tab.path}
              href={tab.path}
              className="relative z-10 flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 transition-all duration-200"
              aria-label={tab.label}
            >
              {/* 아이콘 */}
              <motion.div
                animate={{ scale: isActive ? 1.1 : 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 20 }}
              >
                {tab.icon(isActive)}
              </motion.div>

              {/* 라벨 */}
              <span
                className="text-sm font-bold"
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
