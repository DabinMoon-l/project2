'use client';

import { useState } from 'react';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { useThemeColors } from '@/styles/themes/useTheme';
import {
  ShopItem,
  formatGold,
  RARITY_COLORS,
  RARITY_NAMES,
} from '@/lib/data/shopItems';

/**
 * ItemCard Props 타입
 */
interface ItemCardProps {
  /** 아이템 정보 */
  item: ShopItem;
  /** 보유 여부 */
  isOwned: boolean;
  /** 구매 가능 여부 (골드 충분한지) */
  canAfford: boolean;
  /** 아이템 클릭 핸들러 */
  onClick: (item: ShopItem) => void;
}

// 골드 아이콘 컴포넌트
function GoldIcon({ size = 14 }: { size?: number }) {
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

// 체크 아이콘 (보유중)
function CheckIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-white"
      aria-hidden="true"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

/**
 * 아이템 카드 컴포넌트
 * Shop에서 개별 아이템을 표시하는 카드입니다.
 *
 * @example
 * <ItemCard
 *   item={item}
 *   isOwned={false}
 *   canAfford={true}
 *   onClick={(item) => handleItemClick(item)}
 * />
 */
export default function ItemCard({
  item,
  isOwned,
  canAfford,
  onClick,
}: ItemCardProps) {
  const colors = useThemeColors();
  const [imageError, setImageError] = useState(false);

  // 희귀도 색상
  const rarityColor = item.rarity ? RARITY_COLORS[item.rarity] : RARITY_COLORS.common;
  const rarityName = item.rarity ? RARITY_NAMES[item.rarity] : RARITY_NAMES.common;

  // 아이템 클릭 처리
  const handleClick = () => {
    // 이미 보유한 아이템은 클릭 불가
    if (!isOwned) {
      onClick(item);
    }
  };

  return (
    <motion.div
      whileHover={!isOwned ? { y: -4, scale: 1.02 } : undefined}
      whileTap={!isOwned ? { scale: 0.98 } : undefined}
      onClick={handleClick}
      className={`
        relative flex flex-col rounded-2xl overflow-hidden
        transition-all duration-200
        ${!isOwned ? 'cursor-pointer' : 'cursor-default'}
        ${!isOwned && !canAfford ? 'opacity-70' : ''}
      `}
      style={{
        backgroundColor: colors.backgroundSecondary,
        border: `2px solid ${isOwned ? colors.accent : colors.border}`,
      }}
      role={!isOwned ? 'button' : undefined}
      tabIndex={!isOwned ? 0 : undefined}
      onKeyDown={(e) => {
        if (!isOwned && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick(item);
        }
      }}
      aria-label={`${item.name} - ${formatGold(item.price)} 골드${isOwned ? ' (보유중)' : ''}`}
    >
      {/* 희귀도 표시 */}
      {item.rarity && (
        <div
          className="absolute top-2 left-2 z-10 px-2 py-0.5 rounded-full text-xs font-medium text-white"
          style={{ backgroundColor: rarityColor }}
        >
          {rarityName}
        </div>
      )}

      {/* 보유중 뱃지 */}
      {isOwned && (
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1 px-2 py-1 rounded-full bg-green-500">
          <CheckIcon />
          <span className="text-xs font-medium text-white">보유중</span>
        </div>
      )}

      {/* 아이템 이미지 영역 */}
      <div
        className="relative aspect-square flex items-center justify-center p-4"
        style={{
          background: `linear-gradient(135deg, ${rarityColor}10 0%, ${rarityColor}05 100%)`,
        }}
      >
        {/* 희귀도 테두리 글로우 효과 */}
        {(item.rarity === 'epic' || item.rarity === 'legendary') && (
          <div
            className="absolute inset-0 opacity-20"
            style={{
              background: `radial-gradient(circle at center, ${rarityColor}40 0%, transparent 70%)`,
            }}
          />
        )}

        {/* 아이템 이미지 */}
        {!imageError ? (
          <Image
            src={item.imagePath}
            alt={item.name}
            width={80}
            height={80}
            className="object-contain transition-transform duration-200"
            onError={() => setImageError(true)}
          />
        ) : (
          // 이미지 로드 실패 시 플레이스홀더
          <div
            className="w-20 h-20 flex items-center justify-center rounded-xl text-3xl"
            style={{ backgroundColor: `${rarityColor}20` }}
          >
            {getCategoryEmoji(item.category)}
          </div>
        )}
      </div>

      {/* 아이템 정보 영역 */}
      <div className="flex flex-col gap-1.5 p-3">
        {/* 아이템 이름 */}
        <h3
          className="text-sm font-semibold truncate"
          style={{ color: colors.text }}
        >
          {item.name}
        </h3>

        {/* 가격 */}
        {isOwned ? (
          <div
            className="flex items-center gap-1 text-xs font-medium"
            style={{ color: colors.accent }}
          >
            <span>착용 가능</span>
          </div>
        ) : (
          <div
            className={`flex items-center gap-1 text-sm font-semibold ${
              !canAfford ? 'text-red-400' : ''
            }`}
            style={{ color: canAfford ? colors.text : undefined }}
          >
            <GoldIcon size={16} />
            <span>{formatGold(item.price)}</span>
          </div>
        )}
      </div>

      {/* 골드 부족 오버레이 */}
      {!isOwned && !canAfford && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ backgroundColor: `${colors.background}60` }}
        >
          <span
            className="px-3 py-1 rounded-full text-xs font-medium bg-red-500/90 text-white"
          >
            골드 부족
          </span>
        </div>
      )}
    </motion.div>
  );
}

/**
 * 카테고리별 이모지 반환 (이미지 로드 실패 시 폴백)
 */
function getCategoryEmoji(category: string): string {
  const emojis: Record<string, string> = {
    weapon: '⚔️',
    hat: '🎩',
    mask: '🎭',
    glasses: '👓',
    cape: '🧥',
    pet: '🐾',
    effect: '✨',
    accessory: '💍',
  };
  return emojis[category] || '📦';
}
