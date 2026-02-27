'use client';

import { motion } from 'framer-motion';
import type { ClassStats } from '@/lib/hooks/useProfessorStats';

const CLASS_COLORS: Record<string, { main: string; light: string }> = {
  A: { main: '#8B1A1A', light: '#D4A5A5' },
  B: { main: '#B8860B', light: '#E8D5A3' },
  C: { main: '#1D5D4A', light: '#A8D4C5' },
  D: { main: '#1E3A5F', light: '#A8C4E0' },
};

interface Props {
  classStats: ClassStats[];
}

export default function StabilityIndex({ classStats }: Props) {
  // 항상 A/B/C/D 모두 표시, 안정성 순서 정렬
  const sorted = [...classStats].sort((a, b) => b.stability - a.stability);
  const maxVal = Math.max(...sorted.map(c => Math.max(c.mean, c.stability)), 100);

  return (
    <div className="bg-[#FDFBF7] border border-[#D4CFC4] p-5 shadow-[2px_2px_0px_#D4CFC4]">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-1 h-6 bg-[#1A1A1A]" />
        <h3 className="text-sm font-bold text-[#1A1A1A] tracking-wide uppercase">안정성 지표</h3>
        <div className="flex-1 h-px bg-[#D4CFC4]" />
      </div>
      <p className="text-[10px] text-[#5C5C5C] ml-4 mb-4">
        Stability = Mean - SD &middot; 높을수록 고르게 잘하는 반
      </p>

      <div className="grid grid-cols-2 gap-3">
        {sorted.map((cls, i) => {
          const c = CLASS_COLORS[cls.classId];
          const isUnstable = cls.stability < 50;
          const stabPct = (cls.stability / maxVal) * 100;

          return (
            <motion.div
              key={cls.classId}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className={`relative p-3 border overflow-hidden ${
                isUnstable ? 'border-[#8B1A1A] bg-red-50/50' : 'border-[#D4CFC4]'
              }`}
            >
              {/* 배경 바 */}
              <motion.div
                className="absolute bottom-0 left-0 right-0"
                style={{ backgroundColor: c.light, opacity: 0.3 }}
                initial={{ height: 0 }}
                animate={{ height: `${stabPct}%` }}
                transition={{ duration: 0.8, delay: i * 0.1 }}
              />

              <div className="relative z-10">
                {/* 반 + 순위 */}
                <div className="flex items-center justify-between mb-2">
                  <span className="inline-flex items-center justify-center w-6 h-6 text-[10px] font-bold text-white"
                    style={{ backgroundColor: c.main }}>
                    {cls.classId}
                  </span>
                  {i === 0 && (
                    <span className="text-[9px] px-1.5 py-0.5 bg-[#1A1A1A] text-[#F5F0E8] font-bold">BEST</span>
                  )}
                  {isUnstable && (
                    <span className="text-[9px] px-1.5 py-0.5 bg-[#8B1A1A] text-white font-bold">불안정</span>
                  )}
                </div>

                {/* 안정성 수치 */}
                <p className="text-2xl font-bold tabular-nums" style={{ color: isUnstable ? '#8B1A1A' : c.main }}>
                  {cls.stability.toFixed(1)}
                </p>

                {/* Mean / SD 세부 */}
                <div className="flex gap-3 mt-1 text-[10px] text-[#5C5C5C]">
                  <span>M: {cls.mean.toFixed(1)}</span>
                  <span>SD: {cls.sd.toFixed(1)}</span>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
