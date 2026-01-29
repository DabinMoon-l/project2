'use client';

import { motion } from 'framer-motion';
import { useTheme } from '@/styles/themes/useTheme';
import { type UserProfile } from '@/lib/hooks/useProfile';

// ============================================================
// 타입 정의
// ============================================================

interface StatsSummaryProps {
  /** 사용자 프로필 */
  profile: UserProfile;
}

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 통계 요약 컴포넌트
 *
 * 퀴즈 통계, 피드백 통계, 뱃지를 표시합니다.
 */
export default function StatsSummary({ profile }: StatsSummaryProps) {
  const { theme } = useTheme();

  // 정답률 계산
  const totalAnswers = profile.correctAnswers + profile.wrongAnswers;
  const correctRate =
    totalAnswers > 0
      ? Math.round((profile.correctAnswers / totalAnswers) * 100)
      : 0;

  // 피드백 채택률 계산
  const feedbackRate =
    profile.totalFeedbacks > 0
      ? Math.round((profile.helpfulFeedbacks / profile.totalFeedbacks) * 100)
      : 0;

  const stats = [
    {
      label: '풀이한 퀴즈',
      value: profile.totalQuizzes,
      icon: '📝',
      suffix: '개',
    },
    {
      label: '정답률',
      value: correctRate,
      icon: '🎯',
      suffix: '%',
      color: correctRate >= 70 ? '#22C55E' : correctRate >= 40 ? '#F59E0B' : '#EF4444',
    },
    {
      label: '평균 점수',
      value: profile.averageScore,
      icon: '📊',
      suffix: '점',
    },
    {
      label: '참여율',
      value: profile.participationRate,
      icon: '🏃',
      suffix: '%',
      color: profile.participationRate >= 60 ? '#22C55E' : '#F59E0B',
    },
    {
      label: '제출한 피드백',
      value: profile.totalFeedbacks,
      icon: '💬',
      suffix: '개',
    },
    {
      label: '피드백 채택률',
      value: feedbackRate,
      icon: '👍',
      suffix: '%',
      color: feedbackRate >= 50 ? '#22C55E' : '#6B7280',
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="space-y-4"
    >
      {/* 퀴즈 통계 */}
      <div
        className="rounded-2xl p-4"
        style={{
          backgroundColor: theme.colors.backgroundSecondary,
          border: `1px solid ${theme.colors.border}`,
        }}
      >
        <h3
          className="font-bold mb-4"
          style={{ color: theme.colors.text }}
        >
          퀴즈 통계
        </h3>

        <div className="grid grid-cols-2 gap-3">
          {stats.slice(0, 4).map((stat, index) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="p-3 rounded-xl text-center"
              style={{ backgroundColor: `${theme.colors.accent}10` }}
            >
              <span className="text-2xl mb-1 block">{stat.icon}</span>
              <p
                className="text-xl font-bold"
                style={{ color: stat.color || theme.colors.text }}
              >
                {stat.value}
                <span className="text-sm font-normal">{stat.suffix}</span>
              </p>
              <p
                className="text-xs mt-1"
                style={{ color: theme.colors.textSecondary }}
              >
                {stat.label}
              </p>
            </motion.div>
          ))}
        </div>

        {/* 정답/오답 막대 그래프 */}
        <div className="mt-4">
          <div className="flex justify-between text-sm mb-2">
            <span style={{ color: '#22C55E' }}>
              정답 {profile.correctAnswers}개
            </span>
            <span style={{ color: '#EF4444' }}>
              오답 {profile.wrongAnswers}개
            </span>
          </div>
          <div
            className="h-3 rounded-full overflow-hidden flex"
            style={{ backgroundColor: theme.colors.border }}
          >
            {totalAnswers > 0 && (
              <>
                <motion.div
                  className="h-full"
                  style={{ backgroundColor: '#22C55E' }}
                  initial={{ width: 0 }}
                  animate={{
                    width: `${(profile.correctAnswers / totalAnswers) * 100}%`,
                  }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                />
                <motion.div
                  className="h-full"
                  style={{ backgroundColor: '#EF4444' }}
                  initial={{ width: 0 }}
                  animate={{
                    width: `${(profile.wrongAnswers / totalAnswers) * 100}%`,
                  }}
                  transition={{ duration: 0.8, ease: 'easeOut', delay: 0.2 }}
                />
              </>
            )}
          </div>
        </div>
      </div>

      {/* 피드백 통계 */}
      <div
        className="rounded-2xl p-4"
        style={{
          backgroundColor: theme.colors.backgroundSecondary,
          border: `1px solid ${theme.colors.border}`,
        }}
      >
        <h3
          className="font-bold mb-4"
          style={{ color: theme.colors.text }}
        >
          피드백 활동
        </h3>

        <div className="grid grid-cols-2 gap-3">
          {stats.slice(4).map((stat, index) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + index * 0.05 }}
              className="p-3 rounded-xl text-center"
              style={{ backgroundColor: `${theme.colors.accent}10` }}
            >
              <span className="text-2xl mb-1 block">{stat.icon}</span>
              <p
                className="text-xl font-bold"
                style={{ color: stat.color || theme.colors.text }}
              >
                {stat.value}
                <span className="text-sm font-normal">{stat.suffix}</span>
              </p>
              <p
                className="text-xs mt-1"
                style={{ color: theme.colors.textSecondary }}
              >
                {stat.label}
              </p>
            </motion.div>
          ))}
        </div>
      </div>

      {/* 뱃지 */}
      {profile.badges.length > 0 && (
        <div
          className="rounded-2xl p-4"
          style={{
            backgroundColor: theme.colors.backgroundSecondary,
            border: `1px solid ${theme.colors.border}`,
          }}
        >
          <h3
            className="font-bold mb-4"
            style={{ color: theme.colors.text }}
          >
            획득한 뱃지
          </h3>

          <div className="flex flex-wrap gap-2">
            {profile.badges.map((badge, index) => (
              <motion.div
                key={badge}
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3 + index * 0.05 }}
                className="px-3 py-1.5 rounded-full text-sm font-medium"
                style={{
                  backgroundColor: `${theme.colors.accent}20`,
                  color: theme.colors.accent,
                }}
              >
                {badge}
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* 빈 뱃지 상태 */}
      {profile.badges.length === 0 && (
        <div
          className="rounded-2xl p-6 text-center"
          style={{
            backgroundColor: theme.colors.backgroundSecondary,
            border: `1px solid ${theme.colors.border}`,
          }}
        >
          <span className="text-4xl mb-3 block">🏅</span>
          <p
            className="font-medium mb-1"
            style={{ color: theme.colors.text }}
          >
            아직 뱃지가 없어요
          </p>
          <p
            className="text-sm"
            style={{ color: theme.colors.textSecondary }}
          >
            퀴즈를 풀고 피드백을 남기면 뱃지를 획득할 수 있어요!
          </p>
        </div>
      )}
    </motion.div>
  );
}
