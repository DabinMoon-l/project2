'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import type { StudentData, ClassType } from '@/lib/hooks/useProfessorStudents';

const CLASS_COLORS: Record<ClassType, string> = {
  A: '#8B1A1A', B: '#B8860B', C: '#1D5D4A', D: '#1E3A5F',
};

type OnlineStatus = 'online' | 'idle' | 'offline';

function getOnlineStatus(lastActiveAt: Date): OnlineStatus {
  const now = Date.now();
  const diff = now - lastActiveAt.getTime();
  if (diff < 2 * 60 * 1000) return 'online';   // 2분 이내
  if (diff < 5 * 60 * 1000) return 'idle';      // 5분 이내
  return 'offline';
}

const STATUS_CONFIG: Record<OnlineStatus, { color: string; bg: string; label: string }> = {
  online: { color: '#1D5D4A', bg: 'bg-green-100', label: '접속 중' },
  idle: { color: '#B8860B', bg: 'bg-amber-100', label: '자리 비움' },
  offline: { color: '#5C5C5C', bg: 'bg-gray-100', label: '오프라인' },
};

interface Props {
  students: StudentData[];
}

export default function LiveSessionPanel({ students }: Props) {
  const statusGroups = useMemo(() => {
    const online: StudentData[] = [];
    const idle: StudentData[] = [];
    const offline: StudentData[] = [];

    for (const s of students) {
      const status = getOnlineStatus(s.lastActiveAt);
      if (status === 'online') online.push(s);
      else if (status === 'idle') idle.push(s);
      else offline.push(s);
    }

    return { online, idle, offline };
  }, [students]);

  return (
    <div className="border-2 border-[#1A1A1A] bg-[#FDFBF7] p-4">
      <h3 className="text-sm font-bold text-[#1A1A1A] mb-3">실시간 세션</h3>

      {/* 요약 */}
      <div className="flex gap-3 mb-4">
        {(['online', 'idle', 'offline'] as OnlineStatus[]).map(status => {
          const cfg = STATUS_CONFIG[status];
          const count = statusGroups[status].length;
          return (
            <div key={status} className={`flex-1 p-2 ${cfg.bg} border border-[#D4CFC4] text-center`}>
              <p className="text-lg font-bold" style={{ color: cfg.color }}>{count}</p>
              <p className="text-[10px]" style={{ color: cfg.color }}>{cfg.label}</p>
            </div>
          );
        })}
      </div>

      {/* 접속 중인 학생 목록 */}
      {statusGroups.online.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-[#5C5C5C] font-bold">접속 중 ({statusGroups.online.length})</p>
          {statusGroups.online.map((s, i) => (
            <motion.div
              key={s.uid}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className="flex items-center gap-2 py-1 px-2 bg-[#EBE5D9]"
            >
              <div className="w-2 h-2 rounded-full bg-[#1D5D4A] animate-pulse" />
              <span className="text-xs font-bold text-[#1A1A1A]">{s.nickname}</span>
              <span className="text-[10px] px-1 border border-current font-bold"
                style={{ color: CLASS_COLORS[s.classId] }}>
                {s.classId}반
              </span>
              {(s as StudentData & { currentActivity?: string }).currentActivity && (
                <span className="text-[10px] text-[#5C5C5C] ml-auto">
                  {(s as StudentData & { currentActivity?: string }).currentActivity}
                </span>
              )}
            </motion.div>
          ))}
        </div>
      )}

      {/* 자리 비움 */}
      {statusGroups.idle.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <p className="text-xs text-[#5C5C5C] font-bold">자리 비움 ({statusGroups.idle.length})</p>
          <div className="flex flex-wrap gap-1">
            {statusGroups.idle.map(s => (
              <span key={s.uid} className="text-[10px] px-1.5 py-0.5 bg-amber-50 border border-amber-200 text-[#B8860B]">
                {s.nickname}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
