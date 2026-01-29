'use client';

import { motion } from 'framer-motion';
import { useTheme } from '@/styles/themes/useTheme';

/**
 * 계급 정보 타입
 */
interface RankInfo {
  // 현재 계급명
  name: string;
  // 다음 계급명
  nextRank: string | null;
  // 현재 경험치
  currentExp: number;
  // 다음 계급까지 필요한 경험치
  maxExp: number;
}

/**
 * StatsCard Props
 */
interface StatsCardProps {
  // 골드
  gold: number;
  // 총 경험치
  totalExp: number;
  // 계급 정보
  rankInfo: RankInfo;
}

/**
 * 계급 목록 및 필요 경험치
 */
const RANKS = [
  { name: '견습생', minExp: 0 },
  { name: '용사', minExp: 100 },
  { name: '기사', minExp: 300 },
  { name: '장군', minExp: 600 },
  { name: '대원수', minExp: 1000 },
  { name: '전설의 용사', minExp: 2000 },
];

/**
 * 계급별 아이콘/배지
 */
const RANK_ICONS: Record<string, string> = {
  '견습생': '🌱',
  '용사': '⚔️',
  '기사': '🛡️',
  '장군': '🎖️',
  '대원수': '👑',
  '전설의 용사': '🏆',
};

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
 * 골드, 경험치, 계급을 표시하며 계급 진행률 바를 포함
 */
export default function StatsCard({ gold, totalExp, rankInfo }: StatsCardProps) {
  const { theme } = useTheme();

  // 경험치 진행률 계산 (0-100)
  const expProgress = rankInfo.maxExp > 0
    ? Math.min((rankInfo.currentExp / rankInfo.maxExp) * 100, 100)
    : 100;

  // 최고 계급 여부
  const isMaxRank = rankInfo.nextRank === null;

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
      {/* 상단: 골드 & 경험치 */}
      <div className="flex justify-between items-center mb-4">
        {/* 골드 */}
        <motion.div
          className="flex items-center gap-2"
          whileHover={{ scale: 1.05 }}
        >
          <span className="text-2xl">🪙</span>
          <div>
            <p
              className="text-xs"
              style={{ color: theme.colors.textSecondary }}
            >
              골드
            </p>
            <p
              className="text-lg font-bold"
              style={{ color: theme.colors.accent }}
            >
              {formatNumber(gold)}
            </p>
          </div>
        </motion.div>

        {/* 구분선 */}
        <div
          className="h-10 w-px"
          style={{ backgroundColor: theme.colors.border }}
        />

        {/* 경험치 */}
        <motion.div
          className="flex items-center gap-2"
          whileHover={{ scale: 1.05 }}
        >
          <span className="text-2xl">✨</span>
          <div>
            <p
              className="text-xs"
              style={{ color: theme.colors.textSecondary }}
            >
              총 경험치
            </p>
            <p
              className="text-lg font-bold"
              style={{ color: theme.colors.text }}
            >
              {formatNumber(totalExp)} XP
            </p>
          </div>
        </motion.div>
      </div>

      {/* 하단: 계급 정보 */}
      <div
        className="pt-3"
        style={{ borderTop: `1px solid ${theme.colors.border}` }}
      >
        {/* 계급 아이콘 및 이름 */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xl">{RANK_ICONS[rankInfo.name] || '🌟'}</span>
            <span
              className="font-bold"
              style={{ color: theme.colors.text }}
            >
              {rankInfo.name}
            </span>
          </div>

          {/* 다음 계급 정보 */}
          {!isMaxRank && (
            <span
              className="text-sm"
              style={{ color: theme.colors.textSecondary }}
            >
              다음: {RANK_ICONS[rankInfo.nextRank!]} {rankInfo.nextRank}
            </span>
          )}
          {isMaxRank && (
            <span
              className="text-sm font-medium"
              style={{ color: theme.colors.accent }}
            >
              최고 계급 달성!
            </span>
          )}
        </div>

        {/* 경험치 진행률 바 */}
        <div className="relative">
          {/* 배경 바 */}
          <div
            className="h-3 rounded-full overflow-hidden"
            style={{ backgroundColor: `${theme.colors.accent}20` }}
          >
            {/* 진행률 바 */}
            <motion.div
              className="h-full rounded-full"
              style={{ backgroundColor: theme.colors.accent }}
              initial={{ width: 0 }}
              animate={{ width: `${expProgress}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
            />
          </div>

          {/* 경험치 텍스트 */}
          <div className="flex justify-between mt-1">
            <span
              className="text-xs"
              style={{ color: theme.colors.textSecondary }}
            >
              {rankInfo.currentExp} / {rankInfo.maxExp} XP
            </span>
            <span
              className="text-xs font-medium"
              style={{ color: theme.colors.accent }}
            >
              {Math.round(expProgress)}%
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/**
 * 경험치로 계급 정보 계산하는 유틸리티 함수
 */
export function calculateRankInfo(totalExp: number): RankInfo {
  let currentRankIndex = 0;

  // 현재 계급 찾기
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (totalExp >= RANKS[i].minExp) {
      currentRankIndex = i;
      break;
    }
  }

  const currentRank = RANKS[currentRankIndex];
  const nextRank = RANKS[currentRankIndex + 1];

  // 다음 계급이 없으면 (최고 계급)
  if (!nextRank) {
    return {
      name: currentRank.name,
      nextRank: null,
      currentExp: totalExp - currentRank.minExp,
      maxExp: 0, // 최고 계급이면 진행률 100%
    };
  }

  // 현재 계급 내에서의 경험치 계산
  const currentExp = totalExp - currentRank.minExp;
  const maxExp = nextRank.minExp - currentRank.minExp;

  return {
    name: currentRank.name,
    nextRank: nextRank.name,
    currentExp,
    maxExp,
  };
}
