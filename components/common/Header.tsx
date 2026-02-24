'use client';

import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useThemeColors } from '@/styles/themes/useTheme';

// Header Props 타입 정의
interface HeaderProps {
  /** 페이지 제목 */
  title: string;
  /** 뒤로가기 버튼 표시 여부 */
  showBack?: boolean;
  /** 커스텀 뒤로가기 핸들러 (없으면 router.back() 사용) */
  onBack?: () => void;
  /** 우측 액션 버튼 영역 */
  rightAction?: React.ReactNode;
}

// 뒤로가기 아이콘 컴포넌트 (chevron left)
function BackIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
    </svg>
  );
}

// 애니메이션 variants
const headerVariants = {
  initial: { opacity: 0, y: -10 },
  animate: { opacity: 1, y: 0 },
};

const titleVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
};

const buttonVariants = {
  initial: { opacity: 0, scale: 0.9 },
  animate: { opacity: 1, scale: 1 },
};

/**
 * 공통 Header 컴포넌트
 *
 * 상단 고정 헤더로 뒤로가기 버튼, 페이지 제목, 우측 액션 영역을 제공합니다.
 * 테마 색상이 자동으로 적용됩니다.
 *
 * @example
 * // 기본 사용
 * <Header title="퀴즈 목록" />
 *
 * // 뒤로가기 버튼 포함
 * <Header title="퀴즈 풀기" showBack />
 *
 * // 커스텀 뒤로가기 핸들러
 * <Header title="문제 풀이" showBack onBack={() => setShowConfirm(true)} />
 *
 * // 우측 액션 버튼
 * <Header
 *   title="게시판"
 *   showBack
 *   rightAction={<button onClick={handleWrite}>글쓰기</button>}
 * />
 */
export default function Header({
  title,
  showBack = false,
  onBack,
  rightAction,
}: HeaderProps) {
  const router = useRouter();
  const colors = useThemeColors();

  // 뒤로가기 핸들러
  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      router.back();
    }
  };

  return (
    <motion.header
      variants={headerVariants}
      initial="initial"
      animate="animate"
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="sticky top-0 z-50 w-full"
      style={{
        backgroundColor: `${colors.background}e6`, // 90% 불투명도
      }}
    >
      {/* 블러 오버레이 */}
      <div
        className="absolute inset-0 backdrop-blur-md"
        style={{
          backgroundColor: `${colors.background}40`, // 25% 불투명도
        }}
      />

      {/* 그림자 효과 */}
      <div
        className="absolute inset-x-0 bottom-0 h-px"
        style={{
          background: `linear-gradient(to right, transparent, ${colors.border}, transparent)`,
        }}
      />

      {/* 헤더 컨텐츠 */}
      <div className="relative flex items-center justify-between h-14 px-4">
        {/* 좌측 영역: 뒤로가기 버튼 */}
        <div className="flex justify-start">
          {showBack && (
            <motion.button
              variants={buttonVariants}
              initial="initial"
              animate="animate"
              transition={{ duration: 0.2, delay: 0.1 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleBack}
              className="flex items-center gap-2 text-sm py-2 -ml-2 px-2 transition-colors duration-200"
              style={{
                color: colors.text,
              }}
              aria-label="뒤로가기"
            >
              <BackIcon />
              뒤로가기
            </motion.button>
          )}
        </div>

        {/* 중앙 영역: 페이지 제목 */}
        <motion.h1
          variants={titleVariants}
          initial="initial"
          animate="animate"
          transition={{ duration: 0.3, delay: 0.15 }}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-lg font-bold truncate max-w-[60%] text-center"
          style={{
            color: colors.text,
          }}
        >
          {title}
        </motion.h1>

        {/* 우측 영역: 액션 버튼 */}
        <div className="w-10 flex justify-end">
          {rightAction && (
            <motion.div
              variants={buttonVariants}
              initial="initial"
              animate="animate"
              transition={{ duration: 0.2, delay: 0.2 }}
              style={{
                color: colors.text,
              }}
            >
              {rightAction}
            </motion.div>
          )}
        </div>
      </div>
    </motion.header>
  );
}
