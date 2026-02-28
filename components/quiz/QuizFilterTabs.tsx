'use client';

import { motion } from 'framer-motion';

/**
 * 퀴즈 유형 정의
 * - all: 전체
 * - midterm: 중간
 * - final: 기말
 * - past: 족보
 * - custom: 자체제작
 */
export type QuizType = 'all' | 'midterm' | 'final' | 'past' | 'custom';

interface QuizFilterTabsProps {
  /** 현재 선택된 필터 */
  activeFilter: QuizType;
  /** 필터 변경 핸들러 */
  onFilterChange: (filter: QuizType) => void;
  /** 추가 클래스명 */
  className?: string;
}

// 필터 탭 목록
const filterTabs: { value: QuizType; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'midterm', label: '중간' },
  { value: 'final', label: '기말' },
  { value: 'past', label: '족보' },
  { value: 'custom', label: '자체제작' },
];

/**
 * 현재 시즌에 맞는 기본 탭 반환
 * - 중간고사 시즌 (3월 ~ 5월): midterm
 * - 기말고사 시즌 (6월 ~ 7월, 11월 ~ 12월): final
 * - 그 외: all
 */
export function getDefaultFilter(): QuizType {
  const now = new Date();
  const month = now.getMonth() + 1; // 0-based이므로 +1

  // 중간고사 시즌: 3월 ~ 5월
  if (month >= 3 && month <= 5) {
    return 'midterm';
  }
  // 기말고사 시즌: 6월 ~ 7월, 11월 ~ 12월
  if ((month >= 6 && month <= 7) || (month >= 11 && month <= 12)) {
    return 'final';
  }
  // 그 외 시즌
  return 'all';
}

/**
 * 퀴즈 필터 탭 컴포넌트
 *
 * 퀴즈 목록을 유형별로 필터링하는 탭 UI를 제공합니다.
 * 시즌 날짜에 따라 기본 탭이 자동으로 설정됩니다.
 *
 * @example
 * ```tsx
 * const [filter, setFilter] = useState<QuizType>(getDefaultFilter());
 * <QuizFilterTabs activeFilter={filter} onFilterChange={setFilter} />
 * ```
 */
export default function QuizFilterTabs({
  activeFilter,
  onFilterChange,
  className = '',
}: QuizFilterTabsProps) {
  return (
    <div
      className={`flex items-center gap-2 overflow-x-auto scrollbar-hide pb-2 ${className}`}
    >
      {filterTabs.map((tab) => {
        const isActive = activeFilter === tab.value;

        return (
          <motion.button
            key={tab.value}
            onClick={() => onFilterChange(tab.value)}
            whileTap={{ scale: 0.95 }}
            className={`
              relative px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap
              transition-colors duration-200
              ${
                isActive
                  ? 'text-white'
                  : 'text-gray-600 bg-gray-100 hover:bg-gray-200'
              }
            `}
          >
            {/* 활성 탭 배경 애니메이션 */}
            {isActive && (
              <motion.div
                layoutId="activeFilterTab"
                className="absolute inset-0 bg-theme-accent rounded-full"
                initial={false}
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
            {/* 탭 텍스트 */}
            <span className="relative z-10">{tab.label}</span>
          </motion.button>
        );
      })}
    </div>
  );
}
