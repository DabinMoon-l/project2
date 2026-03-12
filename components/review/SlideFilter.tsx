'use client';

import AnimatedUnderlineTabs from '@/components/common/AnimatedUnderlineTabs';
import { type ReviewFilter, FILTER_OPTIONS } from './types';

/**
 * 밑줄 스타일 필터 탭
 */
export default function SlideFilter({
  activeFilter,
  onFilterChange,
}: {
  activeFilter: ReviewFilter;
  onFilterChange: (filter: ReviewFilter) => void;
}) {
  return <AnimatedUnderlineTabs options={FILTER_OPTIONS} activeValue={activeFilter} onChange={onFilterChange} />;
}
