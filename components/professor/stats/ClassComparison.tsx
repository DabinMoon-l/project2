'use client';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import type { ClassStats } from '@/lib/hooks/useProfessorStats';
import type { StudentData } from '@/lib/hooks/useProfessorStudents';

type CompareMode = 'score' | 'engagement';

const MODE_OPTIONS: { value: CompareMode; label: string }[] = [
  { value: 'score', label: '성적 비교' },
  { value: 'engagement', label: '참여도 비교' },
];

const CLASS_COLORS: Record<string, { main: string; fill: string; label: string }> = {
  A: { main: '#8B1A1A', fill: 'rgba(139,26,26,0.15)', label: 'A반' },
  B: { main: '#B8860B', fill: 'rgba(184,134,11,0.15)', label: 'B반' },
  C: { main: '#1D5D4A', fill: 'rgba(29,93,74,0.15)', label: 'C반' },
  D: { main: '#1E3A5F', fill: 'rgba(30,58,95,0.15)', label: 'D반' },
};

interface Props {
  classStats: ClassStats[];
  students: StudentData[];
  onClassClick?: (classId: string) => void;
}

// 간단한 통계 함수
function calcMean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}
function calcSd(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = calcMean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

interface BarData {
  classId: string;
  mean: number;
  sd: number;
  count: number;
}

export default function ClassComparison({ classStats, students, onClassClick }: Props) {
  const [mode, setMode] = useState<CompareMode>('score');

  // 참여도(EXP) 데이터 계산
  const engagementData = useMemo<BarData[]>(() => {
    const classIds = classStats.map(c => c.classId);
    return classIds.map(classId => {
      const classStudents = students.filter(s => s.classId === classId);
      const exps = classStudents.map(s => s.totalExp || 0);
      return {
        classId,
        mean: calcMean(exps),
        sd: calcSd(exps),
        count: classStudents.length,
      };
    });
  }, [classStats, students]);

  // 현재 모드에 따른 데이터
  const bars = mode === 'score'
    ? classStats.map(cls => ({ classId: cls.classId, mean: cls.mean, sd: cls.sd, count: cls.studentCount }))
    : engagementData;

  // Y축 최댓값: 성적은 100 고정, 참여도는 동적
  const maxVal = mode === 'score'
    ? 100
    : Math.max(100, ...bars.map(b => b.mean + b.sd)) * 1.15;

  const chartW = 360;
  const chartH = 220;
  const padL = 36;
  const padR = 16;
  const padT = 24;
  const padB = 36;
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;

  const barCount = bars.length || 4;
  const gap = plotW / barCount;
  const barW = Math.min(56, gap * 0.6);

  const toY = (v: number) => padT + plotH * (1 - v / maxVal);
  const baseY = toY(0);

  // Y축 그리드 값
  const yTicks = mode === 'score'
    ? [0, 25, 50, 75, 100]
    : (() => {
      const step = Math.ceil(maxVal / 4 / 50) * 50; // 50 단위
      return [0, step, step * 2, step * 3, step * 4].filter(v => v <= maxVal * 1.05);
    })();

  return (
    <div>
      {/* 모드 토글 (SourceFilter 스타일) */}
      <div className="flex gap-4 mb-4">
        {MODE_OPTIONS.map(o => {
          const active = mode === o.value;
          return (
            <button
              key={o.value}
              onClick={() => setMode(o.value)}
              className="relative pb-1.5 text-lg font-bold transition-colors"
              style={{ color: active ? '#1A1A1A' : '#5C5C5C' }}
            >
              {o.label}
              {active && (
                <motion.div
                  layoutId="compare-underline"
                  className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#1A1A1A]"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
            </button>
          );
        })}
      </div>

      <p className="text-[10px] text-[#5C5C5C] mb-3">
        {mode === 'score'
          ? '평균 점수 (± SD) · 막대 클릭 시 클러스터 분석'
          : '평균 EXP (± SD)'}
      </p>

      <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full">
        <defs>
          <clipPath id="plot-clip">
            <rect x={padL} y={0} width={plotW} height={baseY + 1} />
          </clipPath>
        </defs>

        {/* Y축 그리드 + 라벨 */}
        {yTicks.map(v => {
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

        {/* 막대 + 에러바 */}
        <g clipPath="url(#plot-clip)">
          {bars.map((bar, i) => {
            const c = CLASS_COLORS[bar.classId] || CLASS_COLORS.A;
            const cx = padL + gap * i + gap / 2;
            const hasDat = bar.count > 0;
            const meanY = hasDat && bar.mean > 0 ? toY(bar.mean) : baseY;
            const barH = baseY - meanY;

            return (
              <g key={bar.classId}>
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

                {hasDat && bar.sd > 0 && (
                  <motion.g
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.5 + i * 0.1 }}
                  >
                    <line x1={cx} y1={toY(Math.min(maxVal, bar.mean + bar.sd))} x2={cx} y2={toY(Math.max(0, bar.mean - bar.sd))}
                      stroke={c.main} strokeWidth={1.5} />
                    <line x1={cx - 6} y1={toY(Math.min(maxVal, bar.mean + bar.sd))} x2={cx + 6} y2={toY(Math.min(maxVal, bar.mean + bar.sd))}
                      stroke={c.main} strokeWidth={1.5} />
                    <line x1={cx - 6} y1={toY(Math.max(0, bar.mean - bar.sd))} x2={cx + 6} y2={toY(Math.max(0, bar.mean - bar.sd))}
                      stroke={c.main} strokeWidth={1.5} />
                  </motion.g>
                )}
              </g>
            );
          })}
        </g>

        {/* 클릭 영역 + 라벨 */}
        {bars.map((bar, i) => {
          const c = CLASS_COLORS[bar.classId] || CLASS_COLORS.A;
          const cx = padL + gap * i + gap / 2;
          const hasDat = bar.count > 0;
          const meanY = hasDat && bar.mean > 0 ? toY(bar.mean) : baseY;

          return (
            <g key={`label-${bar.classId}`}
              className="cursor-pointer"
              onClick={() => onClassClick?.(bar.classId)}
            >
              <rect x={cx - gap / 2} y={padT} width={gap} height={chartH - padT}
                fill="transparent" />

              {hasDat && (
                <text x={cx} y={Math.min(meanY - 8, toY(Math.min(maxVal, bar.mean + bar.sd)) - 10)} textAnchor="middle"
                  fontSize={13} fill="#1A1A1A" fontWeight="bold">
                  {mode === 'score' ? bar.mean.toFixed(1) : Math.round(bar.mean)}
                </text>
              )}

              <text x={cx} y={baseY + 16} textAnchor="middle"
                fontSize={13} fill="#1A1A1A" fontWeight="bold">
                {c.label}
              </text>
              <text x={cx} y={baseY + 30} textAnchor="middle"
                fontSize={11} fill="#5C5C5C">
                {bar.count}명
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
