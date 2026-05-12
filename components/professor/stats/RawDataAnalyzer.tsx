'use client';

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRawStatsQuery } from '@/lib/hooks/useRawStatsQuery';
import {
  aggregate,
  X_AXIS_META,
  Y_METRIC_META,
  CATEGORY_LABELS,
  type XAxis,
  type YMetric,
  type AggregateRow,
} from '@/lib/utils/rawStatsAggregate';

type ChartType = 'line' | 'bar' | 'table';

interface Props {
  courseId: string;
}

const PRESETS = [
  { label: '오늘', days: 0 },
  { label: '7일', days: 7 },
  { label: '14일', days: 14 },
  { label: '30일', days: 30 },
];

const KST_OFFSET = 9 * 60 * 60 * 1000;

// KST 자정 daysAgo일 전
function kstMidnightDaysAgo(daysAgo: number): Date {
  const kstNow = new Date(Date.now() + KST_OFFSET);
  kstNow.setUTCHours(0, 0, 0, 0);
  kstNow.setUTCDate(kstNow.getUTCDate() - daysAgo);
  return new Date(kstNow.getTime() - KST_OFFSET);
}

function kstEndOfToday(): Date {
  const kstNow = new Date(Date.now() + KST_OFFSET);
  kstNow.setUTCHours(23, 59, 59, 999);
  return new Date(kstNow.getTime() - KST_OFFSET);
}

function downloadCsv(filename: string, lines: string[]) {
  const csv = '﻿' + lines.join('\n'); // BOM (Excel 한글)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const ALL_METRICS: YMetric[] = [
  'pageViews',
  'uniqueUsers',
  'totalDurationMin',
  'avgDurationPerUserMin',
  'avgDurationPerSessionMin',
  'sessions',
];

const ALL_CLASSES = ['A', 'B', 'C', 'D'];
const ALL_CATEGORIES = Object.keys(CATEGORY_LABELS);
const DAY_LABEL = ['월', '화', '수', '목', '금', '토', '일'];

export default function RawDataAnalyzer({ courseId }: Props) {
  const [chartType, setChartType] = useState<ChartType>('line');
  const [xAxis, setXAxis] = useState<XAxis>('date');
  const [selectedMetrics, setSelectedMetrics] = useState<YMetric[]>(['uniqueUsers', 'totalDurationMin']);
  const [presetDays, setPresetDays] = useState(7);
  const [selectedClasses, setSelectedClasses] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  const [showMetricMenu, setShowMetricMenu] = useState(false);
  const [showCategoryMenu, setShowCategoryMenu] = useState(false);

  // presetDays만 의존하는 단순 Date — useMemo 없이 매 렌더 새로 만들어도 가벼움.
  // 단, useRawStatsQuery는 startMs/endMs(숫자) 의존이라 객체 ID는 무관.
  const startDate = kstMidnightDaysAgo(presetDays);
  const endDate = kstEndOfToday();

  const { pageViews, loading, error, fetchedCount } = useRawStatsQuery(courseId, startDate, endDate);

  // 수천 행 → X축 그룹핑은 무거우므로 메모.
  const aggregated = useMemo(() => {
    if (selectedMetrics.length === 0) return [];
    return aggregate(pageViews, xAxis, selectedMetrics, {
      categories: selectedCategories,
      classes: selectedClasses,
    });
  }, [pageViews, xAxis, selectedMetrics, selectedCategories, selectedClasses]);

  const handleExportCsv = () => {
    if (aggregated.length === 0) return;
    const headers = [
      X_AXIS_META[xAxis].label,
      ...selectedMetrics.map(m => `${Y_METRIC_META[m].label}(${Y_METRIC_META[m].unit})`),
    ];
    const lines = [headers.join(',')];
    aggregated.forEach(row => {
      const cells = [row.xLabel, ...selectedMetrics.map(m => String(row.values[m] ?? 0))];
      lines.push(cells.join(','));
    });
    downloadCsv(`${courseId}_${X_AXIS_META[xAxis].label}_${new Date().toISOString().slice(0, 10)}.csv`, lines);
  };

  const handleExportRawCsv = () => {
    if (pageViews.length === 0) return;
    const headers = ['날짜', '시간', '요일', '유저ID', '반', '카테고리', '경로', '체류시간(초)', '세션ID'];
    const lines = [headers.join(',')];
    pageViews.forEach(r => {
      const cells = [
        r.date,
        r.hour,
        DAY_LABEL[r.dayOfWeek] || '',
        r.userId,
        r.classId,
        CATEGORY_LABELS[r.category] || r.category,
        `"${r.path.replace(/"/g, '""')}"`,
        Math.round(r.durationMs / 1000),
        r.sessionId || '',
      ];
      lines.push(cells.join(','));
    });
    downloadCsv(`${courseId}_raw_${new Date().toISOString().slice(0, 10)}.csv`, lines);
  };

  const toggleMetric = (m: YMetric) =>
    setSelectedMetrics(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]);
  const toggleClass = (c: string) =>
    setSelectedClasses(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);
  const toggleCategory = (c: string) =>
    setSelectedCategories(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-[#1A1A1A]">데이터 분석</h3>
        <p className="text-[10px] text-[#5C5C5C]">총 {fetchedCount.toLocaleString()}개 기록</p>
      </div>

      {/* 컨트롤 바 */}
      <div className="border border-[#D4CFC4] p-3 space-y-3">
        {/* 기간 프리셋 */}
        <div>
          <p className="text-[10px] font-bold text-[#5C5C5C] mb-1.5">기간</p>
          <div className="flex gap-1.5 flex-wrap">
            {PRESETS.map(p => (
              <button
                key={p.label}
                type="button"
                onClick={() => setPresetDays(p.days)}
                className={`px-3 py-1 text-[11px] font-bold border transition-colors ${
                  presetDays === p.days
                    ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                    : 'bg-[#F5F0E8] text-[#1A1A1A] border-[#D4CFC4]'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* 차트 타입 + X축 */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-[10px] font-bold text-[#5C5C5C] mb-1.5">형식</p>
            <div className="flex gap-1.5">
              {(['line', 'bar', 'table'] as ChartType[]).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setChartType(t)}
                  className={`flex-1 px-2 py-1 text-[11px] font-bold border transition-colors ${
                    chartType === t
                      ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                      : 'bg-[#F5F0E8] text-[#1A1A1A] border-[#D4CFC4]'
                  }`}
                >
                  {t === 'line' ? '선' : t === 'bar' ? '막대' : '표'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] font-bold text-[#5C5C5C] mb-1.5">X축</p>
            <select
              value={xAxis}
              onChange={(e) => setXAxis(e.target.value as XAxis)}
              className="w-full px-2 py-1 text-[11px] font-bold border border-[#D4CFC4] bg-[#F5F0E8] text-[#1A1A1A]"
            >
              {(Object.keys(X_AXIS_META) as XAxis[]).map(k => (
                <option key={k} value={k}>{X_AXIS_META[k].label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Y축 멀티선택 */}
        <div className="relative">
          <p className="text-[10px] font-bold text-[#5C5C5C] mb-1.5">Y축 (지표)</p>
          <button
            type="button"
            onClick={() => setShowMetricMenu(prev => !prev)}
            className="w-full px-2 py-1.5 text-[11px] font-bold border border-[#D4CFC4] bg-[#F5F0E8] text-[#1A1A1A] flex items-center justify-between"
          >
            <span className="truncate">
              {selectedMetrics.length === 0
                ? '선택하세요'
                : selectedMetrics.map(m => Y_METRIC_META[m].label).join(', ')}
            </span>
            <svg className={`w-3 h-3 transition-transform flex-shrink-0 ${showMetricMenu ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
          <AnimatePresence>
            {showMetricMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowMetricMenu(false)} />
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="absolute top-full left-0 right-0 mt-1 z-20 bg-[#F5F0E8] border border-[#1A1A1A] shadow-lg max-h-60 overflow-y-auto"
                >
                  {ALL_METRICS.map(m => {
                    const selected = selectedMetrics.includes(m);
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => toggleMetric(m)}
                        className={`w-full px-3 py-2 text-[11px] text-left flex items-center gap-2 ${
                          selected ? 'bg-[#EBE5D9] font-bold' : 'hover:bg-[#EBE5D9]'
                        }`}
                      >
                        <span className={`w-3 h-3 border flex items-center justify-center ${selected ? 'bg-[#1A1A1A] border-[#1A1A1A]' : 'border-[#D4CFC4]'}`}>
                          {selected && <svg className="w-2.5 h-2.5 text-[#F5F0E8]" fill="currentColor" viewBox="0 0 12 12"><path d="M4.5 8.5L2 6l-1 1 3.5 3.5L11 4l-1-1z"/></svg>}
                        </span>
                        <span className="text-[#1A1A1A]">{Y_METRIC_META[m].label}</span>
                        <span className="text-[#5C5C5C] ml-auto">({Y_METRIC_META[m].unit})</span>
                      </button>
                    );
                  })}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>

        {/* 반 + 기능 필터 */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-[10px] font-bold text-[#5C5C5C] mb-1.5">반 ({selectedClasses.length || '전체'})</p>
            <div className="flex gap-1">
              {ALL_CLASSES.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleClass(c)}
                  className={`flex-1 px-1 py-1 text-[10px] font-bold border transition-colors ${
                    selectedClasses.includes(c)
                      ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                      : 'bg-[#F5F0E8] text-[#1A1A1A] border-[#D4CFC4]'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="relative">
            <p className="text-[10px] font-bold text-[#5C5C5C] mb-1.5">기능 ({selectedCategories.length || '전체'})</p>
            <button
              type="button"
              onClick={() => setShowCategoryMenu(prev => !prev)}
              className="w-full px-2 py-1 text-[11px] font-bold border border-[#D4CFC4] bg-[#F5F0E8] text-[#1A1A1A] flex items-center justify-between"
            >
              <span className="truncate">
                {selectedCategories.length === 0 ? '전체' : `${selectedCategories.length}개 선택`}
              </span>
              <svg className={`w-3 h-3 transition-transform flex-shrink-0 ${showCategoryMenu ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
            <AnimatePresence>
              {showCategoryMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowCategoryMenu(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="absolute top-full left-0 right-0 mt-1 z-20 bg-[#F5F0E8] border border-[#1A1A1A] shadow-lg max-h-60 overflow-y-auto"
                  >
                    {ALL_CATEGORIES.map(c => {
                      const selected = selectedCategories.includes(c);
                      return (
                        <button
                          key={c}
                          type="button"
                          onClick={() => toggleCategory(c)}
                          className={`w-full px-3 py-1.5 text-[11px] text-left flex items-center gap-2 ${
                            selected ? 'bg-[#EBE5D9] font-bold' : 'hover:bg-[#EBE5D9]'
                          }`}
                        >
                          <span className={`w-2.5 h-2.5 border ${selected ? 'bg-[#1A1A1A] border-[#1A1A1A]' : 'border-[#D4CFC4]'}`} />
                          <span className="text-[#1A1A1A]">{CATEGORY_LABELS[c] || c}</span>
                        </button>
                      );
                    })}
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* CSV 버튼 */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={aggregated.length === 0}
            className="py-1.5 border-2 border-[#1A1A1A] text-[#1A1A1A] text-[11px] font-bold disabled:opacity-30"
          >
            집계 CSV
          </button>
          <button
            type="button"
            onClick={handleExportRawCsv}
            disabled={pageViews.length === 0}
            className="py-1.5 border-2 border-[#1A1A1A] text-[#1A1A1A] text-[11px] font-bold disabled:opacity-30"
          >
            Raw CSV
          </button>
        </div>
      </div>

      {/* 차트 / 표 */}
      {error && (
        <div className="border border-[#8B1A1A] p-3 text-xs text-[#8B1A1A]">{error}</div>
      )}

      {loading && (
        <div className="flex flex-col items-center justify-center py-10 gap-2">
          <motion.div
            className="w-7 h-7 border-2 border-[#1A1A1A] border-t-transparent rounded-full"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          />
          <p className="text-[10px] text-[#5C5C5C]">불러오는 중...</p>
        </div>
      )}

      {!loading && aggregated.length > 0 && selectedMetrics.length > 0 && (
        <div className="border border-[#D4CFC4] p-3 bg-[#FDFBF7]">
          {chartType === 'table' ? (
            <DataTable rows={aggregated} metrics={selectedMetrics} xLabel={X_AXIS_META[xAxis].label} />
          ) : (
            <SvgChart
              rows={aggregated}
              metrics={selectedMetrics}
              chartType={chartType}
              xLabel={X_AXIS_META[xAxis].label}
            />
          )}
        </div>
      )}

      {!loading && pageViews.length === 0 && !error && (
        <div className="border border-dashed border-[#D4CFC4] p-6 text-center">
          <p className="text-xs text-[#5C5C5C]">이 기간에 기록된 데이터가 없습니다</p>
        </div>
      )}

      {!loading && selectedMetrics.length === 0 && (
        <div className="border border-dashed border-[#D4CFC4] p-6 text-center">
          <p className="text-xs text-[#5C5C5C]">Y축 지표를 1개 이상 선택해주세요</p>
        </div>
      )}
    </div>
  );
}

// ============================================================
// SVG 차트
// ============================================================

function SvgChart({
  rows,
  metrics,
  chartType,
  xLabel,
}: {
  rows: AggregateRow[];
  metrics: YMetric[];
  chartType: 'line' | 'bar';
  xLabel: string;
}) {
  const width = 600;
  const height = 280;
  const padding = { top: 20, right: 16, bottom: 50, left: 44 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  // 최대값: rows × metrics 한 번 순회 — 가벼움, 인라인
  let maxValue = 0;
  for (const r of rows) {
    for (const m of metrics) {
      const v = r.values[m] ?? 0;
      if (v > maxValue) maxValue = v;
    }
  }
  if (maxValue === 0) maxValue = 1;

  const xStep = rows.length > 0 ? innerW / Math.max(rows.length - (chartType === 'bar' ? 0 : 1), 1) : 0;
  const xPos = (i: number) => chartType === 'bar'
    ? padding.left + xStep * (i + 0.5)
    : padding.left + xStep * i;
  const yPos = (v: number) => padding.top + innerH - (v / maxValue) * innerH;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(r => maxValue * r);
  const labelStep = Math.max(1, Math.ceil(rows.length / 10));
  const barGroupWidth = xStep * 0.7;
  const barWidth = barGroupWidth / metrics.length;

  return (
    <div className="space-y-2">
      <div className="w-full overflow-x-auto">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
          className="w-full"
          style={{ maxWidth: width }}
        >
          {yTicks.map((tick, i) => (
            <g key={i}>
              <line
                x1={padding.left}
                y1={yPos(tick)}
                x2={width - padding.right}
                y2={yPos(tick)}
                stroke="#EBE5D9"
                strokeWidth={1}
              />
              <text
                x={padding.left - 6}
                y={yPos(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={9}
                fill="#5C5C5C"
              >
                {formatTick(tick)}
              </text>
            </g>
          ))}

          {rows.map((row, i) => {
            if (i % labelStep !== 0 && i !== rows.length - 1) return null;
            return (
              <text
                key={i}
                x={xPos(i)}
                y={height - padding.bottom + 14}
                textAnchor="middle"
                fontSize={9}
                fill="#5C5C5C"
              >
                {row.xLabel}
              </text>
            );
          })}

          <text
            x={padding.left + innerW / 2}
            y={height - 8}
            textAnchor="middle"
            fontSize={10}
            fill="#1A1A1A"
            fontWeight="bold"
          >
            {xLabel}
          </text>

          <line
            x1={padding.left}
            y1={padding.top}
            x2={padding.left}
            y2={padding.top + innerH}
            stroke="#1A1A1A"
            strokeWidth={1}
          />
          <line
            x1={padding.left}
            y1={padding.top + innerH}
            x2={width - padding.right}
            y2={padding.top + innerH}
            stroke="#1A1A1A"
            strokeWidth={1}
          />

          {chartType === 'line' ? (
            metrics.map((metric) => {
              const color = Y_METRIC_META[metric].color;
              const points = rows.map((r, i) => `${xPos(i)},${yPos(r.values[metric] ?? 0)}`).join(' ');
              return (
                <g key={metric}>
                  <polyline points={points} fill="none" stroke={color} strokeWidth={2} />
                  {rows.map((r, i) => (
                    <circle key={i} cx={xPos(i)} cy={yPos(r.values[metric] ?? 0)} r={2.5} fill={color} />
                  ))}
                </g>
              );
            })
          ) : (
            metrics.map((metric, mIdx) => {
              const color = Y_METRIC_META[metric].color;
              return (
                <g key={metric}>
                  {rows.map((r, i) => {
                    const value = r.values[metric] ?? 0;
                    const yTop = yPos(value);
                    const h = padding.top + innerH - yTop;
                    const x = xPos(i) - barGroupWidth / 2 + barWidth * mIdx;
                    return (
                      <rect
                        key={i}
                        x={x}
                        y={yTop}
                        width={barWidth * 0.92}
                        height={Math.max(h, 0)}
                        fill={color}
                      />
                    );
                  })}
                </g>
              );
            })
          )}
        </svg>
      </div>

      <div className="flex flex-wrap gap-3 px-2">
        {metrics.map(m => (
          <div key={m} className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3" style={{ backgroundColor: Y_METRIC_META[m].color }} />
            <span className="text-[10px] text-[#1A1A1A]">
              {Y_METRIC_META[m].label} ({Y_METRIC_META[m].unit})
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatTick(v: number): string {
  if (v >= 10000) return `${(v / 1000).toFixed(0)}k`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (v % 1 === 0) return v.toFixed(0);
  return v.toFixed(1);
}

// ============================================================
// 표 모드
// ============================================================

function DataTable({
  rows,
  metrics,
  xLabel,
}: {
  rows: AggregateRow[];
  metrics: YMetric[];
  xLabel: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-[#1A1A1A]">
            <th className="text-left py-2 px-2 font-bold text-[#1A1A1A] sticky left-0 bg-[#FDFBF7]">{xLabel}</th>
            {metrics.map(m => (
              <th key={m} className="text-right py-2 px-2 font-bold text-[#1A1A1A]">
                {Y_METRIC_META[m].label}
                <span className="text-[#5C5C5C] font-normal"> ({Y_METRIC_META[m].unit})</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-[#EBE5D9]">
              <td className="py-1.5 px-2 text-[#1A1A1A] sticky left-0 bg-[#FDFBF7]">{row.xLabel}</td>
              {metrics.map(m => (
                <td key={m} className="text-right py-1.5 px-2 tabular-nums text-[#1A1A1A]">
                  {(row.values[m] ?? 0).toLocaleString()}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
