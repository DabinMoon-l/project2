'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useThemeColors } from '@/styles/themes/useTheme';
import { ShopItem, ShopCategory, getItemsByCategory } from '@/lib/data/shopItems';
import ItemCard from './ItemCard';

/**
 * ItemGrid Props 타입
 */
interface ItemGridProps {
  /** 현재 카테고리 */
  category: ShopCategory;
  /** 보유 골드 */
  userGold: number;
  /** 보유 아이템 ID 목록 */
  ownedItemIds: string[];
  /** 아이템 클릭 핸들러 */
  onItemClick: (item: ShopItem) => void;
}

// 그리드 애니메이션 variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
    },
  },
  exit: {
    opacity: 0,
    transition: {
      staggerChildren: 0.02,
      staggerDirection: -1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.9 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: 'spring',
      stiffness: 300,
      damping: 25,
    },
  },
  exit: {
    opacity: 0,
    y: -10,
    scale: 0.95,
    transition: {
      duration: 0.15,
    },
  },
};

/**
 * 아이템 그리드 컴포넌트
 * 2열 그리드로 카테고리별 아이템을 표시합니다.
 *
 * @example
 * <ItemGrid
 *   category="weapon"
 *   userGold={1500}
 *   ownedItemIds={['weapon_axe', 'weapon_bow']}
 *   onItemClick={(item) => handleItemClick(item)}
 * />
 */
export default function ItemGrid({
  category,
  userGold,
  ownedItemIds,
  onItemClick,
}: ItemGridProps) {
  const colors = useThemeColors();

  // 현재 카테고리의 아이템 목록
  const items = getItemsByCategory(category);

  // 아이템이 없는 경우
  if (items.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center py-16 text-center"
        style={{ color: colors.textSecondary }}
      >
        <span className="text-4xl mb-4">📦</span>
        <p className="text-lg font-medium">아이템이 없습니다</p>
        <p className="text-sm mt-1">곧 새로운 아이템이 추가될 예정이에요!</p>
      </div>
    );
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={category}
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="grid grid-cols-2 gap-3 px-4 pb-24"
      >
        {items.map((item) => {
          const isOwned = ownedItemIds.includes(item.id);
          const canAfford = userGold >= item.price;

          return (
            <motion.div key={item.id} variants={itemVariants}>
              <ItemCard
                item={item}
                isOwned={isOwned}
                canAfford={canAfford}
                onClick={onItemClick}
              />
            </motion.div>
          );
        })}
      </motion.div>
    </AnimatePresence>
  );
}
