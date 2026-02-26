'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import type { WeeklyDataPoint, ClassType } from '@/lib/hooks/useProfessorStats';
import { quartiles } from '@/lib/utils/statistics';

const CLASS_COLORS: Record<string, { main: string; light: string }> = {
  A: { main: '#8B1A1A', light: '#D4A5A5' },
  B: { main: '#B8860B', light: '#E8D5A3' },
  C: { main: '#1D5D4A', light: '#A8D4C5' },
  D: { main: '#1E3A5F', light: '#A8C4E0' },
};

type FilterMode = 'all' | ClassType;

interface Props {
  weeklyTrend: WeeklyDataPoint[];
}

export default function WeeklyBoxPlot({ weeklyTrend }: Props) {
  const [filter, setFilter] = useState<FilterMode>('all');

  if (weeklyTrend.length === 0) {
    return (
      <div className="bg-[#FDFBF7] border border-[#D4CFC4] p-5 shadow-[2px_2px_0px_#D4CFC4]">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-1 h-6 bg-[#1A1A1A]" />
          <h3 className="text-sm font-bold text-[#1A1A1A] tracking-wide uppercase">주차별 점수 분포</h3>
          <div className="flex-1 h-px bg-[#D4CFC4]" />
        </div>
        <p className="text-sm text-[#5C5C5C] text-center py-8">데이터가 없습니다</p>
      </div>
    );
  }

  // 주차별 scores 수집
  const weeklyBoxData = weeklyTrend.map(w => {
    let scores: number[];
    if (filter === 'all') {
      // 모든 반 점수 합산
      scores = (['A', 'B', 'C', 'D'] as ClassType[]).flatMap(cls => w.byClass[cls].scores);
    } else {
      scores = w.byClass[filter].scores;
    }
    return {
      week: w.week,
      weekNum: w.weekNum,
      bp: quartiles(scores),
      count: scores.length,
    };
  }).filter(w => w.count > 0);

  if (weeklyBoxData.length === 0) {
    return (
      <div className="bg-[#FDFBF7] border border-[#D4CFC4] p-5 shadow-[2px_2px_0px_#D4CFC4]">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-1 h-6 bg-[#1A1A1A]" />
          <h3 className="text-sm font-bold text-[#1A1A1A] tracking-wide uppercase">주차별 점수 분포</h3>
          <div className="flex-1 h-px bg-[#D4CFC4]" />
        </div>
        <p className="text-sm text-[#5C5C5C] text-center py-8">선택된 반에 데이터가 없습니다</p>
      </div>
    );
  }

  const W = 400;
  const H = 240;
  const PAD = { top: 25, right: 25, bottom: 50, left: 40 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const weeks = weeklyBoxData;
  const boxSpacing = plotW / Math.max(weeks.length, 1);
  const boxWidth = Math.min(30, boxSpacing * 0.6);

  const toX = (i: number) => PAD.left + boxSpacing * (i + 0.5);
  const toY = (v: number) => PAD.top + plotH - (v / 100) * plotH;

  // 색상 결정
  const color = filter === 'all'
    ? { main: '#1A1A1A', light: '#D4CFC4' }
    : CLASS_COLORS[filter];

  return (
    <div className="bg-[#FDFBF7] border border-[#D4CFC4] p-5 shadow-[2px_2px_0px_#D4CFC4]">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-1 h-6 bg-[#1A1A1A]" />
        <div>
          <h3 className="text-sm font-bold text-[#1A1A1A] tracking-wide uppercase">주차별 점수 분포</h3>
          <p className="text-[10px] text-[#5C5C5C]">Box Plot (min, Q1, 중앙값, Q3, max)</p>
        </div>
        <div className="flex-1 h-px bg-[#D4CFC4]" />
      </div>

      {/* 반 필터 */}
      <div className="flex gap-1.5 mb-4 ml-4">
        {(['all', 'A', 'B', 'C', 'D'] as FilterMode[]).map(mode => (
          <button
            key={mode}
            onClick={() => setFilter(mode)}
            className={`px-2.5 py-1 text-[10px] font-bold border transition-colors ${
              filter === mode
                ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                : 'border-[#D4CFC4] text-[#5C5C5C] hover:border-[#1A1A1A] hover:text-[#1A1A1A]'
            }`}
          >
            {mode === 'all' ? '전체' : `${mode}반`}
          </button>
        ))}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ overflow: 'visible' }}>
        {/* 배경 */}
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

        {/* 박스플롯 */}
        {weeks.map((w, i) => {
          const x = toX(i);
          const bp = w.bp;
          const halfBox = boxWidth / 2;

          return (
            <g key={w.week}>
              {/* 수염 (min ~ Q1, Q3 ~ max) */}
              <motion.line
                x1={x} y1={toY(bp.max)} x2={x} y2={toY(bp.q3)}
                stroke={color.main} strokeWidth={1.5} strokeDasharray="3,2"
                initial={{ opacity: 0 }} animate={{ opacity: 0.6 }}
                transition={{ delay: 0.2 + i * 0.05 }}
              />
              <motion.line
                x1={x} y1={toY(bp.q1)} x2={x} y2={toY(bp.min)}
                stroke={color.main} strokeWidth={1.5} strokeDasharray="3,2"
                initial={{ opacity: 0 }} animate={{ opacity: 0.6 }}
                transition={{ delay: 0.2 + i * 0.05 }}
              />

              {/* 수염 끝 */}
              <line x1={x - halfBox * 0.5} y1={toY(bp.max)} x2={x + halfBox * 0.5} y2={toY(bp.max)}
                stroke={color.main} strokeWidth={2} />
              <line x1={x - halfBox * 0.5} y1={toY(bp.min)} x2={x + halfBox * 0.5} y2={toY(bp.min)}
                stroke={color.main} strokeWidth={2} />

              {/* 상자 (Q1 ~ Q3) */}
              <motion.rect
                x={x - halfBox} y={toY(bp.q3)}
                width={boxWidth}
                height={Math.max(2, toY(bp.q1) - toY(bp.q3))}
                fill={color.light} stroke={color.main} strokeWidth={2}
                rx={2}
                initial={{ opacity: 0, scaleY: 0 }}
                animate={{ opacity: 1, scaleY: 1 }}
                transition={{ duration: 0.4, delay: i * 0.06 }}
                style={{ transformOrigin: `${x}px ${toY((bp.q1 + bp.q3) / 2)}px` }}
              />

              {/* 중앙값 */}
              <motion.line
                x1={x - halfBox} y1={toY(bp.median)} x2={x + halfBox} y2={toY(bp.median)}
                stroke={color.main} strokeWidth={3}
                initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
                transition={{ duration: 0.3, delay: 0.3 + i * 0.05 }}
              />

              {/* 이상치 */}
              {bp.outliers.map((o, j) => (
                <motion.circle
                  key={j} cx={x} cy={toY(o)} r={2.5}
                  fill="none" stroke={color.main} strokeWidth={1.5}
                  initial={{ scale: 0 }} animate={{ scale: 1 }}
                  transition={{ delay: 0.5 + j * 0.03 }}
                />
              ))}

              {/* X축 라벨 */}
              <text x={x} y={PAD.top + plotH + 16} textAnchor="middle" fontSize={9}
                fill="#5C5C5C" fontFamily="monospace">
                {w.week}
              </text>
            </g>
          );
        })}

        {/* 범례 */}
        <g transform={`translate(${PAD.left}, ${H - 10})`}>
          <rect width={10} height={6} fill={color.light} stroke={color.main} strokeWidth={1} rx={1} />
          <text x={14} y={5.5} fontSize={8} fill="#5C5C5C">IQR (Q1–Q3)</text>
          <line x1={60} y1={3} x2={70} y2={3} stroke={color.main} strokeWidth={2.5} />
          <text x={74} y={5.5} fontSize={8} fill="#5C5C5C">중앙값</text>
          <line x1={110} y1={3} x2={120} y2={3} stroke={color.main} strokeWidth={1.5} strokeDasharray="3,2" />
          <text x={124} y={5.5} fontSize={8} fill="#5C5C5C">수염</text>
        </g>
      </svg>
    </div>
  );
}
