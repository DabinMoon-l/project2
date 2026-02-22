'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Header } from '@/components/common';
import { useCourse } from '@/lib/contexts';
import { useProfessorStats, type QuestionSource, type DispersionMode } from '@/lib/hooks/useProfessorStats';
import { calcFeedbackScore, FEEDBACK_SCORES } from '@/lib/utils/feedbackScore';
import { exportToExcel, exportToWord, type ReportData, type WeeklyStatSummary } from '@/lib/utils/reportExport';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import type { FeedbackType } from '@/components/quiz/InstantFeedbackButton';
import type { CourseId } from '@/lib/types/course';
import { getCourseList } from '@/lib/types/course';

import SubjectFilter from '@/components/professor/stats/SubjectFilter';
import SourceFilter from '@/components/professor/stats/SourceFilter';
import DispersionToggle from '@/components/professor/stats/DispersionToggle';
import ClassComparison from '@/components/professor/stats/ClassComparison';
import WeeklyTrend from '@/components/professor/stats/WeeklyTrend';
import StabilityIndex from '@/components/professor/stats/StabilityIndex';
import RadarChart from '@/components/professor/stats/RadarChart';
import ChapterTable from '@/components/professor/stats/ChapterTable';
import AIDifficultyAnalysis from '@/components/professor/stats/AIDifficultyAnalysis';
import ClassSummaryTable from '@/components/professor/stats/ClassSummaryTable';

function SummaryCard({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex-1 bg-[#FDFBF7] border border-[#D4CFC4] p-3 shadow-[2px_2px_0px_#D4CFC4]"
    >
      <p className={`text-xl font-bold tabular-nums ${accent ? 'text-[#1D5D4A]' : 'text-[#1A1A1A]'}`}>
        {value}
      </p>
      <p className="text-[10px] text-[#5C5C5C] mt-0.5">{label}</p>
    </motion.div>
  );
}

export default function ProfessorStatsPage() {
  const { userCourseId } = useCourse();
  const { data, loading, error, fetchStats } = useProfessorStats();

  const [courseId, setCourseId] = useState<CourseId>(userCourseId || 'biology');
  const [source, setSource] = useState<QuestionSource>('professor');
  const [dispersion, setDispersion] = useState<DispersionMode>('sd');

  // 리포트 상태
  const [reportLoading, setReportLoading] = useState(false);
  const [reportInsight, setReportInsight] = useState<string | null>(null);
  const [reportWeeklyStats, setReportWeeklyStats] = useState<WeeklyStatSummary[]>([]);
  const [reportError, setReportError] = useState<string | null>(null);

  // 피드백 분석 데이터
  const [feedbackData, setFeedbackData] = useState<{
    byType: Record<string, number>;
    avgScore: number;
    total: number;
    aiAvgScore: number;
    aiCount: number;
    profAvgScore: number;
    profCount: number;
  } | null>(null);

  // 참여도 군집 데이터
  const [clusterData, setClusterData] = useState<{
    passionate: number;   // 높은 참여 + 높은 성취
    hardworking: number;  // 높은 참여 + 낮은 성취
    efficient: number;    // 낮은 참여 + 높은 성취
    atRisk: number;       // 낮은 참여 + 낮은 성취
    total: number;
  } | null>(null);

  // 게이미피케이션 데이터
  const [gamificationData, setGamificationData] = useState<{
    avgRabbits: number;
    avgMilestones: number;
    totalStudents: number;
  } | null>(null);

  // 초기 + 필터 변경 시 데이터 조회
  useEffect(() => {
    fetchStats(courseId, source);
  }, [courseId, source, fetchStats]);

  // 피드백 분석 데이터 로드
  useEffect(() => {
    const loadFeedbackAnalysis = async () => {
      try {
        // 해당 과목의 피드백 조회
        const fbQ = query(
          collection(db, 'questionFeedbacks'),
          where('courseId', '==', courseId)
        );
        const fbSnap = await getDocs(fbQ);

        const byType: Record<string, number> = {};
        const aiF: { type: FeedbackType }[] = [];
        const profF: { type: FeedbackType }[] = [];
        const allF: { type: FeedbackType }[] = [];

        fbSnap.docs.forEach(d => {
          const data = d.data();
          const t = data.type as string;
          byType[t] = (byType[t] || 0) + 1;
          allF.push({ type: t as FeedbackType });

          // AI vs 교수 분리 (quizCreatorId가 없거나 isAiGenerated인 경우 AI)
          if (data.isAiGenerated) {
            aiF.push({ type: t as FeedbackType });
          } else {
            profF.push({ type: t as FeedbackType });
          }
        });

        setFeedbackData({
          byType,
          avgScore: calcFeedbackScore(allF),
          total: allF.length,
          aiAvgScore: calcFeedbackScore(aiF),
          aiCount: aiF.length,
          profAvgScore: calcFeedbackScore(profF),
          profCount: profF.length,
        });
      } catch (err) {
        console.error('피드백 분석 로드 실패:', err);
      }
    };

    loadFeedbackAnalysis();
  }, [courseId]);

  // 참여도 군집 + 게이미피케이션 데이터 로드
  useEffect(() => {
    const loadStudentClusters = async () => {
      try {
        const usersQ = query(
          collection(db, 'users'),
          where('courseId', '==', courseId),
          where('role', '==', 'student')
        );
        const usersSnap = await getDocs(usersQ);

        if (usersSnap.empty) {
          setClusterData({ passionate: 0, hardworking: 0, efficient: 0, atRisk: 0, total: 0 });
          setGamificationData({ avgRabbits: 0, avgMilestones: 0, totalStudents: 0 });
          return;
        }

        const students = usersSnap.docs.map(d => {
          const data = d.data();
          return {
            totalExp: data.totalExp || 0,
            correctRate: data.profCorrectCount
              ? ((data.profCorrectCount / Math.max(data.profAttemptCount || 1, 1)) * 100)
              : 0,
            rabbitCount: Array.isArray(data.equippedRabbits) ? data.equippedRabbits.length : 0,
            lastGachaExp: data.lastGachaExp || 0,
          };
        });

        // 중위값 계산
        const exps = students.map(s => s.totalExp).sort((a, b) => a - b);
        const rates = students.map(s => s.correctRate).sort((a, b) => a - b);
        const medianExp = exps[Math.floor(exps.length / 2)] || 0;
        const medianRate = rates[Math.floor(rates.length / 2)] || 0;

        let passionate = 0, hardworking = 0, efficient = 0, atRisk = 0;
        students.forEach(s => {
          const highExp = s.totalExp >= medianExp;
          const highRate = s.correctRate >= medianRate;
          if (highExp && highRate) passionate++;
          else if (highExp && !highRate) hardworking++;
          else if (!highExp && highRate) efficient++;
          else atRisk++;
        });

        setClusterData({ passionate, hardworking, efficient, atRisk, total: students.length });

        // 게이미피케이션
        const totalRabbits = students.reduce((s, st) => s + st.rabbitCount, 0);
        const totalMilestones = students.reduce((s, st) => s + Math.floor(st.lastGachaExp / 50), 0);
        setGamificationData({
          avgRabbits: students.length > 0 ? Math.round((totalRabbits / students.length) * 10) / 10 : 0,
          avgMilestones: students.length > 0 ? Math.round((totalMilestones / students.length) * 10) / 10 : 0,
          totalStudents: students.length,
        });
      } catch (err) {
        console.error('군집 데이터 로드 실패:', err);
      }
    };

    loadStudentClusters();
  }, [courseId]);

  return (
    <div className="min-h-screen bg-[#F5F0E8] pb-24">
      <Header title="통계" />

      <div className="px-4 py-3 space-y-4">
        {/* 필터 영역 */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-3"
        >
          {/* 과목 선택 */}
          <SubjectFilter value={courseId} onChange={setCourseId} />

          {/* 문제 출처 + 산포도 모드 */}
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[10px] text-[#5C5C5C] mb-1.5 font-bold uppercase tracking-wider">출처</p>
              <SourceFilter value={source} onChange={setSource} />
            </div>
            <div>
              <p className="text-[10px] text-[#5C5C5C] mb-1.5 font-bold uppercase tracking-wider">산포도</p>
              <DispersionToggle value={dispersion} onChange={setDispersion} />
            </div>
          </div>
        </motion.div>

        {/* 요약 카드 */}
        {data && (
          <div className="flex gap-2.5">
            <SummaryCard value={String(data.totalStudents)} label="참여 학생" />
            <SummaryCard value={String(data.totalAttempts)} label="총 시도" />
            <SummaryCard
              value={data.professorMean > 0 ? data.professorMean.toFixed(1) : '-'}
              label="교수 문제 평균"
              accent
            />
          </div>
        )}

        {/* 에러 */}
        {error && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-red-50 border border-[#8B1A1A] p-3 shadow-[2px_2px_0px_#D4A5A5]"
          >
            <p className="text-sm text-[#8B1A1A] font-bold">{error}</p>
          </motion.div>
        )}

        {/* 로딩 */}
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

        {/* 데이터 시각화 */}
        {data && !loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="space-y-4"
          >
            {/* A) 반별 비교 */}
            <ClassComparison classStats={data.classStats} mode={dispersion} />

            {/* B) 주간 트렌드 */}
            <WeeklyTrend weeklyTrend={data.weeklyTrend} mode={dispersion} />

            {/* C) 안정성 지표 */}
            <StabilityIndex classStats={data.classStats} />

            {/* D) 이해도 레이더 */}
            <RadarChart chapterStats={data.chapterStats} />

            {/* E) 챕터/소주제 분석 */}
            <ChapterTable chapterStats={data.chapterStats} />

            {/* F) AI 난이도 분석 */}
            <AIDifficultyAnalysis
              aiDifficultyStats={data.aiDifficultyStats}
              professorMean={data.professorMean}
            />

            {/* 반별 요약 */}
            <ClassSummaryTable classStats={data.classStats} />

            {/* ── 피드백 분석 ── */}
            {feedbackData && feedbackData.total > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-[#1A1A1A]" />
                  <h2 className="font-serif-display text-sm font-bold text-[#1A1A1A]">FEEDBACK ANALYSIS</h2>
                  <div className="flex-1 h-px bg-[#1A1A1A]" />
                </div>

                {/* 피드백 평균 점수 */}
                <div className="bg-[#FDFBF7] border border-[#D4CFC4] p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-bold text-[#1A1A1A]">평균 피드백 점수</p>
                    <p className="text-xl font-black text-[#1A1A1A]">
                      {feedbackData.avgScore > 0 ? '+' : ''}{feedbackData.avgScore.toFixed(1)}
                    </p>
                  </div>
                  <p className="text-[10px] text-[#5C5C5C]">총 {feedbackData.total}건</p>
                </div>

                {/* 타입별 분포 */}
                <div className="bg-[#FDFBF7] border border-[#D4CFC4] p-3">
                  <p className="text-xs font-bold text-[#1A1A1A] mb-2">타입별 분포</p>
                  <div className="space-y-1.5">
                    {(['praise', 'wantmore', 'other', 'typo', 'unclear', 'wrong'] as const).map(type => {
                      const count = feedbackData.byType[type] || 0;
                      const pct = feedbackData.total > 0 ? (count / feedbackData.total) * 100 : 0;
                      const label = type === 'praise' ? '좋아요' : type === 'wantmore' ? '더 풀고 싶어요'
                        : type === 'other' ? '기타' : type === 'typo' ? '오타'
                        : type === 'unclear' ? '이해 안 됨' : '정답 틀림';
                      const isPositive = FEEDBACK_SCORES[type] > 0;
                      return (
                        <div key={type} className="flex items-center gap-2">
                          <span className="text-[11px] w-20 text-[#1A1A1A] truncate">{label}</span>
                          <div className="flex-1 h-4 bg-[#EDEAE4] relative">
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

                {/* AI vs 교수 비교 */}
                {(feedbackData.aiCount > 0 || feedbackData.profCount > 0) && (
                  <div className="bg-[#FDFBF7] border border-[#D4CFC4] p-3">
                    <p className="text-xs font-bold text-[#1A1A1A] mb-2">AI 생성 vs 교수 출제</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="text-center p-2 border border-[#D4CFC4]">
                        <p className="text-lg font-black text-[#1A1A1A]">
                          {feedbackData.profCount > 0 ? (feedbackData.profAvgScore > 0 ? '+' : '') + feedbackData.profAvgScore.toFixed(1) : '-'}
                        </p>
                        <p className="text-[10px] text-[#5C5C5C]">교수 ({feedbackData.profCount}건)</p>
                      </div>
                      <div className="text-center p-2 border border-[#D4CFC4]">
                        <p className="text-lg font-black text-[#1A1A1A]">
                          {feedbackData.aiCount > 0 ? (feedbackData.aiAvgScore > 0 ? '+' : '') + feedbackData.aiAvgScore.toFixed(1) : '-'}
                        </p>
                        <p className="text-[10px] text-[#5C5C5C]">AI ({feedbackData.aiCount}건)</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── 참여도 군집 요약 ── */}
            {clusterData && clusterData.total > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-[#1A1A1A]" />
                  <h2 className="font-serif-display text-sm font-bold text-[#1A1A1A]">STUDENT CLUSTERS</h2>
                  <div className="flex-1 h-px bg-[#1A1A1A]" />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: '열정적 학습자', count: clusterData.passionate, color: '#16a34a', desc: '높은 참여 + 높은 성취' },
                    { label: '노력형 학습자', count: clusterData.hardworking, color: '#B8860B', desc: '높은 참여 + 낮은 성취' },
                    { label: '효율형 학습자', count: clusterData.efficient, color: '#1E3A5F', desc: '낮은 참여 + 높은 성취' },
                    { label: '이탈 위험군', count: clusterData.atRisk, color: '#8B1A1A', desc: '낮은 참여 + 낮은 성취' },
                  ].map(cluster => {
                    const pct = clusterData.total > 0 ? Math.round((cluster.count / clusterData.total) * 100) : 0;
                    return (
                      <div key={cluster.label} className="bg-[#FDFBF7] border border-[#D4CFC4] p-3">
                        <div className="flex items-baseline gap-1 mb-1">
                          <span className="text-xl font-black" style={{ color: cluster.color }}>{cluster.count}</span>
                          <span className="text-[10px] text-[#5C5C5C]">명 ({pct}%)</span>
                        </div>
                        <p className="text-xs font-bold text-[#1A1A1A]">{cluster.label}</p>
                        <p className="text-[9px] text-[#5C5C5C]">{cluster.desc}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── 게이미피케이션 효과 ── */}
            {gamificationData && gamificationData.totalStudents > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-[#1A1A1A]" />
                  <h2 className="font-serif-display text-sm font-bold text-[#1A1A1A]">GAMIFICATION</h2>
                  <div className="flex-1 h-px bg-[#1A1A1A]" />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-[#FDFBF7] border border-[#D4CFC4] p-3 text-center">
                    <p className="text-2xl font-black text-[#1A1A1A]">{gamificationData.avgRabbits}</p>
                    <p className="text-[10px] text-[#5C5C5C] mt-1">평균 토끼 장착 수</p>
                  </div>
                  <div className="bg-[#FDFBF7] border border-[#D4CFC4] p-3 text-center">
                    <p className="text-2xl font-black text-[#1A1A1A]">{gamificationData.avgMilestones}</p>
                    <p className="text-[10px] text-[#5C5C5C] mt-1">평균 마일스톤 달성</p>
                  </div>
                </div>
              </div>
            )}

            {/* ── 월별 리포트 다운로드 ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-[#1A1A1A]" />
                <h2 className="font-serif-display text-sm font-bold text-[#1A1A1A]">MONTHLY REPORT</h2>
                <div className="flex-1 h-px bg-[#1A1A1A]" />
              </div>

              <div className="bg-[#FDFBF7] border border-[#D4CFC4] p-4 space-y-3">
                <p className="text-xs text-[#5C5C5C]">
                  월별 수집 데이터를 기반으로 Claude AI 분석 리포트를 생성합니다.
                </p>

                {reportError && (
                  <p className="text-xs text-[#8B1A1A] border border-[#8B1A1A] p-2">{reportError}</p>
                )}

                {/* 리포트 생성 버튼 */}
                <button
                  type="button"
                  disabled={reportLoading}
                  onClick={async () => {
                    setReportLoading(true);
                    setReportError(null);
                    try {
                      const now = new Date();
                      const year = now.getFullYear();
                      const month = now.getMonth() + 1;

                      const generateReport = httpsCallable(functions, 'generateMonthlyReport');
                      const result = await generateReport({ courseId, year, month });
                      const resultData = result.data as { insight: string; weeklyStatsUsed: string[] };
                      setReportInsight(resultData.insight);

                      // weeklyStats 로드 (간략 요약용)
                      const weeksSnap = await getDocs(
                        query(
                          collection(db, 'weeklyStats', courseId, 'weeks'),
                          where('weekStart', '>=', `${year}-${String(month).padStart(2, '0')}-01`),
                          where('weekStart', '<', month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`)
                        )
                      );
                      const stats: WeeklyStatSummary[] = weeksSnap.docs.map(d => {
                        const data = d.data();
                        return {
                          weekLabel: data.weekLabel || d.id,
                          quiz: { newCount: data.quiz?.newCount || 0, avgCorrectRate: data.quiz?.avgCorrectRate || 0 },
                          feedback: { total: data.feedback?.total || 0, avgScore: data.feedback?.avgScore || 0 },
                          student: { activeCount: data.student?.activeCount || 0, totalCount: data.student?.totalCount || 0, avgExpGain: data.student?.avgExpGain || 0 },
                          board: { postCount: data.board?.postCount || 0, commentCount: data.board?.commentCount || 0 },
                        };
                      });
                      setReportWeeklyStats(stats);
                    } catch (err) {
                      const msg = err instanceof Error ? err.message : '리포트 생성 실패';
                      setReportError(msg);
                    } finally {
                      setReportLoading(false);
                    }
                  }}
                  className="w-full py-3 border-2 border-[#1A1A1A] bg-[#1A1A1A] text-white text-sm font-bold disabled:opacity-50"
                >
                  {reportLoading ? '분석 중...' : '이번 달 리포트 생성'}
                </button>

                {/* 인사이트 미리보기 + 다운로드 */}
                {reportInsight && (
                  <div className="space-y-3">
                    <div className="border border-[#D4CFC4] bg-white p-3 max-h-60 overflow-y-auto">
                      <p className="text-[11px] text-[#1A1A1A] whitespace-pre-wrap leading-relaxed">
                        {reportInsight.slice(0, 500)}
                        {reportInsight.length > 500 && '...'}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const courseName = getCourseList().find(c => c.id === courseId)?.name || courseId;
                          const now = new Date();
                          exportToExcel({
                            courseId,
                            courseName,
                            monthLabel: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
                            year: now.getFullYear(),
                            month: now.getMonth() + 1,
                            insight: reportInsight,
                            weeklyStats: reportWeeklyStats,
                          });
                        }}
                        className="py-2 border border-[#1A1A1A] text-[#1A1A1A] text-xs font-bold"
                      >
                        Excel 다운로드
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const courseName = getCourseList().find(c => c.id === courseId)?.name || courseId;
                          const now = new Date();
                          exportToWord({
                            courseId,
                            courseName,
                            monthLabel: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
                            year: now.getFullYear(),
                            month: now.getMonth() + 1,
                            insight: reportInsight,
                            weeklyStats: reportWeeklyStats,
                          });
                        }}
                        className="py-2 border border-[#1A1A1A] text-[#1A1A1A] text-xs font-bold"
                      >
                        Word 다운로드
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
