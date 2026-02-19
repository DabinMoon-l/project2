'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import type { StudentData, ClassType } from '@/lib/hooks/useProfessorStudents';
import { mean, sd, zScore } from '@/lib/utils/statistics';

const CLASS_COLORS: Record<ClassType, string> = {
  A: '#8B1A1A', B: '#B8860B', C: '#1D5D4A', D: '#1E3A5F',
};

export type SortKey = 'status' | 'zscore' | 'score' | 'growth' | 'name';

interface Props {
  students: StudentData[];
  sortBy: SortKey;
  onSortChange: (key: SortKey) => void;
  onStudentClick: (uid: string) => void;
}

function getOnlineStatus(lastActiveAt: Date): 'online' | 'idle' | 'offline' {
  const diff = Date.now() - lastActiveAt.getTime();
  if (diff < 2 * 60 * 1000) return 'online';
  if (diff < 5 * 60 * 1000) return 'idle';
  return 'offline';
}

const STATUS_ORDER = { online: 0, idle: 1, offline: 2 };

export default function StudentListView({ students, sortBy, onSortChange, onStudentClick }: Props) {
  // Z-score 계산
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

  // 정렬
  const sorted = useMemo(() => {
    return [...enrichedStudents].sort((a, b) => {
      switch (sortBy) {
        case 'status':
          return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
        case 'zscore':
          return b.zScore - a.zScore;
        case 'score':
          return b.quizStats.averageScore - a.quizStats.averageScore;
        case 'name':
          return a.nickname.localeCompare(b.nickname);
        default:
          return 0;
      }
    });
  }, [enrichedStudents, sortBy]);

  const SORT_OPTIONS: { key: SortKey; label: string }[] = [
    { key: 'status', label: '접속' },
    { key: 'zscore', label: 'Z-score' },
    { key: 'score', label: '평균' },
    { key: 'name', label: '이름' },
  ];

  return (
    <div>
      {/* 정렬 버튼 */}
      <div className="flex gap-1 mb-3">
        {SORT_OPTIONS.map(opt => (
          <button
            key={opt.key}
            onClick={() => onSortChange(opt.key)}
            className={`px-2.5 py-1 text-[10px] font-bold border border-[#D4CFC4] ${
              sortBy === opt.key
                ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                : 'text-[#5C5C5C] bg-[#FDFBF7]'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* 헤더 */}
      <div className="grid grid-cols-[1fr_40px_50px_55px_40px] gap-1 px-2 py-1.5 border-b-2 border-[#1A1A1A] text-[10px] font-bold text-[#5C5C5C]">
        <span>학생</span>
        <span className="text-center">반</span>
        <span className="text-right">평균</span>
        <span className="text-right">Z-score</span>
        <span className="text-center">상태</span>
      </div>

      {/* 학생 행 */}
      {sorted.length === 0 ? (
        <p className="text-sm text-[#5C5C5C] text-center py-8">학생이 없습니다</p>
      ) : (
        sorted.map((student, i) => {
          const isWarning = student.zScore < -1.5;
          const isDanger = student.zScore < -2.0;

          return (
            <motion.button
              key={student.uid}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.02 }}
              onClick={() => onStudentClick(student.uid)}
              className={`w-full grid grid-cols-[1fr_40px_50px_55px_40px] gap-1 px-2 py-2 border-b border-[#D4CFC4] text-left hover:bg-[#EBE5D9] transition-colors ${
                isDanger ? 'bg-red-50' : isWarning ? 'bg-amber-50' : ''
              }`}
            >
              {/* 이름 + 학번 */}
              <div className="min-w-0">
                <p className="text-xs font-bold text-[#1A1A1A] truncate">{student.nickname}</p>
                {student.studentId && (
                  <p className="text-[10px] text-[#5C5C5C]">{student.studentId}</p>
                )}
              </div>

              {/* 반 */}
              <span
                className="text-[10px] font-bold text-center self-center px-1 border border-current"
                style={{ color: CLASS_COLORS[student.classId] }}
              >
                {student.classId}
              </span>

              {/* 평균 점수 */}
              <span className="text-xs text-right self-center font-mono text-[#1A1A1A]">
                {student.quizStats.averageScore > 0 ? student.quizStats.averageScore.toFixed(0) : '-'}
              </span>

              {/* Z-score */}
              <span className={`text-xs text-right self-center font-mono font-bold ${
                isDanger ? 'text-[#8B1A1A]' : isWarning ? 'text-[#B8860B]' : 'text-[#1A1A1A]'
              }`}>
                {student.quizStats.averageScore > 0 ? student.zScore.toFixed(2) : '-'}
                {isDanger && ' !!'}
                {isWarning && !isDanger && ' !'}
              </span>

              {/* 접속 상태 */}
              <div className="flex justify-center self-center">
                <div className={`w-2.5 h-2.5 rounded-full ${
                  student.status === 'online' ? 'bg-[#1D5D4A] animate-pulse' :
                  student.status === 'idle' ? 'bg-[#B8860B]' : 'bg-[#D4CFC4]'
                }`} />
              </div>
            </motion.button>
          );
        })
      )}
    </div>
  );
}
