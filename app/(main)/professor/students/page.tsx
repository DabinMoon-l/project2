'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Header } from '@/components/common';
import {
  useProfessorStudents,
  type StudentData,
  type StudentDetail,
  type StudentFilterOptions,
  type ClassType,
} from '@/lib/hooks/useProfessorStudents';
import { mean, sd, zScore } from '@/lib/utils/statistics';

import LiveSessionPanel from '@/components/professor/students/LiveSessionPanel';
import StudentListView, { type SortKey } from '@/components/professor/students/StudentListView';
import StudentDetailModal from '@/components/professor/students/StudentDetailModal';
import EarlyWarning, { type WarningItem } from '@/components/professor/students/EarlyWarning';

export default function StudentMonitoringPage() {
  const {
    students,
    loading,
    error,
    fetchStudents,
    fetchStudentDetail,
    clearError,
  } = useProfessorStudents();

  const [selectedClass, setSelectedClass] = useState<ClassType | 'all'>('all');
  const [sortBy, setSortBy] = useState<SortKey>('status');
  const [searchQuery, setSearchQuery] = useState('');

  // 학생 상세 모달
  const [selectedStudentDetail, setSelectedStudentDetail] = useState<StudentDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // 데이터 로드
  useEffect(() => {
    const options: StudentFilterOptions = {
      classId: selectedClass,
      sortBy: 'activity',
      sortOrder: 'desc',
      searchQuery: searchQuery.trim() || undefined,
    };
    fetchStudents(options);
  }, [selectedClass, searchQuery, fetchStudents]);

  // 필터된 학생
  const filteredStudents = useMemo(() => {
    if (selectedClass === 'all') return students;
    return students.filter(s => s.classId === selectedClass);
  }, [students, selectedClass]);

  // 경고 시스템
  const warnings = useMemo((): WarningItem[] => {
    const scores = filteredStudents.map(s => s.quizStats.averageScore);
    const m = mean(scores);
    const s = sd(scores);
    if (s === 0) return [];

    return filteredStudents
      .map(student => {
        const z = zScore(student.quizStats.averageScore, m, s);
        if (z < -2.0) {
          return { uid: student.uid, nickname: student.nickname, classId: student.classId, zScore: z, level: 'danger' as const, reason: 'Z < -2.0' };
        }
        if (z < -1.5) {
          return { uid: student.uid, nickname: student.nickname, classId: student.classId, zScore: z, level: 'caution' as const, reason: 'Z < -1.5' };
        }
        return null;
      })
      .filter((w): w is WarningItem => w !== null);
  }, [filteredStudents]);

  // 학생 클릭
  const handleStudentClick = useCallback(async (uid: string) => {
    const detail = await fetchStudentDetail(uid);
    if (detail) {
      setSelectedStudentDetail(detail);
      setDetailOpen(true);
    }
  }, [fetchStudentDetail]);

  // allStudents (모달에 전달)
  const allStudentsForModal = useMemo(() =>
    students.map(s => ({
      uid: s.uid,
      classId: s.classId,
      averageScore: s.quizStats.averageScore,
    })),
  [students]);

  const CLASS_OPTIONS: (ClassType | 'all')[] = ['all', 'A', 'B', 'C', 'D'];

  return (
    <div className="min-h-screen bg-[#F5F0E8] pb-24">
      <Header title="학생 모니터링" showBack />

      <div className="px-4 py-3 space-y-4">
        {/* 검색 + 반 필터 */}
        <div className="space-y-2">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="학생 이름 또는 학번 검색..."
              className="w-full pl-9 pr-4 py-2 bg-[#FDFBF7] border-2 border-[#1A1A1A] text-sm text-[#1A1A1A] placeholder-[#5C5C5C] outline-none"
            />
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#5C5C5C]"
              fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>

          <div className="flex gap-1">
            {CLASS_OPTIONS.map(cls => (
              <button
                key={cls}
                onClick={() => setSelectedClass(cls)}
                className={`px-3 py-1 text-xs font-bold border border-[#1A1A1A] ${
                  selectedClass === cls
                    ? 'bg-[#1A1A1A] text-[#F5F0E8]'
                    : 'bg-[#FDFBF7] text-[#1A1A1A]'
                }`}
              >
                {cls === 'all' ? '전체' : `${cls}반`}
              </button>
            ))}
          </div>
        </div>

        {/* 에러 */}
        {error && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="p-3 border-2 border-[#8B1A1A] bg-red-50 text-sm text-[#8B1A1A]"
          >
            {error}
            <button onClick={clearError} className="ml-2 underline text-xs">닫기</button>
          </motion.div>
        )}

        {/* 로딩 */}
        {loading && (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-2 border-[#1A1A1A] border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && (
          <>
            {/* 실시간 세션 패널 */}
            <LiveSessionPanel students={filteredStudents} />

            {/* 조기 경고 */}
            <EarlyWarning warnings={warnings} onStudentClick={handleStudentClick} />

            {/* 학생 목록 */}
            <div className="border-2 border-[#1A1A1A] bg-[#FDFBF7] p-3">
              <h3 className="text-sm font-bold text-[#1A1A1A] mb-3">
                학생 목록 ({filteredStudents.length}명)
              </h3>
              <StudentListView
                students={filteredStudents}
                sortBy={sortBy}
                onSortChange={setSortBy}
                onStudentClick={handleStudentClick}
              />
            </div>
          </>
        )}
      </div>

      {/* 학생 상세 모달 */}
      <StudentDetailModal
        student={selectedStudentDetail}
        allStudents={allStudentsForModal}
        isOpen={detailOpen}
        onClose={() => setDetailOpen(false)}
      />
    </div>
  );
}
