'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { readRadarNormCache, type RadarNormData } from '@/lib/utils/radarNormCache';
import { rankPercentile } from '@/lib/utils/statistics';

// 반별 색상 (테마 accent와 동일)
const CLASS_COLORS: Record<string, { main: string; light: string }> = {
  A: { main: '#8B1A1A', light: '#D4A5A5' },
  B: { main: '#B8860B', light: '#E8D5A3' },
  C: { main: '#1D5D4A', light: '#A8D4C5' },
  D: { main: '#1E3A5F', light: '#A8C4E0' },
};

// 5축 (StudentRadar 동일)
const AXES = [
  { key: 'quizScore', label: '퀴즈' },
  { key: 'battle', label: '배틀' },
  { key: 'quizCreation', label: '출제력' },
  { key: 'community', label: '소통' },
  { key: 'activity', label: '활동량' },
] as const;

type AxisKey = (typeof AXES)[number]['key'];

interface ClassProfile {
  quizScore: number;
  battle: number;
  quizCreation: number;
  community: number;
  activity: number;
}

interface Props {
  courseId: string;
}

// radarNormData에서 반별 5축 평균 계산
function computeClassProfiles(norm: RadarNormData): Record<string, ClassProfile> {
  const classStudents: Record<string, string[]> = { A: [], B: [], C: [], D: [] };

  for (const [uid, cls] of Object.entries(norm.studentClassMap)) {
    if (classStudents[cls]) classStudents[cls].push(uid);
  }

  const profiles: Record<string, ClassProfile> = {};

  for (const cls of ['A', 'B', 'C', 'D']) {
    const uids = classStudents[cls];
    if (uids.length === 0) {
      profiles[cls] = { quizScore: 0, battle: 0, quizCreation: 0, community: 0, activity: 0 };
      continue;
    }

    let sumQuizScore = 0, sumBattle = 0, sumQuizCreation = 0;
    let sumCommunity = 0, sumActivity = 0;

    for (const uid of uids) {
      sumQuizScore += rankPercentile(norm.weightedScoreByUid[uid] ?? 0, norm.weightedScoreValues ?? []);
      sumBattle += rankPercentile(norm.battleByUid?.[uid] ?? 0, norm.battleValues ?? []);
      sumQuizCreation += rankPercentile(norm.quizCreationByUid[uid] ?? 0, norm.quizCreationCounts);
      sumCommunity += rankPercentile(norm.communityByUid[uid] ?? 0, norm.communityScores);
      sumActivity += rankPercentile(norm.expByUid[uid] ?? 0, norm.expValues);
    }

    const n = uids.length;
    profiles[cls] = {
      quizScore: sumQuizScore / n,
      battle: sumBattle / n,
      quizCreation: sumQuizCreation / n,
      community: sumCommunity / n,
      activity: sumActivity / n,
    };
  }

  return profiles;
}

export default function ClassProfileRadar({ courseId }: Props) {
  const [hoveredClass, setHoveredClass] = useState<string | null>(null);
  const [classProfiles, setClassProfiles] = useState<Record<string, ClassProfile> | null>(null);

  useEffect(() => {
    const { data } = readRadarNormCache(courseId);
    if (data) {
      setClassProfiles(computeClassProfiles(data));
    } else {
      setClassProfiles(null);
    }
  }, [courseId]);

  const activeClasses = ['A', 'B', 'C', 'D'];

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
  const emptyProfile: ClassProfile = { quizScore: 0, battle: 0, quizCreation: 0, community: 0, activity: 0 };

  const getClassPath = (cls: string) => {
    const profile = classProfiles?.[cls] || emptyProfile;
    const points = AXES.map((axis, i) => getPoint(i, profile[axis.key]));
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + 'Z';
  };

  if (!classProfiles) {
    return (
      <div>
        <h3 className="text-lg font-bold text-[#1A1A1A] mb-1">반별 종합 역량</h3>
        <p className="text-sm text-[#5C5C5C] text-center py-8">레이더 데이터를 불러오는 중...</p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-lg font-bold text-[#1A1A1A] mb-1">반별 종합 역량</h3>
      <p className="text-[10px] text-[#5C5C5C] mb-2">퀴즈 · 배틀 · 출제력 · 소통 · 활동량</p>

      <svg viewBox="0 0 400 360" className="w-full" style={{ overflow: 'visible' }}>
        <defs>
          {activeClasses.map(cls => {
            const c = CLASS_COLORS[cls];
            return (
              <radialGradient key={cls} id={`class-fill-${cls}`} cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor={c.main} stopOpacity={0.05} />
                <stop offset="100%" stopColor={c.main} stopOpacity={0.25} />
              </radialGradient>
            );
          })}
        </defs>

        {/* 배경 그리드 */}
        {gridLevels.map(level => {
          const pts = Array.from({ length: n }, (_, i) => getPoint(i, level));
          const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + 'Z';
          return (
            <g key={level}>
              <path d={path} fill="none" stroke={level === 50 ? '#D4CFC4' : '#EBE5D9'}
                strokeWidth={level === 50 ? 1 : 0.5} />
              <text x={CX + 4} y={CY - (level / 100) * R - 2} fontSize={9}
                fill="#D4CFC4">
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
                fontSize={13} fill="#1A1A1A" fontWeight="700"
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
              fill={`url(#class-fill-${cls})`}
              fillOpacity={isHovered ? 1.2 : 1}
              stroke={cc.main}
              strokeWidth={isHovered ? 3 : 2.5}
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
          const profile = classProfiles[cls] || emptyProfile;
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
      <div className="flex justify-center gap-5 mt-2">
        {activeClasses.map(cls => {
          const cc = CLASS_COLORS[cls];
          return (
            <button
              key={cls}
              onPointerEnter={() => setHoveredClass(cls)}
              onPointerLeave={() => setHoveredClass(null)}
              className="flex items-center gap-1.5 transition-opacity"
              style={{ opacity: hoveredClass && hoveredClass !== cls ? 0.4 : 1 }}
            >
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: cc.main }} />
              <span className="text-xs font-bold text-[#1A1A1A]">{cls}반</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
