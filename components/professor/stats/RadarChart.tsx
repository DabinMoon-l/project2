'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import type { ChapterStats } from '@/lib/hooks/useProfessorStats';

interface Props {
  chapterStats: ChapterStats[];
}

export default function RadarChart({ chapterStats }: Props) {
  const [selectedChapter, setSelectedChapter] = useState<string | null>(null);

  // 레이더에 표시할 데이터: 챕터 전체 or 선택된 챕터의 소주제
  const radarData = selectedChapter
    ? chapterStats.find(c => c.chapterId === selectedChapter)?.details.map(d => ({
        label: d.detailName.length > 8 ? d.detailName.slice(0, 8) + '…' : d.detailName,
        fullLabel: d.detailName,
        value: d.mean,
      })) || []
    : chapterStats.map(c => ({
        label: c.chapterName.length > 6 ? c.chapterName.slice(0, 6) + '…' : c.chapterName,
        fullLabel: c.chapterName,
        value: c.mean,
      }));

  if (radarData.length < 3) {
    return (
      <div className="bg-[#FDFBF7] border border-[#D4CFC4] p-5 shadow-[2px_2px_0px_#D4CFC4]">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-1 h-6 bg-[#1A1A1A]" />
          <h3 className="text-sm font-bold text-[#1A1A1A] tracking-wide uppercase">이해도 레이더</h3>
          <div className="flex-1 h-px bg-[#D4CFC4]" />
        </div>
        <p className="text-sm text-[#5C5C5C] text-center py-8">
          {radarData.length === 0 ? '데이터가 없습니다' : '축이 3개 이상 필요합니다'}
        </p>
      </div>
    );
  }

  const CX = 200;
  const CY = 160;
  const R = 110;
  const n = radarData.length;

  const getPoint = (i: number, value: number) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const r = (value / 100) * R;
    return { x: CX + r * Math.cos(angle), y: CY + r * Math.sin(angle) };
  };

  const gridLevels = [25, 50, 75, 100];
  const dataPoints = radarData.map((d, i) => getPoint(i, d.value));
  const dataPath = dataPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + 'Z';

  // 60% 기준선 — 이해 부족 경계
  const thresholdPoints = Array.from({ length: n }, (_, i) => getPoint(i, 60));
  const thresholdPath = thresholdPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + 'Z';

  // 취약 영역 (60% 미만) 수
  const weakCount = radarData.filter(d => d.value > 0 && d.value < 60).length;

  return (
    <div className="bg-[#FDFBF7] border border-[#D4CFC4] p-5 shadow-[2px_2px_0px_#D4CFC4]">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-1 h-6 bg-[#1A1A1A]" />
        <h3 className="text-sm font-bold text-[#1A1A1A] tracking-wide uppercase">이해도 레이더</h3>
        <div className="flex-1 h-px bg-[#D4CFC4]" />
        {selectedChapter && (
          <button
            onClick={() => setSelectedChapter(null)}
            className="text-[10px] text-[#5C5C5C] hover:text-[#1A1A1A] px-2 py-0.5 border border-[#D4CFC4] bg-[#EBE5D9]"
          >
            전체 보기
          </button>
        )}
      </div>

      {/* 취약 영역 요약 */}
      {weakCount > 0 && (
        <p className="text-[10px] ml-4 mb-2 text-[#8B1A1A] font-bold">
          60% 미만 영역 {weakCount}개
        </p>
      )}

      {/* 챕터 선택 탭 */}
      <div className="flex gap-1.5 flex-wrap mb-4 ml-4">
        <button
          onClick={() => setSelectedChapter(null)}
          className={`relative px-2.5 py-1 text-[10px] font-bold border transition-colors ${
            !selectedChapter
              ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
              : 'border-[#D4CFC4] text-[#5C5C5C] hover:border-[#1A1A1A] hover:text-[#1A1A1A]'
          }`}
        >
          전체
        </button>
        {chapterStats.filter(c => c.details.length >= 3).map(c => (
          <button
            key={c.chapterId}
            onClick={() => setSelectedChapter(c.chapterId)}
            className={`relative px-2.5 py-1 text-[10px] font-bold border transition-colors ${
              selectedChapter === c.chapterId
                ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                : 'border-[#D4CFC4] text-[#5C5C5C] hover:border-[#1A1A1A] hover:text-[#1A1A1A]'
            }`}
          >
            {c.chapterName}
          </button>
        ))}
      </div>

      <svg viewBox="0 0 400 340" className="w-full" style={{ overflow: 'visible' }}>
        {/* 배경 원형 그리드 */}
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

        {/* 60% 기준선 (위험 경계) */}
        <path d={thresholdPath} fill="none" stroke="#8B1A1A" strokeWidth={0.8}
          strokeDasharray="4,3" opacity={0.5} />

        {/* 축 */}
        {radarData.map((d, i) => {
          const end = getPoint(i, 100);
          const labelPos = getPoint(i, 122);
          const isWeak = d.value > 0 && d.value < 60;
          return (
            <g key={i}>
              <line x1={CX} y1={CY} x2={end.x} y2={end.y}
                stroke="#D4CFC4" strokeWidth={0.5} />
              <text
                x={labelPos.x} y={labelPos.y}
                textAnchor="middle" dominantBaseline="middle"
                fontSize={9}
                fill={isWeak ? '#8B1A1A' : '#1A1A1A'}
                fontWeight={isWeak ? 'bold' : '600'}
              >
                {d.label}
              </text>
            </g>
          );
        })}

        {/* 데이터 영역 — 그라데이션 */}
        <defs>
          <radialGradient id="radar-fill" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#1D5D4A" stopOpacity={0.05} />
            <stop offset="100%" stopColor="#1D5D4A" stopOpacity={0.25} />
          </radialGradient>
        </defs>

        <motion.path
          d={dataPath}
          fill="url(#radar-fill)"
          stroke="#1D5D4A" strokeWidth={2.5} strokeLinejoin="round"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          style={{ transformOrigin: `${CX}px ${CY}px` }}
        />

        {/* 데이터 포인트 + 값 레이블 */}
        {dataPoints.map((p, i) => {
          const val = radarData[i].value;
          const isWeak = val > 0 && val < 60;
          // 값 레이블 위치: 포인트에서 약간 바깥
          const labelAngle = (Math.PI * 2 * i) / n - Math.PI / 2;
          const labelR = (val / 100) * R + 14;
          const lx = CX + labelR * Math.cos(labelAngle);
          const ly = CY + labelR * Math.sin(labelAngle);

          return (
            <motion.g key={i}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.3 + i * 0.05 }}
            >
              {/* 포인트 */}
              <circle cx={p.x} cy={p.y} r={5} fill="#FDFBF7"
                stroke={isWeak ? '#8B1A1A' : '#1D5D4A'} strokeWidth={2.5} />
              <circle cx={p.x} cy={p.y} r={2} fill={isWeak ? '#8B1A1A' : '#1D5D4A'} />

              {/* 값 레이블 */}
              {val > 0 && (
                <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
                  fontSize={9} fontWeight="bold" fontFamily="monospace"
                  fill={isWeak ? '#8B1A1A' : '#1D5D4A'}>
                  {val.toFixed(0)}
                </text>
              )}
            </motion.g>
          );
        })}
      </svg>

      {/* 범례 */}
      <div className="flex items-center justify-center gap-4 mt-2 text-[10px] text-[#5C5C5C]">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-0.5 bg-[#1D5D4A]" />
          <span>평균 정답률</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-0.5 border-t border-dashed border-[#8B1A1A]" />
          <span>60% 기준선</span>
        </div>
      </div>
    </div>
  );
}
