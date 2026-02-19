'use client';

import type { ClassType } from '@/lib/hooks/useProfessorStudents';

export interface WarningItem {
  uid: string;
  nickname: string;
  classId: ClassType;
  zScore: number;
  level: 'caution' | 'danger';
  reason: string;
}

interface Props {
  warnings: WarningItem[];
  onStudentClick: (uid: string) => void;
}

export default function EarlyWarning({ warnings, onStudentClick }: Props) {
  if (warnings.length === 0) return null;

  const dangers = warnings.filter(w => w.level === 'danger');
  const cautions = warnings.filter(w => w.level === 'caution');

  return (
    <div className="border-2 border-[#8B1A1A] bg-[#FDFBF7] p-4">
      <h3 className="text-sm font-bold text-[#8B1A1A] mb-3">
        조기 경고 ({warnings.length}명)
      </h3>

      {dangers.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] font-bold text-[#8B1A1A] mb-1.5">위험 (Z &lt; -2.0)</p>
          <div className="space-y-1">
            {dangers.map(w => (
              <button
                key={w.uid}
                onClick={() => onStudentClick(w.uid)}
                className="w-full flex items-center gap-2 px-2 py-1.5 bg-red-50 border border-[#8B1A1A] text-left hover:bg-red-100 transition-colors"
              >
                <span className="text-xs font-bold text-[#8B1A1A]">{w.nickname}</span>
                <span className="text-[10px] text-[#8B1A1A]">{w.classId}반</span>
                <span className="ml-auto text-[10px] font-mono text-[#8B1A1A]">
                  Z={w.zScore.toFixed(2)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {cautions.length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-[#B8860B] mb-1.5">주의 (Z &lt; -1.5)</p>
          <div className="space-y-1">
            {cautions.map(w => (
              <button
                key={w.uid}
                onClick={() => onStudentClick(w.uid)}
                className="w-full flex items-center gap-2 px-2 py-1.5 bg-amber-50 border border-[#B8860B] text-left hover:bg-amber-100 transition-colors"
              >
                <span className="text-xs font-bold text-[#B8860B]">{w.nickname}</span>
                <span className="text-[10px] text-[#B8860B]">{w.classId}반</span>
                <span className="ml-auto text-[10px] font-mono text-[#B8860B]">
                  Z={w.zScore.toFixed(2)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
