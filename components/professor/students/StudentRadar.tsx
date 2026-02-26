'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// 6축 라벨 + 설명
const AXES = [
  { key: 'quizScore', label: '정답률', info: '퀴즈 평균 정답률. 현재 학업 수준.' },
  { key: 'growth', label: '성장세', info: '오답 복습 후 극복률. 앱이 학습에 기여한 정도. 50이 기준선.' },
  { key: 'quizCreation', label: '출제력', info: '직접 만든 퀴즈 수의 백분위. 능동적 학습 참여.' },
  { key: 'community', label: '소통', info: '글·댓글·피드백 가중합의 백분위. 사회적 학습 참여.' },
  { key: 'review', label: '복습력', info: '실제 재풀이한 복습 수의 백분위. 학습 정착 노력.' },
  { key: 'activity', label: '활동량', info: '총 EXP의 백분위. 철권퀴즈 등 포함 종합 참여.' },
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

  const CX = 160;
  const CY = 150;
  const R = 110;
  const n = AXES.length;

  const getPoint = (i: number, value: number) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const r = (value / 100) * R;
    return { x: CX + r * Math.cos(angle), y: CY + r * Math.sin(angle) };
  };

  const gridLevels = [25, 50, 75, 100];

  // 학생 다각형
  const dataPoints = AXES.map((axis, i) => getPoint(i, data[axis.key]));
  const dataPath = dataPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + 'Z';

  return (
    <div className="relative">
      <svg viewBox="0 0 320 320" className="w-full" style={{ overflow: 'visible' }}>
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

        {/* 축 + 라벨 + ⓘ 버튼 */}
        {AXES.map((axis, i) => {
          const end = getPoint(i, 100);
          const labelPos = getPoint(i, 130);
          // ⓘ 아이콘: 라벨 오른쪽에 배치
          const infoX = labelPos.x + (axis.label.length * 6 + 8);
          const infoY = labelPos.y;

          return (
            <g key={axis.key}>
              <line x1={CX} y1={CY} x2={end.x} y2={end.y}
                stroke="#D4CFC4" strokeWidth={0.5} />
              <text
                x={labelPos.x} y={labelPos.y}
                textAnchor="middle" dominantBaseline="middle"
                fontSize={11} fill="#1A1A1A" fontWeight="700"
              >
                {axis.label}
              </text>
              {/* ⓘ 클릭 영역 */}
              <g
                onClick={() => setActiveTooltip(activeTooltip === i ? null : i)}
                style={{ cursor: 'pointer' }}
              >
                <circle cx={infoX} cy={infoY} r={6}
                  fill={activeTooltip === i ? '#1A1A1A' : 'none'}
                  stroke="#999" strokeWidth={0.8} />
                <text x={infoX} y={infoY + 0.5}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={8} fill={activeTooltip === i ? '#fff' : '#999'}
                  fontWeight="600" style={{ pointerEvents: 'none' }}>
                  i
                </text>
              </g>
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

        {/* 데이터 포인트 + 값 */}
        {dataPoints.map((p, i) => {
          const val = data[AXES[i].key];
          const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
          const cwAngle = angle + Math.PI / 2;
          const nx = p.x + 16 * Math.cos(cwAngle);
          const ny = p.y + 16 * Math.sin(cwAngle);

          return (
            <motion.g key={i}
              initial={{ scale: 0 }} animate={{ scale: 1 }}
              transition={{ delay: 0.2 + i * 0.05 }}>
              <circle cx={p.x} cy={p.y} r={4.5} fill="#FDFBF7"
                stroke={classColor} strokeWidth={2} />
              <circle cx={p.x} cy={p.y} r={1.5} fill={classColor} />
              {val > 0 && (
                <text x={nx} y={ny} textAnchor="middle" dominantBaseline="middle"
                  fontSize={11} fontWeight="bold" fill={classColor}>
                  {val.toFixed(0)}
                </text>
              )}
            </motion.g>
          );
        })}
      </svg>

      {/* 툴팁 오버레이 (HTML) */}
      <AnimatePresence>
        {activeTooltip !== null && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="absolute left-1/2 -translate-x-1/2 bottom-2 max-w-[260px]
              bg-[#1A1A1A] text-white text-[11px] leading-relaxed
              px-3 py-2 rounded-lg shadow-lg"
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
