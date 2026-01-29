'use client';

import { motion } from 'framer-motion';

/**
 * 반 정보 타입
 */
export interface ClassRanking {
  /** 반 이름 (A, B, C, D) */
  className: 'A' | 'B' | 'C' | 'D';
  /** 참여율 (0-100) */
  participationRate: number;
  /** 총 학생 수 */
  totalStudents: number;
  /** 참여 학생 수 */
  participatedStudents: number;
}

interface ClassRankingBarProps {
  /** 반별 참여도 데이터 */
  rankings: ClassRanking[];
  /** 현재 사용자의 반 */
  userClass?: 'A' | 'B' | 'C' | 'D';
  /** 로딩 상태 */
  isLoading?: boolean;
  /** 추가 클래스명 */
  className?: string;
}

// 반별 테마 색상 (CLAUDE.md 참조)
const classColors: Record<'A' | 'B' | 'C' | 'D', { bg: string; accent: string; text: string }> = {
  A: {
    bg: 'bg-red-900/20',
    accent: 'from-red-900 to-amber-500',
    text: 'text-red-900',
  },
  B: {
    bg: 'bg-amber-100',
    accent: 'from-amber-600 to-amber-400',
    text: 'text-amber-800',
  },
  C: {
    bg: 'bg-emerald-900/20',
    accent: 'from-emerald-800 to-gray-400',
    text: 'text-emerald-900',
  },
  D: {
    bg: 'bg-blue-900/20',
    accent: 'from-blue-900 to-orange-600',
    text: 'text-blue-900',
  },
};

/**
 * 반 참여도 순위 바 컴포넌트
 *
 * A, B, C, D반의 퀴즈 참여율을 프로그레스 바로 비교합니다.
 * 현재 사용자의 반은 강조 표시됩니다.
 *
 * @example
 * ```tsx
 * <ClassRankingBar
 *   rankings={[
 *     { className: 'A', participationRate: 85, totalStudents: 30, participatedStudents: 25 },
 *     { className: 'B', participationRate: 72, totalStudents: 28, participatedStudents: 20 },
 *     { className: 'C', participationRate: 90, totalStudents: 32, participatedStudents: 29 },
 *     { className: 'D', participationRate: 68, totalStudents: 25, participatedStudents: 17 },
 *   ]}
 *   userClass="A"
 * />
 * ```
 */
export default function ClassRankingBar({
  rankings,
  userClass,
  isLoading = false,
  className = '',
}: ClassRankingBarProps) {
  // 참여율 기준으로 정렬
  const sortedRankings = [...rankings].sort(
    (a, b) => b.participationRate - a.participationRate
  );

  // 최고 참여율 (프로그레스 바 비율 계산용)
  const maxRate = Math.max(...rankings.map((r) => r.participationRate), 1);

  // 로딩 상태
  if (isLoading) {
    return (
      <div className={`bg-white rounded-2xl p-4 shadow-sm ${className}`}>
        <div className="h-6 w-40 bg-gray-200 rounded animate-pulse mb-4" />
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gray-200 rounded-full animate-pulse" />
              <div className="flex-1 h-6 bg-gray-200 rounded-full animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 데이터가 없는 경우
  if (rankings.length === 0) {
    return (
      <div className={`bg-white rounded-2xl p-4 shadow-sm ${className}`}>
        <h3 className="text-lg font-bold text-gray-900 mb-4">반 참여도 순위</h3>
        <p className="text-center text-gray-500 py-4">
          참여도 데이터가 없습니다.
        </p>
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-2xl p-4 shadow-sm ${className}`}>
      {/* 섹션 타이틀 */}
      <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
        <span className="text-xl">🏆</span>
        반 참여도 순위
      </h3>

      {/* 순위 바 목록 */}
      <div className="space-y-3">
        {sortedRankings.map((ranking, index) => {
          const colors = classColors[ranking.className];
          const isUserClass = userClass === ranking.className;
          const widthPercent = (ranking.participationRate / maxRate) * 100;

          return (
            <motion.div
              key={ranking.className}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
              className={`
                flex items-center gap-3 p-2 rounded-xl transition-all
                ${isUserClass ? 'ring-2 ring-theme-accent ring-offset-1' : ''}
              `}
            >
              {/* 순위 번호 */}
              <div
                className={`
                  w-6 h-6 rounded-full flex items-center justify-center
                  text-xs font-bold
                  ${index === 0 ? 'bg-yellow-400 text-yellow-900' : 'bg-gray-200 text-gray-600'}
                `}
              >
                {index + 1}
              </div>

              {/* 반 라벨 */}
              <div
                className={`
                  w-8 h-8 rounded-full flex items-center justify-center
                  font-bold text-sm ${colors.bg} ${colors.text}
                `}
              >
                {ranking.className}
              </div>

              {/* 프로그레스 바 */}
              <div className="flex-1 relative">
                <div className="h-6 bg-gray-100 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${widthPercent}%` }}
                    transition={{
                      duration: 0.8,
                      delay: index * 0.1,
                      ease: 'easeOut',
                    }}
                    className={`h-full bg-gradient-to-r ${colors.accent} rounded-full`}
                  />
                </div>

                {/* 참여율 텍스트 */}
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5 + index * 0.1 }}
                  className={`
                    absolute right-2 top-1/2 -translate-y-1/2
                    text-xs font-semibold
                    ${widthPercent > 50 ? 'text-white' : 'text-gray-700'}
                  `}
                >
                  {ranking.participationRate}%
                </motion.span>
              </div>

              {/* 참여 인원 */}
              <span className="text-xs text-gray-500 whitespace-nowrap">
                {ranking.participatedStudents}/{ranking.totalStudents}
              </span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
