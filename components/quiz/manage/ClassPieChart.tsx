'use client';

import { motion } from 'framer-motion';

/**
 * 반별 참여 파이차트 (도넛형, 클릭으로 필터링)
 */
export default function ClassPieChart({
  counts,
  selectedClass,
  onSelectClass,
}: {
  counts: Record<string, number>;
  selectedClass: string;
  onSelectClass: (classType: string) => void;
}) {
  const total = counts.A + counts.B + counts.C + counts.D;

  // 반별 색상 (온보딩 원색 기준)
  const classColors: Record<string, string> = {
    A: '#EF4444', // 빨강
    B: '#EAB308', // 노랑
    C: '#22C55E', // 초록
    D: '#3B82F6', // 파랑
  };

  // 파이 조각 계산
  const classes = ['A', 'B', 'C', 'D'] as const;
  let currentAngle = -90; // 12시 방향에서 시작

  const slices = classes.map((cls) => {
    const count = counts[cls] || 0;
    const percentage = total > 0 ? (count / total) * 100 : 25;
    const angle = (percentage / 100) * 360;
    const startAngle = currentAngle;
    const endAngle = currentAngle + angle;
    currentAngle = endAngle;

    return {
      class: cls,
      count,
      percentage,
      startAngle,
      endAngle,
      color: classColors[cls],
    };
  });

  // SVG 파이 조각 경로 생성
  const createSlicePath = (startAngle: number, endAngle: number, radius: number, innerRadius: number = 0) => {
    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;

    const x1 = 50 + radius * Math.cos(startRad);
    const y1 = 50 + radius * Math.sin(startRad);
    const x2 = 50 + radius * Math.cos(endRad);
    const y2 = 50 + radius * Math.sin(endRad);

    const largeArc = endAngle - startAngle > 180 ? 1 : 0;

    if (innerRadius > 0) {
      const ix1 = 50 + innerRadius * Math.cos(startRad);
      const iy1 = 50 + innerRadius * Math.sin(startRad);
      const ix2 = 50 + innerRadius * Math.cos(endRad);
      const iy2 = 50 + innerRadius * Math.sin(endRad);

      return `M ${ix1} ${iy1} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${ix1} ${iy1} Z`;
    }

    return `M 50 50 L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
  };

  if (total === 0) {
    return (
      <div className="flex flex-col items-center gap-2">
        <div className="relative w-24 h-24">
          <svg viewBox="0 0 100 100" className="w-full h-full">
            <circle cx="50" cy="50" r="40" fill="#D4CFC4" />
            <circle cx="50" cy="50" r="25" fill="#F5F0E8" />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs text-[#5C5C5C]">없음</span>
          </div>
        </div>
        <button
          onClick={() => onSelectClass('all')}
          className={`px-3 py-1 text-sm border-2 transition-all ${
            selectedClass === 'all'
              ? 'border-[#1A1A1A] bg-[#1A1A1A] text-[#F5F0E8]'
              : 'border-[#D4CFC4] text-[#5C5C5C] hover:border-[#1A1A1A]'
          }`}
        >
          전체 (0)
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-28 h-28">
        <svg viewBox="0 0 100 100" className="w-full h-full">
          {slices.map((slice) => (
            <motion.path
              key={slice.class}
              d={createSlicePath(slice.startAngle, slice.endAngle, 40, 20)}
              fill={slice.color}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{
                opacity: selectedClass === 'all' || selectedClass === slice.class ? 1 : 0.3,
                scale: selectedClass === slice.class ? 1.05 : 1,
              }}
              whileHover={{ scale: 1.08, opacity: 1 }}
              transition={{ duration: 0.2 }}
              onClick={() => onSelectClass(selectedClass === slice.class ? 'all' : slice.class)}
              className="cursor-pointer"
              style={{ transformOrigin: '50px 50px' }}
            />
          ))}
          {/* 중앙 원 */}
          <circle cx="50" cy="50" r="18" fill="#F5F0E8" />
        </svg>
        {/* 중앙 텍스트 */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <p className="text-lg font-bold text-[#1A1A1A]">{total}</p>
            <p className="text-[10px] text-[#5C5C5C]">명</p>
          </div>
        </div>
      </div>

      {/* 범례 + 전체 버튼 */}
      <div className="flex items-center gap-2 flex-wrap justify-center">
        <button
          onClick={() => onSelectClass('all')}
          className={`px-2 py-0.5 text-xs border transition-all ${
            selectedClass === 'all'
              ? 'border-[#1A1A1A] bg-[#1A1A1A] text-[#F5F0E8]'
              : 'border-[#D4CFC4] text-[#5C5C5C] hover:border-[#1A1A1A]'
          }`}
        >
          전체
        </button>
        {slices.map((slice) => (
          <button
            key={slice.class}
            onClick={() => onSelectClass(selectedClass === slice.class ? 'all' : slice.class)}
            className={`flex items-center gap-1 px-2 py-0.5 text-xs border transition-all ${
              selectedClass === slice.class
                ? 'border-[#1A1A1A] bg-[#1A1A1A] text-[#F5F0E8]'
                : 'border-[#D4CFC4] text-[#5C5C5C] hover:border-[#1A1A1A]'
            }`}
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: slice.color }}
            />
            {slice.class}({slice.count})
          </button>
        ))}
      </div>
    </div>
  );
}
