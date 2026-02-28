'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
/* eslint-disable @next/next/no-img-element */
import { COURSES, type CourseId } from '@/lib/types/course';
import {
  useProfessorStudents,
  type StudentDetail,
  type ClassType,
} from '@/lib/hooks/useProfessorStudents';
import { useCourse } from '@/lib/contexts';
import { ScrollToTopButton } from '@/components/common';
import { mean, sd, zScore } from '@/lib/utils/statistics';

import StudentListView from '@/components/professor/students/StudentListView';
import StudentDetailModal from '@/components/professor/students/StudentDetailModal';
import StudentEnrollment from '@/components/professor/StudentEnrollment';
import { scaleCoord } from '@/lib/hooks/useViewportScale';

// ============================================================
// 접속 상태 유틸
// ============================================================

function getOnlineStatus(lastActiveAt: Date): 'online' | 'offline' {
  const diff = Date.now() - lastActiveAt.getTime();
  if (diff < 60 * 1000) return 'online'; // 1분 이내 활동 = 접속 중 (하트비트 30초 기준)
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

  const { userCourseId, setProfessorCourse } = useCourse();

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

  // 학생 등록 모달
  const [showEnrollment, setShowEnrollment] = useState(false);

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

  // 실시간 접속 통계
  const sessionStats = useMemo(() => {
    let onlineCount = 0;
    for (const s of filteredStudents) {
      if (getOnlineStatus(s.lastActiveAt) === 'online') onlineCount++;
    }
    return { onlineCount, totalCount: filteredStudents.length };
  }, [filteredStudents]);

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

  // 학생 클릭 — 동기 캐시에서 즉시 레이더+학업 표시 + 백그라운드 보충
  const handleStudentClick = useCallback(async (uid: string) => {
    // 캐시에서 동기적으로 데이터 가져오기 (레이더+학업 즉시 표시)
    const instant = getInstantDetail(uid);

    if (instant) {
      setSelectedStudentDetail(instant);
    } else {
      const basicStudent = studentsRef.current.find(s => s.uid === uid);
      if (!basicStudent) return;
      setSelectedStudentDetail({
        ...basicStudent,
        recentQuizzes: [],
        recentFeedbacks: [],
      });
    }
    setDetailOpen(true);

    // 백그라운드에서 보충 데이터 로드 (recentQuizzes, recentFeedbacks)
    // 기존 레이더/학업 데이터는 절대 덮어쓰지 않음
    const detail = await fetchStudentDetail(uid);
    if (detail) {
      setSelectedStudentDetail(prev => {
        if (!prev) return detail;
        return {
          ...detail,
          radarMetrics: detail.radarMetrics ?? prev.radarMetrics,
          weightedScore: detail.weightedScore ?? prev.weightedScore,
          classWeightedScores: detail.classWeightedScores ?? prev.classWeightedScores,
        };
      });
    }
  }, [getInstantDetail, fetchStudentDetail]);

  // allStudents (모달에 전달)
  const allStudentsForModal = useMemo(() =>
    students.map(s => ({
      uid: s.uid,
      classId: s.classId,
      averageScore: s.quizStats.averageScore,
    })),
  [students]);

  const CLASS_OPTIONS: (ClassType | 'all')[] = ['all', 'A', 'B', 'C', 'D'];

  const handleCourseChange = useCallback((courseId: CourseId) => {
    setProfessorCourse(courseId);
  }, [setProfessorCourse]);

  return (
    <div className="min-h-screen pb-24 bg-[#F5F0E8]">
      <header className="flex flex-col items-center">
        <StudentsRibbonHeader
          currentCourseId={userCourseId || 'biology'}
          onCourseChange={handleCourseChange}
        />
      </header>

      <div className="px-4 mt-2">
        {/* 반 필터 (언더라인 탭) + 검색 — 같은 줄 */}
        <div className="flex items-center justify-between">
          {/* 언더라인 탭 */}
          <ClassFilterTabs selectedClass={selectedClass} onClassChange={setSelectedClass} />

          {/* 검색 */}
          <div className="relative w-[145px]">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="이름·학번·닉네임"
              className="w-full pl-6 pr-3 py-3 bg-[#EDEAE4] border border-[#1A1A1A] rounded-lg text-sm text-center text-[#1A1A1A] placeholder-[#5C5C5C] outline-none"
            />
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#5C5C5C]"
              fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>

        <div className="h-3" />

        {/* 실시간 접속 — 도넛 차트 + 범례 */}
        <div ref={donutRef} />
        <SessionDonut
          online={sessionStats.onlineCount}
          total={sessionStats.totalCount}
          classFilter={selectedClass}
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
            />

            <div className="h-8" />

            {/* 학생 등록 버튼 (목록 하단) */}
            <button
              onClick={() => setShowEnrollment(true)}
              className="w-full py-2 border border-dashed border-[#D4CFC4] text-xs font-bold text-[#5C5C5C]
                hover:border-[#1A1A1A] hover:text-[#1A1A1A] transition-colors"
            >
              + 학생 등록
            </button>
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

      {/* 스크롤 맨 위로 */}
      <ScrollToTopButton targetRef={donutRef} />

      {/* 학생 등록 모달 */}
      <AnimatePresence>
        {showEnrollment && userCourseId && (
          <StudentEnrollment
            courseId={userCourseId}
            onClose={() => setShowEnrollment(false)}
            onComplete={() => {
              // onSnapshot이 자동으로 갱신하므로 별도 호출 불필요
            }}
          />
        )}
      </AnimatePresence>

    </div>
  );
}

// ============================================================
// 과목 리본 스와이프 헤더
// ============================================================

const COURSE_IDS: CourseId[] = ['biology', 'microbiology', 'pathophysiology'];

function StudentsRibbonHeader({
  currentCourseId,
  onCourseChange,
}: {
  currentCourseId: CourseId;
  onCourseChange: (courseId: CourseId) => void;
}) {
  const currentIndex = COURSE_IDS.indexOf(currentCourseId);
  const course = COURSES[currentCourseId];
  const ribbonImage = course?.studentsRibbonImage || '/images/biology-students-ribbon.png';
  const ribbonScale = course?.studentsRibbonScale || 1;

  const goToPrev = () => {
    const prevIdx = (currentIndex - 1 + COURSE_IDS.length) % COURSE_IDS.length;
    onCourseChange(COURSE_IDS[prevIdx]);
  };

  const goToNext = () => {
    const nextIdx = (currentIndex + 1) % COURSE_IDS.length;
    onCourseChange(COURSE_IDS[nextIdx]);
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
        className="w-full h-[160px] mt-2 cursor-grab active:cursor-grabbing select-none"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        style={{ touchAction: 'pan-y' }}
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
        {COURSE_IDS.map((id, idx) => (
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

const CLASS_FILTER_OPTIONS: { key: ClassType | 'all'; label: string }[] = [
  { key: 'all', label: 'ALL' },
  { key: 'A', label: 'A' },
  { key: 'B', label: 'B' },
  { key: 'C', label: 'C' },
  { key: 'D', label: 'D' },
];

function ClassFilterTabs({
  selectedClass,
  onClassChange,
}: {
  selectedClass: ClassType | 'all';
  onClassChange: (cls: ClassType | 'all') => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [underline, setUnderline] = useState({ left: 0, width: 0 });
  const activeIdx = CLASS_FILTER_OPTIONS.findIndex(o => o.key === selectedClass);

  const measureUnderline = useCallback(() => {
    if (activeIdx < 0 || !containerRef.current || !btnRefs.current[activeIdx]) return;
    const container = containerRef.current.getBoundingClientRect();
    const btn = btnRefs.current[activeIdx]!.getBoundingClientRect();
    setUnderline({ left: btn.left - container.left, width: btn.width });
  }, [activeIdx]);

  useEffect(() => {
    measureUnderline();
  }, [measureUnderline]);

  return (
    <div ref={containerRef} className="relative flex gap-4">
      {CLASS_FILTER_OPTIONS.map((opt, i) => (
        <button
          key={opt.key}
          ref={el => { btnRefs.current[i] = el; }}
          onClick={() => onClassChange(opt.key)}
          className={`pb-1.5 text-xl font-bold transition-colors ${
            selectedClass === opt.key ? 'text-[#1A1A1A]' : 'text-[#5C5C5C]'
          }`}
        >
          {opt.label}
        </button>
      ))}
      {activeIdx >= 0 && underline.width > 0 && (
        <motion.div
          className="absolute bottom-0 h-[2px] bg-[#1A1A1A]"
          animate={{ left: underline.left, width: underline.width }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        />
      )}
    </div>
  );
}

// ============================================================
// 접속 도넛 차트 + 범례
// ============================================================

function SessionDonut({ online, total, classFilter }: { online: number; total: number; classFilter: string }) {
  const offline = total - online;
  const onlinePct = total > 0 ? Math.round((online / total) * 100) : 0;

  // SVG 도넛
  const R = 42;
  const C = 2 * Math.PI * R;
  const onlineLen = (onlinePct / 100) * C;

  // 애니메이션 키 — classFilter가 바뀔 때만 리트리거 (모달/탭 변경은 무시)
  const animKey = `donut-${classFilter}`;

  return (
    <div className="flex items-center justify-center gap-6 py-2">
      {/* 도넛 차트 */}
      <div className="flex-shrink-0 w-[160px] h-[160px]">
        <svg width="160" height="160" viewBox="0 0 100 100">
          {/* 오프라인 링 */}
          <circle
            cx="50" cy="50" r={R} fill="none"
            stroke="#1A1A1A" strokeWidth="13" opacity="0.12"
          />
          {/* 접속 중 — 채움 애니메이션 */}
          {onlinePct > 0 && (
            <motion.circle
              key={animKey}
              cx="50" cy="50" r={R} fill="none"
              stroke="#1A1A1A" strokeWidth="13"
              strokeLinecap="round"
              transform="rotate(-90 50 50)"
              initial={{ strokeDasharray: `0 ${C}` }}
              animate={{ strokeDasharray: `${onlineLen} ${C - onlineLen}` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
            />
          )}
          {/* 중앙 퍼센트 */}
          <text x="50" y="50" textAnchor="middle" dominantBaseline="central" className="font-bold text-[16px] fill-[#1A1A1A]">
            {onlinePct}%
          </text>
        </svg>
      </div>

      {/* 범례 */}
      <div className="w-[160px] space-y-2.5">
        {/* 전체 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full flex-shrink-0 border-2 border-[#1A1A1A] bg-[#1A1A1A]/50" />
            <span className="text-base font-bold text-[#1A1A1A]">전체</span>
          </div>
          <span className="text-2xl font-bold text-[#1A1A1A]">{total}<span className="text-sm text-[#5C5C5C] font-normal ml-0.5">명</span></span>
        </div>
        {/* 접속 중 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-[#1A1A1A] flex-shrink-0" />
            <span className="text-base font-bold text-[#1A1A1A]">접속 중</span>
          </div>
          <span className="text-2xl font-bold text-[#1A1A1A]">{online}<span className="text-sm text-[#5C5C5C] font-normal ml-0.5">명</span></span>
        </div>
        {/* 오프라인 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full border-2 border-[#1A1A1A] bg-[#F5F0E8] flex-shrink-0" />
            <span className="text-base font-bold text-[#1A1A1A]">오프라인</span>
          </div>
          <span className="text-2xl font-bold text-[#1A1A1A]">{offline}<span className="text-sm text-[#5C5C5C] font-normal ml-0.5">명</span></span>
        </div>
      </div>
    </div>
  );
}
