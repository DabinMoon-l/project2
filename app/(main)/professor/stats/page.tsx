'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Header } from '@/components/common';
import { useCourse } from '@/lib/contexts';
import { useProfessorStats, type QuestionSource, type DispersionMode } from '@/lib/hooks/useProfessorStats';
import type { CourseId } from '@/lib/types/course';

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

  // 초기 + 필터 변경 시 데이터 조회
  useEffect(() => {
    fetchStats(courseId, source);
  }, [courseId, source, fetchStats]);

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
          </motion.div>
        )}
      </div>
    </div>
  );
}
