'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { httpsCallable } from 'firebase/functions';
import { collection, getDocs } from 'firebase/firestore';
import { db, functions } from '@/lib/firebase';
import { Header } from '@/components/common';
import {
  useProfessorStudents,
  type StudentDetail,
  type StudentFilterOptions,
  type ClassType,
} from '@/lib/hooks/useProfessorStudents';
import { useCourse } from '@/lib/contexts';
import { mean, sd, zScore } from '@/lib/utils/statistics';

import LiveSessionPanel from '@/components/professor/students/LiveSessionPanel';
import StudentListView, { type SortKey } from '@/components/professor/students/StudentListView';
import StudentDetailModal from '@/components/professor/students/StudentDetailModal';
import EarlyWarning, { type WarningItem } from '@/components/professor/students/EarlyWarning';
import StudentEnrollment from '@/components/professor/StudentEnrollment';

export default function StudentMonitoringPage() {
  const {
    students,
    loading,
    error,
    fetchStudents,
    fetchStudentDetail,
    clearError,
  } = useProfessorStudents();

  const { userCourseId } = useCourse();

  const [selectedClass, setSelectedClass] = useState<ClassType | 'all'>('all');
  const [sortBy, setSortBy] = useState<SortKey>('status');
  const [searchQuery, setSearchQuery] = useState('');

  // 학생 상세 모달
  const [selectedStudentDetail, setSelectedStudentDetail] = useState<StudentDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // 학생 등록 모달
  const [showEnrollment, setShowEnrollment] = useState(false);

  // 비밀번호 초기화 모달
  const [showResetPw, setShowResetPw] = useState(false);
  const [resetStudentId, setResetStudentId] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetResult, setResetResult] = useState<string | null>(null);

  // 가입 현황
  const [enrolledCount, setEnrolledCount] = useState<{ total: number; registered: number } | null>(null);

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

  // 가입 현황 로드
  const loadEnrolledCount = useCallback(async () => {
    if (!userCourseId) return;
    try {
      const snapshot = await getDocs(
        collection(db, 'enrolledStudents', userCourseId, 'students')
      );
      let total = 0;
      let registered = 0;
      snapshot.forEach(doc => {
        total++;
        if (doc.data().isRegistered) registered++;
      });
      setEnrolledCount({ total, registered });
    } catch {
      // enrolledStudents 컬렉션이 없을 수 있음
    }
  }, [userCourseId]);

  useEffect(() => {
    loadEnrolledCount();
  }, [loadEnrolledCount]);

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

  // 비밀번호 초기화 처리
  const handleResetPassword = useCallback(async () => {
    if (!resetStudentId || !resetNewPassword || !userCourseId) return;

    if (resetNewPassword.length < 6) {
      setResetResult('비밀번호는 6자 이상이어야 합니다.');
      return;
    }

    setResetLoading(true);
    setResetResult(null);

    try {
      const resetFn = httpsCallable<
        { studentId: string; courseId: string; newPassword: string },
        { success: boolean; message: string }
      >(functions, 'resetStudentPassword');

      const response = await resetFn({
        studentId: resetStudentId,
        courseId: userCourseId,
        newPassword: resetNewPassword,
      });

      setResetResult(response.data.message);
      setResetNewPassword('');
    } catch (err: unknown) {
      const firebaseError = err as { message?: string };
      setResetResult(firebaseError.message || '비밀번호 초기화에 실패했습니다.');
    } finally {
      setResetLoading(false);
    }
  }, [resetStudentId, resetNewPassword, userCourseId]);

  const CLASS_OPTIONS: (ClassType | 'all')[] = ['all', 'A', 'B', 'C', 'D'];

  return (
    <div className="min-h-screen bg-[#F5F0E8] pb-24">
      <Header title="학생 모니터링" showBack />

      <div className="px-4 py-3 space-y-4">
        {/* 학생 등록 + 비밀번호 초기화 버튼 */}
        <div className="flex gap-2">
          <button
            onClick={() => setShowEnrollment(true)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 border-2 border-[#1A1A1A] bg-[#1A1A1A] text-[#F5F0E8] text-xs font-bold hover:bg-[#333]"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
            </svg>
            학생 등록
          </button>
          <button
            onClick={() => setShowResetPw(true)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 border-2 border-[#1A1A1A] bg-[#FDFBF7] text-[#1A1A1A] text-xs font-bold hover:bg-[#EBE5D9]"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
            비번 초기화
          </button>
        </div>

        {/* 가입 현황 */}
        {enrolledCount && (
          <div className="flex items-center gap-2 px-3 py-2 bg-[#FDFBF7] border border-[#D4CFC4] text-xs text-[#5C5C5C]">
            <span>등록: <b className="text-[#1A1A1A]">{enrolledCount.total}명</b></span>
            <span>·</span>
            <span>가입 완료: <b className="text-green-700">{enrolledCount.registered}명</b></span>
            <span>·</span>
            <span>미가입: <b className="text-orange-600">{enrolledCount.total - enrolledCount.registered}명</b></span>
          </div>
        )}

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

      {/* 학생 등록 모달 */}
      <AnimatePresence>
        {showEnrollment && userCourseId && (
          <StudentEnrollment
            courseId={userCourseId}
            onClose={() => setShowEnrollment(false)}
            onComplete={() => {
              loadEnrolledCount();
              fetchStudents({ classId: selectedClass, sortBy: 'activity', sortOrder: 'desc' });
            }}
          />
        )}
      </AnimatePresence>

      {/* 비밀번호 초기화 모달 */}
      <AnimatePresence>
        {showResetPw && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowResetPw(false)}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm bg-[#FDFBF7] border-2 border-[#1A1A1A] p-4 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-[#1A1A1A]">비밀번호 초기화</h3>
                <button
                  onClick={() => {
                    setShowResetPw(false);
                    setResetResult(null);
                    setResetStudentId('');
                    setResetNewPassword('');
                  }}
                  className="text-[#5C5C5C]"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-3">
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="학번"
                  value={resetStudentId}
                  onChange={(e) => setResetStudentId(e.target.value.replace(/\D/g, ''))}
                  maxLength={10}
                  className="w-full px-3 py-2 border border-[#D4CFC4] text-sm bg-white focus:outline-none focus:border-[#1A1A1A]"
                />
                <input
                  type="text"
                  placeholder="새 비밀번호 (6자 이상)"
                  value={resetNewPassword}
                  onChange={(e) => setResetNewPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-[#D4CFC4] text-sm bg-white focus:outline-none focus:border-[#1A1A1A]"
                />
              </div>

              {resetResult && (
                <div className={`p-2 text-xs border ${
                  resetResult.includes('초기화되었습니다')
                    ? 'border-green-300 bg-green-50 text-green-700'
                    : 'border-red-300 bg-red-50 text-red-700'
                }`}>
                  {resetResult}
                </div>
              )}

              <button
                onClick={handleResetPassword}
                disabled={resetLoading || !resetStudentId || !resetNewPassword}
                className="w-full py-2.5 bg-[#1A1A1A] text-[#F5F0E8] font-bold text-sm disabled:opacity-50"
              >
                {resetLoading ? '처리 중...' : '비밀번호 초기화'}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
