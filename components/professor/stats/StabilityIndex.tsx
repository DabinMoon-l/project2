'use client';

import { motion } from 'framer-motion';
import type { ClassStats } from '@/lib/hooks/useProfessorStats';

interface Props {
  classStats: ClassStats[];
}

export default function StabilityIndex({ classStats }: Props) {
  // 안정성 순서 정렬
  const sorted = [...classStats].sort((a, b) => b.stability - a.stability);

  return (
    <div>
      <h3 className="text-lg font-bold text-[#1A1A1A] mb-1">안정성 지표</h3>
      <p className="text-[10px] text-[#5C5C5C] mb-3">
        Stability = Mean - SD &middot; 높을수록 고르게 잘하는 반
      </p>

      <div className="grid grid-cols-2 gap-3">
        {sorted.map((cls, i) => {
          const isUnstable = cls.stability < 50;
          const isBest = i === 0;

          return (
            <motion.div
              key={cls.classId}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="relative p-4 border border-[#D4CFC4] overflow-hidden flex flex-col items-center text-center"
            >
              <div className="relative z-10 w-full">
                {/* 반 이름 + 상태 라벨 */}
                <div className="flex items-center justify-between mb-2">
                  <span className="text-base font-black text-[#1A1A1A] border border-[#1A1A1A] px-1.5 py-0.5">
                    {cls.classId}반
                  </span>
                  {isBest && (
                    <span className="text-sm font-black text-[#1A1A1A]">BEST</span>
                  )}
                  {isUnstable && (
                    <span className="text-sm font-black text-[#1A1A1A]">불안정</span>
                  )}
                </div>

                {/* 안정성 점수 (크고 중앙) */}
                <p className="text-4xl font-black tabular-nums text-[#1A1A1A]">
                  {cls.stability.toFixed(1)}
                </p>

                {/* Mean / SD */}
                <div className="flex justify-center gap-4 mt-2 text-xs text-[#5C5C5C]">
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
