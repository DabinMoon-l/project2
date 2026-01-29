'use client';

import { motion } from 'framer-motion';
import {
  type ClassStats,
  type ClassType,
  CLASS_COLORS,
} from '@/lib/hooks/useProfessorStudents';

// ============================================================
// 타입 정의
// ============================================================

interface StudentStatsProps {
  /** 반별 통계 */
  classStats: ClassStats[];
  /** 총 학생 수 */
  totalStudents: number;
}

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 학생 통계 요약 컴포넌트
 *
 * 반별 통계와 전체 요약을 표시합니다.
 */
export default function StudentStats({
  classStats,
  totalStudents,
}: StudentStatsProps) {
  // 전체 통계 계산
  const totalActive = classStats.reduce(
    (sum, s) => sum + Math.round((s.studentCount * s.participationRate) / 100),
    0
  );
  const overallAverage =
    classStats.length > 0
      ? Math.round(
          classStats.reduce((sum, s) => sum + s.averageScore, 0) /
            classStats.length
        )
      : 0;

  return (
    <div className="space-y-4">
      {/* 전체 통계 */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-5 text-white"
      >
        <h3 className="font-medium text-white/80 mb-3">전체 현황</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <p className="text-3xl font-bold">{totalStudents}</p>
            <p className="text-sm text-white/70">총 학생</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold">{totalActive}</p>
            <p className="text-sm text-white/70">활동 중</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold">{overallAverage}</p>
            <p className="text-sm text-white/70">평균 점수</p>
          </div>
        </div>
      </motion.div>

      {/* 반별 통계 */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-white rounded-2xl p-4 shadow-sm"
      >
        <h3 className="font-bold text-gray-800 mb-4">반별 현황</h3>

        <div className="space-y-3">
          {classStats.map((stat, index) => {
            const color = CLASS_COLORS[stat.classId];

            return (
              <motion.div
                key={stat.classId}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                className="flex items-center gap-3"
              >
                {/* 반 이름 */}
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold"
                  style={{ backgroundColor: color }}
                >
                  {stat.classId}
                </div>

                {/* 정보 */}
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-gray-700">
                      {stat.classId}반
                      <span className="text-gray-400 font-normal ml-1">
                        ({stat.studentCount}명)
                      </span>
                    </span>
                    <span className="text-sm font-medium text-gray-600">
                      평균 {stat.averageScore}점
                    </span>
                  </div>

                  {/* 참여율 바 */}
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${stat.participationRate}%` }}
                      transition={{ duration: 0.5, delay: index * 0.1 }}
                      className="h-full rounded-full"
                      style={{ backgroundColor: color }}
                    />
                  </div>

                  {/* 참여율 텍스트 */}
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-gray-400">
                      참여율 {stat.participationRate}%
                    </span>
                    {stat.topStudent && (
                      <span className="text-xs text-amber-600">
                        1등: {stat.topStudent.nickname} ({stat.topStudent.score}점)
                      </span>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* 빈 상태 */}
        {classStats.every((s) => s.studentCount === 0) && (
          <p className="text-center text-gray-400 py-4">
            아직 데이터가 없습니다
          </p>
        )}
      </motion.div>
    </div>
  );
}
