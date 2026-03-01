'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useCourse } from '@/lib/contexts';
import { useProfessorStats, getRawStudents, type QuestionSource, type RawStudentData } from '@/lib/hooks/useProfessorStats';
import { calcFeedbackScore, FEEDBACK_SCORES } from '@/lib/utils/feedbackScore';
import { exportToExcel, exportToWord, type WeeklyStatSummary } from '@/lib/utils/reportExport';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { mean as statMean, sd as statSd, zScore } from '@/lib/utils/statistics';
import type { FeedbackType } from '@/components/quiz/InstantFeedbackButton';
import type { CourseId } from '@/lib/types/course';
import { getCourseList, COURSES } from '@/lib/types/course';
import { scaleCoord } from '@/lib/hooks/useViewportScale';

import SourceFilter from '@/components/professor/stats/SourceFilter';
import ClassComparison from '@/components/professor/stats/ClassComparison';
import StabilityIndex from '@/components/professor/stats/StabilityIndex';
import RadarChart from '@/components/professor/stats/RadarChart';
import ClassProfileRadar from '@/components/professor/stats/ClassProfileRadar';
import MobileBottomSheet from '@/components/common/MobileBottomSheet';
import StudentListView from '@/components/professor/students/StudentListView';
import StudentDetailModal from '@/components/professor/students/StudentDetailModal';
import { useProfessorStudents, type StudentDetail, type StudentData } from '@/lib/hooks/useProfessorStudents';
import type { WarningItem } from '@/app/(main)/professor/students/page';

// ── 부가 데이터 모듈 레벨 캐시 ──
interface ClusterStudentMap {
  passionate: string[];
  hardworking: string[];
  efficient: string[];
  atRisk: string[];
}

interface ExtraData {
  feedbackData: {
    byType: Record<string, number>;
    avgScore: number;
    total: number;
    aiAvgScore: number;
    aiCount: number;
    profAvgScore: number;
    profCount: number;
  } | null;
  clusterData: {
    passionate: number;
    hardworking: number;
    efficient: number;
    atRisk: number;
    total: number;
    byClass: Record<string, { passionate: number; hardworking: number; efficient: number; atRisk: number }>;
    // uid 매핑 (반별)
    studentsByCluster: Record<string, ClusterStudentMap>;
  } | null;
}

const _extraCacheMap = new Map<string, { data: ExtraData; ts: number }>();
const EXTRA_CACHE_TTL = 5 * 60 * 1000;

const COURSE_IDS: CourseId[] = ['biology', 'microbiology', 'pathophysiology'];

const CLUSTER_META = [
  { key: 'passionate' as const, label: '열정적 학습자', color: '#16a34a', desc: '높은 참여 + 높은 성취' },
  { key: 'hardworking' as const, label: '노력형 학습자', color: '#B8860B', desc: '높은 참여 + 낮은 성취' },
  { key: 'efficient' as const, label: '효율형 학습자', color: '#1E3A5F', desc: '낮은 참여 + 높은 성취' },
  { key: 'atRisk' as const, label: '이탈 위험군', color: '#8B1A1A', desc: '낮은 참여 + 낮은 성취' },
];

export default function ProfessorStatsPage() {
  const { userCourseId, setProfessorCourse } = useCourse();
  const { data, loading, error, fetchStats } = useProfessorStats();
  const {
    students,
    subscribeStudents,
    getInstantDetail,
    fetchStudentDetail,
  } = useProfessorStudents();

  const [courseId, setCourseId] = useState<CourseId>(userCourseId || 'biology');
  const [source, setSource] = useState<QuestionSource>('professor');

  const handleCourseChange = useCallback((newCourseId: CourseId) => {
    setCourseId(newCourseId);
    setProfessorCourse(newCourseId);
  }, [setProfessorCourse]);

  // 학생 목록 구독
  useEffect(() => {
    const unsub = subscribeStudents(courseId);
    return unsub;
  }, [courseId, subscribeStudents]);

  // 리포트 상태
  const [reportLoading, setReportLoading] = useState(false);
  const [reportInsight, setReportInsight] = useState<string | null>(null);
  const [reportWeeklyStats, setReportWeeklyStats] = useState<WeeklyStatSummary[]>([]);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportSheetOpen, setReportSheetOpen] = useState(false);
  const [reportMonth, setReportMonth] = useState(() => new Date().getMonth() + 1);
  const [reportYear, setReportYear] = useState(() => new Date().getFullYear());
  const [reportAvailable, setReportAvailable] = useState(false);
  const [existingReportInsight, setExistingReportInsight] = useState<string | null>(null);
  const [reportMonthDropdownOpen, setReportMonthDropdownOpen] = useState(false);
  const [reportCheckLoading, setReportCheckLoading] = useState(false);

  // 바텀시트 상태
  const [atRiskSheetOpen, setAtRiskSheetOpen] = useState(false);
  const [clusterSheetOpen, setClusterSheetOpen] = useState(false);
  const [selectedClusterClass, setSelectedClusterClass] = useState<string | null>(null);
  const [selectedClusterType, setSelectedClusterType] = useState<string | null>(null);

  // 학생 상세 모달
  const [selectedStudentDetail, setSelectedStudentDetail] = useState<StudentDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const studentsRef = useRef(students);
  studentsRef.current = students;

  // 부가 데이터
  const [extraData, setExtraData] = useState<ExtraData>({
    feedbackData: null,
    clusterData: null,
  });

  useEffect(() => {
    fetchStats(courseId, source);
  }, [courseId, source, fetchStats]);

  // 위험학생 계산
  const { atRiskStudentList, atRiskWarningMap } = useMemo(() => {
    if (students.length < 3) return { atRiskStudentList: [] as StudentData[], atRiskWarningMap: new Map<string, WarningItem>() };
    const scores = students.map(s => s.quizStats.averageScore);
    const m = statMean(scores);
    const s = statSd(scores);
    if (s === 0) return { atRiskStudentList: [] as StudentData[], atRiskWarningMap: new Map<string, WarningItem>() };

    const warningMap = new Map<string, WarningItem>();
    const atRisk: StudentData[] = [];
    students.forEach(st => {
      const z = zScore(st.quizStats.averageScore, m, s);
      if (z < -1.5) {
        atRisk.push(st);
        warningMap.set(st.uid, { uid: st.uid, level: z < -2 ? 'danger' : 'caution' });
      }
    });
    atRisk.sort((a, b) => a.quizStats.averageScore - b.quizStats.averageScore);
    return { atRiskStudentList: atRisk, atRiskWarningMap: warningMap };
  }, [students]);

  // 학생 클릭 핸들러
  const handleStudentClick = useCallback(async (uid: string) => {
    const instant = getInstantDetail(uid);
    if (instant) {
      setSelectedStudentDetail(instant);
    } else {
      const basicStudent = studentsRef.current.find(s => s.uid === uid);
      if (!basicStudent) return;
      setSelectedStudentDetail({ ...basicStudent, recentQuizzes: [], recentFeedbacks: [] });
    }
    setDetailOpen(true);

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

  const allStudentsForModal = useMemo(() =>
    students.map(s => ({ uid: s.uid, classId: s.classId, averageScore: s.quizStats.averageScore })),
  [students]);

  // 클러스터 바텀시트용 학생 필터
  const clusterStudentList = useMemo(() => {
    if (!selectedClusterClass || !selectedClusterType || !extraData.clusterData) return [];
    const uids = extraData.clusterData.studentsByCluster[selectedClusterClass]?.[selectedClusterType as keyof ClusterStudentMap] || [];
    const uidSet = new Set(uids);
    return students.filter(s => uidSet.has(s.uid));
  }, [selectedClusterClass, selectedClusterType, extraData.clusterData, students]);

  // 클러스터 warningMap (빈 맵 — 클러스터 바텀시트에서는 경고 불필요)
  const emptyWarningMap = useMemo(() => new Map<string, WarningItem>(), []);

  // 피드백 + 군집 데이터
  useEffect(() => {
    let cancelled = false;

    const loadAllExtraData = async () => {
      const cached = _extraCacheMap.get(courseId);

      // stale-while-revalidate: 만료되었어도 즉시 표시
      if (cached) {
        setExtraData(cached.data);
        if (Date.now() - cached.ts < EXTRA_CACHE_TTL) return;
        // 만료됨 → 백그라운드 갱신 계속
      }

      try {
        const fbSnap = await getDocs(query(collection(db, 'questionFeedbacks'), where('courseId', '==', courseId)));
        if (cancelled) return;

        let rawStudents = getRawStudents(courseId);
        if (!rawStudents) {
          const usersSnap = await getDocs(query(collection(db, 'users'), where('courseId', '==', courseId), where('role', '==', 'student')));
          rawStudents = usersSnap.docs.map(d => {
            const data = d.data();
            return {
              uid: d.id,
              classId: (data.classId || 'A') as string,
              totalExp: data.totalExp || 0,
              profCorrectCount: data.profCorrectCount || 0,
              profAttemptCount: data.profAttemptCount || 0,
              equippedRabbits: Array.isArray(data.equippedRabbits) ? data.equippedRabbits : [],
              lastGachaExp: data.lastGachaExp || 0,
            } as RawStudentData & { uid: string };
          });
        }
        if (cancelled) return;

        // 피드백 분석
        const byType: Record<string, number> = {};
        const aiF: { type: FeedbackType }[] = [];
        const profF: { type: FeedbackType }[] = [];
        const allF: { type: FeedbackType }[] = [];

        fbSnap.docs.forEach(d => {
          const data = d.data();
          const t = data.type as string;
          byType[t] = (byType[t] || 0) + 1;
          allF.push({ type: t as FeedbackType });
          if (data.isAiGenerated) aiF.push({ type: t as FeedbackType });
          else profF.push({ type: t as FeedbackType });
        });

        const feedbackData = {
          byType,
          avgScore: calcFeedbackScore(allF),
          total: allF.length,
          aiAvgScore: calcFeedbackScore(aiF),
          aiCount: aiF.length,
          profAvgScore: calcFeedbackScore(profF),
          profCount: profF.length,
        };

        // 군집 분류
        if (rawStudents.length === 0) {
          const result: ExtraData = {
            feedbackData,
            clusterData: { passionate: 0, hardworking: 0, efficient: 0, atRisk: 0, total: 0, byClass: {}, studentsByCluster: {} },
          };
          _extraCacheMap.set(courseId, { data: result, ts: Date.now() });
          if (!cancelled) setExtraData(result);
          return;
        }

        const rawStudentData = rawStudents.map(s => ({
          uid: (s as RawStudentData & { uid?: string }).uid || '',
          classId: s.classId,
          totalExp: s.totalExp,
          correctRate: s.profCorrectCount
            ? ((s.profCorrectCount / Math.max(s.profAttemptCount || 1, 1)) * 100)
            : 0,
        }));

        const exps = rawStudentData.map(s => s.totalExp).sort((a, b) => a - b);
        const medianExp = exps[Math.floor(exps.length / 2)] || 0;
        const RATE_THRESHOLD = 50;

        let passionate = 0, hardworking = 0, efficient = 0, atRiskCluster = 0;
        const byClass: Record<string, { passionate: number; hardworking: number; efficient: number; atRisk: number }> = {};
        const studentsByCluster: Record<string, ClusterStudentMap> = {};

        rawStudentData.forEach(s => {
          const highExp = s.totalExp >= medianExp && s.totalExp > 0;
          const highRate = s.correctRate >= RATE_THRESHOLD;
          const cls = s.classId;
          if (!byClass[cls]) byClass[cls] = { passionate: 0, hardworking: 0, efficient: 0, atRisk: 0 };
          if (!studentsByCluster[cls]) studentsByCluster[cls] = { passionate: [], hardworking: [], efficient: [], atRisk: [] };

          if (highExp && highRate) { passionate++; byClass[cls].passionate++; studentsByCluster[cls].passionate.push(s.uid); }
          else if (highExp && !highRate) { hardworking++; byClass[cls].hardworking++; studentsByCluster[cls].hardworking.push(s.uid); }
          else if (!highExp && highRate) { efficient++; byClass[cls].efficient++; studentsByCluster[cls].efficient.push(s.uid); }
          else { atRiskCluster++; byClass[cls].atRisk++; studentsByCluster[cls].atRisk.push(s.uid); }
        });

        const clusterData = { passionate, hardworking, efficient, atRisk: atRiskCluster, total: rawStudentData.length, byClass, studentsByCluster };

        const result: ExtraData = { feedbackData, clusterData };
        _extraCacheMap.set(courseId, { data: result, ts: Date.now() });
        if (!cancelled) setExtraData(result);
      } catch (err) {
        console.error('통계 부가 데이터 로드 실패:', err);
      }
    };

    loadAllExtraData();
    return () => { cancelled = true; };
  }, [courseId]);

  // 리포트 월 드롭다운 옵션 생성 (최근 6개월)
  const reportMonthOptions = useMemo(() => {
    const opts: { year: number; month: number; label: string }[] = [];
    const now = new Date();
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      opts.push({ year: d.getFullYear(), month: d.getMonth() + 1, label: `${d.getMonth() + 1}월` });
    }
    return opts;
  }, []);

  // 리포트 가용성 체크 (월 변경 시)
  // 해당 월이 완전히 끝난 후에만 생성 가능
  useEffect(() => {
    let cancelled = false;
    const checkAvailability = async () => {
      setReportCheckLoading(true);
      setReportAvailable(false);
      setExistingReportInsight(null);
      try {
        // 해당 월이 끝났는지 확인 (다음 달 1일 이후여야 함)
        const monthEndDate = new Date(reportYear, reportMonth, 1); // 다음 달 1일
        const now = new Date();
        const monthHasEnded = now >= monthEndDate;

        if (!monthHasEnded) {
          // 월이 아직 안 끝남 → 비활성
          if (!cancelled) {
            setReportAvailable(false);
            setReportCheckLoading(false);
          }
          return;
        }

        const monthLabel = `${reportYear}-${String(reportMonth).padStart(2, '0')}`;

        // 기존 리포트 확인
        const reportDoc = await getDoc(doc(db, 'monthlyReports', courseId, 'months', monthLabel));
        if (reportDoc.exists()) {
          if (!cancelled) {
            setExistingReportInsight(reportDoc.data().insight || '');
            setReportAvailable(true);
          }
          return;
        }

        // weeklyStats 존재 여부 확인
        const nextMonth = reportMonth === 12 ? `${reportYear + 1}-01-01` : `${reportYear}-${String(reportMonth + 1).padStart(2, '0')}-01`;
        const weeksSnap = await getDocs(
          query(
            collection(db, 'weeklyStats', courseId, 'weeks'),
            where('weekStart', '>=', `${reportYear}-${String(reportMonth).padStart(2, '0')}-01`),
            where('weekStart', '<', nextMonth)
          )
        );
        if (!cancelled) {
          setReportAvailable(weeksSnap.docs.length > 0);
        }
      } catch {
        if (!cancelled) setReportAvailable(false);
      } finally {
        if (!cancelled) setReportCheckLoading(false);
      }
    };
    checkAvailability();
    return () => { cancelled = true; };
  }, [courseId, reportYear, reportMonth]);

  // weeklyStats 조회 헬퍼
  const fetchWeeklyStatsForMonth = useCallback(async (year: number, month: number) => {
    const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const weeksSnap = await getDocs(
      query(
        collection(db, 'weeklyStats', courseId, 'weeks'),
        where('weekStart', '>=', `${year}-${String(month).padStart(2, '0')}-01`),
        where('weekStart', '<', nextMonth)
      )
    );
    return weeksSnap.docs.map(d => {
      const wData = d.data();
      return {
        weekLabel: wData.weekLabel || d.id,
        quiz: { newCount: wData.quiz?.newCount || 0, avgCorrectRate: wData.quiz?.avgCorrectRate || 0 },
        feedback: { total: wData.feedback?.total || 0, avgScore: wData.feedback?.avgScore || 0 },
        student: { activeCount: wData.student?.activeCount || 0, totalCount: wData.student?.totalCount || 0, avgExpGain: wData.student?.avgExpGain || 0 },
        board: { postCount: wData.board?.postCount || 0, commentCount: wData.board?.commentCount || 0 },
      };
    });
  }, [courseId]);

  // 리포트 생성/열기
  const handleGenerateReport = useCallback(async () => {
    if (!reportAvailable || reportLoading) return;
    setReportLoading(true);
    setReportError(null);
    try {
      // 기존 리포트가 있으면 바로 열기
      if (existingReportInsight !== null) {
        setReportInsight(existingReportInsight);
        const stats = await fetchWeeklyStatsForMonth(reportYear, reportMonth);
        setReportWeeklyStats(stats);
        setReportSheetOpen(true);
        return;
      }

      // 새 리포트 생성
      const generateReport = httpsCallable(functions, 'generateMonthlyReport');
      const result = await generateReport({ courseId, year: reportYear, month: reportMonth });
      const resultData = result.data as { insight: string; weeklyStatsUsed: string[] };
      setReportInsight(resultData.insight);
      setExistingReportInsight(resultData.insight);

      const stats = await fetchWeeklyStatsForMonth(reportYear, reportMonth);
      setReportWeeklyStats(stats);
      setReportSheetOpen(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '리포트 생성 실패';
      setReportError(msg);
    } finally {
      setReportLoading(false);
    }
  }, [courseId, reportYear, reportMonth, reportAvailable, reportLoading, existingReportInsight, fetchWeeklyStatsForMonth]);

  // 반 클릭 → 클러스터 바텀시트
  const handleClassClick = useCallback((classId: string) => {
    setSelectedClusterClass(classId);
    setSelectedClusterType(null);
    setClusterSheetOpen(true);
  }, []);

  return (
    <div className="min-h-screen pb-24 bg-[#F5F0E8]">
      {/* 리본 헤더 */}
      <header className="flex flex-col items-center">
        <DashboardRibbonHeader
          currentCourseId={courseId}
          onCourseChange={handleCourseChange}
        />
      </header>

      <div className="px-4 space-y-6">
        {/* 리본과 필터 사이 간격 */}
        <div className="pt-2">
          <SourceFilter value={source} onChange={setSource} />
        </div>

        {/* 요약 카드 2개 (가운데 정렬 + 숫자 크게) */}
        {data && (
          <div className="grid grid-cols-3 gap-2.5">
            {/* 참여학생 */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="p-3 border border-[#D4CFC4] flex flex-col items-center justify-center"
            >
              <p className="text-3xl font-black tabular-nums text-[#1A1A1A]">
                {data.totalStudents}
              </p>
              <p className="text-[11px] text-[#5C5C5C] mt-1">참여 학생</p>
            </motion.div>

            {/* 위험학생 */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.05 }}
              className="p-3 border border-[#D4CFC4] cursor-pointer hover:border-[#8B1A1A] transition-colors flex flex-col items-center justify-center"
              onClick={() => setAtRiskSheetOpen(true)}
            >
              <div className="flex items-center gap-1">
                <p className={`text-3xl font-black tabular-nums ${atRiskStudentList.length > 0 ? 'text-[#8B1A1A]' : 'text-[#1A1A1A]'}`}>
                  {atRiskStudentList.length}
                </p>
                {atRiskStudentList.length > 0 && (
                  <svg className="w-3.5 h-3.5 text-[#8B1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                )}
              </div>
              <p className="text-[11px] text-[#5C5C5C] mt-1">위험 학생</p>
            </motion.div>

            {/* 월간 리포트 */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1 }}
              className={`p-3 border transition-colors flex flex-col justify-center items-center relative ${
                reportAvailable && !reportCheckLoading
                  ? 'border-[#D4CFC4] cursor-pointer hover:border-[#1A1A1A]'
                  : 'border-dashed border-[#D4CFC4] bg-[#EBE5D9]/30'
              }`}
              onClick={() => {
                if (reportAvailable && !reportCheckLoading) handleGenerateReport();
              }}
            >
              {reportLoading ? (
                <motion.div
                  className="w-8 h-8 border-2 border-[#1A1A1A] border-t-transparent rounded-full"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                />
              ) : (
                <svg className={`w-8 h-8 ${reportAvailable && !reportCheckLoading ? 'text-[#1A1A1A]' : 'text-[#B0A89A]'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              )}
              {/* 월 드롭다운 + 레포트 라벨 */}
              <div className="flex items-center gap-0.5 mt-1 relative">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setReportMonthDropdownOpen(prev => !prev);
                  }}
                  className={`text-[11px] font-bold flex items-center gap-0.5 ${reportAvailable && !reportCheckLoading ? 'text-[#5C5C5C]' : 'text-[#B0A89A]'}`}
                >
                  {reportMonth}월 레포트
                  <svg className={`w-2.5 h-2.5 transition-transform ${reportMonthDropdownOpen ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>

              {/* 월 선택 드롭다운 */}
              <AnimatePresence>
                {reportMonthDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setReportMonthDropdownOpen(false); }} />
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className="absolute bottom-0 translate-y-full z-20 bg-[#F5F0E8] border border-[#1A1A1A] shadow-lg rounded-lg overflow-hidden"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {reportMonthOptions.map(opt => (
                        <button
                          key={`${opt.year}-${opt.month}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setReportYear(opt.year);
                            setReportMonth(opt.month);
                            setReportMonthDropdownOpen(false);
                          }}
                          className={`w-full px-4 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                            reportYear === opt.year && reportMonth === opt.month
                              ? 'bg-[#1A1A1A] text-[#F5F0E8]'
                              : 'text-[#1A1A1A] hover:bg-[#EBE5D9]'
                          }`}
                        >
                          {opt.year !== new Date().getFullYear() ? `${opt.year}년 ` : ''}{opt.label}
                        </button>
                      ))}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </motion.div>
          </div>
        )}

        {reportError && (
          <p className="text-xs text-[#8B1A1A] border border-[#8B1A1A] p-2">{reportError}</p>
        )}

        {error && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-red-50 border border-[#8B1A1A] p-3">
            <p className="text-sm text-[#8B1A1A] font-bold">{error}</p>
          </motion.div>
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <motion.div
              className="w-10 h-10 border-2 border-[#1A1A1A] border-t-transparent rounded-full"
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            />
            <p className="text-xs text-[#5C5C5C]">데이터 분석 중...</p>
          </div>
        )}

        {data && !loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="space-y-8"
          >
            <ClassComparison classStats={data.classStats} onClassClick={handleClassClick} />
            <ClassProfileRadar courseId={courseId} />
            <StabilityIndex classStats={data.classStats} />
            <RadarChart chapterStats={data.chapterStats} />

            {/* 피드백 분석 */}
            {extraData.feedbackData && extraData.feedbackData.total > 0 && (
              <div className="space-y-3">
                <h3 className="text-lg font-bold text-[#1A1A1A]">피드백 분석</h3>

                <div className="flex items-center justify-between p-3 border border-[#D4CFC4]">
                  <div>
                    <p className="text-xs font-bold text-[#1A1A1A]">평균 피드백 점수</p>
                    <p className="text-[10px] text-[#5C5C5C]">총 {extraData.feedbackData.total}건</p>
                  </div>
                  <p className="text-xl font-black text-[#1A1A1A]">
                    {extraData.feedbackData.avgScore > 0 ? '+' : ''}{extraData.feedbackData.avgScore.toFixed(1)}
                  </p>
                </div>

                <div className="p-3 border border-[#D4CFC4]">
                  <p className="text-xs font-bold text-[#1A1A1A] mb-2">타입별 분포</p>
                  <div className="space-y-1.5">
                    {(['praise', 'wantmore', 'other', 'typo', 'unclear', 'wrong'] as const).map(type => {
                      const count = extraData.feedbackData!.byType[type] || 0;
                      const pct = extraData.feedbackData!.total > 0 ? (count / extraData.feedbackData!.total) * 100 : 0;
                      const label = type === 'praise' ? '좋아요' : type === 'wantmore' ? '더 풀고 싶어요'
                        : type === 'other' ? '기타' : type === 'typo' ? '오타'
                        : type === 'unclear' ? '이해 안 됨' : '정답 틀림';
                      const isPositive = FEEDBACK_SCORES[type] > 0;
                      return (
                        <div key={type} className="flex items-center gap-2">
                          <span className="text-[11px] w-20 text-[#1A1A1A] truncate">{label}</span>
                          <div className="flex-1 h-4 bg-[#EBE5D9] relative">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${pct}%` }}
                              transition={{ duration: 0.6 }}
                              className="h-full"
                              style={{ backgroundColor: isPositive ? '#16a34a' : FEEDBACK_SCORES[type] < 0 ? '#dc2626' : '#6b7280' }}
                            />
                          </div>
                          <span className="text-[10px] text-[#5C5C5C] w-8 text-right">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {(extraData.feedbackData.aiCount > 0 || extraData.feedbackData.profCount > 0) && (
                  <div className="p-3 border border-[#D4CFC4]">
                    <p className="text-xs font-bold text-[#1A1A1A] mb-2">AI 생성 vs 교수 출제</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="text-center p-2 border border-[#D4CFC4]">
                        <p className="text-lg font-black text-[#1A1A1A]">
                          {extraData.feedbackData.profCount > 0 ? (extraData.feedbackData.profAvgScore > 0 ? '+' : '') + extraData.feedbackData.profAvgScore.toFixed(1) : '-'}
                        </p>
                        <p className="text-[10px] text-[#5C5C5C]">교수 ({extraData.feedbackData.profCount}건)</p>
                      </div>
                      <div className="text-center p-2 border border-[#D4CFC4]">
                        <p className="text-lg font-black text-[#1A1A1A]">
                          {extraData.feedbackData.aiCount > 0 ? (extraData.feedbackData.aiAvgScore > 0 ? '+' : '') + extraData.feedbackData.aiAvgScore.toFixed(1) : '-'}
                        </p>
                        <p className="text-[10px] text-[#5C5C5C]">AI ({extraData.feedbackData.aiCount}건)</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}
      </div>

      {/* 위험학생 바텀시트 */}
      <MobileBottomSheet open={atRiskSheetOpen} onClose={() => setAtRiskSheetOpen(false)} maxHeight="80vh">
        <div className="px-4 pb-6">
          {atRiskStudentList.length === 0 ? (
            <p className="text-sm text-[#5C5C5C] text-center py-8">위험 학생이 없습니다</p>
          ) : (
            <StudentListView
              students={atRiskStudentList}
              onStudentClick={handleStudentClick}
              warningMap={atRiskWarningMap}
            />
          )}
        </div>
      </MobileBottomSheet>

      {/* 반별 클러스터 바텀시트 */}
      <MobileBottomSheet
        open={clusterSheetOpen}
        onClose={() => { setClusterSheetOpen(false); setSelectedClusterClass(null); setSelectedClusterType(null); }}
        maxHeight="85vh"
      >
        <div className="px-4 pb-6">
          {selectedClusterClass && (
            <>
              <h3 className="text-base font-bold text-[#1A1A1A] mb-4">{selectedClusterClass}반 학생 군집</h3>

              {extraData.clusterData?.byClass[selectedClusterClass] ? (
                <div className="space-y-4">
                  {/* 군집 카드 4개 */}
                  <div className="grid grid-cols-2 gap-2">
                    {CLUSTER_META.map(cluster => {
                      const classCluster = extraData.clusterData!.byClass[selectedClusterClass];
                      const count = classCluster[cluster.key];
                      const classTotal = Object.values(classCluster).reduce((a, b) => a + b, 0);
                      const pct = classTotal > 0 ? Math.round((count / classTotal) * 100) : 0;
                      const isSelected = selectedClusterType === cluster.key;

                      return (
                        <button
                          key={cluster.key}
                          onClick={() => setSelectedClusterType(isSelected ? null : cluster.key)}
                          className={`p-3 border text-left transition-colors ${
                            isSelected ? 'border-[#1A1A1A] bg-[#EBE5D9]' : 'border-[#D4CFC4]'
                          }`}
                        >
                          <div className="flex items-baseline gap-1.5 mb-1">
                            <span className="text-2xl font-black" style={{ color: cluster.color }}>{count}</span>
                            <span className="text-xs text-[#5C5C5C]">명 ({pct}%)</span>
                          </div>
                          <p className="text-xs font-bold text-[#1A1A1A]">{cluster.label}</p>
                          <p className="text-[9px] text-[#5C5C5C]">{cluster.desc}</p>
                        </button>
                      );
                    })}
                  </div>

                  {/* 선택된 군집의 학생 목록 */}
                  {selectedClusterType && (
                    <div className="mt-2">
                      {clusterStudentList.length === 0 ? (
                        <p className="text-sm text-[#5C5C5C] text-center py-6">해당 군집에 학생이 없습니다</p>
                      ) : (
                        <StudentListView
                          students={clusterStudentList}
                          onStudentClick={handleStudentClick}
                          warningMap={emptyWarningMap}
                        />
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-[#5C5C5C] text-center py-8">데이터 없음</p>
              )}
            </>
          )}
        </div>
      </MobileBottomSheet>

      {/* 학생 상세 모달 */}
      <StudentDetailModal
        student={selectedStudentDetail}
        allStudents={allStudentsForModal}
        isOpen={detailOpen}
        onClose={() => setDetailOpen(false)}
      />

      {/* 리포트 바텀시트 */}
      <MobileBottomSheet open={reportSheetOpen} onClose={() => setReportSheetOpen(false)} maxHeight="80vh">
        <div className="px-4 pb-6">
          <h3 className="text-base font-bold text-[#1A1A1A] mb-4">{reportMonth}월 리포트</h3>
          {reportInsight && (
            <div className="space-y-3">
              <div className="border border-[#D4CFC4] p-3 max-h-60 overflow-y-auto">
                <p className="text-[11px] text-[#1A1A1A] whitespace-pre-wrap leading-relaxed">
                  {reportInsight.slice(0, 800)}
                  {reportInsight.length > 800 && '...'}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const courseName = getCourseList().find(c => c.id === courseId)?.name || courseId;
                    exportToExcel({ courseId, courseName, monthLabel: `${reportYear}-${String(reportMonth).padStart(2, '0')}`, year: reportYear, month: reportMonth, insight: reportInsight!, weeklyStats: reportWeeklyStats });
                  }}
                  className="py-2.5 border-2 border-[#1A1A1A] text-[#1A1A1A] text-xs font-bold"
                >
                  Excel 다운로드
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const courseName = getCourseList().find(c => c.id === courseId)?.name || courseId;
                    exportToWord({ courseId, courseName, monthLabel: `${reportYear}-${String(reportMonth).padStart(2, '0')}`, year: reportYear, month: reportMonth, insight: reportInsight!, weeklyStats: reportWeeklyStats });
                  }}
                  className="py-2.5 border-2 border-[#1A1A1A] text-[#1A1A1A] text-xs font-bold"
                >
                  Word 다운로드
                </button>
              </div>
            </div>
          )}
        </div>
      </MobileBottomSheet>

    </div>
  );
}

// ── 대시보드 리본 헤더 ──
function DashboardRibbonHeader({
  currentCourseId,
  onCourseChange,
}: {
  currentCourseId: CourseId;
  onCourseChange: (courseId: CourseId) => void;
}) {
  const currentIndex = COURSE_IDS.indexOf(currentCourseId);
  const course = COURSES[currentCourseId];
  const ribbonImage = course?.dashboardRibbonImage || '/images/biology-dashboard-ribbon.png';
  const ribbonScale = course?.dashboardRibbonScale || 1;

  const goToPrev = () => {
    const prevIdx = (currentIndex - 1 + COURSE_IDS.length) % COURSE_IDS.length;
    onCourseChange(COURSE_IDS[prevIdx]);
  };
  const goToNext = () => {
    const nextIdx = (currentIndex + 1) % COURSE_IDS.length;
    onCourseChange(COURSE_IDS[nextIdx]);
  };

  const swipeStartX = useRef(0);
  const swipeStartY = useRef(0);
  const swipeDir = useRef<'none' | 'horizontal' | 'vertical'>('none');

  const handleTouchStart = (e: React.TouchEvent) => {
    swipeStartX.current = scaleCoord(e.touches[0].clientX);
    swipeStartY.current = scaleCoord(e.touches[0].clientY);
    swipeDir.current = 'none';
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (swipeDir.current !== 'none') return;
    const dx = Math.abs(scaleCoord(e.touches[0].clientX) - swipeStartX.current);
    const dy = Math.abs(scaleCoord(e.touches[0].clientY) - swipeStartY.current);
    if (dx > 10 || dy > 10) swipeDir.current = dx > dy ? 'horizontal' : 'vertical';
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (swipeDir.current === 'vertical') return;
    const dx = scaleCoord(e.changedTouches[0].clientX) - swipeStartX.current;
    if (Math.abs(dx) > 40) { dx > 0 ? goToPrev() : goToNext(); }
  };

  const mouseStartX = useRef(0);
  const isMouseDragging = useRef(false);
  const handleMouseDown = (e: React.MouseEvent) => { mouseStartX.current = scaleCoord(e.clientX); isMouseDragging.current = true; };
  const handleMouseUp = (e: React.MouseEvent) => {
    if (!isMouseDragging.current) return;
    isMouseDragging.current = false;
    const diff = scaleCoord(e.clientX) - mouseStartX.current;
    if (diff > 40) goToPrev();
    else if (diff < -40) goToNext();
  };

  return (
    <div className="flex flex-col items-center">
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
              alt={course?.name || 'Dashboard'}
              className="w-full h-full object-contain pointer-events-none"
              style={{ transform: `scale(${ribbonScale}) scaleX(1.15)` }}
              draggable={false}
            />
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="flex justify-center gap-2 mt-3">
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
