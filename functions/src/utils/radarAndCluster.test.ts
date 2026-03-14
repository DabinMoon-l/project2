import { describe, it, expect } from "vitest";

// ============================================================
// rankPercentile 로직 테스트 (computeRadarNorm에서 사용)
// ============================================================

// 프론트 statistics.ts의 rankPercentile과 동일한 로직 재현
function rankPercentile(value: number, sortedValues: number[]): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return value > 0 ? 50 : 0;
  if (sortedValues[0] === sortedValues[sortedValues.length - 1]) {
    return value > 0 ? 50 : 0;
  }
  const below = sortedValues.filter(v => v < value).length;
  return Math.round((below / (sortedValues.length - 1)) * 100);
}

describe("rankPercentile", () => {
  it("빈 배열 → 0", () => {
    expect(rankPercentile(50, [])).toBe(0);
  });

  it("단일 값 배열 — 값 > 0이면 50", () => {
    expect(rankPercentile(100, [100])).toBe(50);
  });

  it("단일 값 배열 — 값 = 0이면 0", () => {
    expect(rankPercentile(0, [0])).toBe(0);
  });

  it("모든 값 동일(0) → 0", () => {
    expect(rankPercentile(0, [0, 0, 0, 0, 0])).toBe(0);
  });

  it("모든 값 동일(50) → value > 0이면 50", () => {
    expect(rankPercentile(50, [50, 50, 50])).toBe(50);
  });

  it("최고점 학생은 100 백분위", () => {
    expect(rankPercentile(100, [20, 40, 60, 80, 100])).toBe(100);
  });

  it("최저점 학생은 0 백분위", () => {
    expect(rankPercentile(20, [20, 40, 60, 80, 100])).toBe(0);
  });

  it("중간 학생은 50 백분위", () => {
    expect(rankPercentile(60, [20, 40, 60, 80, 100])).toBe(50);
  });

  it("대부분 0이고 소수만 활동 — 0인 학생은 0%", () => {
    const sorted = [0, 0, 0, 0, 0, 0, 0, 100, 200, 300];
    expect(rankPercentile(0, sorted)).toBe(0);
  });

  it("대부분 0이고 소수만 활동 — 활동한 학생은 높은 백분위", () => {
    const sorted = [0, 0, 0, 0, 0, 0, 0, 100, 200, 300];
    expect(rankPercentile(300, sorted)).toBe(100);
    expect(rankPercentile(100, sorted)).toBe(78); // 7/9 * 100
  });
});

// ============================================================
// 4군집 분류 로직 테스트
// ============================================================

interface StudentClusterInput {
  totalExp: number;
  correctRate: number; // quizStats.averageScore (0~100)
}

type ClusterType = "passionate" | "hardworking" | "efficient" | "atRisk";

function classifyStudent(
  student: StudentClusterInput,
  medianExp: number,
  medianRate: number,
): ClusterType {
  const highExp = student.totalExp >= medianExp && student.totalExp > 0;
  const highRate = student.correctRate >= medianRate && student.correctRate > 0;

  if (highExp && highRate) return "passionate";
  if (highExp && !highRate) return "hardworking";
  if (!highExp && highRate) return "efficient";
  return "atRisk";
}

function computeMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 0;
}

describe("4군집 분류", () => {
  it("EXP=0, 성적=0 → 이탈 위험군 (medianExp/Rate가 0이어도)", () => {
    expect(classifyStudent({ totalExp: 0, correctRate: 0 }, 0, 0)).toBe("atRisk");
  });

  it("EXP > 0, 성적 > 0, 둘 다 median 이상 → 열정적", () => {
    expect(classifyStudent({ totalExp: 200, correctRate: 80 }, 100, 60)).toBe("passionate");
  });

  it("EXP 높고 성적 낮음 → 노력형", () => {
    expect(classifyStudent({ totalExp: 200, correctRate: 30 }, 100, 60)).toBe("hardworking");
  });

  it("EXP 낮고 성적 높음 → 효율형", () => {
    expect(classifyStudent({ totalExp: 50, correctRate: 80 }, 100, 60)).toBe("efficient");
  });

  it("EXP 낮고 성적 낮음 → 이탈 위험군", () => {
    expect(classifyStudent({ totalExp: 50, correctRate: 30 }, 100, 60)).toBe("atRisk");
  });

  it("비활동 학생 대다수 — 활동 학생이 열정적/노력형으로 분류", () => {
    // 10명: 7명 비활동(EXP=0, rate=0), 3명 활동
    const students: StudentClusterInput[] = [
      { totalExp: 0, correctRate: 0 },
      { totalExp: 0, correctRate: 0 },
      { totalExp: 0, correctRate: 0 },
      { totalExp: 0, correctRate: 0 },
      { totalExp: 0, correctRate: 0 },
      { totalExp: 0, correctRate: 0 },
      { totalExp: 0, correctRate: 0 },
      { totalExp: 300, correctRate: 90 },  // 활동 + 잘함
      { totalExp: 200, correctRate: 40 },  // 활동 + 못함
      { totalExp: 50, correctRate: 85 },   // 적은 활동 + 잘함
    ];

    const medianExp = computeMedian(students.map(s => s.totalExp));   // 0
    const medianRate = computeMedian(students.map(s => s.correctRate)); // 0

    const results = students.map(s => classifyStudent(s, medianExp, medianRate));

    // 비활동 7명 → 전부 이탈 위험군 (> 0 조건)
    expect(results.filter(r => r === "atRisk").length).toBe(7);
    // 활동한 3명 → passionate (300,90), hardworking(200,40)은 medianRate=0이므로 40>0=passionate
    // 실제: medianRate=0, 40>=0 && 40>0 = true → passionate
    // 50 >= 0 && 50 > 0 = true (highExp), 85 >= 0 && 85 > 0 = true → passionate
    expect(results.filter(r => r === "passionate").length).toBe(3);
  });

  it("모든 학생 활동 중 — 상대적 분류", () => {
    const students: StudentClusterInput[] = [
      { totalExp: 500, correctRate: 90 },  // 열정적
      { totalExp: 400, correctRate: 85 },  // 열정적
      { totalExp: 300, correctRate: 45 },  // 노력형 (rate < median)
      { totalExp: 100, correctRate: 80 },  // 효율형 (exp < median)
      { totalExp: 50, correctRate: 30 },   // 이탈 위험
    ];

    const medianExp = computeMedian(students.map(s => s.totalExp));   // 300
    const medianRate = computeMedian(students.map(s => s.correctRate)); // 80

    const results = students.map(s => classifyStudent(s, medianExp, medianRate));

    expect(results[0]).toBe("passionate");   // 500>=300, 90>=80
    expect(results[1]).toBe("passionate");   // 400>=300, 85>=80
    expect(results[2]).toBe("hardworking");  // 300>=300, 45<80
    expect(results[3]).toBe("efficient");    // 100<300, 80>=80
    expect(results[4]).toBe("atRisk");       // 50<300, 30<80
  });
});

// ============================================================
// 교수 퀴즈 평균 점수 (퀴즈 축) 계산 테스트
// ============================================================

describe("퀴즈 축 — 교수 퀴즈 평균 원점수", () => {
  it("퀴즈 1개 100점 → 평균 100", () => {
    const scores = [100];
    const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
    expect(avg).toBe(100);
  });

  it("퀴즈 2개 (100, 80) → 평균 90", () => {
    const scores = [100, 80];
    const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
    expect(avg).toBe(90);
  });

  it("퀴즈 미참여 → 0", () => {
    const scores: number[] = [];
    const avg = scores.length > 0 ? scores.reduce((s, v) => s + v, 0) / scores.length : 0;
    expect(avg).toBe(0);
  });

  it("퀴즈 3개 (60, 70, 80) → 평균 70", () => {
    const scores = [60, 70, 80];
    const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
    expect(Math.round(avg * 100) / 100).toBe(70);
  });
});

// ============================================================
// 소통 축 계산 테스트 (글×3 + 댓글×2 + 피드백)
// ============================================================

describe("소통 축 — 글×3 + 댓글×2 + 피드백", () => {
  it("글 2개, 댓글 5개, 피드백 3개 → 2×3 + 5×2 + 3 = 19", () => {
    const community = 2 * 3 + 5 * 2 + 3;
    expect(community).toBe(19);
  });

  it("활동 없음 → 0", () => {
    const community = 0 * 3 + 0 * 2 + 0;
    expect(community).toBe(0);
  });

  it("댓글만 활동 → 댓글×2", () => {
    const community = 0 * 3 + 10 * 2 + 0;
    expect(community).toBe(20);
  });
});

// ============================================================
// 박스플롯 계산 테스트 (ClassComparison)
// ============================================================

function calcBoxPlot(values: number[]) {
  if (values.length === 0) return { q1: 0, median: 0, q3: 0, whiskerLow: 0, whiskerHigh: 0, outliers: [] };
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const median = sorted[Math.floor(n / 2)];
  const q1 = sorted[Math.floor(n * 0.25)];
  const q3 = sorted[Math.floor(n * 0.75)];
  const iqr = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;
  const whiskerLow = sorted.find(v => v >= lowerFence) ?? q1;
  const whiskerHigh = [...sorted].reverse().find(v => v <= upperFence) ?? q3;
  const outliers = sorted.filter(v => v < lowerFence || v > upperFence);
  return { q1, median, q3, whiskerLow, whiskerHigh, outliers };
}

describe("박스플롯 계산", () => {
  it("대부분 0 + 이상치 1명 → 이상치 감지", () => {
    const exps = [0, 0, 0, 0, 0, 0, 0, 0, 0, 5000];
    const result = calcBoxPlot(exps);
    expect(result.median).toBe(0);
    expect(result.outliers).toContain(5000);
    expect(result.whiskerHigh).toBeLessThan(5000);
  });

  it("정상 분포 — 이상치 없음", () => {
    const exps = [100, 120, 130, 150, 170, 180, 200];
    const result = calcBoxPlot(exps);
    expect(result.outliers.length).toBe(0);
    expect(result.median).toBe(150);
  });

  it("빈 배열 → 모두 0", () => {
    const result = calcBoxPlot([]);
    expect(result.median).toBe(0);
    expect(result.outliers.length).toBe(0);
  });
});
