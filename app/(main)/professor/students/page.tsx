'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Header, Skeleton } from '@/components/common';
import {
  StudentList,
  StudentDetailModal,
  StudentStats,
  TargetClassSelector,
} from '@/components/professor';
import {
  useProfessorStudents,
  type StudentData,
  type StudentFilterOptions,
  type ClassType,
} from '@/lib/hooks/useProfessorStudents';

// ============================================================
// 타입 정의
// ============================================================

type SortOption = 'activity' | 'score' | 'name' | 'level';

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 교수님 학생 모니터링 페이지
 *
 * 학생별 진도 현황, 참여율, 점수를 모니터링할 수 있습니다.
 */
export default function StudentMonitoringPage() {
  const {
    students,
    loading,
    error,
    hasMore,
    fetchStudents,
    fetchMore,
    fetchStudentDetail,
    getClassStats,
    clearError,
  } = useProfessorStudents();

  // 필터 상태
  const [selectedClass, setSelectedClass] = useState<ClassType | 'all'>('all');
  const [sortBy, setSortBy] = useState<SortOption>('activity');
  const [searchQuery, setSearchQuery] = useState('');

  // 선택된 학생 (상세 모달용)
  const [selectedStudent, setSelectedStudent] = useState<StudentData | null>(null);

  // 뷰 모드: list (목록) | stats (통계)
  const [viewMode, setViewMode] = useState<'list' | 'stats'>('list');

  // 데이터 로드
  useEffect(() => {
    const options: StudentFilterOptions = {
      classId: selectedClass,
      sortBy,
      sortOrder: 'desc',
      searchQuery: searchQuery.trim() || undefined,
    };
    fetchStudents(options);
  }, [selectedClass, sortBy, searchQuery, fetchStudents]);

  // 학생 클릭 핸들러
  const handleStudentClick = useCallback((student: StudentData) => {
    setSelectedStudent(student);
  }, []);

  // 모달 닫기
  const handleCloseModal = useCallback(() => {
    setSelectedStudent(null);
  }, []);

  // 반별 통계
  const classStats = getClassStats();

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* 헤더 */}
      <Header title="학생 모니터링" showBack />

      {/* 필터 영역 */}
      <div className="sticky top-0 bg-gray-50 z-10 px-4 pt-3 pb-2 space-y-3">
        {/* 검색 */}
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="학생 이름 또는 학번 검색..."
            className="
              w-full pl-10 pr-4 py-2.5 bg-white rounded-xl
              border border-gray-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100
              text-sm outline-none transition-all
            "
          />
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>

        {/* 뷰 모드 토글 + 반 선택 */}
        <div className="flex items-center gap-3">
          {/* 뷰 모드 토글 */}
          <div className="flex bg-white rounded-xl p-1 shadow-sm">
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`
                px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
                ${viewMode === 'list' ? 'bg-indigo-500 text-white' : 'text-gray-500'}
              `}
            >
              목록
            </button>
            <button
              type="button"
              onClick={() => setViewMode('stats')}
              className={`
                px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
                ${viewMode === 'stats' ? 'bg-indigo-500 text-white' : 'text-gray-500'}
              `}
            >
              통계
            </button>
          </div>

          {/* 반 선택 */}
          <div className="flex-1 overflow-x-auto">
            <TargetClassSelector
              value={selectedClass}
              onChange={setSelectedClass}
              className="flex-nowrap"
            />
          </div>
        </div>

        {/* 정렬 옵션 (목록 모드에서만) */}
        {viewMode === 'list' && (
          <div className="flex gap-2">
            {[
              { value: 'activity', label: '최근 활동순' },
              { value: 'score', label: '점수순' },
              { value: 'level', label: '레벨순' },
              { value: 'name', label: '이름순' },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setSortBy(option.value as SortOption)}
                className={`
                  px-3 py-1.5 rounded-full text-xs font-medium transition-colors
                  ${
                    sortBy === option.value
                      ? 'bg-indigo-500 text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-100'
                  }
                `}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 에러 메시지 */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-4 mb-4 p-3 bg-red-50 border border-red-200 rounded-xl"
        >
          <p className="text-sm text-red-600">{error}</p>
          <button
            type="button"
            onClick={clearError}
            className="text-xs text-red-500 underline mt-1"
          >
            닫기
          </button>
        </motion.div>
      )}

      {/* 메인 컨텐츠 */}
      <main className="px-4 pt-2">
        {viewMode === 'list' ? (
          // 목록 뷰
          <StudentList
            students={students}
            loading={loading}
            hasMore={hasMore}
            onLoadMore={fetchMore}
            onStudentClick={handleStudentClick}
          />
        ) : (
          // 통계 뷰
          <StudentStats
            classStats={classStats}
            totalStudents={students.length}
          />
        )}
      </main>

      {/* 학생 상세 모달 */}
      <StudentDetailModal
        student={selectedStudent}
        onLoadDetail={fetchStudentDetail}
        onClose={handleCloseModal}
      />
    </div>
  );
}
