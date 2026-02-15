'use client';

import { motion } from 'framer-motion';
import { useTheme } from '@/styles/themes/useTheme';

/**
 * 뽑기 마일스톤 정보 타입
 */
interface MilestoneInfo {
  /** 현재 마일스톤 구간 내 진행도 (0-50) */
  currentExp: number;
  /** 마일스톤 간격 */
  maxExp: number;
  /** 뽑기 가능 여부 */
  canGacha: boolean;
}

/**
 * StatsCard Props
 */
interface StatsCardProps {
  /** 총 경험치 */
  totalExp: number;
  /** 뽑기 마일스톤 정보 */
  milestoneInfo: MilestoneInfo;
  /** 보유 토끼 수 */
  rabbitCount: number;
  /** 집사 토끼 수 */
  butlerCount: number;
}

/**
 * 숫자를 천 단위로 포맷팅
 */
function formatNumber(num: number): string {
  if (num >= 10000) {
    return `${(num / 10000).toFixed(1)}만`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}천`;
  }
  return num.toLocaleString();
}

/**
 * 스탯 카드 컴포넌트
 *
 * 경험치, 뽑기 마일스톤 진행률, 토끼 보유 현황 표시
 */
export default function StatsCard({ totalExp, milestoneInfo, rabbitCount, butlerCount }: StatsCardProps) {
  const { theme } = useTheme();

  const expProgress = milestoneInfo.maxExp > 0
    ? Math.min((milestoneInfo.currentExp / milestoneInfo.maxExp) * 100, 100)
    : 100;

  return (
    <motion.div
      className="w-full rounded-2xl p-4"
      style={{
        backgroundColor: theme.colors.backgroundSecondary,
        border: `1px solid ${theme.colors.border}`,
      }}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
    >
      {/* 상단: 경험치 */}
      <div className="flex justify-center items-center mb-4">
        <motion.div
          className="flex items-center gap-3"
          whileHover={{ scale: 1.05 }}
        >
          <span className="text-3xl">✨</span>
          <div>
            <p
              className="text-xs"
              style={{ color: theme.colors.textSecondary }}
            >
              총 경험치
            </p>
            <p
              className="text-xl font-bold"
              style={{ color: theme.colors.accent }}
            >
              {formatNumber(totalExp)} XP
            </p>
          </div>
        </motion.div>
      </div>

      {/* 하단: 뽑기 마일스톤 + 토끼 현황 */}
      <div
        className="pt-3"
        style={{ borderTop: `1px solid ${theme.colors.border}` }}
      >
        {/* 토끼 현황 */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xl">🐰</span>
            <span
              className="font-bold"
              style={{ color: theme.colors.text }}
            >
              {rabbitCount}마리
            </span>
            {butlerCount > 0 && (
              <span
                className="text-sm"
                style={{ color: theme.colors.textSecondary }}
              >
                (집사 {butlerCount})
              </span>
            )}
          </div>

          {/* 뽑기 가능 알림 */}
          {milestoneInfo.canGacha && (
            <span
              className="text-sm font-medium px-2 py-0.5"
              style={{ color: '#D4AF37', backgroundColor: '#D4AF3720' }}
            >
              뽑기 가능!
            </span>
          )}
        </div>

        {/* 마일스톤 진행률 바 */}
        <div className="relative">
          <div
            className="h-3 rounded-full overflow-hidden"
            style={{ backgroundColor: `${theme.colors.accent}20` }}
          >
            <motion.div
              className="h-full rounded-full"
              style={{ backgroundColor: theme.colors.accent }}
              initial={{ width: 0 }}
              animate={{ width: `${expProgress}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
            />
          </div>

          <div className="flex justify-between mt-1">
            <span
              className="text-xs"
              style={{ color: theme.colors.textSecondary }}
            >
              {milestoneInfo.currentExp} / {milestoneInfo.maxExp} XP
            </span>
            <span
              className="text-xs"
              style={{ color: theme.colors.textSecondary }}
            >
              다음 뽑기
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/**
 * 뽑기 마일스톤 정보 계산 유틸리티 함수
 */
export function calculateMilestoneInfo(totalExp: number, lastGachaExp: number): MilestoneInfo {
  const currentMilestone = Math.floor(totalExp / 50) * 50;
  const canGacha = currentMilestone > lastGachaExp && totalExp >= 50;

  return {
    currentExp: totalExp % 50,
    maxExp: 50,
    canGacha,
  };
}
