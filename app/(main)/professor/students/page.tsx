'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import AnimatedUnderlineTabs from '@/components/common/AnimatedUnderlineTabs';
/* eslint-disable @next/next/no-img-element */
import type { CourseId } from '@/lib/types/course';
import {
  useProfessorStudents,
  type StudentDetail,
  type ClassType,
} from '@/lib/hooks/useProfessorStudents';
import { useCourse, useDetailPanel } from '@/lib/contexts';
import { ScrollToTopButton } from '@/components/common';
import { useWideMode } from '@/lib/hooks/useViewportScale';
import { mean, sd, zScore } from '@/lib/utils/statistics';

import StudentListView from '@/components/professor/students/StudentListView';
import StudentDetailModal from '@/components/professor/students/StudentDetailModal';
import StudentManagementSheet from '@/components/professor/students/StudentManagementSheet';
import { scaleCoord } from '@/lib/hooks/useViewportScale';
import { useDailyAttendance } from '@/lib/hooks/useDailyAttendance';
import { useHomeScale } from '@/components/home/useHomeScale';

// ============================================================
// 접속 상태 유틸
// ============================================================

function getOnlineStatus(lastActiveAt: Date): 'online' | 'offline' {
  const diff = Date.now() - lastActiveAt.getTime();
  // useActivityTracker 간격(120초) + 여유 30초 = 150초
  if (diff < 150 * 1000) return 'online';
  return 'offline';
}

// ============================================================
// 경고 아이템 타입 (StudentListView에 전달)
// ============================================================

export interface WarningItem {
  uid: string;
  level: 'caution' | 'danger';
}

// ============================================================
// 메인 페이지
// ============================================================

export default function StudentMonitoringPage() {
  const {
    students,
    loading,
    error,
    subscribeStudents,
    getInstantDetail,
    fetchStudentDetail,
    clearError,
  } = useProfessorStudents();

  const { userCourseId, setProfessorCourse, assignedCourses, courseList } = useCourse();
  const isWide = useWideMode();
  const { openDetail, replaceDetail, closeDetail, isDetailOpen } = useDetailPanel();
  const courseIds = useMemo(() => {
    const allIds = courseList.map(c => c.id) as CourseId[];
    if (assignedCourses.length > 0) {
      return allIds.filter(id => assignedCourses.includes(id));
    }
    return allIds;
  }, [assignedCourses, courseList]);

  const [selectedClass, setSelectedClass] = useState<ClassType | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // 검색 디바운스 (300ms)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // 학생 상세 모달
  const [selectedStudentDetail, setSelectedStudentDetail] = useState<StudentDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // 학생 관리 시트
  const [showManagement, setShowManagement] = useState(false);

  // students ref (handleStudentClick에서 참조 — 콜백 재생성 방지)
  const studentsRef = useRef(students);
  studentsRef.current = students;

  // 스크롤 맨 위로 (도넛 섹션 기준)
  const donutRef = useRef<HTMLDivElement>(null);

  // 실시간 구독 (courseId 변경 시 재구독)
  useEffect(() => {
    if (userCourseId) subscribeStudents(userCourseId);
  }, [userCourseId, subscribeStudents]);

  // 필터된 학생 (반 + 검색)
  const filteredStudents = useMemo(() => {
    let list = students;
    if (selectedClass !== 'all') {
      list = list.filter(s => s.classId === selectedClass);
    }
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.trim().toLowerCase();
      list = list.filter(s =>
        s.nickname.toLowerCase().includes(q) ||
        s.studentId.toLowerCase().includes(q) ||
        (s.name && s.name.toLowerCase().includes(q))
      );
    }
    return list;
  }, [students, selectedClass, debouncedSearch]);

  // 날짜 선택 (일일 접속 통계용)
  const todayDate = useMemo(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  }, []);
  const [selectedMonth, setSelectedMonth] = useState(todayDate.month);
  const [selectedDay, setSelectedDay] = useState(todayDate.day);

  // 해당 월의 최대 일수 (2월 윤년 등 자동 반영)
  const maxDayInMonth = useMemo(
    () => new Date(todayDate.year, selectedMonth, 0).getDate(),
    [todayDate.year, selectedMonth],
  );

  // 월 변경 시 일이 최대일을 초과하면 자동 보정
  const handleMonthChange = useCallback((m: number) => {
    setSelectedMonth(m);
    const maxDay = new Date(todayDate.year, m, 0).getDate();
    setSelectedDay(prev => Math.min(prev, maxDay));
  }, [todayDate.year]);

  // < > 하루 이동
  const handlePrevDay = useCallback(() => {
    setSelectedDay(prev => {
      if (prev > 1) return prev - 1;
      // 이전 달로
      const newMonth = selectedMonth > 1 ? selectedMonth - 1 : 12;
      const newMaxDay = new Date(todayDate.year, newMonth, 0).getDate();
      setSelectedMonth(newMonth);
      return newMaxDay;
    });
  }, [selectedMonth, todayDate.year]);

  const handleNextDay = useCallback(() => {
    setSelectedDay(prev => {
      if (prev < maxDayInMonth) return prev + 1;
      // 다음 달로
      const newMonth = selectedMonth < 12 ? selectedMonth + 1 : 1;
      setSelectedMonth(newMonth);
      return 1;
    });
  }, [selectedMonth, maxDayInMonth]);

  // 선택된 날짜 → YYYY-MM-DD 문자열
  const selectedDateStr = useMemo(() => {
    const clampedDay = Math.min(selectedDay, maxDayInMonth);
    return `${todayDate.year}-${String(selectedMonth).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
  }, [selectedMonth, selectedDay, maxDayInMonth, todayDate.year]);

  const isTodaySelected = selectedDateStr === new Date().toISOString().slice(0, 10);

  // 일일 접속 데이터 조회
  const { attendedUids } = useDailyAttendance(userCourseId || '', selectedDateStr);

  // 일일 접속 통계 (필터된 학생 기준)
  const attendanceStats = useMemo(() => {
    const attendedSet = new Set(attendedUids);

    // 오늘: lastActiveAt가 오늘인 학생도 포함 (코드 배포 전 접속한 학생 포착)
    if (isTodaySelected) {
      const todayStr = new Date().toDateString();
      for (const s of filteredStudents) {
        if (s.lastActiveAt.toDateString() === todayStr) {
          attendedSet.add(s.uid);
        }
      }
    }

    let count = 0;
    for (const s of filteredStudents) {
      if (attendedSet.has(s.uid)) count++;
    }
    return { attendedCount: count, totalCount: filteredStudents.length };
  }, [filteredStudents, attendedUids, isTodaySelected]);

  // 경고 시스템 (StudentListView에 전달)
  const warningMap = useMemo((): Map<string, WarningItem> => {
    const map = new Map<string, WarningItem>();
    const scores = filteredStudents.map(s => s.quizStats.averageScore);
    const m = mean(scores);
    const s = sd(scores);
    if (s === 0) return map;

    filteredStudents.forEach(student => {
      const z = zScore(student.quizStats.averageScore, m, s);
      if (z < -2.0) {
        map.set(student.uid, { uid: student.uid, level: 'danger' });
      } else if (z < -1.5) {
        map.set(student.uid, { uid: student.uid, level: 'caution' });
      }
    });
    return map;
  }, [filteredStudents]);

  // allStudents (모달에 전달)
  const allStudentsForModal = useMemo(() =>
    students.map(s => ({
      uid: s.uid,
      classId: s.classId,
      averageScore: s.quizStats.averageScore,
    })),
  [students]);

  // 가로모드: 3쪽 패널에 학생 상세/관리 표시 (클릭 핸들러에서 직접 호출)
  const openStudentPanel = useCallback((detail: StudentDetail) => {
    const close = () => { setDetailOpen(false); closeDetail(); };
    const action = isDetailOpen ? replaceDetail : openDetail;
    action(
      <StudentDetailModal
        student={detail}
        allStudents={allStudentsForModal}
        isOpen
        onClose={close}
        isPanelMode
      />
    );
  }, [allStudentsForModal, isDetailOpen, openDetail, replaceDetail, closeDetail]);

  const openManagePanel = useCallback(() => {
    if (!userCourseId) return;
    const close = () => { setShowManagement(false); closeDetail(); };
    const action = isDetailOpen ? replaceDetail : openDetail;
    action(
      <StudentManagementSheet
        open
        onClose={close}
        courseId={userCourseId}
        isPanelMode
      />
    );
  }, [userCourseId, isDetailOpen, openDetail, replaceDetail, closeDetail]);

  // 학생 클릭 — 동기 캐시에서 즉시 레이더+학업 표시 + 백그라운드 보충
  const handleStudentClick = useCallback(async (uid: string) => {
    // 캐시에서 동기적으로 데이터 가져오기 (레이더+학업 즉시 표시)
    const instant = getInstantDetail(uid);

    let initialDetail: StudentDetail;
    if (instant) {
      initialDetail = instant;
    } else {
      const basicStudent = studentsRef.current.find(s => s.uid === uid);
      if (!basicStudent) return;
      initialDetail = { ...basicStudent, recentQuizzes: [], recentFeedbacks: [] };
    }

    // 가로모드: 3쪽 패널로 표시 (세로모드: 바텀시트)
    if (isWide) {
      openStudentPanel(initialDetail);
    } else {
      setSelectedStudentDetail(initialDetail);
      setDetailOpen(true);
    }

    // 백그라운드에서 보충 데이터 로드 (recentQuizzes, recentFeedbacks)
    const detail = await fetchStudentDetail(uid);
    if (detail) {
      const merged = {
        ...detail,
        radarMetrics: detail.radarMetrics ?? initialDetail.radarMetrics,
        weightedScore: detail.weightedScore ?? initialDetail.weightedScore,
        classWeightedScores: detail.classWeightedScores ?? initialDetail.classWeightedScores,
      };
      if (isWide) {
        // 가로모드: 3쪽 패널 갱신 (퀴즈 성적 등 보충 데이터 반영)
        openStudentPanel(merged);
      } else {
        // 세로모드: state 업데이트로 바텀시트 갱신 (리마운트 없음)
        setSelectedStudentDetail(prev => prev ? merged : detail);
      }
    }
  }, [getInstantDetail, fetchStudentDetail, isWide, openStudentPanel]);

  const CLASS_OPTIONS: (ClassType | 'all')[] = ['all', 'A', 'B', 'C', 'D'];

  const handleCourseChange = useCallback((courseId: CourseId) => {
    setProfessorCourse(courseId);
    setSearchQuery(''); // 과목 변경 시 검색 초기화
  }, [setProfessorCourse]);

  return (
    <div className="min-h-screen pb-24 bg-[#F5F0E8]">
      <header className="flex flex-col items-center">
        <StudentsRibbonHeader
          currentCourseId={userCourseId || 'biology'}
          onCourseChange={handleCourseChange}
          courseIds={courseIds}
        />
      </header>

      <div className="px-4 mt-2">
        {/* 반 필터 (언더라인 탭) + 검색 — 같은 줄 */}
        <div className="flex items-center justify-between">
          {/* 언더라인 탭 */}
          <ClassFilterTabs selectedClass={selectedClass} onClassChange={(cls) => { setSelectedClass(cls); setSearchQuery(''); }} />

          {/* 검색 */}
          <div className="relative w-[145px]">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="이름·학번·닉네임"
              className={`w-full pl-6 pr-8 py-3 border rounded-lg text-sm text-center text-[#1A1A1A] placeholder-[#5C5C5C] outline-none ${
                searchQuery ? 'bg-[#1A1A1A]/5 border-[#1A1A1A] border-2' : 'bg-[#EDEAE4] border-[#1A1A1A]'
              }`}
            />
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#5C5C5C]"
              fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {/* 검색 초기화 X 버튼 */}
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full bg-[#1A1A1A] text-white"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        <div className="h-3" />

        {/* 일일 접속 — 도넛 차트 + 날짜 선택 + 범례 */}
        <div ref={donutRef} />
        <SessionDonut
          attended={attendanceStats.attendedCount}
          total={attendanceStats.totalCount}
          classFilter={selectedClass}
          month={selectedMonth}
          day={selectedDay}
          maxDay={maxDayInMonth}
          onMonthChange={handleMonthChange}
          onDayChange={setSelectedDay}
          onPrevDay={handlePrevDay}
          onNextDay={handleNextDay}
        />

        <div className="h-3" />

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
            {/* 학생 목록 */}
            <StudentListView
              students={filteredStudents}
              onStudentClick={handleStudentClick}
              warningMap={warningMap}
              onManageClick={() => { if (isWide) { openManagePanel(); } else { setShowManagement(true); } }}
            />
          </>
        )}
      </div>

      {/* 학생 상세 모달 (세로모드만 — 가로모드는 3쪽 패널로 표시) */}
      {!isWide && (
        <StudentDetailModal
          student={selectedStudentDetail}
          allStudents={allStudentsForModal}
          isOpen={detailOpen}
          onClose={() => setDetailOpen(false)}
        />
      )}

      {/* 스크롤 맨 위로 */}
      <ScrollToTopButton targetRef={donutRef} />

      {/* 학생 관리 바텀시트 (세로모드만 — 가로모드는 3쪽 패널로 표시) */}
      {!isWide && userCourseId && (
        <StudentManagementSheet
          open={showManagement}
          onClose={() => setShowManagement(false)}
          courseId={userCourseId}
        />
      )}

    </div>
  );
}

// ============================================================
// 과목 리본 스와이프 헤더
// ============================================================

function StudentsRibbonHeader({
  currentCourseId,
  onCourseChange,
  courseIds,
}: {
  currentCourseId: CourseId;
  onCourseChange: (courseId: CourseId) => void;
  courseIds: CourseId[];
}) {
  const { getCourseById } = useCourse();
  const scale = useHomeScale();
  const currentIndex = courseIds.indexOf(currentCourseId);
  const course = getCourseById(currentCourseId);
  const ribbonImage = course?.studentsRibbonImage || '/images/biology-students-ribbon.png';
  const ribbonScale = course?.studentsRibbonScale || 1;

  const goToPrev = () => {
    const prevIdx = (currentIndex - 1 + courseIds.length) % courseIds.length;
    onCourseChange(courseIds[prevIdx]);
  };

  const goToNext = () => {
    const nextIdx = (currentIndex + 1) % courseIds.length;
    onCourseChange(courseIds[nextIdx]);
  };

  // 터치 + 마우스 드래그 스와이프 (세로 스크롤 허용)
  const swipeStartX = useRef(0);
  const swipeStartY = useRef(0);
  const swipeDir = useRef<'none' | 'horizontal' | 'vertical'>('none');

  const handleTouchStart = (e: React.TouchEvent) => {
    swipeStartX.current = scaleCoord(e.touches[0].clientX);
    swipeStartY.current = scaleCoord(e.touches[0].clientY);
    swipeDir.current = 'none';
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (swipeDir.current === 'vertical') return;
    const touch = e.changedTouches[0];
    const dx = scaleCoord(touch.clientX) - swipeStartX.current;
    if (Math.abs(dx) > 40) {
      if (dx > 0) goToPrev();
      else goToNext();
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (swipeDir.current !== 'none') return;
    const dx = Math.abs(scaleCoord(e.touches[0].clientX) - swipeStartX.current);
    const dy = Math.abs(scaleCoord(e.touches[0].clientY) - swipeStartY.current);
    if (dx > 10 || dy > 10) {
      swipeDir.current = dx > dy ? 'horizontal' : 'vertical';
    }
  };

  // PC 마우스 드래그
  const mouseStartX = useRef(0);
  const isMouseDragging = useRef(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    mouseStartX.current = scaleCoord(e.clientX);
    isMouseDragging.current = true;
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!isMouseDragging.current) return;
    isMouseDragging.current = false;
    const diff = scaleCoord(e.clientX) - mouseStartX.current;
    if (diff > 40) goToPrev();
    else if (diff < -40) goToNext();
  };

  return (
    <div className="flex flex-col items-center">
      {/* 리본 이미지 — 터치/마우스 드래그로 과목 전환 */}
      <div
        className="w-full mt-2 cursor-grab active:cursor-grabbing select-none"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        style={{ height: Math.round(160 * scale), touchAction: 'pan-y' }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={currentCourseId}
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={{ duration: 0.2 }}
            className="w-full h-full"
          >
            <img
              src={ribbonImage}
              alt={course?.name || 'Students'}
              className="w-full h-full object-contain pointer-events-none"
              style={{ transform: `scale(${ribbonScale}) scaleX(1.15)` }}
              draggable={false}
            />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* 페이지네이션 도트 — mb-2로 아래 콘텐츠와 간격 확보 */}
      <div className="flex justify-center gap-2 mt-3 mb-2">
        {courseIds.map((id, idx) => (
          <button
            key={id}
            onClick={() => onCourseChange(id)}
            className={`w-2 h-2 rounded-full transition-all ${
              idx === currentIndex ? 'bg-[#1A1A1A] w-4' : 'bg-[#D4CFC4]'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

// ============================================================
// 반 필터 언더라인 탭
// ============================================================

const CLASS_FILTER_OPTIONS: { value: ClassType | 'all'; label: string }[] = [
  { value: 'all', label: 'ALL' },
  { value: 'A', label: 'A' },
  { value: 'B', label: 'B' },
  { value: 'C', label: 'C' },
  { value: 'D', label: 'D' },
];

function ClassFilterTabs({
  selectedClass,
  onClassChange,
}: {
  selectedClass: ClassType | 'all';
  onClassChange: (cls: ClassType | 'all') => void;
}) {
  return <AnimatedUnderlineTabs options={CLASS_FILTER_OPTIONS} activeValue={selectedClass} onChange={onClassChange} buttonClassName="text-xl" />;
}

// ============================================================
// 위아래 스와이프 숫자 선택기
// ============================================================

function ScrollableDigit({ value, min, max, onChange }: {
  value: number; min: number; max: number;
  onChange: (v: number) => void;
}) {
  const startY = useRef<number | null>(null);
  const accum = useRef(0);
  const scale = useHomeScale();

  return (
    <span
      className="inline-block cursor-ns-resize select-none touch-none font-black text-[#1A1A1A] tabular-nums leading-none"
      style={{ fontSize: Math.round(24 * scale), minWidth: value >= 10 ? '1.6ch' : '0.9ch', textAlign: 'center' }}
      onPointerDown={(e) => {
        startY.current = e.clientY;
        accum.current = 0;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (startY.current === null) return;
        const dy = startY.current - e.clientY; // 위로 = 증가
        accum.current += dy;
        startY.current = e.clientY;
        const step = 25;
        if (Math.abs(accum.current) >= step) {
          const dir = accum.current > 0 ? 1 : -1;
          accum.current = 0;
          const next = value + dir;
          if (next >= min && next <= max) onChange(next);
        }
      }}
      onPointerUp={() => { startY.current = null; }}
      onPointerCancel={() => { startY.current = null; }}
    >
      {value}
    </span>
  );
}

// ============================================================
// 일일 접속 도넛 차트 + 날짜 선택 + 범례
// ============================================================

function SessionDonut({ attended, total, classFilter, month, day, maxDay, onMonthChange, onDayChange, onPrevDay, onNextDay }: {
  attended: number; total: number; classFilter: string;
  month: number; day: number; maxDay: number;
  onMonthChange: (m: number) => void;
  onDayChange: (d: number) => void;
  onPrevDay: () => void;
  onNextDay: () => void;
}) {
  const notAttended = total - attended;
  const pct = total > 0 ? Math.round((attended / total) * 100) : 0;
  const scale = useHomeScale();

  const R = 42;
  const C = 2 * Math.PI * R;
  const attendedLen = (pct / 100) * C;
  const animKey = `donut-${classFilter}-${month}-${day}`;
  const donutSize = Math.round(160 * scale);

  return (
    <div className="flex items-center justify-center py-2" style={{ gap: Math.round(24 * scale) }}>
      {/* 도넛 차트 */}
      <div className="flex-shrink-0" style={{ width: donutSize, height: donutSize }}>
        <svg width={donutSize} height={donutSize} viewBox="0 0 100 100">
          {/* 미접속 링 */}
          <circle
            cx="50" cy="50" r={R} fill="none"
            stroke="#1A1A1A" strokeWidth="13" opacity="0.12"
          />
          {/* 접속 — 채움 애니메이션 */}
          {pct > 0 && (
            <motion.circle
              key={animKey}
              cx="50" cy="50" r={R} fill="none"
              stroke="#1A1A1A" strokeWidth="13"
              strokeLinecap="round"
              transform="rotate(-90 50 50)"
              initial={{ strokeDasharray: `0 ${C}` }}
              animate={{ strokeDasharray: `${attendedLen} ${C - attendedLen}` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
            />
          )}
          {/* 중앙 퍼센트 */}
          <text x="50" y="50" textAnchor="middle" dominantBaseline="central" className="font-bold text-[16px] fill-[#1A1A1A]">
            {pct}%
          </text>
        </svg>
      </div>

      {/* 날짜 + 범례 */}
      <div style={{ width: Math.round(160 * scale) }} className="space-y-2">
        {/* 날짜 선택: < X月 X日 > */}
        <div className="flex items-center justify-between pb-1 border-b border-dashed border-[#D4CFC4]">
          <button onClick={onPrevDay} className="flex items-center justify-center text-[#5C5C5C] hover:text-[#1A1A1A] transition-colors" style={{ width: Math.round(24 * scale), height: Math.round(24 * scale) }}>
            <svg style={{ width: Math.round(14 * scale), height: Math.round(14 * scale) }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex items-baseline gap-0.5">
            <ScrollableDigit value={month} min={1} max={12} onChange={onMonthChange} />
            <span className="font-bold text-[#5C5C5C]" style={{ fontSize: Math.round(16 * scale) }}>月</span>
            <span className="w-0.5" />
            <ScrollableDigit value={day} min={1} max={maxDay} onChange={onDayChange} />
            <span className="font-bold text-[#5C5C5C]" style={{ fontSize: Math.round(16 * scale) }}>日</span>
          </div>
          <button onClick={onNextDay} className="flex items-center justify-center text-[#5C5C5C] hover:text-[#1A1A1A] transition-colors" style={{ width: Math.round(24 * scale), height: Math.round(24 * scale) }}>
            <svg style={{ width: Math.round(14 * scale), height: Math.round(14 * scale) }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* 전체 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="rounded-full flex-shrink-0 border-2 border-[#1A1A1A] bg-[#1A1A1A]/50" style={{ width: Math.round(16 * scale), height: Math.round(16 * scale) }} />
            <span className="font-bold text-[#1A1A1A]" style={{ fontSize: Math.round(16 * scale) }}>전체</span>
          </div>
          <span className="font-bold text-[#1A1A1A]" style={{ fontSize: Math.round(24 * scale) }}>{total}<span className="text-[#5C5C5C] font-normal ml-0.5" style={{ fontSize: Math.round(14 * scale) }}>명</span></span>
        </div>
        {/* 접속 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="rounded-full bg-[#1A1A1A] flex-shrink-0" style={{ width: Math.round(16 * scale), height: Math.round(16 * scale) }} />
            <span className="font-bold text-[#1A1A1A]" style={{ fontSize: Math.round(16 * scale) }}>접속</span>
          </div>
          <span className="font-bold text-[#1A1A1A]" style={{ fontSize: Math.round(24 * scale) }}>{attended}<span className="text-[#5C5C5C] font-normal ml-0.5" style={{ fontSize: Math.round(14 * scale) }}>명</span></span>
        </div>
        {/* 미접속 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="rounded-full border-2 border-[#1A1A1A] bg-[#F5F0E8] flex-shrink-0" style={{ width: Math.round(16 * scale), height: Math.round(16 * scale) }} />
            <span className="font-bold text-[#1A1A1A]" style={{ fontSize: Math.round(16 * scale) }}>미접속</span>
          </div>
          <span className="font-bold text-[#1A1A1A]" style={{ fontSize: Math.round(24 * scale) }}>{notAttended}<span className="text-[#5C5C5C] font-normal ml-0.5" style={{ fontSize: Math.round(14 * scale) }}>명</span></span>
        </div>
      </div>
    </div>
  );
}
