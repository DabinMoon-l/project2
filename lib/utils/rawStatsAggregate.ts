/**
 * Raw 페이지뷰 집계 헬퍼 + 메타 상수
 * (useRawStatsQuery 훅과 분리 — 순수 함수)
 */

import type { PageViewRow } from '@/lib/hooks/useRawStatsQuery';

/** X축 기준 */
export type XAxis = 'date' | 'hour' | 'dayOfWeek';

/** Y축 메트릭 */
export type YMetric =
  | 'pageViews'
  | 'uniqueUsers'
  | 'totalDurationMin'
  | 'avgDurationPerUserMin'
  | 'avgDurationPerSessionMin'
  | 'sessions';

export interface AggregateRow {
  x: string | number;
  xLabel: string;
  values: Record<string, number>;
}

/** X축 키 → 표시 라벨 */
export function formatXKey(axis: XAxis, key: string | number): string {
  if (axis === 'hour') return `${key}시`;
  if (axis === 'dayOfWeek') {
    const labels = ['월', '화', '수', '목', '금', '토', '일'];
    return labels[Number(key)] || String(key);
  }
  return String(key);
}

/** X축 키 후보 생성 */
export function generateXKeys(axis: XAxis, rows: PageViewRow[]): (string | number)[] {
  if (axis === 'hour') return Array.from({ length: 24 }, (_, i) => i);
  if (axis === 'dayOfWeek') return [0, 1, 2, 3, 4, 5, 6];
  const set = new Set<string>();
  rows.forEach(r => set.add(r.date));
  return Array.from(set).sort();
}

/** rows를 X축 + 선택 메트릭으로 집계 */
export function aggregate(
  rows: PageViewRow[],
  xAxis: XAxis,
  metrics: YMetric[],
  filter: { categories: string[]; classes: string[] },
): AggregateRow[] {
  const filtered = rows.filter(r => {
    if (filter.categories.length > 0 && !filter.categories.includes(r.category)) return false;
    if (filter.classes.length > 0 && !filter.classes.includes(r.classId)) return false;
    return true;
  });

  const xKeys = generateXKeys(xAxis, filtered);
  const groups = new Map<string | number, PageViewRow[]>();
  xKeys.forEach(k => groups.set(k, []));
  filtered.forEach(r => {
    const key: string | number = xAxis === 'date' ? r.date : xAxis === 'hour' ? r.hour : r.dayOfWeek;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  });

  const result: AggregateRow[] = [];
  groups.forEach((groupRows, x) => {
    const values: Record<string, number> = {};

    metrics.forEach(metric => {
      switch (metric) {
        case 'pageViews':
          values[metric] = groupRows.length;
          break;
        case 'uniqueUsers': {
          const set = new Set(groupRows.map(r => r.userId));
          values[metric] = set.size;
          break;
        }
        case 'totalDurationMin': {
          const sum = groupRows.reduce((acc, r) => acc + r.durationMs, 0);
          values[metric] = Math.round((sum / 60000) * 10) / 10;
          break;
        }
        case 'avgDurationPerUserMin': {
          const set = new Set(groupRows.map(r => r.userId));
          const sum = groupRows.reduce((acc, r) => acc + r.durationMs, 0);
          values[metric] = set.size > 0 ? Math.round((sum / set.size / 60000) * 10) / 10 : 0;
          break;
        }
        case 'avgDurationPerSessionMin': {
          const sessionDur = new Map<string, number>();
          groupRows.forEach(r => {
            if (!r.sessionId) return;
            sessionDur.set(r.sessionId, (sessionDur.get(r.sessionId) || 0) + r.durationMs);
          });
          const total = Array.from(sessionDur.values()).reduce((a, b) => a + b, 0);
          values[metric] = sessionDur.size > 0 ? Math.round((total / sessionDur.size / 60000) * 10) / 10 : 0;
          break;
        }
        case 'sessions': {
          const set = new Set(groupRows.map(r => r.sessionId).filter(Boolean));
          values[metric] = set.size;
          break;
        }
      }
    });

    result.push({ x, xLabel: formatXKey(xAxis, x), values });
  });

  result.sort((a, b) => {
    if (typeof a.x === 'number' && typeof b.x === 'number') return a.x - b.x;
    return String(a.x).localeCompare(String(b.x));
  });

  return result;
}

/** 메트릭 메타 (라벨/단위/색) */
export const Y_METRIC_META: Record<YMetric, { label: string; unit: string; color: string }> = {
  pageViews: { label: '페이지뷰 수', unit: '회', color: '#1A1A1A' },
  uniqueUsers: { label: '접속 유저 수', unit: '명', color: '#8B1A1A' },
  totalDurationMin: { label: '총 이용시간', unit: '분', color: '#1E3A5F' },
  avgDurationPerUserMin: { label: '유저당 평균 이용시간', unit: '분', color: '#1D5D4A' },
  avgDurationPerSessionMin: { label: '세션당 평균 이용시간', unit: '분', color: '#B8860B' },
  sessions: { label: '세션 수', unit: '개', color: '#5C5C5C' },
};

export const X_AXIS_META: Record<XAxis, { label: string }> = {
  date: { label: '날짜' },
  hour: { label: '시간대 (0~23시)' },
  dayOfWeek: { label: '요일' },
};

/** 카테고리 표시명 */
export const CATEGORY_LABELS: Record<string, string> = {
  home: '홈',
  quiz_list: '퀴즈 목록',
  quiz_solve: '퀴즈 풀이',
  quiz_result: '퀴즈 결과',
  quiz_feedback: '퀴즈 피드백',
  quiz_exp: '퀴즈 EXP',
  quiz_create: '퀴즈 만들기',
  review_list: '복습 목록',
  review_detail: '복습 상세',
  review_practice: '복습 연습',
  board_list: '게시판',
  board_detail: '게시글',
  ranking: '랭킹',
  profile: '프로필',
  settings: '설정',
  prof_stats: '교수 통계',
  prof_students: '교수 학생관리',
  prof_quiz_preview: '교수 퀴즈 미리보기',
  other: '기타',
};
