'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCourse } from '@/lib/contexts';
import { COURSES, type CourseId } from '@/lib/types/course';

/**
 * 과목 정보 타입
 */
interface CourseOption {
  id: CourseId;
  name: string;
  nameEn: string;
  grade: number;
  semester: number;
}

/**
 * CourseSelector Props
 */
interface CourseSelectorProps {
  /** 선택된 과목 ID */
  selectedCourseId: CourseId | null;
  /** 과목 변경 핸들러 */
  onCourseChange: (courseId: CourseId | null) => void;
  /** 전체 옵션 표시 여부 */
  showAllOption?: boolean;
  /** 컴팩트 모드 */
  compact?: boolean;
}

/**
 * 과목 선택 컴포넌트
 * 교수님이 관리할 과목을 선택할 수 있는 드롭다운
 */
export function CourseSelector({
  selectedCourseId,
  onCourseChange,
  showAllOption = true,
  compact = false,
}: CourseSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { semesterSettings } = useCourse();

  // 과목 목록 생성
  const courseOptions: CourseOption[] = Object.values(COURSES).map((course) => ({
    id: course.id,
    name: course.name,
    nameEn: course.nameEn,
    grade: course.grade,
    semester: course.semester,
  }));

  // 선택된 과목 정보
  const selectedCourse = selectedCourseId ? COURSES[selectedCourseId] : null;

  // 학기 라벨
  const semesterLabel = semesterSettings
    ? `${semesterSettings.currentYear}년 ${semesterSettings.currentSemester}학기`
    : '';

  return (
    <div className="relative">
      {/* 선택 버튼 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          flex items-center gap-2
          ${compact ? 'px-3 py-1.5 text-sm' : 'px-4 py-2'}
          border-2 border-[#1A1A1A]
          bg-[#FDFBF7] hover:bg-[#F5F0E8]
          transition-colors
        `}
      >
        <span className="font-serif-display font-bold text-[#1A1A1A]">
          {selectedCourse ? selectedCourse.name : '전체 과목'}
        </span>
        <svg
          className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* 드롭다운 메뉴 */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* 배경 오버레이 */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => setIsOpen(false)}
            />

            {/* 드롭다운 */}
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="
                absolute top-full left-0 mt-1 z-50
                min-w-[200px]
                border-2 border-[#1A1A1A]
                bg-[#FDFBF7]
                shadow-[4px_4px_0_#1A1A1A]
              "
            >
              {/* 학기 정보 헤더 */}
              {semesterLabel && (
                <div className="px-3 py-2 border-b border-[#D4CFC4] bg-[#EBE5D9]">
                  <span className="text-xs text-[#5C5C5C]">{semesterLabel}</span>
                </div>
              )}

              {/* 전체 옵션 */}
              {showAllOption && (
                <button
                  onClick={() => {
                    onCourseChange(null);
                    setIsOpen(false);
                  }}
                  className={`
                    w-full px-3 py-2 text-left
                    hover:bg-[#F5F0E8]
                    ${!selectedCourseId ? 'bg-[#EBE5D9] font-bold' : ''}
                  `}
                >
                  <span className="text-[#1A1A1A]">전체 과목</span>
                </button>
              )}

              {/* 구분선 */}
              {showAllOption && <div className="h-px bg-[#D4CFC4]" />}

              {/* 과목 목록 */}
              {courseOptions.map((course) => (
                <button
                  key={course.id}
                  onClick={() => {
                    onCourseChange(course.id);
                    setIsOpen(false);
                  }}
                  className={`
                    w-full px-3 py-2 text-left
                    hover:bg-[#F5F0E8]
                    ${selectedCourseId === course.id ? 'bg-[#EBE5D9] font-bold' : ''}
                  `}
                >
                  <div className="flex flex-col">
                    <span className="text-[#1A1A1A]">{course.name}</span>
                    <span className="text-xs text-[#5C5C5C]">
                      {course.grade}학년 {course.semester}학기 · {course.nameEn}
                    </span>
                  </div>
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

export default CourseSelector;
