'use client';

import { useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Skeleton } from '@/components/common';
import StudentListItem from './StudentListItem';
import { type StudentData } from '@/lib/hooks/useProfessorStudents';

// ============================================================
// 타입 정의
// ============================================================

interface StudentListProps {
  /** 학생 목록 */
  students: StudentData[];
  /** 로딩 상태 */
  loading: boolean;
  /** 추가 데이터 여부 */
  hasMore: boolean;
  /** 추가 로드 함수 */
  onLoadMore: () => void;
  /** 학생 클릭 핸들러 */
  onStudentClick: (student: StudentData) => void;
}

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 학생 목록 스켈레톤
 */
function StudentListSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-white rounded-2xl p-4 shadow-sm">
          <div className="flex items-start gap-3 mb-3">
            <Skeleton className="w-12 h-12 rounded-full" />
            <div className="flex-1">
              <Skeleton className="h-5 w-24 mb-2" />
              <Skeleton className="h-4 w-32" />
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[1, 2, 3, 4].map((j) => (
              <Skeleton key={j} className="h-14 rounded-xl" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * 빈 상태 컴포넌트
 */
function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center justify-center py-16"
    >
      <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-4">
        <svg
          className="w-10 h-10 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
          />
        </svg>
      </div>
      <h3 className="text-lg font-bold text-gray-600 mb-2">
        등록된 학생이 없습니다
      </h3>
      <p className="text-sm text-gray-400 text-center">
        학생들이 앱에 가입하면 여기에 표시됩니다.
      </p>
    </motion.div>
  );
}

/**
 * 학생 목록 컴포넌트
 *
 * 학생 목록을 표시하고 무한 스크롤을 지원합니다.
 */
export default function StudentList({
  students,
  loading,
  hasMore,
  onLoadMore,
  onStudentClick,
}: StudentListProps) {
  const observerRef = useRef<HTMLDivElement | null>(null);

  // 무한 스크롤 Observer
  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const target = entries[0];
      if (target.isIntersecting && hasMore && !loading) {
        onLoadMore();
      }
    },
    [hasMore, loading, onLoadMore]
  );

  useEffect(() => {
    const option = {
      root: null,
      rootMargin: '100px',
      threshold: 0,
    };

    const observer = new IntersectionObserver(handleObserver, option);
    if (observerRef.current) {
      observer.observe(observerRef.current);
    }

    return () => observer.disconnect();
  }, [handleObserver]);

  // 초기 로딩
  if (loading && students.length === 0) {
    return <StudentListSkeleton />;
  }

  // 빈 상태
  if (!loading && students.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="space-y-3">
      <AnimatePresence mode="popLayout">
        {students.map((student, index) => (
          <motion.div
            key={student.uid}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ delay: index * 0.05 }}
          >
            <StudentListItem
              student={student}
              onClick={() => onStudentClick(student)}
            />
          </motion.div>
        ))}
      </AnimatePresence>

      {/* 무한 스크롤 트리거 */}
      <div ref={observerRef} className="h-4" />

      {/* 추가 로딩 */}
      {loading && students.length > 0 && (
        <div className="flex justify-center py-4">
          <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
        </div>
      )}

      {/* 더 이상 데이터 없음 */}
      {!hasMore && students.length > 0 && (
        <p className="text-center text-sm text-gray-400 py-4">
          모든 학생을 불러왔습니다
        </p>
      )}
    </div>
  );
}
