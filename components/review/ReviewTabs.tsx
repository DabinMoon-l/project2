'use client';

import { motion } from 'framer-motion';

/**
 * 복습 탭 유형
 */
export type ReviewTabType = 'wrong' | 'bookmark';

interface ReviewTabsProps {
  /** 현재 선택된 탭 */
  activeTab: ReviewTabType;
  /** 탭 변경 핸들러 */
  onTabChange: (tab: ReviewTabType) => void;
  /** 오답 개수 */
  wrongCount: number;
  /** 찜한 문제 개수 */
  bookmarkCount: number;
  /** 추가 클래스명 */
  className?: string;
}

// 탭 목록
const tabs: { value: ReviewTabType; label: string; icon: string }[] = [
  { value: 'wrong', label: '오답노트', icon: '📝' },
  { value: 'bookmark', label: '찜한 문제', icon: '📚' },
];

/**
 * 복습 탭 컴포넌트
 *
 * 오답노트와 찜한 문제 탭을 전환하는 UI를 제공합니다.
 * 각 탭에 해당하는 문제 개수를 함께 표시합니다.
 *
 * @example
 * ```tsx
 * const [activeTab, setActiveTab] = useState<ReviewTabType>('wrong');
 *
 * <ReviewTabs
 *   activeTab={activeTab}
 *   onTabChange={setActiveTab}
 *   wrongCount={5}
 *   bookmarkCount={3}
 * />
 * ```
 */
export default function ReviewTabs({
  activeTab,
  onTabChange,
  wrongCount,
  bookmarkCount,
  className = '',
}: ReviewTabsProps) {
  // 탭별 개수 매핑
  const counts: Record<ReviewTabType, number> = {
    wrong: wrongCount,
    bookmark: bookmarkCount,
  };

  return (
    <div className={`bg-white rounded-2xl p-1 shadow-sm ${className}`}>
      <div className="flex gap-1">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.value;
          const count = counts[tab.value];

          return (
            <motion.button
              key={tab.value}
              onClick={() => onTabChange(tab.value)}
              whileTap={{ scale: 0.98 }}
              className={`
                relative flex-1 flex items-center justify-center gap-2
                py-3 px-4 rounded-xl text-sm font-medium
                transition-colors duration-200
                ${isActive
                  ? 'text-white'
                  : 'text-gray-600 hover:bg-gray-50'
                }
              `}
            >
              {/* 활성 탭 배경 */}
              {isActive && (
                <motion.div
                  layoutId="activeReviewTab"
                  className="absolute inset-0 bg-theme-accent rounded-xl"
                  initial={false}
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}

              {/* 탭 내용 */}
              <span className="relative z-10 flex items-center gap-2">
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
                {/* 개수 뱃지 */}
                {count > 0 && (
                  <span
                    className={`
                      px-2 py-0.5 text-xs font-bold rounded-full
                      ${isActive
                        ? 'bg-white/20 text-white'
                        : 'bg-gray-100 text-gray-600'
                      }
                    `}
                  >
                    {count}
                  </span>
                )}
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
