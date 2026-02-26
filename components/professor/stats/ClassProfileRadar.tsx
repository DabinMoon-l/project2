'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';

// 반별 색상 (테마 accent와 동일)
const CLASS_COLORS: Record<string, { main: string; light: string }> = {
  A: { main: '#8B1A1A', light: '#D4A5A5' },
  B: { main: '#B8860B', light: '#E8D5A3' },
  C: { main: '#1D5D4A', light: '#A8D4C5' },
  D: { main: '#1E3A5F', light: '#A8C4E0' },
};

// 6축 라벨
const AXES = [
  { key: 'score', label: '평균 점수' },
  { key: 'stability', label: '안정성' },
  { key: 'participation', label: '참여율' },
  { key: 'feedback', label: '피드백' },
  { key: 'board', label: '게시판' },
  { key: 'gamification', label: '마일스톤' },
] as const;

type AxisKey = (typeof AXES)[number]['key'];

interface ClassProfile {
  score: number;
  stability: number;
  participation: number;
  feedback: number;
  board: number;
  gamification: number;
}

interface Props {
  classProfileData: Record<string, ClassProfile>;
}

export default function ClassProfileRadar({ classProfileData }: Props) {
  const [hoveredClass, setHoveredClass] = useState<string | null>(null);

  // 데이터 있는 반만 필터
  const activeClasses = ['A', 'B', 'C', 'D'].filter(cls => {
    const p = classProfileData[cls];
    return p && (p.score > 0 || p.stability > 0 || p.participation > 0);
  });

  if (activeClasses.length === 0) {
    return (
      <div className="bg-[#FDFBF7] border border-[#D4CFC4] p-5 shadow-[2px_2px_0px_#D4CFC4]">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-1 h-6 bg-[#1A1A1A]" />
          <h3 className="text-sm font-bold text-[#1A1A1A] tracking-wide uppercase">반별 종합 역량</h3>
          <div className="flex-1 h-px bg-[#D4CFC4]" />
        </div>
        <p className="text-sm text-[#5C5C5C] text-center py-8">데이터가 없습니다</p>
      </div>
    );
  }

  const CX = 200;
  const CY = 170;
  const R = 120;
  const n = AXES.length;

  const getPoint = (i: number, value: number) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const r = (value / 100) * R;
    return { x: CX + r * Math.cos(angle), y: CY + r * Math.sin(angle) };
  };

  const gridLevels = [25, 50, 75, 100];

  // 반별 다각형 path 생성
  const getClassPath = (cls: string) => {
    const profile = classProfileData[cls];
    if (!profile) return '';
    const points = AXES.map((axis, i) => getPoint(i, profile[axis.key]));
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + 'Z';
  };

  return (
    <div className="bg-[#FDFBF7] border border-[#D4CFC4] p-5 shadow-[2px_2px_0px_#D4CFC4]">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-1 h-6 bg-[#1A1A1A]" />
        <h3 className="text-sm font-bold text-[#1A1A1A] tracking-wide uppercase">반별 종합 역량</h3>
        <div className="flex-1 h-px bg-[#D4CFC4]" />
      </div>

      <svg viewBox="0 0 400 360" className="w-full" style={{ overflow: 'visible' }}>
        {/* 배경 그리드 */}
        {gridLevels.map(level => {
          const pts = Array.from({ length: n }, (_, i) => getPoint(i, level));
          const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + 'Z';
          return (
            <g key={level}>
              <path d={path} fill="none" stroke={level === 50 ? '#D4CFC4' : '#EBE5D9'}
                strokeWidth={level === 50 ? 1 : 0.5} />
              <text x={CX + 4} y={CY - (level / 100) * R - 2} fontSize={8}
                fill="#D4CFC4" fontFamily="monospace">
                {level}
              </text>
            </g>
          );
        })}

        {/* 축 + 라벨 */}
        {AXES.map((axis, i) => {
          const end = getPoint(i, 100);
          const labelPos = getPoint(i, 125);
          return (
            <g key={axis.key}>
              <line x1={CX} y1={CY} x2={end.x} y2={end.y}
                stroke="#D4CFC4" strokeWidth={0.5} />
              <text
                x={labelPos.x} y={labelPos.y}
                textAnchor="middle" dominantBaseline="middle"
                fontSize={9} fill="#1A1A1A" fontWeight="600"
              >
                {axis.label}
              </text>
            </g>
          );
        })}

        {/* 반별 다각형 */}
        {activeClasses.map(cls => {
          const path = getClassPath(cls);
          const cc = CLASS_COLORS[cls];
          const isHovered = hoveredClass === cls;
          const isOtherHovered = hoveredClass !== null && hoveredClass !== cls;

          return (
            <motion.path
              key={cls}
              d={path}
              fill={cc.main}
              fillOpacity={isHovered ? 0.2 : 0.1}
              stroke={cc.main}
              strokeWidth={isHovered ? 3 : 2}
              strokeLinejoin="round"
              opacity={isOtherHovered ? 0.3 : 1}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{
                opacity: isOtherHovered ? 0.3 : 1,
                scale: 1,
              }}
              transition={{ duration: 0.4 }}
              style={{ transformOrigin: `${CX}px ${CY}px` }}
            />
          );
        })}

        {/* 반별 꼭짓점 포인트 */}
        {activeClasses.map(cls => {
          const profile = classProfileData[cls];
          if (!profile) return null;
          const cc = CLASS_COLORS[cls];
          const isOtherHovered = hoveredClass !== null && hoveredClass !== cls;

          return AXES.map((axis, i) => {
            const p = getPoint(i, profile[axis.key]);
            return (
              <circle
                key={`${cls}-${axis.key}`}
                cx={p.x} cy={p.y} r={3}
                fill={cc.main}
                opacity={isOtherHovered ? 0.3 : 1}
              />
            );
          });
        })}
      </svg>

      {/* 범례 */}
      <div className="flex justify-center gap-3 mt-2">
        {activeClasses.map(cls => {
          const cc = CLASS_COLORS[cls];
          return (
            <button
              key={cls}
              onPointerEnter={() => setHoveredClass(cls)}
              onPointerLeave={() => setHoveredClass(null)}
              className="flex items-center gap-1.5 px-2 py-1 border border-[#D4CFC4] transition-colors"
              style={{
                backgroundColor: hoveredClass === cls ? cc.light : 'transparent',
                borderColor: hoveredClass === cls ? cc.main : '#D4CFC4',
              }}
            >
              <div className="w-3 h-3" style={{ backgroundColor: cc.main }} />
              <span className="text-[10px] font-bold text-[#1A1A1A]">{cls}반</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
