import { describe, it, expect } from "vitest";
import {
  mean,
  sd,
  cv,
  ci95,
  stabilityIndex,
  zScore,
  percentile,
  quartiles,
  getISOWeek,
  weekLabel,
  growthRate,
  rankPercentile,
  tValue95,
} from "./statistics";

// ============================================================
// mean — 평균
// ============================================================

describe("mean", () => {
  it("빈 배열 → 0", () => {
    expect(mean([])).toBe(0);
  });

  it("[10] → 10", () => {
    expect(mean([10])).toBe(10);
  });

  it("[10, 20, 30] → 20", () => {
    expect(mean([10, 20, 30])).toBe(20);
  });

  it("소수점 결과", () => {
    expect(mean([1, 2])).toBe(1.5);
  });

  it("음수 포함", () => {
    expect(mean([-10, 10])).toBe(0);
  });

  it("모두 같은 값", () => {
    expect(mean([5, 5, 5, 5])).toBe(5);
  });
});

// ============================================================
// sd — 표본 표준편차
// ============================================================

describe("sd", () => {
  it("빈 배열 → 0", () => {
    expect(sd([])).toBe(0);
  });

  it("1개 → 0 (n-1=0)", () => {
    expect(sd([42])).toBe(0);
  });

  it("모두 같은 값 → 0", () => {
    expect(sd([5, 5, 5])).toBe(0);
  });

  it("[2, 4, 4, 4, 5, 5, 7, 9] → ≈2.138", () => {
    const result = sd([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(result).toBeCloseTo(2.138, 2);
  });

  it("[10, 20] → ≈7.071", () => {
    // variance = (10-15)^2 + (20-15)^2 / 1 = 50
    expect(sd([10, 20])).toBeCloseTo(Math.sqrt(50), 5);
  });
});

// ============================================================
// cv — 변동계수
// ============================================================

describe("cv", () => {
  it("평균 0 → 0 (0 나눗셈 방지)", () => {
    expect(cv([0, 0])).toBe(0);
  });

  it("모두 같은 값 → 0 (sd=0)", () => {
    expect(cv([10, 10, 10])).toBe(0);
  });

  it("sd/mean 계산", () => {
    const values = [10, 20, 30];
    const m = mean(values);
    const s = sd(values);
    expect(cv(values)).toBeCloseTo(s / m, 10);
  });
});

// ============================================================
// ci95 — 95% 신뢰구간
// ============================================================

describe("ci95", () => {
  it("1개 값 → [값, 값] (구간 없음)", () => {
    const [lo, hi] = ci95([42]);
    expect(lo).toBe(42);
    expect(hi).toBe(42);
  });

  it("빈 배열 → [0, 0]", () => {
    const [lo, hi] = ci95([]);
    expect(lo).toBe(0);
    expect(hi).toBe(0);
  });

  it("대칭 구간", () => {
    const [lo, hi] = ci95([10, 20, 30, 40, 50]);
    const m = mean([10, 20, 30, 40, 50]);
    expect(m - lo).toBeCloseTo(hi - m, 10); // 대칭
  });

  it("모두 같은 값 → 구간 폭 0", () => {
    const [lo, hi] = ci95([5, 5, 5, 5]);
    expect(lo).toBe(5);
    expect(hi).toBe(5);
  });

  it("lower < mean < upper", () => {
    const values = [60, 70, 80, 90, 100];
    const [lo, hi] = ci95(values);
    const m = mean(values);
    expect(lo).toBeLessThan(m);
    expect(hi).toBeGreaterThan(m);
  });
});

// ============================================================
// stabilityIndex — 안정성 지표
// ============================================================

describe("stabilityIndex", () => {
  it("mean - sd", () => {
    const values = [80, 85, 90];
    expect(stabilityIndex(values)).toBeCloseTo(mean(values) - sd(values), 10);
  });

  it("모두 같은 값 → mean (sd=0)", () => {
    expect(stabilityIndex([50, 50, 50])).toBe(50);
  });
});

// ============================================================
// zScore — Z-점수
// ============================================================

describe("zScore", () => {
  it("평균과 같은 값 → 0", () => {
    expect(zScore(50, 50, 10)).toBe(0);
  });

  it("sd=0 → 0 (0 나눗셈 방지)", () => {
    expect(zScore(80, 50, 0)).toBe(0);
  });

  it("평균 위 1 SD → 1.0", () => {
    expect(zScore(60, 50, 10)).toBe(1.0);
  });

  it("평균 아래 2 SD → -2.0", () => {
    expect(zScore(30, 50, 10)).toBe(-2.0);
  });

  it("위험 학생 기준 z < -1.5", () => {
    expect(zScore(35, 50, 10)).toBe(-1.5);
    expect(zScore(35, 50, 10)).toBeLessThanOrEqual(-1.5);
  });

  it("위험 학생 기준 z < -2.0", () => {
    expect(zScore(30, 50, 10)).toBeLessThanOrEqual(-2.0);
  });
});

// ============================================================
// percentile — 정규분포 근사 CDF
// ============================================================

describe("percentile", () => {
  it("z=0 → 50 (중앙)", () => {
    expect(percentile(0)).toBe(50);
  });

  it("z=1.96 → ≈98 (95% CI 상한)", () => {
    expect(percentile(1.96)).toBeGreaterThanOrEqual(97);
    expect(percentile(1.96)).toBeLessThanOrEqual(98);
  });

  it("z=-1.96 → ≈2 (95% CI 하한)", () => {
    expect(percentile(-1.96)).toBeGreaterThanOrEqual(2);
    expect(percentile(-1.96)).toBeLessThanOrEqual(3);
  });

  it("큰 양수 z → 100에 근접", () => {
    expect(percentile(4)).toBeGreaterThanOrEqual(99);
  });

  it("큰 음수 z → 0에 근접", () => {
    expect(percentile(-4)).toBeLessThanOrEqual(1);
  });

  it("대칭성: percentile(z) + percentile(-z) ≈ 100", () => {
    expect(percentile(1) + percentile(-1)).toBe(100);
  });
});

// ============================================================
// quartiles — 사분위수
// ============================================================

describe("quartiles", () => {
  it("빈 배열 → 전부 0", () => {
    const q = quartiles([]);
    expect(q).toEqual({ min: 0, q1: 0, median: 0, q3: 0, max: 0, outliers: [] });
  });

  it("1개 값", () => {
    const q = quartiles([50]);
    expect(q.median).toBe(50);
    expect(q.min).toBe(50);
    expect(q.max).toBe(50);
  });

  it("짝수 개수 중앙값 보간", () => {
    const q = quartiles([10, 20, 30, 40]);
    expect(q.median).toBe(25); // (20+30)/2
  });

  it("홀수 개수 중앙값", () => {
    const q = quartiles([10, 20, 30, 40, 50]);
    expect(q.median).toBe(30);
  });

  it("이상치 감지 (IQR 1.5배)", () => {
    // sorted: [1, 10, 10, 10, 10, 10, 100]
    // lower=[1,10,10] Q1=10, upper=[10,10,100] Q3=10, IQR=0 → fence [10,10]
    // 더 명확한 예: [10, 20, 20, 20, 20, 20, 100]
    // lower=[10,20,20] Q1=20, upper=[20,20,100] Q3=20, IQR=0 → 역시 안 됨
    // IQR > 0 이어야 함: [10, 12, 14, 16, 18, 50]
    // lower=[10,12,14] Q1=12, upper=[16,18,50] Q3=18, IQR=6, upperFence=27
    // 50 > 27 → outlier!
    const q = quartiles([10, 12, 14, 16, 18, 50]);
    expect(q.outliers).toContain(50);
  });

  it("이상치 없는 경우", () => {
    const q = quartiles([10, 20, 30, 40, 50]);
    expect(q.outliers).toEqual([]);
  });

  it("정렬 안 된 입력도 처리", () => {
    const q = quartiles([50, 10, 30, 40, 20]);
    expect(q.median).toBe(30);
  });
});

// ============================================================
// growthRate — 성장률
// ============================================================

describe("growthRate", () => {
  it("previous 0, current > 0 → 100", () => {
    expect(growthRate(50, 0)).toBe(100);
  });

  it("previous 0, current 0 → 0", () => {
    expect(growthRate(0, 0)).toBe(0);
  });

  it("2배 성장 → 100%", () => {
    expect(growthRate(100, 50)).toBe(100);
  });

  it("변화 없음 → 0%", () => {
    expect(growthRate(50, 50)).toBe(0);
  });

  it("감소 → 음수", () => {
    expect(growthRate(25, 50)).toBe(-50);
  });
});

// ============================================================
// rankPercentile — 순위 백분위
// ============================================================

describe("rankPercentile", () => {
  it("빈 배열 → 0", () => {
    expect(rankPercentile(50, [])).toBe(0);
  });

  it("1명, 값 > 0 → 50", () => {
    expect(rankPercentile(100, [100])).toBe(50);
  });

  it("1명, 값 0 → 0", () => {
    expect(rankPercentile(0, [0])).toBe(0);
  });

  it("모든 값 동일, 값 > 0 → 50", () => {
    expect(rankPercentile(50, [50, 50, 50])).toBe(50);
  });

  it("모든 값 0 → 0 (활동 없음)", () => {
    expect(rankPercentile(0, [0, 0, 0])).toBe(0);
  });

  it("최고값 → 100", () => {
    expect(rankPercentile(100, [10, 20, 30, 40, 50, 60, 70, 80, 90, 100])).toBe(100);
  });

  it("최저값 → 0", () => {
    expect(rankPercentile(10, [10, 20, 30, 40, 50])).toBe(0);
  });

  it("중간값 백분위", () => {
    // 30보다 작은 값: 10, 20 → 2/4 = 50%
    expect(rankPercentile(30, [10, 20, 30, 40, 50])).toBe(50);
  });
});

// ============================================================
// tValue95 — t-분포 임계값
// ============================================================

describe("tValue95", () => {
  it("df=1 → 12.706", () => {
    expect(tValue95(1)).toBe(12.706);
  });

  it("df=30 → 2.042", () => {
    expect(tValue95(30)).toBe(2.042);
  });

  it("df ≤ 0 → 1.960 (무한 근사)", () => {
    expect(tValue95(0)).toBe(1.960);
    expect(tValue95(-1)).toBe(1.960);
  });

  it("df=Infinity → 1.960", () => {
    expect(tValue95(Infinity)).toBe(1.960);
  });

  it("df=10 → 2.228", () => {
    expect(tValue95(10)).toBe(2.228);
  });
});

// ============================================================
// getISOWeek / weekLabel
// ============================================================

describe("getISOWeek / weekLabel", () => {
  it("2026-01-01 (목) → W1", () => {
    const d = new Date(2026, 0, 1); // 2026-01-01
    expect(getISOWeek(d)).toBe(1);
    expect(weekLabel(d)).toBe("W1");
  });

  it("같은 주 내 날짜 → 같은 주차", () => {
    const mon = new Date(2026, 2, 9); // 2026-03-09 월
    const fri = new Date(2026, 2, 13); // 2026-03-13 금
    expect(getISOWeek(mon)).toBe(getISOWeek(fri));
  });
});
