// 통계 유틸리티 — Mean, SD, CV, 95% CI, Stability Index, Z-score, t-분포

// 95% 양측 t-분포 임계값 (df → t)
const T_TABLE_95: [number, number][] = [
  [1, 12.706], [2, 4.303], [3, 3.182], [4, 2.776], [5, 2.571],
  [6, 2.447], [7, 2.365], [8, 2.306], [9, 2.262], [10, 2.228],
  [11, 2.201], [12, 2.179], [13, 2.160], [14, 2.145], [15, 2.131],
  [16, 2.120], [17, 2.110], [18, 2.101], [19, 2.093], [20, 2.086],
  [25, 2.060], [30, 2.042], [35, 2.030], [40, 2.021], [45, 2.014],
  [50, 2.009], [60, 2.000], [70, 1.994], [80, 1.990], [90, 1.987],
  [100, 1.984], [120, 1.980], [Infinity, 1.960],
];

// df에 대한 t값 (가장 가까운 df로 보간)
export function tValue95(df: number): number {
  if (df <= 0) return 1.960;
  for (let i = 0; i < T_TABLE_95.length; i++) {
    if (df <= T_TABLE_95[i][0]) return T_TABLE_95[i][1];
  }
  return 1.960;
}

// 평균
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

// 표준편차 (표본)
export function sd(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

// 변동계수
export function cv(values: number[]): number {
  const m = mean(values);
  if (m === 0) return 0;
  return sd(values) / m;
}

// 95% 신뢰구간 [lower, upper]
export function ci95(values: number[]): [number, number] {
  const n = values.length;
  if (n < 2) return [mean(values), mean(values)];
  const m = mean(values);
  const s = sd(values);
  const t = tValue95(n - 1);
  const margin = t * (s / Math.sqrt(n));
  return [m - margin, m + margin];
}

// 안정성 지표 = Mean - SD
export function stabilityIndex(values: number[]): number {
  return mean(values) - sd(values);
}

// Z-score
export function zScore(value: number, m: number, s: number): number {
  if (s === 0) return 0;
  return (value - m) / s;
}

// 백분위 (정규분포 근사 CDF)
export function percentile(zScore: number): number {
  // Abramowitz and Stegun 근사
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = zScore < 0 ? -1 : 1;
  const x = Math.abs(zScore) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return Math.round((0.5 * (1.0 + sign * y)) * 100);
}

// 사분위수 (Box plot용)
export function quartiles(values: number[]): {
  min: number; q1: number; median: number; q3: number; max: number;
  outliers: number[];
} {
  if (values.length === 0) {
    return { min: 0, q1: 0, median: 0, q3: 0, max: 0, outliers: [] };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;

  const q2 = medianOf(sorted);
  const lower = sorted.slice(0, Math.floor(n / 2));
  const upper = sorted.slice(Math.ceil(n / 2));
  const q1 = medianOf(lower);
  const q3 = medianOf(upper);

  const iqr = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;

  const outliers = sorted.filter(v => v < lowerFence || v > upperFence);
  const minNonOutlier = sorted.find(v => v >= lowerFence) ?? sorted[0];
  const maxNonOutlier = [...sorted].reverse().find(v => v <= upperFence) ?? sorted[n - 1];

  return {
    min: minNonOutlier,
    q1,
    median: q2,
    q3,
    max: maxNonOutlier,
    outliers,
  };
}

function medianOf(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// ISO 주차 번호 계산 (Date → week number)
export function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

// ISO 주차 레이블 (예: "W12")
export function weekLabel(date: Date): string {
  return `W${getISOWeek(date)}`;
}

// 성장률 (%) = (current - previous) / previous * 100
export function growthRate(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

// 순위 백분위 (0~100) — 정렬된 배열에서 value보다 작은 비율
export function rankPercentile(value: number, sortedValues: number[]): number {
  if (sortedValues.length <= 1) return 50;
  // 모든 값이 동일하면 구분 불가 → 50% (중간)
  if (sortedValues[0] === sortedValues[sortedValues.length - 1]) return 50;
  const below = sortedValues.filter(v => v < value).length;
  return Math.round((below / (sortedValues.length - 1)) * 100);
}
