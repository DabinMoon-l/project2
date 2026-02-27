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

export default function ClassSummaryTable({ classStats }: Props) {
  // 항상 A/B/C/D 모두 표시
  const activeClasses = classStats;
  const bestMean = Math.max(...classStats.filter(c => c.scores.length > 0).map(c => c.mean), 0);

  return (
    <div className="bg-[#FDFBF7] border border-[#D4CFC4] p-5 shadow-[2px_2px_0px_#D4CFC4]">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-1 h-6 bg-[#1A1A1A]" />
        <h3 className="text-sm font-bold text-[#1A1A1A] tracking-wide uppercase">반별 요약</h3>
        <div className="flex-1 h-px bg-[#D4CFC4]" />
      </div>

      {/* 카드형 요약 */}
      <div className="space-y-3">
        {activeClasses.map((cls, i) => {
          const c = CLASS_COLORS[cls.classId] || { main: '#1A1A1A', light: '#D4CFC4' };
          const isBest = cls.mean === bestMean;
          const isUnstable = cls.stability < 50;
          const hasHighCV = cls.cv > 0.20;

          return (
            <motion.div
              key={cls.classId}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              className={`relative border overflow-hidden ${
                isUnstable ? 'border-[#8B1A1A]/40' : 'border-[#D4CFC4]'
              }`}
            >
              {/* 좌측 색상 스트라이프 */}
              <div className="absolute left-0 top-0 bottom-0 w-1.5" style={{ backgroundColor: c.main }} />

              <div className="pl-4 pr-3 py-3">
                {/* 반 이름 + 뱃지 */}
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="inline-flex items-center justify-center w-7 h-7 text-xs font-bold text-white"
                    style={{ backgroundColor: c.main }}>
                    {cls.classId}
                  </span>
                  <span className="text-xs font-bold" style={{ color: c.main }}>{cls.classId}반</span>
                  <span className="text-[10px] text-[#5C5C5C]">{cls.studentCount}명</span>
                  {isBest && (
                    <span className="text-[9px] px-1.5 py-0.5 bg-[#1A1A1A] text-[#F5F0E8] font-bold ml-auto">BEST</span>
                  )}
                  {isUnstable && (
                    <span className={`text-[9px] px-1.5 py-0.5 bg-[#8B1A1A] text-white font-bold ${isBest ? '' : 'ml-auto'}`}>불안정</span>
                  )}
                </div>

                {/* 수치 그리드 */}
                <div className="grid grid-cols-5 gap-2">
                  {/* Mean */}
                  <div className="text-center">
                    <p className="text-[9px] text-[#5C5C5C] mb-0.5">Mean</p>
                    <p className={`text-sm font-bold tabular-nums ${cls.mean < 60 ? 'text-[#8B1A1A]' : ''}`}
                      style={{ color: cls.mean >= 60 ? c.main : undefined }}>
                      {cls.mean.toFixed(1)}
                    </p>
                  </div>

                  {/* SD */}
                  <div className="text-center">
                    <p className="text-[9px] text-[#5C5C5C] mb-0.5">SD</p>
                    <p className={`text-sm font-bold font-mono tabular-nums ${cls.sd > 15 ? 'text-[#B8860B]' : 'text-[#1A1A1A]'}`}>
                      {cls.sd.toFixed(1)}
                    </p>
                  </div>

                  {/* CV */}
                  <div className="text-center">
                    <p className="text-[9px] text-[#5C5C5C] mb-0.5">CV</p>
                    <p className={`text-sm font-bold font-mono tabular-nums ${hasHighCV ? 'text-[#CC6600]' : 'text-[#1A1A1A]'}`}>
                      {cls.cv.toFixed(2)}
                    </p>
                  </div>

                  {/* 95% CI */}
                  <div className="text-center">
                    <p className="text-[9px] text-[#5C5C5C] mb-0.5">95% CI</p>
                    <p className="text-[10px] font-mono tabular-nums text-[#1A1A1A] leading-tight">
                      {cls.ci[0].toFixed(1)}
                      <br />
                      {cls.ci[1].toFixed(1)}
                    </p>
                  </div>

                  {/* 안정성 */}
                  <div className="text-center">
                    <p className="text-[9px] text-[#5C5C5C] mb-0.5">안정성</p>
                    <p className={`text-sm font-bold tabular-nums ${isUnstable ? 'text-[#8B1A1A]' : 'text-[#1A1A1A]'}`}>
                      {cls.stability.toFixed(1)}
                    </p>
                  </div>
                </div>

                {/* 하단 미니 바: 안정성 비율 */}
                <div className="mt-2 pt-2 border-t border-[#D4CFC4]/50">
                  <div className="relative h-1.5 bg-[#EBE5D9]">
                    <motion.div
                      className="absolute left-0 top-0 h-full"
                      style={{ backgroundColor: isUnstable ? '#8B1A1A' : c.main }}
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, Math.max(0, cls.stability))}%` }}
                      transition={{ duration: 0.6, delay: i * 0.1 }}
                    />
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* 기준 범례 */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-4 pt-3 border-t border-[#D4CFC4] text-[9px] text-[#5C5C5C]">
        <span><span className="text-[#8B1A1A] font-bold">Mean&lt;60</span> 이해 부족</span>
        <span><span className="text-[#B8860B] font-bold">SD&gt;15</span> 성취도 격차</span>
        <span><span className="text-[#CC6600] font-bold">CV&gt;0.20</span> 높은 변동성</span>
        <span><span className="text-[#8B1A1A] font-bold">안정성&lt;50</span> 불안정</span>
      </div>
    </div>
  );
}
