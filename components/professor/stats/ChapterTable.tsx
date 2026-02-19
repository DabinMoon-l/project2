'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ChapterStats } from '@/lib/hooks/useProfessorStats';

interface Props {
  chapterStats: ChapterStats[];
}

function AlertBadge({ type }: { type: 'low' | 'gap' | 'volatile' }) {
  const config = {
    low: { bg: 'bg-[#8B1A1A]', label: '이해↓' },
    gap: { bg: 'bg-[#B8860B]', label: '격차↑' },
    volatile: { bg: 'bg-[#CC6600]', label: '변동↑' },
  }[type];
  return (
    <span className={`inline-block px-1.5 py-0.5 text-[9px] font-bold text-white ${config.bg}`}>
      {config.label}
    </span>
  );
}

export default function ChapterTable({ chapterStats }: Props) {
  const [expandedChapter, setExpandedChapter] = useState<string | null>(null);

  if (chapterStats.length === 0) {
    return (
      <div className="bg-[#FDFBF7] border border-[#D4CFC4] p-5 shadow-[2px_2px_0px_#D4CFC4]">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-1 h-6 bg-[#1A1A1A]" />
          <h3 className="text-sm font-bold text-[#1A1A1A] tracking-wide uppercase">챕터별 분석</h3>
          <div className="flex-1 h-px bg-[#D4CFC4]" />
        </div>
        <p className="text-sm text-[#5C5C5C] text-center py-4">데이터가 없습니다</p>
      </div>
    );
  }

  // 경고 수 집계
  const totalAlerts = chapterStats.reduce((sum, ch) => {
    let count = 0;
    if (ch.mean > 0 && ch.mean < 60) count++;
    if (ch.sd > 15) count++;
    if (ch.cv > 0.20) count++;
    return sum + count;
  }, 0);

  return (
    <div className="bg-[#FDFBF7] border border-[#D4CFC4] p-5 shadow-[2px_2px_0px_#D4CFC4]">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-1 h-6 bg-[#1A1A1A]" />
        <h3 className="text-sm font-bold text-[#1A1A1A] tracking-wide uppercase">챕터별 분석</h3>
        {totalAlerts > 0 && (
          <span className="text-[9px] px-1.5 py-0.5 bg-[#8B1A1A] text-white font-bold">
            경고 {totalAlerts}
          </span>
        )}
        <div className="flex-1 h-px bg-[#D4CFC4]" />
      </div>
      <p className="text-[10px] text-[#5C5C5C] ml-4 mb-4">
        Mean&lt;60% · SD&gt;15% · CV&gt;0.20 경고 표시
      </p>

      <div className="space-y-2">
        {chapterStats.map((ch, ci) => {
          const isExpanded = expandedChapter === ch.chapterId;
          const alerts: ('low' | 'gap' | 'volatile')[] = [];
          if (ch.mean > 0 && ch.mean < 60) alerts.push('low');
          if (ch.sd > 15) alerts.push('gap');
          if (ch.cv > 0.20) alerts.push('volatile');
          const hasAlerts = alerts.length > 0;
          const barPct = Math.min(100, ch.mean);

          return (
            <motion.div
              key={ch.chapterId}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: ci * 0.05 }}
              className={`border ${hasAlerts ? 'border-[#8B1A1A]/30' : 'border-[#D4CFC4]'}`}
            >
              {/* 챕터 헤더 (클릭하여 소주제 펼치기) */}
              <button
                onClick={() => setExpandedChapter(isExpanded ? null : ch.chapterId)}
                className="w-full flex items-center gap-3 p-3 text-left hover:bg-[#EBE5D9]/50 transition-colors"
              >
                {/* 순번 */}
                <span className="inline-flex items-center justify-center w-6 h-6 text-[10px] font-bold text-white bg-[#1A1A1A] shrink-0">
                  {ci + 1}
                </span>

                {/* 이름 + 경고 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-xs font-bold text-[#1A1A1A] truncate">{ch.chapterName}</span>
                    {alerts.map(a => <AlertBadge key={a} type={a} />)}
                  </div>
                  {/* 미니 바 */}
                  <div className="relative h-1.5 bg-[#EBE5D9]">
                    <motion.div
                      className="absolute left-0 top-0 h-full"
                      style={{ backgroundColor: ch.mean < 60 ? '#8B1A1A' : '#1D5D4A' }}
                      initial={{ width: 0 }}
                      animate={{ width: `${barPct}%` }}
                      transition={{ duration: 0.5, delay: ci * 0.05 }}
                    />
                  </div>
                </div>

                {/* 수치 */}
                <div className="text-right shrink-0">
                  <p className={`text-base font-bold tabular-nums ${ch.mean < 60 ? 'text-[#8B1A1A]' : 'text-[#1A1A1A]'}`}>
                    {ch.mean > 0 ? ch.mean.toFixed(1) : '-'}
                  </p>
                  <p className="text-[9px] text-[#5C5C5C] font-mono">
                    SD {ch.mean > 0 ? ch.sd.toFixed(1) : '-'}
                  </p>
                </div>

                {/* 펼치기 화살표 */}
                {ch.details.length > 0 && (
                  <svg className={`w-3.5 h-3.5 text-[#5C5C5C] transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                )}
              </button>

              {/* 소주제 펼치기 */}
              <AnimatePresence>
                {isExpanded && ch.details.length > 0 && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="border-t border-[#D4CFC4] bg-[#EBE5D9]/30">
                      {/* 소주제 테이블 헤더 */}
                      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 px-3 py-1.5 text-[9px] font-bold text-[#5C5C5C] border-b border-[#D4CFC4]">
                        <span>소주제</span>
                        <span className="w-12 text-right">Mean</span>
                        <span className="w-10 text-right">SD</span>
                        <span className="w-10 text-right">CV</span>
                      </div>

                      {ch.details.map((detail, di) => {
                        const dAlerts: ('low' | 'gap' | 'volatile')[] = [];
                        if (detail.mean > 0 && detail.mean < 60) dAlerts.push('low');
                        if (detail.sd > 15) dAlerts.push('gap');
                        if (detail.cv > 0.20) dAlerts.push('volatile');
                        const dBarPct = Math.min(100, detail.mean);

                        return (
                          <motion.div
                            key={detail.detailId}
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: di * 0.03 }}
                            className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 items-center px-3 py-2 border-b border-[#D4CFC4]/50 last:border-b-0"
                          >
                            {/* 이름 + 미니 바 */}
                            <div className="min-w-0">
                              <div className="flex items-center gap-1 mb-0.5">
                                <span className="text-[11px] text-[#1A1A1A] truncate">{detail.detailName}</span>
                                {dAlerts.map(a => <AlertBadge key={a} type={a} />)}
                              </div>
                              <div className="relative h-1 bg-[#D4CFC4]/40 w-full">
                                <div
                                  className="absolute left-0 top-0 h-full transition-all"
                                  style={{
                                    width: `${dBarPct}%`,
                                    backgroundColor: detail.mean < 60 ? '#8B1A1A' : '#1D5D4A',
                                    opacity: 0.6,
                                  }}
                                />
                              </div>
                            </div>

                            <span className={`w-12 text-right text-[11px] font-mono tabular-nums font-bold ${
                              detail.mean > 0 && detail.mean < 60 ? 'text-[#8B1A1A]' : 'text-[#1A1A1A]'
                            }`}>
                              {detail.mean > 0 ? detail.mean.toFixed(1) : '-'}
                            </span>
                            <span className={`w-10 text-right text-[11px] font-mono tabular-nums ${
                              detail.sd > 15 ? 'text-[#B8860B] font-bold' : 'text-[#5C5C5C]'
                            }`}>
                              {detail.mean > 0 ? detail.sd.toFixed(1) : '-'}
                            </span>
                            <span className={`w-10 text-right text-[11px] font-mono tabular-nums ${
                              detail.cv > 0.20 ? 'text-[#CC6600] font-bold' : 'text-[#5C5C5C]'
                            }`}>
                              {detail.mean > 0 ? detail.cv.toFixed(2) : '-'}
                            </span>
                          </motion.div>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
