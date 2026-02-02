'use client';

import { motion } from 'framer-motion';
import { useTheme } from '@/styles/themes/useTheme';
import { type UserProfile } from '@/lib/hooks/useProfile';

// ============================================================
// 타입 정의
// ============================================================

interface ProfileCardProps {
  /** 사용자 프로필 */
  profile: UserProfile;
  /** 수정 버튼 클릭 핸들러 */
  onEdit?: () => void;
}

// ============================================================
// 계급별 색상
// ============================================================

const RANK_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  '견습생': { bg: '#A0522D20', text: '#A0522D', border: '#A0522D' },
  '용사': { bg: '#C0C0C020', text: '#808080', border: '#C0C0C0' },
  '기사': { bg: '#FFD70020', text: '#B8860B', border: '#FFD700' },
  '장군': { bg: '#4169E120', text: '#4169E1', border: '#4169E1' },
  '전설의 용사': { bg: '#FF450020', text: '#FF4500', border: '#FF4500' },
};

// ============================================================
// 피부색 목록
// ============================================================

const SKIN_COLORS = [
  '#8B4513', '#FFD93D', '#FF9F43', '#FFEAA7', '#6B4423',
  '#74B9FF', '#00D2D3', '#A29BFE', '#FF6B6B', '#2D3436',
  '#55EFC4', '#0984E3', '#FD79A8', '#81ECEC', '#00CEC9',
];

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 프로필 카드 컴포넌트
 *
 * 캐릭터, 닉네임, 계급, 레벨 정보를 표시합니다.
 */
export default function ProfileCard({ profile, onEdit }: ProfileCardProps) {
  const { theme } = useTheme();
  const rankStyle = RANK_COLORS[profile.rank] || RANK_COLORS['견습생'];
  const skinColor = SKIN_COLORS[profile.characterOptions?.skinColor || 3];

  // 다음 레벨까지 필요한 경험치 계산
  const currentLevelExp = (profile.level - 1) * 100;
  const nextLevelExp = profile.level * 100;
  const expProgress = ((profile.totalExp - currentLevelExp) / (nextLevelExp - currentLevelExp)) * 100;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl overflow-hidden"
      style={{
        backgroundColor: theme.colors.backgroundSecondary,
        border: `1px solid ${theme.colors.border}`,
      }}
    >
      {/* 배경 그라데이션 */}
      <div
        className="h-24 relative"
        style={{
          background: `linear-gradient(135deg, ${theme.colors.accent}, ${theme.colors.accent}80)`,
        }}
      >
        {/* 수정 버튼 */}
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors"
          >
            <svg
              className="w-4 h-4 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
              />
            </svg>
          </button>
        )}
      </div>

      {/* 캐릭터 아바타 */}
      <div className="relative px-4 -mt-12">
        <motion.div
          className="w-24 h-24 rounded-full border-4 mx-auto overflow-hidden"
          style={{
            backgroundColor: theme.colors.background,
            borderColor: theme.colors.background,
          }}
          whileHover={{ scale: 1.05 }}
        >
          {/* 간단한 캐릭터 아바타 */}
          <svg viewBox="0 0 100 100" className="w-full h-full">
            {/* 배경 */}
            <circle cx="50" cy="50" r="48" fill={`${theme.colors.accent}20`} />

            {/* 귀 */}
            <ellipse cx="30" cy="25" rx="8" ry="18" fill={skinColor} />
            <ellipse cx="70" cy="25" rx="8" ry="18" fill={skinColor} />
            <ellipse cx="30" cy="25" rx="4" ry="10" fill="#FFB6C1" opacity="0.6" />
            <ellipse cx="70" cy="25" rx="4" ry="10" fill="#FFB6C1" opacity="0.6" />

            {/* 얼굴 */}
            <ellipse cx="50" cy="55" rx="30" ry="32" fill={skinColor} />

            {/* 눈 */}
            <ellipse cx="40" cy="50" rx="5" ry="6" fill="white" />
            <circle cx="40" cy="50" r="3" fill="#2D3436" />
            <circle cx="39" cy="48" r="1" fill="white" />
            <ellipse cx="60" cy="50" rx="5" ry="6" fill="white" />
            <circle cx="60" cy="50" r="3" fill="#2D3436" />
            <circle cx="59" cy="48" r="1" fill="white" />

            {/* 볼 */}
            <ellipse cx="28" cy="58" rx="5" ry="3" fill="#FFB6C1" opacity="0.5" />
            <ellipse cx="72" cy="58" rx="5" ry="3" fill="#FFB6C1" opacity="0.5" />

            {/* 코 */}
            <ellipse cx="50" cy="58" rx="3" ry="2" fill="#FFB6C1" />

            {/* 입 */}
            <path
              d="M45,65 Q50,70 55,65"
              fill="none"
              stroke="#2D3436"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </motion.div>

        {/* 계급 뱃지 */}
        <div
          className="absolute bottom-0 left-1/2 transform -translate-x-1/2 translate-y-2 px-3 py-1 rounded-full text-xs font-bold"
          style={{
            backgroundColor: rankStyle.bg,
            color: rankStyle.text,
            border: `1px solid ${rankStyle.border}`,
          }}
        >
          {profile.rank}
        </div>
      </div>

      {/* 프로필 정보 */}
      <div className="px-4 pt-6 pb-4 text-center">
        {/* 닉네임 */}
        <h2
          className="text-xl font-bold mb-1"
          style={{ color: theme.colors.text }}
        >
          {profile.nickname}
        </h2>

        {/* 반 표시 */}
        <p
          className="text-sm mb-4"
          style={{ color: theme.colors.textSecondary }}
        >
          {profile.classType}반
          {profile.studentId && ` | ${profile.studentId}`}
        </p>

        {/* 레벨 & 경험치 */}
        <div
          className="rounded-xl p-3 mb-4"
          style={{ backgroundColor: `${theme.colors.accent}10` }}
        >
          <div className="flex items-center justify-between mb-2">
            <span
              className="text-sm font-medium"
              style={{ color: theme.colors.textSecondary }}
            >
              Lv. {profile.level}
            </span>
            <span
              className="text-sm"
              style={{ color: theme.colors.accent }}
            >
              {profile.totalExp} EXP
            </span>
          </div>

          {/* 경험치 바 */}
          <div
            className="h-2 rounded-full overflow-hidden"
            style={{ backgroundColor: `${theme.colors.accent}20` }}
          >
            <motion.div
              className="h-full rounded-full"
              style={{ backgroundColor: theme.colors.accent }}
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(expProgress, 100)}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
            />
          </div>

          <p
            className="text-xs mt-1 text-right"
            style={{ color: theme.colors.textSecondary }}
          >
            다음 레벨까지 {nextLevelExp - profile.totalExp} EXP
          </p>
        </div>

      </div>
    </motion.div>
  );
}
