'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// 6축 라벨 + 설명
const AXES = [
  { key: 'quizScore', label: '정답률', info: '퀴즈 평균 정답률 (절대값)' },
  { key: 'growth', label: '성장세', info: '오답 복습 후 극복률. 50 기준선' },
  { key: 'quizCreation', label: '출제력', info: '직접 만든 퀴즈 수 백분위' },
  { key: 'community', label: '소통', info: '글×3 + 피드백 가중합 백분위' },
  { key: 'review', label: '복습력', info: '재풀이한 복습 수 백분위' },
  { key: 'activity', label: '활동량', info: '총 EXP 백분위' },
] as const;

interface RadarData {
  quizScore: number;
  growth: number;
  quizCreation: number;
  community: number;
  review: number;
  activity: number;
}

interface Props {
  data: RadarData;
  classColor: string;
}

export default function StudentRadar({ data, classColor }: Props) {
  const [activeTooltip, setActiveTooltip] = useState<number | null>(null);

  // viewBox를 넉넉하게 — 라벨 + ⓘ가 잘리지 않도록
  const CX = 185;
  const CY = 180;
  const R = 100;
  const VIEWBOX_W = 370;
  const VIEWBOX_H = 370;
  const n = AXES.length;

  // 각 축의 각도
  const angles = AXES.map((_, i) => (Math.PI * 2 * i) / n - Math.PI / 2);

  const getPoint = (i: number, value: number) => {
    const r = (value / 100) * R;
    return { x: CX + r * Math.cos(angles[i]), y: CY + r * Math.sin(angles[i]) };
  };

  const gridLevels = [25, 50, 75, 100];

  // 학생 다각형
  const dataPoints = AXES.map((axis, i) => getPoint(i, data[axis.key]));
  const dataPath = dataPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + 'Z';

  // 축 라벨 위치 (차트 바깥 충분히 먼 곳 — 값 라벨과 겹치지 않게)
  const LABEL_R = R + 48;
  // 라벨 + ⓘ를 하나의 그룹으로 보고, ⓘ 폭(~10px)의 절반만큼 라벨을 왼쪽으로 이동하여 전체 중앙 정렬
  const INFO_ICON_OFFSET = 6; // ⓘ 아이콘 반폭 보정
  const labelPositions = angles.map(angle => ({
    x: CX + LABEL_R * Math.cos(angle) - INFO_ICON_OFFSET,
    y: CY + LABEL_R * Math.sin(angle),
  }));

  // ⓘ 버튼: 라벨 텍스트 바로 오른쪽에 배치
  const infoPositions = AXES.map((axis, i) => {
    const lp = labelPositions[i];
    const halfW = axis.label.length * 7.5; // 한글 문자 폭 추정
    const ix = lp.x + halfW + 10;
    const iy = lp.y;
    return { pctX: (ix / VIEWBOX_W) * 100, pctY: (iy / VIEWBOX_H) * 100 };
  });

  return (
    <div className="relative" onClick={() => setActiveTooltip(null)}>
      <svg viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`} className="w-full">
        {/* 배경 그리드 */}
        {gridLevels.map(level => {
          const pts = Array.from({ length: n }, (_, i) => getPoint(i, level));
          const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + 'Z';
          return (
            <g key={level}>
              <path d={path} fill="none" stroke={level === 50 ? '#D4CFC4' : '#EBE5D9'}
                strokeWidth={level === 50 ? 1 : 0.5} />
              <text x={CX + 4} y={CY - (level / 100) * R - 2} fontSize={8}
                fill="#D4CFC4">
                {level}
              </text>
            </g>
          );
        })}

        {/* 축 선 + 라벨 */}
        {AXES.map((axis, i) => {
          const end = getPoint(i, 100);
          const lp = labelPositions[i];

          return (
            <g key={axis.key}>
              <line x1={CX} y1={CY} x2={end.x} y2={end.y}
                stroke="#D4CFC4" strokeWidth={0.5} />
              <text
                x={lp.x} y={lp.y}
                textAnchor="middle" dominantBaseline="middle"
                fontSize={14} fill="#1A1A1A" fontWeight="700"
              >
                {axis.label}
              </text>
            </g>
          );
        })}

        {/* 학생 다각형 */}
        <defs>
          <radialGradient id="student-radar-fill" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={classColor} stopOpacity={0.05} />
            <stop offset="100%" stopColor={classColor} stopOpacity={0.25} />
          </radialGradient>
        </defs>

        <motion.path
          d={dataPath}
          fill="url(#student-radar-fill)"
          stroke={classColor} strokeWidth={2.5} strokeLinejoin="round"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          style={{ transformOrigin: `${CX}px ${CY}px` }}
        />

        {/* 데이터 포인트 + 값 라벨 (축 방향 바깥으로 배치) */}
        {dataPoints.map((p, i) => {
          const val = data[AXES[i].key];
          const angle = angles[i];
          // 값 라벨: 데이터 포인트에서 축 방향 바깥으로 16px
          const nx = p.x + 16 * Math.cos(angle);
          const ny = p.y + 16 * Math.sin(angle);

          return (
            <motion.g key={i}
              initial={{ scale: 0 }} animate={{ scale: 1 }}
              transition={{ delay: 0.2 + i * 0.05 }}>
              <circle cx={p.x} cy={p.y} r={5} fill="#FDFBF7"
                stroke={classColor} strokeWidth={2} />
              <circle cx={p.x} cy={p.y} r={2} fill={classColor} />
              {val > 0 && (
                <text x={nx} y={ny} textAnchor="middle" dominantBaseline="middle"
                  fontSize={13} fontWeight="bold" fill={classColor}>
                  {val.toFixed(0)}
                </text>
              )}
            </motion.g>
          );
        })}
      </svg>

      {/* ⓘ 버튼 — HTML 오버레이 (라벨 오른쪽에 나란히 배치) */}
      {infoPositions.map((pos, i) => (
        <button
          key={`info-${i}`}
          className="absolute w-7 h-7 flex items-center justify-center -ml-3.5 -mt-3.5"
          style={{ left: `${pos.pctX}%`, top: `${pos.pctY}%` }}
          onClick={(e) => { e.stopPropagation(); setActiveTooltip(activeTooltip === i ? null : i); }}
        >
          <span
            className={`w-4 h-4 rounded-full border text-[10px] font-semibold leading-none flex items-center justify-center transition-colors ${
              activeTooltip === i
                ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]'
                : 'bg-transparent text-[#999] border-[#999]'
            }`}
          >
            i
          </span>
        </button>
      ))}

      {/* 툴팁 — 차트 중앙에 겹쳐서 표시 (ⓘ 다시 터치로 닫기) */}
      <AnimatePresence>
        {activeTooltip !== null && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 max-w-[220px]
              bg-[#1A1A1A] text-white text-[11px] leading-relaxed
              px-3 py-2 rounded-lg shadow-lg z-10"
            onClick={() => setActiveTooltip(null)}
          >
            <span className="font-bold mr-1">{AXES[activeTooltip].label}</span>
            {AXES[activeTooltip].info}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
