'use client';

import { motion } from 'framer-motion';
import type { WeeklyDataPoint, DispersionMode, ClassType } from '@/lib/hooks/useProfessorStats';

const CLASS_COLORS: Record<string, { main: string; light: string }> = {
  A: { main: '#8B1A1A', light: '#D4A5A5' },
  B: { main: '#B8860B', light: '#E8D5A3' },
  C: { main: '#1D5D4A', light: '#A8D4C5' },
  D: { main: '#1E3A5F', light: '#A8C4E0' },
};

interface Props {
  weeklyTrend: WeeklyDataPoint[];
  mode: DispersionMode;
}

export default function WeeklyTrend({ weeklyTrend, mode }: Props) {
  if (weeklyTrend.length === 0) {
    return (
      <div className="bg-[#FDFBF7] border border-[#D4CFC4] p-5 shadow-[2px_2px_0px_#D4CFC4]">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-1 h-6 bg-[#1A1A1A]" />
          <h3 className="text-sm font-bold text-[#1A1A1A] tracking-wide uppercase">주간 트렌드</h3>
          <div className="flex-1 h-px bg-[#D4CFC4]" />
        </div>
        <p className="text-sm text-[#5C5C5C] text-center py-8">데이터가 없습니다</p>
      </div>
    );
  }

  const W = 400;
  const H = 240;
  const PAD = { top: 25, right: 25, bottom: 50, left: 40 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const weeks = weeklyTrend;
  const xStep = weeks.length > 1 ? plotW / (weeks.length - 1) : plotW / 2;

  const toX = (i: number) => PAD.left + (weeks.length > 1 ? i * xStep : plotW / 2);
  const toY = (v: number) => PAD.top + plotH - (v / 100) * plotH;

  const classes: ClassType[] = ['A', 'B', 'C', 'D'];

  // 부드러운 곡선 path 생성 (catmull-rom to cubic bezier)
  const smoothPath = (points: { x: number; y: number }[]) => {
    if (points.length < 2) return '';
    if (points.length === 2) return `M${points[0].x},${points[0].y}L${points[1].x},${points[1].y}`;

    let d = `M${points[0].x},${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      d += `C${cp1x},${cp1y},${cp2x},${cp2y},${p2.x},${p2.y}`;
    }
    return d;
  };

  const modeLabel = mode === 'sd' ? 'SD 밴드' : mode === 'ci' ? '95% CI 밴드' : '';

  return (
    <div className="bg-[#FDFBF7] border border-[#D4CFC4] p-5 shadow-[2px_2px_0px_#D4CFC4]">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-1 h-6 bg-[#1A1A1A]" />
        <div>
          <h3 className="text-sm font-bold text-[#1A1A1A] tracking-wide uppercase">주간 트렌드</h3>
          {modeLabel && <p className="text-[10px] text-[#5C5C5C]">{modeLabel} 표시</p>}
        </div>
        <div className="flex-1 h-px bg-[#D4CFC4]" />
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ overflow: 'visible' }}>
        {/* 배경 채우기 */}
        <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} fill="#FDFBF7" />

        {/* 그리드 */}
        {[0, 25, 50, 75, 100].map(v => (
          <g key={v}>
            <line x1={PAD.left} y1={toY(v)} x2={W - PAD.right} y2={toY(v)}
              stroke={v === 50 ? '#D4CFC4' : '#EBE5D9'} strokeWidth={v === 50 ? 1 : 0.5} />
            <text x={PAD.left - 6} y={toY(v) + 3} textAnchor="end" fontSize={9}
              fill={v === 50 ? '#5C5C5C' : '#D4CFC4'} fontFamily="monospace">{v}</text>
          </g>
        ))}

        {/* X축 라벨 */}
        {weeks.map((w, i) => (
          <g key={w.week}>
            <line x1={toX(i)} y1={PAD.top + plotH} x2={toX(i)} y2={PAD.top + plotH + 4} stroke="#D4CFC4" />
            <text x={toX(i)} y={PAD.top + plotH + 16} textAnchor="middle" fontSize={9} fill="#5C5C5C" fontFamily="monospace">
              {w.week}
            </text>
          </g>
        ))}

        {/* 반별 라인 + 밴드 */}
        {classes.map(cls => {
          const cc = CLASS_COLORS[cls];
          const points = weeks.map((w, i) => ({
            x: toX(i),
            y: toY(w.byClass[cls].mean),
            mean: w.byClass[cls].mean,
            sd: w.byClass[cls].sd,
            ci: w.byClass[cls].ci,
          }));

          const linePath = smoothPath(points);

          // CI/SD 밴드
          let bandPath = '';
          if (mode === 'ci' || mode === 'sd') {
            const upperPts = points.map(p => {
              const high = mode === 'ci' ? Math.min(100, p.ci[1]) : Math.min(100, p.mean + p.sd);
              return { x: p.x, y: toY(high) };
            });
            const lowerPts = [...points].reverse().map(p => {
              const low = mode === 'ci' ? Math.max(0, p.ci[0]) : Math.max(0, p.mean - p.sd);
              return { x: p.x, y: toY(low) };
            });
            bandPath = [
              ...upperPts.map((u, i) => `${i === 0 ? 'M' : 'L'}${u.x},${u.y}`),
              ...lowerPts.map((l, i) => `${i === 0 ? 'L' : 'L'}${l.x},${l.y}`),
              'Z',
            ].join(' ');
          }

          return (
            <g key={cls}>
              {bandPath && (
                <motion.path d={bandPath} fill={cc.light} opacity={0.25}
                  initial={{ opacity: 0 }} animate={{ opacity: 0.25 }} transition={{ duration: 0.6 }} />
              )}
              <motion.path d={linePath} fill="none" stroke={cc.main} strokeWidth={2.5} strokeLinecap="round"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 1, ease: 'easeInOut' }} />
              {/* 데이터 포인트 */}
              {points.map((p, i) => (
                <motion.g key={i}
                  initial={{ scale: 0 }} animate={{ scale: 1 }}
                  transition={{ delay: 0.5 + i * 0.08 }}>
                  <circle cx={p.x} cy={p.y} r={5} fill="#FDFBF7" stroke={cc.main} strokeWidth={2} />
                  <circle cx={p.x} cy={p.y} r={2} fill={cc.main} />
                </motion.g>
              ))}
            </g>
          );
        })}

        {/* 범례 */}
        {classes.map((cls, i) => (
          <g key={cls} transform={`translate(${PAD.left + i * 80}, ${H - 12})`}>
            <rect width={16} height={4} fill={CLASS_COLORS[cls].main} rx={2} />
            <text x={20} y={4} fontSize={9} fill="#5C5C5C" fontWeight="bold">{cls}반</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
