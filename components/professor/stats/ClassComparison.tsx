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

// 박스플롯 데이터
interface BoxPlotData {
  classId: string;
  q1: number;
  median: number;
  q3: number;
  whiskerLow: number;
  whiskerHigh: number;
  outliers: number[];
  count: number;
}

function calcBoxPlot(values: number[]): Omit<BoxPlotData, 'classId' | 'count'> {
  if (values.length === 0) return { q1: 0, median: 0, q3: 0, whiskerLow: 0, whiskerHigh: 0, outliers: [] };
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const median = sorted[Math.floor(n / 2)];
  const q1 = sorted[Math.floor(n * 0.25)];
  const q3 = sorted[Math.floor(n * 0.75)];
  const iqr = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;
  const whiskerLow = sorted.find(v => v >= lowerFence) ?? q1;
  const whiskerHigh = [...sorted].reverse().find(v => v <= upperFence) ?? q3;
  const outliers = sorted.filter(v => v < lowerFence || v > upperFence);
  return { q1, median, q3, whiskerLow, whiskerHigh, outliers };
}

// 성적 비교용 타입
interface BarData {
  classId: string;
  mean: number;
  sd: number;
  count: number;
}

function calcMean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}
function calcSd(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = calcMean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

export default function ClassComparison({ classStats, students, onClassClick }: Props) {
  const [mode, setMode] = useState<CompareMode>('score');

  // ── 참여도 박스플롯 데이터 ──
  const boxPlots = useMemo<BoxPlotData[]>(() => {
    const classIds = classStats.map(c => c.classId);
    return classIds.map(classId => {
      const exps = students.filter(s => s.classId === classId).map(s => s.totalExp || 0);
      return { classId, count: exps.length, ...calcBoxPlot(exps) };
    });
  }, [classStats, students]);

  // ── 공통 차트 크기 ──
  const chartW = 360;
  const chartH = 240;
  const padL = 44;
  const padR = 16;
  const padT = 24;
  const padB = 36;
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;
  const colCount = classStats.length || 4;
  const gap = plotW / colCount;
  const boxW = Math.min(44, gap * 0.5);

  // ── 성적 비교 (기존 막대 차트) ──
  if (mode === 'score') {
    const maxVal = 100;
    const toY = (v: number) => padT + plotH * (1 - v / maxVal);
    const baseY = toY(0);
    const barW = Math.min(56, gap * 0.6);

    return (
      <div>
        <ModeToggle mode={mode} setMode={setMode} />
        <p className="text-[10px] text-[#5C5C5C] mb-3">평균 점수 (± SD) · 막대 클릭 시 클러스터 분석</p>

        <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full">
          <defs>
            <clipPath id="plot-clip">
              <rect x={padL} y={0} width={plotW} height={baseY + 1} />
            </clipPath>
          </defs>

          {[0, 25, 50, 75, 100].map(v => (
            <g key={v}>
              <line x1={padL} y1={toY(v)} x2={chartW - padR} y2={toY(v)}
                stroke={v === 0 ? '#D4CFC4' : '#EBE5D9'} strokeWidth={v === 0 ? 1 : 0.5} />
              <text x={padL - 6} y={toY(v) + 4} textAnchor="end" fontSize={12} fill="#5C5C5C" fontWeight="500">{v}</text>
            </g>
          ))}

          <g clipPath="url(#plot-clip)">
            {classStats.map((cls, i) => {
              const c = CLASS_COLORS[cls.classId];
              const cx = padL + gap * i + gap / 2;
              const hasDat = cls.scores.length > 0;
              const meanY = hasDat ? toY(cls.mean) : baseY;
              const barH = baseY - meanY;

              return (
                <g key={cls.classId}>
                  {hasDat && barH > 0 && (
                    <motion.rect x={cx - barW / 2} width={barW} fill={c.fill} stroke={c.main} strokeWidth={2} rx={2}
                      initial={{ y: baseY, height: 0 }} animate={{ y: meanY, height: barH }}
                      transition={{ duration: 0.6, delay: i * 0.1, ease: 'easeOut' }} />
                  )}
                  {hasDat && cls.sd > 0 && (
                    <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 + i * 0.1 }}>
                      <line x1={cx} y1={toY(Math.min(100, cls.mean + cls.sd))} x2={cx} y2={toY(Math.max(0, cls.mean - cls.sd))} stroke={c.main} strokeWidth={1.5} />
                      <line x1={cx - 6} y1={toY(Math.min(100, cls.mean + cls.sd))} x2={cx + 6} y2={toY(Math.min(100, cls.mean + cls.sd))} stroke={c.main} strokeWidth={1.5} />
                      <line x1={cx - 6} y1={toY(Math.max(0, cls.mean - cls.sd))} x2={cx + 6} y2={toY(Math.max(0, cls.mean - cls.sd))} stroke={c.main} strokeWidth={1.5} />
                    </motion.g>
                  )}
                </g>
              );
            })}
          </g>

          {classStats.map((cls, i) => {
            const c = CLASS_COLORS[cls.classId];
            const cx = padL + gap * i + gap / 2;
            const hasDat = cls.scores.length > 0;
            const meanY = hasDat ? toY(cls.mean) : baseY;
            return (
              <g key={`label-${cls.classId}`} className="cursor-pointer" onClick={() => onClassClick?.(cls.classId)}>
                <rect x={cx - gap / 2} y={padT} width={gap} height={chartH - padT} fill="transparent" />
                {hasDat && (
                  <text x={cx} y={Math.min(meanY - 8, toY(Math.min(100, cls.mean + cls.sd)) - 10)} textAnchor="middle" fontSize={13} fill="#1A1A1A" fontWeight="bold">
                    {cls.mean.toFixed(1)}
                  </text>
                )}
                <text x={cx} y={baseY + 16} textAnchor="middle" fontSize={13} fill="#1A1A1A" fontWeight="bold">{c.label}</text>
                <text x={cx} y={baseY + 30} textAnchor="middle" fontSize={11} fill="#5C5C5C">{cls.studentCount}명</text>
              </g>
            );
          })}
        </svg>
      </div>
    );
  }

  // ── 참여도 비교 (박스플롯) ──
  // Y축: whisker 범위 기반, 이상치는 위에 점으로
  const maxVal = useMemo(() => {
    const whiskerMax = Math.max(...boxPlots.map(b => b.whiskerHigh), 0);
    return Math.max(50, whiskerMax * 1.25);
  }, [boxPlots]);

  const toY = (v: number) => padT + plotH * (1 - Math.min(v, maxVal) / maxVal);
  const baseY = toY(0);

  // Y축 틱 (깔끔한 간격)
  const yTicks = useMemo(() => {
    const step = Math.pow(10, Math.floor(Math.log10(maxVal / 4)));
    const niceStep = [1, 2, 5, 10, 20, 50, 100, 200, 500].find(s => s * step >= maxVal / 5) || 1;
    const tickStep = niceStep * (step < 1 ? 1 : step / (step > 1 ? 1 : 1));
    const realStep = tickStep > 0 ? tickStep : 50;
    const ticks: number[] = [];
    for (let v = 0; v <= maxVal * 1.05; v += realStep) ticks.push(Math.round(v));
    return ticks.length > 0 ? ticks : [0];
  }, [maxVal]);

  return (
    <div>
      <ModeToggle mode={mode} setMode={setMode} />
      <p className="text-[10px] text-[#5C5C5C] mb-3">EXP 분포 (박스플롯) · 점 = 이상치</p>

      <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full">
        {/* Y축 그리드 */}
        {yTicks.map(v => (
          <g key={v}>
            <line x1={padL} y1={toY(v)} x2={chartW - padR} y2={toY(v)}
              stroke={v === 0 ? '#D4CFC4' : '#EBE5D9'} strokeWidth={v === 0 ? 1 : 0.5} />
            <text x={padL - 6} y={toY(v) + 4} textAnchor="end" fontSize={11} fill="#5C5C5C" fontWeight="500">{v}</text>
          </g>
        ))}

        {/* 박스플롯 */}
        {boxPlots.map((bp, i) => {
          const c = CLASS_COLORS[bp.classId] || CLASS_COLORS.A;
          const cx = padL + gap * i + gap / 2;
          if (bp.count === 0) return (
            <g key={bp.classId}>
              <text x={cx} y={baseY + 16} textAnchor="middle" fontSize={13} fill="#1A1A1A" fontWeight="bold">{c.label}</text>
              <text x={cx} y={baseY + 30} textAnchor="middle" fontSize={11} fill="#5C5C5C">0명</text>
            </g>
          );

          const q1Y = toY(bp.q1);
          const q3Y = toY(bp.q3);
          const medY = toY(bp.median);
          const wLowY = toY(bp.whiskerLow);
          const wHighY = toY(bp.whiskerHigh);
          const boxH = q1Y - q3Y;

          return (
            <g key={bp.classId} className="cursor-pointer" onClick={() => onClassClick?.(bp.classId)}>
              {/* Whisker 세로선 */}
              <motion.line x1={cx} y1={wHighY} x2={cx} y2={wLowY}
                stroke={c.main} strokeWidth={1.5}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.1 }} />
              {/* Whisker 가로 캡 */}
              <line x1={cx - boxW * 0.3} y1={wHighY} x2={cx + boxW * 0.3} y2={wHighY} stroke={c.main} strokeWidth={1.5} />
              <line x1={cx - boxW * 0.3} y1={wLowY} x2={cx + boxW * 0.3} y2={wLowY} stroke={c.main} strokeWidth={1.5} />

              {/* 박스 (Q1~Q3) */}
              <motion.rect x={cx - boxW / 2} y={q3Y} width={boxW} height={Math.max(boxH, 1)}
                fill={c.fill} stroke={c.main} strokeWidth={2} rx={2}
                initial={{ opacity: 0, scaleY: 0 }} animate={{ opacity: 1, scaleY: 1 }}
                style={{ transformOrigin: `${cx}px ${q1Y}px` }}
                transition={{ duration: 0.5, delay: i * 0.1 }} />

              {/* 중앙값 선 */}
              <motion.line x1={cx - boxW / 2 + 2} y1={medY} x2={cx + boxW / 2 - 2} y2={medY}
                stroke={c.main} strokeWidth={2.5}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 + i * 0.1 }} />

              {/* 이상치 점 */}
              {bp.outliers.map((val, oi) => {
                // 이상치는 Y축 상한 밖이면 상한 위치에 표시
                const oy = val > maxVal ? padT - 2 : toY(val);
                return (
                  <motion.circle key={oi} cx={cx} cy={oy} r={3}
                    fill="none" stroke={c.main} strokeWidth={1.5}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 + i * 0.1 }} />
                );
              })}

              {/* 중앙값 라벨 */}
              <text x={cx + boxW / 2 + 4} y={medY + 4} textAnchor="start" fontSize={11} fill="#1A1A1A" fontWeight="bold">
                {Math.round(bp.median)}
              </text>

              {/* X축 라벨 */}
              <text x={cx} y={baseY + 16} textAnchor="middle" fontSize={13} fill="#1A1A1A" fontWeight="bold">{c.label}</text>
              <text x={cx} y={baseY + 30} textAnchor="middle" fontSize={11} fill="#5C5C5C">{bp.count}명</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// 모드 토글 컴포넌트
function ModeToggle({ mode, setMode }: { mode: CompareMode; setMode: (m: CompareMode) => void }) {
  return (
    <div className="flex gap-4 mb-4">
      {MODE_OPTIONS.map(o => {
        const active = mode === o.value;
        return (
          <button key={o.value} onClick={() => setMode(o.value)}
            className="relative pb-1.5 text-lg font-bold transition-colors"
            style={{ color: active ? '#1A1A1A' : '#5C5C5C' }}>
            {o.label}
            {active && (
              <motion.div layoutId="compare-underline"
                className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#1A1A1A]"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }} />
            )}
          </button>
        );
      })}
    </div>
  );
}
