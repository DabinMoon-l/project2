'use client';

import { memo } from 'react';
import { motion } from 'framer-motion';
import { SPRING_TAP, TAP_SCALE } from '@/lib/constants/springs';

/**
 * 폴더 카드 컴포넌트
 */
function FolderCard({
  title,
  count,
  onClick,
  onDelete,
  isSelectMode = false,
  isSelected = false,
  showDelete = false,
  hasUpdate = false,
  onUpdateClick,
  variant = 'folder',
}: {
  title: string;
  count: number;
  onClick: () => void;
  onDelete?: () => void;
  isSelectMode?: boolean;
  isSelected?: boolean;
  showDelete?: boolean;
  hasUpdate?: boolean;
  onUpdateClick?: () => void;
  /** 카드 스타일: folder(폴더 아이콘) 또는 quiz(퀴즈 카드 스타일) */
  variant?: 'folder' | 'quiz';
}) {
  // gradient ID 충돌 방지용 고유 키 (특수문자 제거 — SVG url() 참조 깨짐 방지)
  const gradId = `fc-${title.replace(/[^a-zA-Z0-9가-힣]/g, '')}-${count}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileTap={!isSelectMode ? TAP_SCALE : undefined}
      transition={SPRING_TAP}
      onClick={onClick}
      className={`
        relative pt-1 flex flex-col items-center justify-center gap-0.5 cursor-pointer transition-all duration-150
        ${isSelectMode
          ? isSelected
            ? ''
            : ''
          : 'hover:scale-105'
        }
      `}
    >
      {/* 삭제 버튼 */}
      {showDelete && onDelete && !isSelectMode && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="absolute top-0 right-0 w-6 h-6 border border-[#8B1A1A] text-[#8B1A1A] bg-[#F5F0E8] hover:bg-[#FDEAEA] flex items-center justify-center transition-colors z-10"
        >
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        </button>
      )}

      {/* 선택 표시 */}
      {isSelectMode && isSelected && (
        <div className="absolute top-0.5 right-0.5 w-5 h-5 bg-[#1A1A1A] rounded-full flex items-center justify-center z-10">
          <svg className="w-3 h-3 text-[#F5F0E8]" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        </div>
      )}

      {/* 아이콘 영역 */}
      <div className="relative">
        {variant === 'quiz' ? (
          // 퀴즈 카드 스타일 아이콘 — 검정 글래스 fill
          <svg className="w-16 h-16 drop-shadow-lg" viewBox="0 0 24 24" fill="none">
            <defs>
              <linearGradient id={`${gradId}-q`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="rgba(50,50,50,0.85)" />
                <stop offset="100%" stopColor="rgba(25,25,25,0.9)" />
              </linearGradient>
            </defs>
            <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" fill={`url(#${gradId}-q)`} />
            <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke="rgba(255,255,255,0.1)" strokeWidth="0.4" fill="none" />
          </svg>
        ) : (
          // 폴더 아이콘 — 검정 글래스 fill
          <svg className="w-16 h-16 drop-shadow-lg" viewBox="0 0 24 24" fill="none">
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="rgba(50,50,50,0.85)" />
                <stop offset="100%" stopColor="rgba(25,25,25,0.9)" />
              </linearGradient>
            </defs>
            <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" fill={`url(#${gradId})`} />
            <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" stroke="rgba(255,255,255,0.1)" strokeWidth="0.4" fill="none" />
          </svg>
        )}
        {/* 업데이트 알림 아이콘 */}
        {hasUpdate && !isSelectMode && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onUpdateClick?.();
            }}
            className="absolute -top-1 -right-1 w-5 h-5 bg-[#F5C518] rounded-full flex items-center justify-center border-2 border-[#1A1A1A] hover:scale-110 transition-transform"
          >
            <span className="text-[#1A1A1A] font-bold text-xs">!</span>
          </button>
        )}
      </div>

      {/* 제목 */}
      <span className={`text-sm font-bold text-center px-1 truncate w-full ${isSelectMode && !isSelected ? 'text-[#5C5C5C]' : 'text-[#1A1A1A]'}`}>
        {title}
      </span>

      {/* 문제 수 */}
      <span className="text-xs text-center text-[#5C5C5C]">
        {count}문제
      </span>
    </motion.div>
  );
}

export default memo(FolderCard);
