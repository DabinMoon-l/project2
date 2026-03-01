'use client';

import { motion } from 'framer-motion';
import type { ClassStats } from '@/lib/hooks/useProfessorStats';

const CLASS_COLORS: Record<string, { main: string; fill: string; label: string }> = {
  A: { main: '#8B1A1A', fill: 'rgba(139,26,26,0.15)', label: 'A반' },
  B: { main: '#B8860B', fill: 'rgba(184,134,11,0.15)', label: 'B반' },
  C: { main: '#1D5D4A', fill: 'rgba(29,93,74,0.15)', label: 'C반' },
  D: { main: '#1E3A5F', fill: 'rgba(30,58,95,0.15)', label: 'D반' },
};

interface Props {
  classStats: ClassStats[];
  onClassClick?: (classId: string) => void;
}

export default function ClassComparison({ classStats, onClassClick }: Props) {
  // Y축 최댓값 항상 100 고정
  const maxVal = 100;

  const chartW = 360;
  const chartH = 220;
  const padL = 36;
  const padR = 16;
  const padT = 24;
  const padB = 36;
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;

  const barCount = classStats.length || 4;
  const gap = plotW / barCount;
  const barW = Math.min(56, gap * 0.6);

  const toY = (v: number) => padT + plotH * (1 - v / maxVal);
  const baseY = toY(0);

  return (
    <div>
      <h3 className="text-lg font-bold text-[#1A1A1A] mb-1">반별 성적 비교</h3>
      <p className="text-[10px] text-[#5C5C5C] mb-3">평균 점수 (± SD) · 막대 클릭 시 클러스터 분석</p>

      <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full">
        <defs>
          <clipPath id="plot-clip">
            <rect x={padL} y={0} width={plotW} height={baseY + 1} />
          </clipPath>
        </defs>

        {/* Y축 그리드 + 라벨 */}
        {[0, 25, 50, 75, 100].map(v => {
          const y = toY(v);
          return (
            <g key={v}>
              <line x1={padL} y1={y} x2={chartW - padR} y2={y}
                stroke={v === 0 ? '#D4CFC4' : '#EBE5D9'} strokeWidth={v === 0 ? 1 : 0.5} />
              <text x={padL - 6} y={y + 4} textAnchor="end"
                fontSize={12} fill="#5C5C5C" fontWeight="500">{v}</text>
            </g>
          );
        })}

        {/* 막대 + 에러바 (클립 영역 내) */}
        <g clipPath="url(#plot-clip)">
          {classStats.map((cls, i) => {
            const c = CLASS_COLORS[cls.classId];
            const cx = padL + gap * i + gap / 2;
            const hasDat = cls.scores.length > 0;
            const meanY = hasDat ? toY(cls.mean) : baseY;
            const barH = baseY - meanY;

            return (
              <g key={cls.classId}>
                {/* 막대 */}
                {hasDat && barH > 0 && (
                  <motion.rect
                    x={cx - barW / 2}
                    width={barW}
                    fill={c.fill}
                    stroke={c.main}
                    strokeWidth={2}
                    rx={2}
                    initial={{ y: baseY, height: 0 }}
                    animate={{ y: meanY, height: barH }}
                    transition={{ duration: 0.6, delay: i * 0.1, ease: 'easeOut' }}
                  />
                )}

                {/* SD Error bar */}
                {hasDat && cls.sd > 0 && (
                  <motion.g
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.5 + i * 0.1 }}
                  >
                    <line x1={cx} y1={toY(Math.min(100, cls.mean + cls.sd))} x2={cx} y2={toY(Math.max(0, cls.mean - cls.sd))}
                      stroke={c.main} strokeWidth={1.5} />
                    <line x1={cx - 6} y1={toY(Math.min(100, cls.mean + cls.sd))} x2={cx + 6} y2={toY(Math.min(100, cls.mean + cls.sd))}
                      stroke={c.main} strokeWidth={1.5} />
                    <line x1={cx - 6} y1={toY(Math.max(0, cls.mean - cls.sd))} x2={cx + 6} y2={toY(Math.max(0, cls.mean - cls.sd))}
                      stroke={c.main} strokeWidth={1.5} />
                  </motion.g>
                )}
              </g>
            );
          })}
        </g>

        {/* 클릭 영역 + 라벨 (클립 밖) */}
        {classStats.map((cls, i) => {
          const c = CLASS_COLORS[cls.classId];
          const cx = padL + gap * i + gap / 2;
          const hasDat = cls.scores.length > 0;
          const meanY = hasDat ? toY(cls.mean) : baseY;

          return (
            <g key={`label-${cls.classId}`}
              className="cursor-pointer"
              onClick={() => onClassClick?.(cls.classId)}
            >
              {/* 투명 클릭 영역 */}
              <rect x={cx - gap / 2} y={padT} width={gap} height={chartH - padT}
                fill="transparent" />

              {/* 평균값 레이블 (SD 에러바 위에 배치) */}
              {hasDat && (
                <text x={cx} y={Math.min(meanY - 8, toY(Math.min(100, cls.mean + cls.sd)) - 10)} textAnchor="middle"
                  fontSize={13} fill="#1A1A1A" fontWeight="bold">
                  {cls.mean.toFixed(1)}
                </text>
              )}

              {/* X축 라벨 */}
              <text x={cx} y={baseY + 16} textAnchor="middle"
                fontSize={13} fill="#1A1A1A" fontWeight="bold">
                {c.label}
              </text>
              <text x={cx} y={baseY + 30} textAnchor="middle"
                fontSize={11} fill="#5C5C5C">
                {cls.studentCount}명
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
