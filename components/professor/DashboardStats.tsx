'use client';

import { motion } from 'framer-motion';

interface StatItem {
  label: string;
  value: number | string;
  icon: string;
  change?: number; // 전주 대비 변화율
  color: string;
}

interface DashboardStatsProps {
  /** 총 학생 수 */
  totalStudents: number;
  /** 이번 주 참여율 */
  weeklyParticipation: number;
  /** 평균 점수 */
  averageScore: number;
  /** 새 피드백 수 */
  newFeedbacks: number;
}

/**
 * 대시보드 통계 카드 컴포넌트
 */
export default function DashboardStats({
  totalStudents,
  weeklyParticipation,
  averageScore,
  newFeedbacks,
}: DashboardStatsProps) {
  const stats: StatItem[] = [
    {
      label: '총 학생',
      value: totalStudents,
      icon: '👥',
      color: 'from-blue-500 to-blue-600',
    },
    {
      label: '주간 참여율',
      value: `${weeklyParticipation}%`,
      icon: '📊',
      change: 5,
      color: 'from-green-500 to-green-600',
    },
    {
      label: '평균 점수',
      value: averageScore,
      icon: '⭐',
      change: -2,
      color: 'from-yellow-500 to-orange-500',
    },
    {
      label: '새 피드백',
      value: newFeedbacks,
      icon: '💬',
      color: 'from-purple-500 to-purple-600',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3">
      {stats.map((stat, index) => (
        <motion.div
          key={stat.label}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.1 }}
          className={`
            relative overflow-hidden
            bg-gradient-to-br ${stat.color}
            rounded-2xl p-4 text-white
            shadow-lg
          `}
        >
          {/* 배경 아이콘 */}
          <div className="absolute -right-2 -bottom-2 text-5xl opacity-20">
            {stat.icon}
          </div>

          {/* 아이콘 */}
          <div className="text-2xl mb-2">{stat.icon}</div>

          {/* 값 */}
          <div className="text-2xl font-bold mb-1">{stat.value}</div>

          {/* 라벨 및 변화율 */}
          <div className="flex items-center justify-between">
            <span className="text-sm opacity-90">{stat.label}</span>
            {stat.change !== undefined && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                stat.change >= 0 ? 'bg-white/20' : 'bg-red-400/30'
              }`}>
                {stat.change >= 0 ? '↑' : '↓'} {Math.abs(stat.change)}%
              </span>
            )}
          </div>
        </motion.div>
      ))}
    </div>
  );
}
