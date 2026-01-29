'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { useTheme } from '@/styles/themes/useTheme';

/**
 * 빠른 메뉴 아이템 타입
 */
interface QuickMenuItem {
  // 아이콘 (이모지 또는 텍스트)
  icon: string;
  // 메뉴 라벨
  label: string;
  // 이동 경로
  path: string;
  // 알림 뱃지 수
  badge?: number;
  // 아이콘 배경색 (옵션)
  bgColor?: string;
}

/**
 * QuickMenu Props
 */
interface QuickMenuProps {
  // 읽지 않은 퀴즈 수
  unreadQuizCount?: number;
  // 복습할 문제 수 (오답노트)
  reviewCount?: number;
  // 새 게시글 수
  newPostCount?: number;
}

/**
 * 빠른 메뉴 컴포넌트
 * 4개 아이콘 버튼: 오늘의 퀴즈, 복습, 게시판, Shop
 */
export default function QuickMenu({
  unreadQuizCount = 0,
  reviewCount = 0,
  newPostCount = 0,
}: QuickMenuProps) {
  const { theme } = useTheme();

  // 메뉴 아이템 정의
  const menuItems: QuickMenuItem[] = [
    {
      icon: '📝',
      label: '오늘의 퀴즈',
      path: '/quiz',
      badge: unreadQuizCount,
      bgColor: '#FF6B6B',
    },
    {
      icon: '📚',
      label: '복습',
      path: '/review',
      badge: reviewCount,
      bgColor: '#4ECDC4',
    },
    {
      icon: '💬',
      label: '게시판',
      path: '/board',
      badge: newPostCount,
      bgColor: '#45B7D1',
    },
    {
      icon: '🛒',
      label: 'Shop',
      path: '/shop',
      badge: 0,
      bgColor: '#96CEB4',
    },
  ];

  // 애니메이션 설정
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 },
  };

  return (
    <motion.div
      className="w-full"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* 섹션 타이틀 */}
      <h3
        className="text-sm font-medium mb-3 px-1"
        style={{ color: theme.colors.textSecondary }}
      >
        빠른 메뉴
      </h3>

      {/* 메뉴 그리드 */}
      <div className="grid grid-cols-4 gap-3">
        {menuItems.map((item) => (
          <motion.div key={item.path} variants={itemVariants}>
            <Link href={item.path}>
              <motion.div
                className="flex flex-col items-center gap-2 p-3 rounded-xl relative"
                style={{
                  backgroundColor: theme.colors.backgroundSecondary,
                }}
                whileHover={{
                  scale: 1.05,
                  backgroundColor: `${theme.colors.accent}15`,
                }}
                whileTap={{ scale: 0.95 }}
                transition={{ type: 'spring', stiffness: 400, damping: 20 }}
              >
                {/* 아이콘 */}
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center text-2xl"
                  style={{
                    backgroundColor: `${item.bgColor}20`,
                  }}
                >
                  {item.icon}
                </div>

                {/* 라벨 */}
                <span
                  className="text-xs font-medium text-center"
                  style={{ color: theme.colors.text }}
                >
                  {item.label}
                </span>

                {/* 알림 뱃지 */}
                {item.badge !== undefined && item.badge > 0 && (
                  <motion.div
                    className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1.5 rounded-full flex items-center justify-center"
                    style={{
                      backgroundColor: '#FF4757',
                      color: '#FFFFFF',
                    }}
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{
                      type: 'spring',
                      stiffness: 500,
                      damping: 20,
                    }}
                  >
                    <span className="text-xs font-bold">
                      {item.badge > 99 ? '99+' : item.badge}
                    </span>
                  </motion.div>
                )}
              </motion.div>
            </Link>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
