'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import type { StudentData, ClassType } from '@/lib/hooks/useProfessorStudents';
import type { WarningItem } from '@/app/(main)/professor/students/page';
import { mean, sd, zScore } from '@/lib/utils/statistics';
import { getRabbitProfileUrl } from '@/lib/utils/rabbitProfile';

const CLASS_COLORS: Record<ClassType, string> = {
  A: '#8B1A1A', B: '#B8860B', C: '#1D5D4A', D: '#1E3A5F',
};

export type SortKey = 'studentId' | 'status' | 'zscore' | 'score';

interface Props {
  students: StudentData[];
  sortBy?: SortKey;
  onSortChange?: (key: SortKey) => void;
  onStudentClick: (uid: string) => void;
  warningMap: Map<string, WarningItem>;
}

function getOnlineStatus(lastActiveAt: Date): 'online' | 'offline' {
  const diff = Date.now() - lastActiveAt.getTime();
  if (diff < 60 * 1000) return 'online';
  return 'offline';
}


/** 학번 기반 정렬 */
function compareStudentId(a: string | undefined, b: string | undefined): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const yearA = parseInt(a.slice(0, 2), 10);
  const yearB = parseInt(b.slice(0, 2), 10);
  const currentYear = 26;
  const isReturneeA = yearA < currentYear - 1;
  const isReturneeB = yearB < currentYear - 1;
  if (isReturneeA && !isReturneeB) return -1;
  if (!isReturneeA && isReturneeB) return 1;
  return a.localeCompare(b);
}

/** 체류 페이지 분류 */
type PageCategory = 'quiz' | 'home' | 'board' | 'review';

const PAGE_COLORS: Record<PageCategory, string> = {
  quiz: '#8B1A1A',
  home: '#1D5D4A',
  board: '#B8860B',
  review: '#1E3A5F',
};

const PAGE_LABELS: Record<PageCategory, string> = {
  quiz: '퀴즈',
  home: '홈',
  board: '게시판',
  review: '복습',
};

function getPageCategory(activity?: string): PageCategory {
  if (!activity) return 'home';
  if (activity.includes('퀴즈') || activity.includes('출제') || activity.includes('배틀') || activity.includes('철권')) return 'quiz';
  if (activity.includes('복습') || activity.includes('리뷰')) return 'review';
  if (activity.includes('게시판') || activity.includes('게시글')) return 'board';
  return 'home';
}

/** N일전 표시 */
function getTimeAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '방금';
  if (diffMin < 60) return `${diffMin}분전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간전`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}일전`;
}

export default function StudentListView({ students, onStudentClick, warningMap }: Props) {
  const enrichedStudents = useMemo(() => {
    const scores = students.map(s => s.quizStats.averageScore);
    const m = mean(scores);
    const s = sd(scores);
    return students.map(student => ({
      ...student,
      zScore: zScore(student.quizStats.averageScore, m, s),
      status: getOnlineStatus(student.lastActiveAt),
    }));
  }, [students]);

  // 항상 학번순 정렬
  const sorted = useMemo(() => {
    return [...enrichedStudents].sort((a, b) => compareStudentId(a.studentId, b.studentId));
  }, [enrichedStudents]);

  // 프로필 크기
  const PROFILE_SIZE = 90;

  return (
    <div>
      {/* 헤더 */}
      <div className="flex items-center mb-5">
        <span className="text-[22px] font-bold text-[#1A1A1A] pb-1.5">
          학생 목록 ({students.length}명)
        </span>
      </div>

      {/* 학생 카드 그리드 — 3열 */}
      {sorted.length === 0 ? (
        <p className="text-lg text-[#5C5C5C] text-center py-12">학생이 없습니다</p>
      ) : (
        <div className="grid grid-cols-3 gap-y-5 gap-x-3">
          {sorted.map((student, i) => {
            const warning = warningMap.get(student.uid);
            const isDanger = warning?.level === 'danger';
            const isCaution = warning?.level === 'caution';
            const isOnline = student.status === 'online';
            const displayName = student.name || student.nickname;
            const pageCategory = isOnline ? getPageCategory(student.currentActivity) : null;

            return (
              <motion.button
                key={student.uid}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: Math.min(i * 0.01, 0.5) }}
                onClick={() => onStudentClick(student.uid)}
                className="flex flex-col items-center text-center"
              >
                {/* 프로필 */}
                <div className="relative" style={{ width: PROFILE_SIZE, height: PROFILE_SIZE }}>
                  <div
                    className={`rounded-full overflow-hidden bg-[#F5F0E8] shadow-lg ${
                      isDanger ? 'border-[2.5px] border-[#8B1A1A]' :
                      isCaution ? 'border-[2.5px] border-[#B8860B]' :
                      ''
                    }`}
                    style={{
                      width: PROFILE_SIZE,
                      height: PROFILE_SIZE,
                    }}
                  >
                    {student.profileRabbitId != null ? (
                      <img
                        src={getRabbitProfileUrl(student.profileRabbitId)}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-[#F5F0E8]">
                        <svg className="w-3/5 h-3/5 opacity-50" viewBox="0 0 24 24" fill="#5C5C5C">
                          <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
                        </svg>
                      </div>
                    )}
                  </div>
                  {/* 체류 상태 — 프로필에 겹치게 */}
                  <motion.div
                    className="absolute bottom-0.5 right-0.5 w-[20px] h-[20px] rounded-full border-[1.5px] border-white/30 shadow-md"
                    style={{ backgroundColor: isOnline && pageCategory ? PAGE_COLORS[pageCategory] : '#D4CFC4' }}
                    animate={isOnline ? { opacity: [1, 0.75, 1] } : undefined}
                    transition={isOnline ? { duration: 2, repeat: Infinity, ease: 'easeInOut' } : undefined}
                  />
                </div>

                {/* 이름 */}
                <p className="text-base font-bold text-[#1A1A1A] mt-1.5 truncate w-full">
                  {displayName}
                </p>

                {/* 반 · 닉네임 */}
                <p className="text-sm text-[#5C5C5C] mt-0.5 truncate w-full">
                  {student.classId}반{student.name ? ` · ${student.nickname}` : ''}
                </p>

                {/* 체류 페이지 또는 N일전 */}
                <p
                  className={`text-xs mt-0.5 font-bold`}
                  style={{ color: isOnline && pageCategory ? PAGE_COLORS[pageCategory] : '#5C5C5C' }}
                >
                  {isOnline && pageCategory ? PAGE_LABELS[pageCategory] : getTimeAgo(student.lastActiveAt)}
                </p>
              </motion.button>
            );
          })}
        </div>
      )}
    </div>
  );
}
