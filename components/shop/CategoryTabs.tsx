'use client';

import { useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useThemeColors } from '@/styles/themes/useTheme';
import { SHOP_CATEGORIES, ShopCategory, CategoryInfo } from '@/lib/data/shopItems';

/**
 * CategoryTabs Props 타입
 */
interface CategoryTabsProps {
  /** 현재 선택된 카테고리 */
  selectedCategory: ShopCategory;
  /** 카테고리 선택 핸들러 */
  onSelectCategory: (category: ShopCategory) => void;
}

/**
 * 카테고리 탭 컴포넌트
 * 가로 스크롤이 가능한 카테고리 탭 목록을 표시합니다.
 *
 * @example
 * <CategoryTabs
 *   selectedCategory="weapon"
 *   onSelectCategory={(category) => setSelectedCategory(category)}
 * />
 */
export default function CategoryTabs({
  selectedCategory,
  onSelectCategory,
}: CategoryTabsProps) {
  const colors = useThemeColors();
  const scrollRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // 선택된 탭이 보이도록 스크롤
  useEffect(() => {
    const selectedTab = tabRefs.current.get(selectedCategory);
    if (selectedTab && scrollRef.current) {
      const container = scrollRef.current;
      const tabRect = selectedTab.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();

      // 탭이 컨테이너 안에 완전히 보이지 않으면 스크롤
      if (tabRect.left < containerRect.left || tabRect.right > containerRect.right) {
        selectedTab.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'center',
        });
      }
    }
  }, [selectedCategory]);

  return (
    <div className="sticky top-14 z-40 w-full py-3">
      {/* 배경 블러 */}
      <div
        className="absolute inset-0 backdrop-blur-sm"
        style={{ backgroundColor: `${colors.background}95` }}
      />

      {/* 탭 목록 스크롤 컨테이너 */}
      <div
        ref={scrollRef}
        className="relative flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-hide"
        style={{
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
      >
        {SHOP_CATEGORIES.map((category) => (
          <CategoryTab
            key={category.id}
            category={category}
            isSelected={selectedCategory === category.id}
            onSelect={() => onSelectCategory(category.id)}
            ref={(el) => {
              if (el) tabRefs.current.set(category.id, el);
            }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * 개별 카테고리 탭 컴포넌트
 */
interface CategoryTabProps {
  category: CategoryInfo;
  isSelected: boolean;
  onSelect: () => void;
}

import { forwardRef } from 'react';

const CategoryTab = forwardRef<HTMLButtonElement, CategoryTabProps>(
  function CategoryTab({ category, isSelected, onSelect }, ref) {
    const colors = useThemeColors();

    return (
      <motion.button
        ref={ref}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={onSelect}
        className={`
          relative flex items-center gap-1.5 px-4 py-2.5
          rounded-full whitespace-nowrap
          font-medium text-sm
          transition-colors duration-200
          focus:outline-none focus:ring-2 focus:ring-offset-2
          ${isSelected ? 'shadow-md' : ''}
        `}
        style={{
          backgroundColor: isSelected ? colors.accent : `${colors.accent}15`,
          color: isSelected
            ? colors.background
            : colors.text,
          '--tw-ring-color': colors.accent,
        } as React.CSSProperties}
        aria-pressed={isSelected}
        aria-label={`${category.name} 카테고리`}
      >
        {/* 아이콘 */}
        <span className="text-base" aria-hidden="true">
          {category.icon}
        </span>

        {/* 이름 */}
        <span>{category.name}</span>

        {/* 선택 시 언더라인 애니메이션 */}
        {isSelected && (
          <motion.div
            layoutId="categoryUnderline"
            className="absolute inset-0 rounded-full"
            style={{
              backgroundColor: colors.accent,
              zIndex: -1,
            }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          />
        )}
      </motion.button>
    );
  }
);
