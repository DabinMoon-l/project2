'use client';

import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useThemeColors } from '@/styles/themes/useTheme';
import { formatGold } from '@/lib/data/shopItems';

/**
 * ShopHeader Props 타입
 */
interface ShopHeaderProps {
  /** 보유 골드 */
  gold: number;
  /** 커스텀 뒤로가기 핸들러 */
  onBack?: () => void;
}

// 뒤로가기 아이콘 컴포넌트
function BackIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19 12H5" />
      <path d="M12 19l-7-7 7-7" />
    </svg>
  );
}

// 골드 아이콘 컴포넌트
function GoldIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="text-yellow-400"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" fill="#F59E0B" />
      <circle cx="12" cy="12" r="7" fill="#FBBF24" />
      <text
        x="12"
        y="16"
        textAnchor="middle"
        fontSize="10"
        fontWeight="bold"
        fill="#92400E"
      >
        G
      </text>
    </svg>
  );
}

// 애니메이션 variants
const headerVariants = {
  initial: { opacity: 0, y: -10 },
  animate: { opacity: 1, y: 0 },
};

const goldVariants = {
  initial: { opacity: 0, scale: 0.9 },
  animate: { opacity: 1, scale: 1 },
};

/**
 * Shop 헤더 컴포넌트
 * 뒤로가기 버튼과 보유 골드를 표시합니다.
 *
 * @example
 * <ShopHeader gold={1500} />
 * <ShopHeader gold={1500} onBack={() => router.push('/')} />
 */
export default function ShopHeader({ gold, onBack }: ShopHeaderProps) {
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
        backgroundColor: `${colors.background}e6`,
      }}
    >
      {/* 블러 오버레이 */}
      <div
        className="absolute inset-0 backdrop-blur-md"
        style={{
          backgroundColor: `${colors.background}40`,
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
        {/* 좌측: 뒤로가기 버튼 */}
        <motion.button
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.2, delay: 0.1 }}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
          onClick={handleBack}
          className="p-2 -ml-2 rounded-full transition-colors duration-200"
          style={{
            color: colors.text,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = `${colors.accent}20`;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
          aria-label="뒤로가기"
        >
          <BackIcon />
        </motion.button>

        {/* 중앙: 페이지 제목 */}
        <motion.h1
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.15 }}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-lg font-bold"
          style={{ color: colors.text }}
        >
          상점
        </motion.h1>

        {/* 우측: 보유 골드 */}
        <motion.div
          variants={goldVariants}
          initial="initial"
          animate="animate"
          transition={{ duration: 0.3, delay: 0.2 }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full"
          style={{
            backgroundColor: `${colors.accent}15`,
            border: `1px solid ${colors.accent}30`,
          }}
        >
          <GoldIcon />
          <span
            className="text-sm font-semibold"
            style={{ color: colors.accent }}
          >
            {formatGold(gold)}
          </span>
        </motion.div>
      </div>
    </motion.header>
  );
}
