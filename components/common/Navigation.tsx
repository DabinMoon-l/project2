'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useTheme } from '@/styles/themes/useTheme';

/**
 * 사용자 역할 타입
 */
export type UserRole = 'student' | 'professor';

/**
 * 네비게이션 탭 아이템 인터페이스
 */
interface NavItem {
  // 탭 아이콘 (이모지)
  icon: string;
  // 탭 라벨
  label: string;
  // 이동 경로
  path: string;
}

/**
 * Navigation Props
 */
interface NavigationProps {
  // 사용자 역할 (학생/교수님)
  role: UserRole;
}

// 학생용 네비게이션 탭 (4개)
const studentTabs: NavItem[] = [
  { icon: '🏠', label: '홈', path: '/' },
  { icon: '📝', label: '퀴즈', path: '/quiz' },
  { icon: '📚', label: '복습', path: '/review' },
  { icon: '💬', label: '게시판', path: '/board' },
];

// 교수님용 네비게이션 탭 (5개)
const professorTabs: NavItem[] = [
  { icon: '🏠', label: '홈', path: '/professor' },
  { icon: '📝', label: '퀴즈', path: '/professor/quiz' },
  { icon: '📊', label: '학생', path: '/professor/students' },
  { icon: '🔬', label: '문제', path: '/professor/analysis' },
  { icon: '💬', label: '게시판', path: '/professor/board' },
];

/**
 * 현재 경로가 탭과 매칭되는지 확인
 * @param pathname 현재 경로
 * @param tabPath 탭 경로
 * @returns 활성 여부
 */
function isActiveTab(pathname: string, tabPath: string): boolean {
  // 홈 경로는 정확히 일치해야 함
  if (tabPath === '/' || tabPath === '/professor') {
    return pathname === tabPath;
  }
  // 그 외 경로는 해당 경로로 시작하면 활성
  return pathname.startsWith(tabPath);
}

/**
 * 하단 고정 네비게이션 바 컴포넌트
 * 학생/교수님 역할에 따라 다른 탭 구성 표시
 * Framer Motion으로 탭 전환 애니메이션 적용
 */
export default function Navigation({ role }: NavigationProps) {
  const pathname = usePathname();
  const { theme } = useTheme();

  // 역할에 따른 탭 선택
  const tabs = role === 'professor' ? professorTabs : studentTabs;

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 safe-area-bottom"
      style={{
        backgroundColor: theme.colors.backgroundSecondary,
        borderTopWidth: '1px',
        borderTopStyle: 'solid',
        borderTopColor: theme.colors.border,
      }}
    >
      <ul className="flex items-center justify-around h-16 max-w-md mx-auto px-2">
        {tabs.map((tab) => {
          const isActive = isActiveTab(pathname, tab.path);

          return (
            <li key={tab.path} className="relative flex-1">
              <Link
                href={tab.path}
                className="flex flex-col items-center justify-center py-2 transition-colors duration-200"
                style={{
                  color: isActive
                    ? theme.colors.accent
                    : theme.colors.textSecondary,
                }}
              >
                {/* 활성 탭 배경 인디케이터 */}
                {isActive && (
                  <motion.div
                    layoutId="activeTab"
                    className="absolute inset-x-1 top-1 bottom-1 rounded-xl -z-10"
                    style={{
                      backgroundColor: `${theme.colors.accent}20`,
                    }}
                    initial={false}
                    transition={{
                      type: 'spring',
                      stiffness: 500,
                      damping: 35,
                    }}
                  />
                )}

                {/* 아이콘 */}
                <motion.span
                  className="text-xl mb-0.5"
                  animate={{
                    scale: isActive ? 1.15 : 1,
                  }}
                  transition={{
                    type: 'spring',
                    stiffness: 400,
                    damping: 20,
                  }}
                >
                  {tab.icon}
                </motion.span>

                {/* 라벨 */}
                <motion.span
                  className="text-xs font-medium"
                  animate={{
                    fontWeight: isActive ? 600 : 500,
                  }}
                  transition={{ duration: 0.15 }}
                >
                  {tab.label}
                </motion.span>

                {/* 활성 상태 점 인디케이터 */}
                {isActive && (
                  <motion.div
                    className="absolute -top-0.5 w-1 h-1 rounded-full"
                    style={{ backgroundColor: theme.colors.accent }}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0, opacity: 0 }}
                    transition={{
                      type: 'spring',
                      stiffness: 500,
                      damping: 25,
                    }}
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
