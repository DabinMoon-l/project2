'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { AIDifficultyStats } from '@/lib/hooks/useProfessorStats';

const DIFF_CONFIG: Record<string, { color: string; light: string; icon: string }> = {
  쉬움: { color: '#1D5D4A', light: '#A8D4C5', icon: '○' },
  보통: { color: '#B8860B', light: '#E8D5A3', icon: '◎' },
  어려움: { color: '#8B1A1A', light: '#D4A5A5', icon: '●' },
};

interface Props {
  aiDifficultyStats: AIDifficultyStats[];
  professorMean: number;
}

export default function AIDifficultyAnalysis({ aiDifficultyStats, professorMean }: Props) {
  const [open, setOpen] = useState(false);
  const hasData = aiDifficultyStats.some(d => d.count > 0);

  return (
    <div className="bg-[#FDFBF7] border border-[#D4CFC4] shadow-[2px_2px_0px_#D4CFC4] overflow-hidden">
      {/* 헤더 (토글) */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 p-5 text-left hover:bg-[#EBE5D9]/30 transition-colors"
      >
        <div className="w-1 h-6 bg-[#1A1A1A]" />
        <div className="flex-1">
          <h3 className="text-sm font-bold text-[#1A1A1A] tracking-wide uppercase">AI 난이도 분석</h3>
          <p className="text-[10px] text-[#5C5C5C]">보조 섹션 · 교수 문제 대비 비교</p>
        </div>

        {/* 토글 아이콘 */}
        <motion.div
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <svg className="w-4 h-4 text-[#5C5C5C]"
            fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </motion.div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 space-y-4">
              {/* 교수 기준선 */}
              {professorMean > 0 && (
                <div className="flex items-center gap-2 p-2.5 bg-[#EBE5D9] border border-[#D4CFC4]">
                  <div className="w-1 h-4 bg-[#1A1A1A]" />
                  <span className="text-[10px] text-[#5C5C5C]">교수 문제 기준선</span>
                  <span className="text-sm font-bold text-[#1A1A1A] tabular-nums ml-auto">
                    {professorMean.toFixed(1)}점
                  </span>
                </div>
              )}

              {!hasData ? (
                <p className="text-sm text-[#5C5C5C] text-center py-6">AI 문제 데이터가 없습니다</p>
              ) : (
                <div className="space-y-3">
                  {aiDifficultyStats.map((d, i) => {
                    const cfg = DIFF_CONFIG[d.difficulty] || DIFF_CONFIG['보통'];
                    const diff = professorMean > 0 && d.count > 0
                      ? ((d.mean - professorMean) / professorMean * 100) : 0;
                    const barPct = d.count > 0 ? Math.min(100, d.mean) : 0;

                    return (
                      <motion.div
                        key={d.difficulty}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.08 }}
                        className="border border-[#D4CFC4] p-3"
                      >
                        {/* 난이도 라벨 + 수치 */}
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm" style={{ color: cfg.color }}>{cfg.icon}</span>
                            <span className="text-xs font-bold" style={{ color: cfg.color }}>
                              {d.difficulty}
                            </span>
                            <span className="text-[10px] text-[#5C5C5C]">{d.count}회</span>
                          </div>
                          <div className="flex items-baseline gap-2">
                            {d.count > 0 && (
                              <span className="text-lg font-bold tabular-nums" style={{ color: cfg.color }}>
                                {d.mean.toFixed(1)}
                              </span>
                            )}
                            {d.count > 0 && professorMean > 0 && (
                              <span className={`text-[10px] font-bold font-mono ${
                                diff > 0 ? 'text-[#1D5D4A]' : diff < 0 ? 'text-[#8B1A1A]' : 'text-[#5C5C5C]'
                              }`}>
                                {diff > 0 ? '+' : ''}{diff.toFixed(1)}%
                              </span>
                            )}
                          </div>
                        </div>

                        {/* 바 */}
                        <div className="relative h-3 bg-[#EBE5D9]">
                          <motion.div
                            className="absolute left-0 top-0 h-full"
                            style={{ backgroundColor: cfg.color, opacity: 0.2 }}
                            initial={{ width: 0 }}
                            animate={{ width: '100%' }}
                            transition={{ duration: 0.2 }}
                          />
                          <motion.div
                            className="absolute left-0 top-0 h-full"
                            style={{ backgroundColor: cfg.color }}
                            initial={{ width: 0 }}
                            animate={{ width: `${barPct}%` }}
                            transition={{ duration: 0.5, delay: i * 0.08 }}
                          />
                          {/* 교수 기준선 마커 */}
                          {professorMean > 0 && (
                            <div
                              className="absolute top-0 h-full w-0.5 bg-[#1A1A1A]"
                              style={{ left: `${Math.min(100, professorMean)}%` }}
                            />
                          )}
                        </div>

                        {/* SD */}
                        {d.count > 0 && (
                          <p className="text-[9px] text-[#5C5C5C] font-mono mt-1 text-right">
                            SD: {d.sd.toFixed(1)}
                          </p>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
              )}

              {/* 범례 */}
              <div className="flex items-center justify-center gap-3 pt-2 border-t border-[#D4CFC4] text-[9px] text-[#5C5C5C]">
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 bg-[#1A1A1A]" style={{ width: 2 }} />
                  <span>교수 기준선</span>
                </div>
                <span>|</span>
                <span>양수 = 교수 대비 쉬움</span>
                <span>|</span>
                <span>음수 = 교수 대비 어려움</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
