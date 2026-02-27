'use client';

import { motion } from 'framer-motion';
import type { ClassStats, DispersionMode } from '@/lib/hooks/useProfessorStats';

const CLASS_COLORS: Record<string, { main: string; light: string; label: string }> = {
  A: { main: '#8B1A1A', light: '#D4A5A5', label: 'A반' },
  B: { main: '#B8860B', light: '#E8D5A3', label: 'B반' },
  C: { main: '#1D5D4A', light: '#A8D4C5', label: 'C반' },
  D: { main: '#1E3A5F', light: '#A8C4E0', label: 'D반' },
};

interface Props {
  classStats: ClassStats[];
  mode: DispersionMode;
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="w-1 h-6 bg-[#1A1A1A]" />
      <div>
        <h3 className="text-sm font-bold text-[#1A1A1A] font-serif-display tracking-wide uppercase">{title}</h3>
        {subtitle && <p className="text-[10px] text-[#5C5C5C] mt-0.5">{subtitle}</p>}
      </div>
      <div className="flex-1 h-px bg-[#D4CFC4]" />
    </div>
  );
}

export default function ClassComparison({ classStats, mode }: Props) {
  const modeLabel = mode === 'sd' ? '± SD' : mode === 'ci' ? '95% CI' : 'CV';

  // 항상 A/B/C/D 모두 표시
  const allClasses = classStats;
  const activeClasses = classStats.filter(c => c.scores.length > 0);
  const maxMean = Math.max(1, ...activeClasses.map(c => c.mean));

  return (
    <div className="space-y-4">
      {/* 반별 평균 — 수평 바 차트 (더 직관적) */}
      <div className="bg-[#FDFBF7] border border-[#D4CFC4] p-5 shadow-[2px_2px_0px_#D4CFC4]">
        <SectionTitle title="반별 성적 비교" subtitle={`평균 점수 (${modeLabel})`} />

        <div className="space-y-4">
          {allClasses.map((cls, i) => {
            const c = CLASS_COLORS[cls.classId];
            const barPct = cls.scores.length > 0 ? (cls.mean / 100) * 100 : 0;

            // Error bar 범위
            let errLow = cls.mean;
            let errHigh = cls.mean;
            if (mode === 'sd') {
              errLow = Math.max(0, cls.mean - cls.sd);
              errHigh = Math.min(100, cls.mean + cls.sd);
            } else if (mode === 'ci') {
              errLow = Math.max(0, cls.ci[0]);
              errHigh = Math.min(100, cls.ci[1]);
            }

            return (
              <div key={cls.classId} className="group">
                {/* 반 라벨 + 수치 */}
                <div className="flex items-baseline justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center justify-center w-7 h-7 text-xs font-bold text-white"
                      style={{ backgroundColor: c.main }}>
                      {cls.classId}
                    </span>
                    <span className="text-xs text-[#5C5C5C]">{cls.studentCount}명</span>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-xl font-bold tabular-nums" style={{ color: c.main }}>
                      {cls.mean.toFixed(1)}
                    </span>
                    <span className="text-[10px] text-[#5C5C5C]">점</span>
                    {mode === 'cv' && (
                      <span className={`text-[10px] font-mono ml-1 ${cls.cv > 0.2 ? 'text-[#CC6600] font-bold' : 'text-[#5C5C5C]'}`}>
                        CV {cls.cv.toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>

                {/* 바 */}
                <div className="relative h-8 bg-[#EBE5D9] overflow-hidden">
                  <motion.div
                    className="absolute left-0 top-0 h-full"
                    style={{ backgroundColor: c.main, opacity: 0.15 }}
                    initial={{ width: 0 }}
                    animate={{ width: '100%' }}
                    transition={{ duration: 0.3, delay: i * 0.08 }}
                  />
                  <motion.div
                    className="absolute left-0 top-0 h-full"
                    style={{ backgroundColor: c.main }}
                    initial={{ width: 0 }}
                    animate={{ width: `${barPct}%` }}
                    transition={{ duration: 0.6, delay: i * 0.1, ease: 'easeOut' }}
                  />
                  {/* Error range indicator */}
                  {mode !== 'cv' && (
                    <motion.div
                      className="absolute top-1/2 -translate-y-1/2 h-2 border-l-2 border-r-2"
                      style={{
                        left: `${errLow}%`,
                        width: `${errHigh - errLow}%`,
                        borderColor: c.main,
                        backgroundColor: `${c.main}30`,
                      }}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.5 + i * 0.1 }}
                    />
                  )}
                </div>

                {/* SD/CI 텍스트 */}
                {mode !== 'cv' && (
                  <p className="text-[10px] text-[#5C5C5C] mt-1 text-right font-mono">
                    {mode === 'sd'
                      ? `${errLow.toFixed(1)} – ${errHigh.toFixed(1)} (SD: ${cls.sd.toFixed(1)})`
                      : `${errLow.toFixed(1)} – ${errHigh.toFixed(1)}`
                    }
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* 스케일 참조선 */}
        <div className="flex justify-between mt-3 pt-2 border-t border-[#D4CFC4]">
          {[0, 25, 50, 75, 100].map(v => (
            <span key={v} className="text-[9px] text-[#D4CFC4] font-mono">{v}</span>
          ))}
        </div>
      </div>

      {/* Box Plot */}
      <div className="bg-[#FDFBF7] border border-[#D4CFC4] p-5 shadow-[2px_2px_0px_#D4CFC4]">
        <SectionTitle title="점수 분포" subtitle="Box Plot (최솟값, Q1, 중앙값, Q3, 최댓값)" />

        <svg viewBox="0 0 400 180" className="w-full" style={{ overflow: 'visible' }}>
          {/* 배경 그리드 */}
          {[0, 25, 50, 75, 100].map(v => {
            const y = 150 - (v / 100) * 130;
            return (
              <g key={v}>
                <line x1={40} y1={y} x2={380} y2={y} stroke="#EBE5D9" strokeWidth={1} />
                <text x={35} y={y + 3} textAnchor="end" fontSize={9} fill="#D4CFC4" fontFamily="monospace">{v}</text>
              </g>
            );
          })}

          {allClasses.map((cls, i) => {
            const x = 80 + i * 80;
            const bp = cls.boxplot;
            const c = CLASS_COLORS[cls.classId];
            const toY = (v: number) => 150 - (v / 100) * 130;

            return (
              <g key={cls.classId}>
                {/* 수염 */}
                <motion.line x1={x} y1={toY(bp.max)} x2={x} y2={toY(bp.q3)}
                  stroke={c.main} strokeWidth={1.5} strokeDasharray="3,2"
                  initial={{ opacity: 0 }} animate={{ opacity: 0.6 }} transition={{ delay: 0.3 + i * 0.1 }} />
                <motion.line x1={x} y1={toY(bp.q1)} x2={x} y2={toY(bp.min)}
                  stroke={c.main} strokeWidth={1.5} strokeDasharray="3,2"
                  initial={{ opacity: 0 }} animate={{ opacity: 0.6 }} transition={{ delay: 0.3 + i * 0.1 }} />

                {/* 수염 끝 */}
                <line x1={x - 10} y1={toY(bp.max)} x2={x + 10} y2={toY(bp.max)} stroke={c.main} strokeWidth={2} />
                <line x1={x - 10} y1={toY(bp.min)} x2={x + 10} y2={toY(bp.min)} stroke={c.main} strokeWidth={2} />

                {/* 상자 (Q1~Q3) — 그라데이션 효과 */}
                <motion.rect
                  x={x - 22} y={toY(bp.q3)}
                  width={44} height={Math.max(2, toY(bp.q1) - toY(bp.q3))}
                  fill={c.light} stroke={c.main} strokeWidth={2}
                  rx={2}
                  initial={{ opacity: 0, scaleY: 0 }}
                  animate={{ opacity: 1, scaleY: 1 }}
                  transition={{ duration: 0.5, delay: i * 0.12 }}
                  style={{ transformOrigin: `${x}px ${toY((bp.q1 + bp.q3) / 2)}px` }}
                />

                {/* 중앙값 */}
                <motion.line
                  x1={x - 22} y1={toY(bp.median)} x2={x + 22} y2={toY(bp.median)}
                  stroke={c.main} strokeWidth={3}
                  initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
                  transition={{ duration: 0.4, delay: 0.5 + i * 0.1 }}
                />

                {/* 중앙값 레이블 */}
                <text x={x + 28} y={toY(bp.median) + 3} fontSize={9} fill={c.main} fontWeight="bold" fontFamily="monospace">
                  {bp.median.toFixed(0)}
                </text>

                {/* 이상치 */}
                {bp.outliers.map((o, j) => (
                  <motion.circle key={j} cx={x} cy={toY(o)} r={3}
                    fill="none" stroke={c.main} strokeWidth={1.5}
                    initial={{ scale: 0 }} animate={{ scale: 1 }}
                    transition={{ delay: 0.7 + j * 0.05 }} />
                ))}

                {/* 반 라벨 */}
                <rect x={x - 14} y={158} width={28} height={16} fill={c.main} rx={2} />
                <text x={x} y={170} textAnchor="middle" fontSize={10} fill="white" fontWeight="bold">
                  {c.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
