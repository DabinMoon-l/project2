/**
 * 시즌 리셋 히스토리 목록 컴포넌트
 *
 * 과거 시즌 리셋 기록을 표시합니다.
 */

'use client';

import { motion } from 'framer-motion';
import { useTheme } from '@/styles/themes/useTheme';
import {
  type SeasonLog,
  getSeasonName,
} from '@/lib/hooks/useSeasonReset';

// ============================================================
// Props
// ============================================================

interface SeasonHistoryListProps {
  /**
   * 시즌 로그 목록
   */
  logs: SeasonLog[];
  /**
   * 로딩 상태
   */
  loading?: boolean;
  /**
   * 선택된 반 필터
   */
  classFilter?: string | null;
  /**
   * 반 필터 변경 핸들러
   */
  onClassFilterChange?: (classId: string | null) => void;
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
// 유틸리티
// ============================================================

/**
 * 날짜 포맷팅
 */
function formatDate(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours === 0) {
      const minutes = Math.floor(diff / (1000 * 60));
      return `${minutes}분 전`;
    }
    return `${hours}시간 전`;
  }

  if (days === 1) {
    return '어제';
  }

  if (days < 7) {
    return `${days}일 전`;
  }

  return date.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ============================================================
// 컴포넌트
// ============================================================

export function SeasonHistoryList({
  logs,
  loading = false,
  classFilter,
  onClassFilterChange,
}: SeasonHistoryListProps) {
  const { theme } = useTheme();

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
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
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: `${theme.colors.accent}20` }}
          >
            <span className="text-xl">📜</span>
          </div>
          <div>
            <h3
              className="font-bold"
              style={{ color: theme.colors.text }}
            >
              시즌 전환 히스토리
            </h3>
            <p
              className="text-xs"
              style={{ color: theme.colors.textSecondary }}
            >
              최근 리셋 기록
            </p>
          </div>
        </div>
      </div>

      {/* 필터 */}
      {onClassFilterChange && (
        <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
          <button
            onClick={() => onClassFilterChange(null)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors`}
            style={{
              backgroundColor: classFilter === null
                ? theme.colors.accent
                : `${theme.colors.accent}15`,
              color: classFilter === null
                ? theme.colors.background
                : theme.colors.text,
            }}
          >
            전체
          </button>
          {['A', 'B', 'C', 'D'].map((classId) => (
            <button
              key={classId}
              onClick={() => onClassFilterChange(classId)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors"
              style={{
                backgroundColor: classFilter === classId
                  ? CLASS_COLORS[classId]
                  : `${CLASS_COLORS[classId]}15`,
                color: classFilter === classId
                  ? '#FFFFFF'
                  : CLASS_COLORS[classId],
              }}
            >
              {classId}반
            </button>
          ))}
        </div>
      )}

      {/* 로딩 */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-16 rounded-xl animate-pulse"
              style={{ backgroundColor: `${theme.colors.accent}10` }}
            />
          ))}
        </div>
      )}

      {/* 빈 상태 */}
      {!loading && logs.length === 0 && (
        <div className="py-8 text-center">
          <span className="text-4xl block mb-2">📭</span>
          <p
            className="text-sm"
            style={{ color: theme.colors.textSecondary }}
          >
            시즌 전환 기록이 없습니다
          </p>
        </div>
      )}

      {/* 히스토리 목록 */}
      {!loading && logs.length > 0 && (
        <div className="space-y-3">
          {logs.map((log, index) => (
            <motion.div
              key={log.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
              className="rounded-xl p-3"
              style={{
                backgroundColor: `${CLASS_COLORS[log.classId]}10`,
                border: `1px solid ${CLASS_COLORS[log.classId]}30`,
              }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {/* 반 뱃지 */}
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-white"
                    style={{ backgroundColor: CLASS_COLORS[log.classId] }}
                  >
                    {log.classId}
                  </div>

                  {/* 정보 */}
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className="text-sm font-medium"
                        style={{ color: theme.colors.text }}
                      >
                        {getSeasonName(log.previousSeason)}
                      </span>
                      <span style={{ color: theme.colors.textSecondary }}>
                        →
                      </span>
                      <span
                        className="text-sm font-medium"
                        style={{ color: theme.colors.accent }}
                      >
                        {getSeasonName(log.newSeason)}
                      </span>
                    </div>
                    <p
                      className="text-xs"
                      style={{ color: theme.colors.textSecondary }}
                    >
                      {log.studentCount}명 초기화 · {log.resetByName}
                    </p>
                  </div>
                </div>

                {/* 날짜 */}
                <span
                  className="text-xs"
                  style={{ color: theme.colors.textSecondary }}
                >
                  {formatDate(log.createdAt)}
                </span>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

export default SeasonHistoryList;
