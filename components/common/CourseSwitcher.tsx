'use client';

import { useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { CourseId } from '@/lib/types/course';
import { scaleCoord } from '@/lib/hooks/useViewportScale';

const ALL_COURSES: { id: CourseId; name: string }[] = [
  { id: 'biology', name: 'Biology' },
  { id: 'microbiology', name: 'Microbiology' },
  { id: 'pathophysiology', name: 'Pathophysiology' },
];

interface Props {
  value: CourseId;
  onChange: (id: CourseId) => void;
  textClassName?: string;
  /** 표시할 과목 목록 (assignedCourses 기반 필터링용) */
  courseIds?: string[];
}

export default function CourseSwitcher({ value, onChange, textClassName, courseIds }: Props) {
  // courseIds가 있으면 해당 과목만 표시, 없으면 전체
  const courses = courseIds && courseIds.length > 0
    ? ALL_COURSES.filter(c => courseIds.includes(c.id))
    : ALL_COURSES;
  const currentIndex = courses.findIndex(c => c.id === value);
  const touchStartX = useRef(0);
  const dirRef = useRef(0);

  const goPrev = useCallback(() => {
    dirRef.current = -1;
    const prevIdx = (currentIndex - 1 + courses.length) % courses.length;
    onChange(courses[prevIdx].id);
  }, [currentIndex, onChange, courses]);

  const goNext = useCallback(() => {
    dirRef.current = 1;
    const nextIdx = (currentIndex + 1) % courses.length;
    onChange(courses[nextIdx].id);
  }, [currentIndex, onChange, courses]);

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = scaleCoord(e.touches[0].clientX);
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const dx = scaleCoord(e.changedTouches[0].clientX) - touchStartX.current;
    if (Math.abs(dx) > 40) {
      if (dx < 0) goNext();
      else goPrev();
    }
  };

  const dir = dirRef.current;

  return (
    <div
      className="flex items-center justify-center gap-4"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <button onClick={goPrev} className="p-2 active:scale-90 transition-transform">
        <svg className="w-5 h-5 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      <div className="overflow-hidden min-w-[200px] text-center py-1">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={value}
            className={textClassName || 'text-3xl font-black text-white tracking-wide inline-block'}
            initial={{ opacity: 0, x: dir >= 0 ? 30 : -30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir >= 0 ? -30 : 30 }}
            transition={{ duration: 0.15 }}
          >
            {courses[currentIndex]?.name || 'Biology'}
          </motion.span>
        </AnimatePresence>
      </div>

      <button onClick={goNext} className="p-2 active:scale-90 transition-transform">
        <svg className="w-5 h-5 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );
}
