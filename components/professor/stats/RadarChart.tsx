'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ChapterStats } from '@/lib/hooks/useProfessorStats';

function AlertBadge({ type }: { type: 'low' | 'gap' | 'volatile' }) {
  const label = { low: '이해↓', gap: '격차↑', volatile: '변동↑' }[type];
  return (
    <span className="inline-block px-1.5 py-0.5 text-[9px] font-bold text-[#1A1A1A] border border-[#1A1A1A]">
      {label}
    </span>
  );
}

interface Props {
  chapterStats: ChapterStats[];
}

// chapterId에서 숫자 추출
function extractChapterNumber(chapterId: string): string {
  const match = chapterId.match(/(\d+)/);
  return match ? match[1] : '';
}

export default function RadarChart({ chapterStats }: Props) {
  const [selectedChapter, setSelectedChapter] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // 레이더에 표시할 데이터
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

  // 취약 영역 (60% 미만) 수
  const weakCount = radarData.filter(d => d.value > 0 && d.value < 60).length;

  // 챕터 드롭다운 옵션
  const chapterOptions = chapterStats.filter(c => c.details.length >= 3);

  // 경고 수
  const totalAlerts = chapterStats.reduce((sum, ch) => {
    let count = 0;
    if (ch.mean > 0 && ch.mean < 60) count++;
    if (ch.sd > 15) count++;
    if (ch.cv > 0.20) count++;
    return sum + count;
  }, 0);

  // 선택된 챕터의 드롭다운 표시 이름
  const selectedChapterLabel = selectedChapter
    ? (() => {
        const ch = chapterStats.find(c => c.chapterId === selectedChapter);
        if (!ch) return '선택';
        const num = extractChapterNumber(ch.chapterId);
        return num ? `Ch.${num} ${ch.chapterName}` : ch.chapterName;
      })()
    : '전체 챕터';

  // 선택된 챕터의 소주제 데이터
  const selectedChapterData = selectedChapter
    ? chapterStats.find(c => c.chapterId === selectedChapter)
    : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div>
          <h3 className="text-lg font-bold text-[#1A1A1A]">챕터 분석</h3>
          {totalAlerts > 0 && (
            <p className="text-xs text-[#8B1A1A] font-bold mt-0.5">경고 {totalAlerts}개</p>
          )}
        </div>
        {/* 챕터 커스텀 드롭다운 */}
        <div className="relative">
          <button
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="px-2 py-1 bg-[#F5F0E8] border border-[#1A1A1A] text-[#1A1A1A] text-xs font-bold flex items-center justify-between gap-1.5 min-w-[80px] rounded-lg"
          >
            <span className="truncate max-w-[120px]">
              {selectedChapterLabel}
            </span>
            <svg
              className={`w-3 h-3 shrink-0 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`}
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>

          <AnimatePresence>
            {isDropdownOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setIsDropdownOpen(false)} />
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="absolute right-0 top-full mt-1 z-20 bg-[#F5F0E8] border border-[#1A1A1A] shadow-lg min-w-[80px] rounded-lg overflow-hidden max-h-[240px] overflow-y-auto"
                >
                  <button
                    onClick={() => { setSelectedChapter(null); setIsDropdownOpen(false); }}
                    className={`w-full px-3 py-2 text-left text-xs font-medium transition-colors ${
                      !selectedChapter
                        ? 'bg-[#1A1A1A] text-[#F5F0E8]'
                        : 'text-[#1A1A1A] hover:bg-[#EDEAE4]'
                    }`}
                  >
                    전체 챕터
                  </button>
                  {chapterOptions.map(c => {
                    const num = extractChapterNumber(c.chapterId);
                    return (
                      <button
                        key={c.chapterId}
                        onClick={() => { setSelectedChapter(c.chapterId); setIsDropdownOpen(false); }}
                        className={`w-full px-3 py-2 text-left text-xs font-medium transition-colors ${
                          selectedChapter === c.chapterId
                            ? 'bg-[#1A1A1A] text-[#F5F0E8]'
                            : 'text-[#1A1A1A] hover:bg-[#EDEAE4]'
                        }`}
                      >
                        {num ? `Ch.${num} ` : ''}{c.chapterName}
                      </button>
                    );
                  })}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* 레이더 차트 */}
      {radarData.length >= 3 ? (
        <RadarSvg radarData={radarData} weakCount={weakCount} />
      ) : (
        <p className="text-sm text-[#5C5C5C] text-center py-8">
          {radarData.length === 0 ? '데이터가 없습니다' : '축이 3개 이상 필요합니다'}
        </p>
      )}

      {/* 드롭다운으로 챕터 선택 시: 소주제 아코디언 */}
      <AnimatePresence>
        {selectedChapterData && selectedChapterData.details.length > 0 && (
          <motion.div
            key={selectedChapterData.chapterId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="mt-3 overflow-hidden border border-[#D4CFC4]"
          >
            {/* 챕터 헤더 */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-[#EBE5D9]/50 border-b border-[#D4CFC4]">
              <span className="text-sm font-bold text-[#1A1A1A]">
                {(() => { const num = extractChapterNumber(selectedChapterData.chapterId); return num ? `Ch.${num} ` : ''; })()}
                {selectedChapterData.chapterName} 소주제
              </span>
              <span className="text-sm font-bold text-[#1A1A1A] tabular-nums">
                평균 {selectedChapterData.mean > 0 ? selectedChapterData.mean.toFixed(1) : '-'}
              </span>
            </div>

            <div className="bg-[#EBE5D9]/20">
              {selectedChapterData.details.map((detail, di) => {
                const dAlerts: ('low' | 'gap' | 'volatile')[] = [];
                if (detail.mean > 0 && detail.mean < 60) dAlerts.push('low');
                if (detail.sd > 15) dAlerts.push('gap');
                if (detail.cv > 0.20) dAlerts.push('volatile');
                const dBarPct = Math.min(100, detail.mean);

                return (
                  <motion.div
                    key={detail.detailId}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: di * 0.03 }}
                    className="flex items-center gap-3 px-4 py-2.5 border-b border-[#D4CFC4]/50 last:border-b-0"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1 mb-0.5">
                        <span className="text-sm text-[#1A1A1A] truncate">{detail.detailName}</span>
                        {dAlerts.map(a => <AlertBadge key={a} type={a} />)}
                      </div>
                      <div className="relative h-1 bg-[#D4CFC4]/40 w-full">
                        <div
                          className="absolute left-0 top-0 h-full transition-all"
                          style={{
                            width: `${dBarPct}%`,
                            backgroundColor: detail.mean < 60 ? '#8B1A1A' : '#1D5D4A',
                            opacity: 0.6,
                          }}
                        />
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="text-sm font-bold tabular-nums text-[#1A1A1A]">
                        {detail.mean > 0 ? detail.mean.toFixed(1) : '-'}
                      </span>
                      {detail.mean > 0 && (
                        <p className="text-[9px] text-[#5C5C5C]">
                          SD {detail.sd.toFixed(1)} · CV {detail.cv.toFixed(2)}
                        </p>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// 레이더 SVG 서브컴포넌트
function RadarSvg({ radarData, weakCount }: {
  radarData: { label: string; fullLabel: string; value: number }[];
  weakCount: number;
}) {
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

  // 60% 기준선
  const thresholdPoints = Array.from({ length: n }, (_, i) => getPoint(i, 60));
  const thresholdPath = thresholdPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + 'Z';

  return (
    <>
      {weakCount > 0 && (
        <p className="text-[10px] mb-2 text-[#8B1A1A] font-bold">
          60% 미만 영역 {weakCount}개
        </p>
      )}

      <svg viewBox="0 0 400 340" className="w-full" style={{ overflow: 'visible' }}>
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

        {/* 60% 기준선 */}
        <path d={thresholdPath} fill="none" stroke="#8B1A1A" strokeWidth={0.8}
          strokeDasharray="4,3" opacity={0.5} />

        {/* 축 + 라벨 */}
        {radarData.map((d, i) => {
          const end = getPoint(i, 100);
          const labelPos = getPoint(i, 125);
          const isWeak = d.value > 0 && d.value < 60;
          return (
            <g key={i}>
              <line x1={CX} y1={CY} x2={end.x} y2={end.y}
                stroke="#D4CFC4" strokeWidth={0.5} />
              <text
                x={labelPos.x} y={labelPos.y}
                textAnchor="middle" dominantBaseline="middle"
                fontSize={13}
                fill={isWeak ? '#8B1A1A' : '#1A1A1A'}
                fontWeight="700"
              >
                {d.label}
              </text>
            </g>
          );
        })}

        {/* 데이터 영역 */}
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
              <circle cx={p.x} cy={p.y} r={5} fill="#F5F0E8"
                stroke={isWeak ? '#8B1A1A' : '#1D5D4A'} strokeWidth={2.5} />
              <circle cx={p.x} cy={p.y} r={2} fill={isWeak ? '#8B1A1A' : '#1D5D4A'} />

              {val > 0 && (
                <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
                  fontSize={11} fontWeight="bold"
                  fill={isWeak ? '#8B1A1A' : '#1D5D4A'}>
                  {val.toFixed(0)}
                </text>
              )}
            </motion.g>
          );
        })}
      </svg>

      {/* 범례 */}
      <div className="flex items-center justify-center gap-4 mt-2 text-xs text-[#5C5C5C]">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-0.5 bg-[#1D5D4A]" />
          <span>평균 정답률</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-0.5 border-t border-dashed border-[#8B1A1A]" />
          <span>60% 기준선</span>
        </div>
      </div>
    </>
  );
}
