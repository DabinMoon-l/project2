'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { useThemeColors } from '@/styles/themes/useTheme';
import {
  ShopItem,
  formatGold,
  RARITY_COLORS,
  RARITY_NAMES,
} from '@/lib/data/shopItems';
import Button from '@/components/common/Button';
import CharacterPreviewWithItem from './CharacterPreviewWithItem';
import { CharacterOptions, DEFAULT_CHARACTER_OPTIONS } from '@/components/onboarding/CharacterPreview';

/**
 * PurchaseModal Props 타입
 */
interface PurchaseModalProps {
  /** 모달 열림 상태 */
  isOpen: boolean;
  /** 모달 닫기 핸들러 */
  onClose: () => void;
  /** 선택한 아이템 */
  item: ShopItem | null;
  /** 보유 골드 */
  userGold: number;
  /** 캐릭터 옵션 (미리보기용) */
  characterOptions?: CharacterOptions;
  /** 구매 확인 핸들러 */
  onConfirmPurchase: (item: ShopItem) => void;
  /** 구매 로딩 상태 */
  isPurchasing?: boolean;
}

// 골드 아이콘 컴포넌트
function GoldIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className="text-yellow-400 flex-shrink-0"
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
const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

const modalVariants = {
  hidden: {
    opacity: 0,
    scale: 0.9,
    y: 50,
  },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      type: 'spring',
      stiffness: 300,
      damping: 25,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    y: 20,
    transition: {
      duration: 0.15,
    },
  },
};

/**
 * 구매 확인 모달 컴포넌트
 * 아이템 구매 전 미리보기와 확인 기능을 제공합니다.
 *
 * @example
 * <PurchaseModal
 *   isOpen={isOpen}
 *   onClose={() => setIsOpen(false)}
 *   item={selectedItem}
 *   userGold={1500}
 *   onConfirmPurchase={(item) => handlePurchase(item)}
 * />
 */
export default function PurchaseModal({
  isOpen,
  onClose,
  item,
  userGold,
  characterOptions = DEFAULT_CHARACTER_OPTIONS,
  onConfirmPurchase,
  isPurchasing = false,
}: PurchaseModalProps) {
  const colors = useThemeColors();
  const [imageError, setImageError] = useState(false);

  // 아이템이 없으면 렌더링하지 않음
  if (!item) return null;

  // 구매 가능 여부
  const canAfford = userGold >= item.price;
  const remainingGold = userGold - item.price;

  // 희귀도 정보
  const rarityColor = item.rarity
    ? RARITY_COLORS[item.rarity]
    : RARITY_COLORS.common;
  const rarityName = item.rarity
    ? RARITY_NAMES[item.rarity]
    : RARITY_NAMES.common;

  // 구매 핸들러
  const handlePurchase = () => {
    if (canAfford && !isPurchasing) {
      onConfirmPurchase(item);
    }
  };

  // SSR 대응
  if (typeof window === 'undefined') {
    return null;
  }

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* 백드롭 */}
          <motion.div
            variants={backdropVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            aria-hidden="true"
          />

          {/* 모달 */}
          <motion.div
            variants={modalVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            role="dialog"
            aria-modal="true"
            aria-labelledby="purchase-modal-title"
            className="relative w-full max-w-md rounded-3xl overflow-hidden shadow-2xl"
            style={{ backgroundColor: colors.background }}
          >
            {/* 헤더 - 희귀도 색상 배경 */}
            <div
              className="relative py-4 px-6"
              style={{
                background: `linear-gradient(135deg, ${rarityColor}30 0%, ${rarityColor}10 100%)`,
              }}
            >
              {/* 닫기 버튼 */}
              <button
                onClick={onClose}
                className="absolute top-4 right-4 p-1 rounded-full transition-colors"
                style={{ color: colors.text }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = `${colors.accent}20`;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
                aria-label="닫기"
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>

              {/* 희귀도 뱃지 */}
              {item.rarity && (
                <div
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium text-white mb-2"
                  style={{ backgroundColor: rarityColor }}
                >
                  <span>{rarityName}</span>
                </div>
              )}

              {/* 아이템 이름 */}
              <h2
                id="purchase-modal-title"
                className="text-xl font-bold"
                style={{ color: colors.text }}
              >
                {item.name}
              </h2>

              {/* 아이템 설명 */}
              {item.description && (
                <p
                  className="text-sm mt-1"
                  style={{ color: colors.textSecondary }}
                >
                  {item.description}
                </p>
              )}
            </div>

            {/* 본문 */}
            <div className="p-6">
              {/* 캐릭터 미리보기 */}
              <div className="flex justify-center mb-6">
                <CharacterPreviewWithItem
                  characterOptions={characterOptions}
                  selectedItem={item}
                />
              </div>

              {/* 가격 정보 */}
              <div
                className="rounded-2xl p-4 mb-6"
                style={{ backgroundColor: colors.backgroundSecondary }}
              >
                {/* 아이템 가격 */}
                <div className="flex items-center justify-between mb-3">
                  <span style={{ color: colors.textSecondary }}>아이템 가격</span>
                  <div className="flex items-center gap-1.5">
                    <GoldIcon size={18} />
                    <span
                      className="font-semibold"
                      style={{ color: colors.text }}
                    >
                      {formatGold(item.price)}
                    </span>
                  </div>
                </div>

                {/* 보유 골드 */}
                <div className="flex items-center justify-between mb-3">
                  <span style={{ color: colors.textSecondary }}>보유 골드</span>
                  <div className="flex items-center gap-1.5">
                    <GoldIcon size={18} />
                    <span
                      className="font-semibold"
                      style={{ color: colors.text }}
                    >
                      {formatGold(userGold)}
                    </span>
                  </div>
                </div>

                {/* 구분선 */}
                <div
                  className="h-px my-3"
                  style={{ backgroundColor: colors.border }}
                />

                {/* 구매 후 잔액 */}
                <div className="flex items-center justify-between">
                  <span style={{ color: colors.textSecondary }}>구매 후 잔액</span>
                  <div className="flex items-center gap-1.5">
                    <GoldIcon size={18} />
                    <span
                      className={`font-bold ${!canAfford ? 'text-red-500' : ''}`}
                      style={{ color: canAfford ? colors.accent : undefined }}
                    >
                      {canAfford ? formatGold(remainingGold) : '부족'}
                    </span>
                  </div>
                </div>
              </div>

              {/* 골드 부족 경고 */}
              {!canAfford && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 mb-6 p-3 rounded-xl bg-red-500/10 border border-red-500/30"
                >
                  <span className="text-xl">⚠️</span>
                  <span className="text-sm text-red-400">
                    골드가 {formatGold(item.price - userGold)} 부족합니다.
                    퀴즈를 풀어 더 많은 골드를 획득하세요!
                  </span>
                </motion.div>
              )}

              {/* 버튼 영역 */}
              <div className="flex gap-3">
                <Button
                  variant="secondary"
                  size="lg"
                  fullWidth
                  onClick={onClose}
                  className="flex-1"
                >
                  취소
                </Button>
                <Button
                  variant="primary"
                  size="lg"
                  fullWidth
                  disabled={!canAfford}
                  loading={isPurchasing}
                  onClick={handlePurchase}
                  className="flex-1"
                  style={{
                    background: canAfford
                      ? `linear-gradient(135deg, ${rarityColor} 0%, ${rarityColor}cc 100%)`
                      : undefined,
                  }}
                >
                  {isPurchasing ? '구매 중...' : '구매하기'}
                </Button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
