'use client';

import { motion } from 'framer-motion';
import { type OverallAnalysisSummary } from '@/lib/hooks/useProfessorAnalysis';

// ============================================================
// 타입 정의
// ============================================================

interface DifficultyChartProps {
  /** 전체 분석 요약 */
  summary: OverallAnalysisSummary;
}

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 난이도 분포 차트 컴포넌트
 *
 * 문제 유형별, 난이도별 분포를 시각화합니다.
 */
export default function DifficultyChart({ summary }: DifficultyChartProps) {
  const { difficultyDistribution, typeDistribution, totalQuestions } = summary;

  // 난이도 설정
  const difficultyData = [
    {
      key: 'easy',
      label: '쉬움',
      count: difficultyDistribution.easy,
      color: 'bg-green-500',
      bgColor: 'bg-green-100',
      textColor: 'text-green-700',
    },
    {
      key: 'normal',
      label: '보통',
      count: difficultyDistribution.normal,
      color: 'bg-yellow-500',
      bgColor: 'bg-yellow-100',
      textColor: 'text-yellow-700',
    },
    {
      key: 'hard',
      label: '어려움',
      count: difficultyDistribution.hard,
      color: 'bg-red-500',
      bgColor: 'bg-red-100',
      textColor: 'text-red-700',
    },
  ];

  // 문제 유형 설정
  const typeData = [
    {
      key: 'ox',
      label: 'OX',
      count: typeDistribution.ox,
      color: 'bg-blue-500',
      bgColor: 'bg-blue-100',
      textColor: 'text-blue-700',
    },
    {
      key: 'multiple',
      label: '객관식',
      count: typeDistribution.multiple,
      color: 'bg-purple-500',
      bgColor: 'bg-purple-100',
      textColor: 'text-purple-700',
    },
    {
      key: 'subjective',
      label: '주관식',
      count: typeDistribution.subjective,
      color: 'bg-teal-500',
      bgColor: 'bg-teal-100',
      textColor: 'text-teal-700',
    },
  ];

  // 퍼센트 계산
  const getPercentage = (count: number) => {
    if (totalQuestions === 0) return 0;
    return Math.round((count / totalQuestions) * 100);
  };

  return (
    <div className="space-y-4">
      {/* 난이도 분포 */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-2xl p-4 shadow-sm"
      >
        <h3 className="font-bold text-gray-800 mb-4">난이도 분포</h3>

        {/* 가로 바 차트 */}
        <div className="space-y-3">
          {difficultyData.map((item, index) => (
            <motion.div
              key={item.key}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className={`w-3 h-3 rounded-full ${item.color}`} />
                  <span className={`text-sm font-medium ${item.textColor}`}>
                    {item.label}
                  </span>
                </div>
                <span className="text-sm text-gray-600">
                  {item.count}문제 ({getPercentage(item.count)}%)
                </span>
              </div>
              <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${getPercentage(item.count)}%` }}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                  className={`h-full rounded-full ${item.color}`}
                />
              </div>
            </motion.div>
          ))}
        </div>

        {/* 빈 상태 */}
        {totalQuestions === 0 && (
          <p className="text-center text-gray-400 py-4">데이터가 없습니다</p>
        )}
      </motion.div>

      {/* 문제 유형 분포 */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-white rounded-2xl p-4 shadow-sm"
      >
        <h3 className="font-bold text-gray-800 mb-4">문제 유형 분포</h3>

        {/* 원형 카드 */}
        <div className="grid grid-cols-3 gap-3">
          {typeData.map((item, index) => (
            <motion.div
              key={item.key}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3 + index * 0.1 }}
              className={`${item.bgColor} rounded-xl p-3 text-center`}
            >
              {/* 원형 진행률 */}
              <div className="relative w-16 h-16 mx-auto mb-2">
                <svg className="w-full h-full transform -rotate-90">
                  <circle
                    cx="32"
                    cy="32"
                    r="28"
                    stroke="currentColor"
                    strokeWidth="6"
                    fill="none"
                    className="text-gray-200"
                  />
                  <circle
                    cx="32"
                    cy="32"
                    r="28"
                    stroke="currentColor"
                    strokeWidth="6"
                    fill="none"
                    strokeLinecap="round"
                    className={item.textColor}
                    strokeDasharray={`${getPercentage(item.count) * 1.76} 176`}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className={`text-sm font-bold ${item.textColor}`}>
                    {getPercentage(item.count)}%
                  </span>
                </div>
              </div>

              <p className={`text-sm font-medium ${item.textColor}`}>
                {item.label}
              </p>
              <p className="text-xs text-gray-500">{item.count}문제</p>
            </motion.div>
          ))}
        </div>

        {/* 빈 상태 */}
        {totalQuestions === 0 && (
          <p className="text-center text-gray-400 py-4">데이터가 없습니다</p>
        )}
      </motion.div>
    </div>
  );
}
