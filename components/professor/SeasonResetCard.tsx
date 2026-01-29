/**
 * 시즌 리셋 카드 컴포넌트
 *
 * 교수님이 시즌을 전환할 수 있는 카드 UI입니다.
 * 현재 시즌 정보와 리셋 버튼을 표시합니다.
 */

'use client';

import { motion } from 'framer-motion';
import { useTheme } from '@/styles/themes/useTheme';
import {
  type ClassSeasonInfo,
  type SeasonType,
  getSeasonName,
  getNextSeason,
  RESET_ITEMS,
  PRESERVED_ITEMS,
} from '@/lib/hooks/useSeasonReset';

// ============================================================
// Props
// ============================================================

interface SeasonResetCardProps {
  /**
   * 반별 시즌 정보
   */
  classSeasons: ClassSeasonInfo[];
  /**
   * 로딩 상태
   */
  loading?: boolean;
  /**
   * 개별 반 리셋 클릭 핸들러
   */
  onResetClass?: (classId: string, newSeason: SeasonType) => void;
  /**
   * 전체 리셋 클릭 핸들러
   */
  onResetAll?: (newSeason: SeasonType) => void;
}

// ============================================================
// 상수
// ============================================================

const CLASS_COLORS: Record<string, string> = {
  A: '#D4AF37',
  B: '#3D2B1F',
  C: '#0D3D2E',
  D: '#1A2744',
};

// ============================================================
// 컴포넌트
// ============================================================

export function SeasonResetCard({
  classSeasons,
  loading = false,
  onResetClass,
  onResetAll,
}: SeasonResetCardProps) {
  const { theme } = useTheme();

  // 가장 많은 시즌 타입 (대표 시즌)
  const currentSeasonCounts = classSeasons.reduce(
    (acc, cls) => {
      acc[cls.currentSeason] = (acc[cls.currentSeason] || 0) + 1;
      return acc;
    },
    {} as Record<SeasonType, number>
  );

  const dominantSeason: SeasonType =
    (currentSeasonCounts.midterm || 0) >= (currentSeasonCounts.final || 0)
      ? 'midterm'
      : 'final';

  const nextSeason = getNextSeason(dominantSeason);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl p-5"
      style={{
        backgroundColor: theme.colors.backgroundSecondary,
        border: `1px solid ${theme.colors.border}`,
      }}
    >
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: `${theme.colors.accent}20` }}
          >
            <span className="text-2xl">📅</span>
          </div>
          <div>
            <h3
              className="font-bold text-lg"
              style={{ color: theme.colors.text }}
            >
              시즌 관리
            </h3>
            <p
              className="text-xs"
              style={{ color: theme.colors.textSecondary }}
            >
              학기 전환 시 학생 데이터가 초기화됩니다
            </p>
          </div>
        </div>
      </div>

      {/* 현재 시즌 표시 */}
      <div
        className="rounded-xl p-4 mb-4"
        style={{ backgroundColor: `${theme.colors.accent}10` }}
      >
        <div className="flex items-center justify-between">
          <div>
            <p
              className="text-xs"
              style={{ color: theme.colors.textSecondary }}
            >
              현재 시즌
            </p>
            <p
              className="text-xl font-bold"
              style={{ color: theme.colors.accent }}
            >
              {getSeasonName(dominantSeason)}
            </p>
          </div>
          <div className="text-right">
            <p
              className="text-xs"
              style={{ color: theme.colors.textSecondary }}
            >
              다음 시즌
            </p>
            <p
              className="text-lg font-medium"
              style={{ color: theme.colors.text }}
            >
              {getSeasonName(nextSeason)}
            </p>
          </div>
        </div>
      </div>

      {/* 반별 상태 */}
      <div className="mb-4">
        <p
          className="text-sm font-medium mb-2"
          style={{ color: theme.colors.text }}
        >
          반별 현황
        </p>
        <div className="grid grid-cols-4 gap-2">
          {classSeasons.map((cls) => (
            <motion.button
              key={cls.classId}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() =>
                onResetClass?.(cls.classId, getNextSeason(cls.currentSeason))
              }
              disabled={loading || !cls.canReset}
              className="rounded-xl p-3 text-center transition-opacity disabled:opacity-50"
              style={{
                backgroundColor: `${CLASS_COLORS[cls.classId]}15`,
                border: `1px solid ${CLASS_COLORS[cls.classId]}30`,
              }}
            >
              <p
                className="text-lg font-bold"
                style={{ color: CLASS_COLORS[cls.classId] }}
              >
                {cls.classId}반
              </p>
              <p
                className="text-xs mt-1"
                style={{ color: theme.colors.textSecondary }}
              >
                {getSeasonName(cls.currentSeason)}
              </p>
              <p
                className="text-xs"
                style={{ color: theme.colors.textSecondary }}
              >
                {cls.studentCount}명
              </p>
            </motion.button>
          ))}
        </div>
      </div>

      {/* 초기화 항목 안내 */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {/* 초기화되는 항목 */}
        <div
          className="rounded-xl p-3"
          style={{ backgroundColor: '#FEE2E2' }}
        >
          <p className="text-xs font-medium text-red-700 mb-2">
            초기화 항목
          </p>
          <div className="space-y-1">
            {RESET_ITEMS.map((item) => (
              <div
                key={item.name}
                className="flex items-center gap-1.5 text-xs text-red-600"
              >
                <span>{item.icon}</span>
                <span>{item.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 유지되는 항목 */}
        <div
          className="rounded-xl p-3"
          style={{ backgroundColor: '#D1FAE5' }}
        >
          <p className="text-xs font-medium text-green-700 mb-2">
            유지 항목
          </p>
          <div className="space-y-1">
            {PRESERVED_ITEMS.map((item) => (
              <div
                key={item.name}
                className="flex items-center gap-1.5 text-xs text-green-600"
              >
                <span>{item.icon}</span>
                <span>{item.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 전체 리셋 버튼 */}
      <motion.button
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
        onClick={() => onResetAll?.(nextSeason)}
        disabled={loading}
        className="w-full py-3 rounded-xl font-medium text-white transition-opacity disabled:opacity-50"
        style={{ backgroundColor: '#DC2626' }}
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <motion.span
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full"
            />
            처리 중...
          </span>
        ) : (
          `전체 반 → ${getSeasonName(nextSeason)} 전환`
        )}
      </motion.button>

      {/* 경고 문구 */}
      <p
        className="text-xs text-center mt-3"
        style={{ color: theme.colors.textSecondary }}
      >
        ⚠️ 시즌 전환은 되돌릴 수 없습니다. 신중하게 진행해주세요.
      </p>
    </motion.div>
  );
}

export default SeasonResetCard;
