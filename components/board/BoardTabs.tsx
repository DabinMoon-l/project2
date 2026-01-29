'use client';

import { motion } from 'framer-motion';
import type { BoardCategory } from '@/lib/hooks/useBoard';

interface BoardTabsProps {
  /** 현재 선택된 탭 */
  activeTab: BoardCategory;
  /** 탭 변경 핸들러 */
  onTabChange: (tab: BoardCategory) => void;
}

/**
 * 게시판 탭 컴포넌트
 *
 * [To 교수님] [우리들끼리] 두 개의 탭을 제공합니다.
 */
export default function BoardTabs({ activeTab, onTabChange }: BoardTabsProps) {
  const tabs: { id: BoardCategory; label: string }[] = [
    { id: 'toProfessor', label: 'To 교수님' },
    { id: 'community', label: '우리들끼리' },
  ];

  return (
    <div className="flex bg-theme-background-secondary rounded-xl p-1">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`
            relative flex-1 py-2.5 px-4 text-sm font-medium rounded-lg
            transition-colors duration-200
            ${
              activeTab === tab.id
                ? 'text-white'
                : 'text-theme-text-secondary hover:text-theme-text'
            }
          `}
        >
          {/* 활성 탭 배경 애니메이션 */}
          {activeTab === tab.id && (
            <motion.div
              layoutId="activeTab"
              className="absolute inset-0 bg-theme-accent rounded-lg"
              initial={false}
              transition={{
                type: 'spring',
                stiffness: 400,
                damping: 30,
              }}
            />
          )}
          {/* 탭 텍스트 */}
          <span className="relative z-10">{tab.label}</span>
        </button>
      ))}
    </div>
  );
}
