'use client';

import { Skeleton } from '@/components/common';

/**
 * 스켈레톤 퀴즈 카드 (찜/서재 탭용)
 */
export default function SkeletonQuizCard() {
  return (
    <div className="border border-[#D4CFC4] bg-[#F5F0E8] p-4 shadow-sm">
      {/* 상단: 제목 + 하트 */}
      <div className="flex justify-between items-start mb-3">
        <Skeleton className="w-2/3 h-5 rounded-none" />
        <Skeleton className="w-5 h-5 rounded-none" />
      </div>

      {/* 정보 텍스트 */}
      <Skeleton className="w-24 h-3 mb-3 rounded-none" />

      {/* 태그들 */}
      <div className="flex flex-wrap gap-1 mb-4">
        <Skeleton className="w-16 h-5 rounded-none" />
        <Skeleton className="w-20 h-5 rounded-none" />
      </div>

      {/* 버튼들 */}
      <div className="flex gap-2">
        <Skeleton className="flex-1 h-9 rounded-none" />
        <Skeleton className="flex-1 h-9 rounded-none" />
      </div>
    </div>
  );
}
