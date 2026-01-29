/**
 * Web Vitals 성능 모니터링 유틸리티
 *
 * Core Web Vitals 메트릭을 측정하고 리포팅합니다.
 * - LCP (Largest Contentful Paint): 가장 큰 콘텐츠 요소가 표시되기까지의 시간
 * - FID (First Input Delay): 첫 입력에 대한 지연 시간
 * - CLS (Cumulative Layout Shift): 레이아웃 이동 누적 점수
 * - FCP (First Contentful Paint): 첫 콘텐츠가 표시되기까지의 시간
 * - TTFB (Time to First Byte): 첫 바이트를 받기까지의 시간
 * - INP (Interaction to Next Paint): 상호작용 후 다음 페인트까지의 시간
 */

import type { Metric } from 'web-vitals';

// 성능 메트릭 타입
export interface WebVitalsMetric {
  id: string;
  name: string;
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
  delta: number;
  navigationType: string;
}

// 메트릭 임계값 (Google 권장 기준)
const THRESHOLDS = {
  LCP: { good: 2500, poor: 4000 },
  FID: { good: 100, poor: 300 },
  CLS: { good: 0.1, poor: 0.25 },
  FCP: { good: 1800, poor: 3000 },
  TTFB: { good: 800, poor: 1800 },
  INP: { good: 200, poor: 500 },
};

/**
 * 메트릭 값에 따른 등급 판정
 */
function getRating(name: string, value: number): 'good' | 'needs-improvement' | 'poor' {
  const threshold = THRESHOLDS[name as keyof typeof THRESHOLDS];
  if (!threshold) return 'good';

  if (value <= threshold.good) return 'good';
  if (value <= threshold.poor) return 'needs-improvement';
  return 'poor';
}

/**
 * Web Vitals 메트릭을 콘솔에 리포팅
 * 개발 환경에서만 동작합니다.
 */
export function reportWebVitals(metric: Metric): void {
  // 프로덕션에서는 console.log가 제거되므로 리포팅만 수행
  if (process.env.NODE_ENV === 'development') {
    const rating = getRating(metric.name, metric.value);
    const emoji = rating === 'good' ? '🟢' : rating === 'needs-improvement' ? '🟡' : '🔴';

    // eslint-disable-next-line no-console
    console.log(
      `${emoji} [Web Vitals] ${metric.name}: ${Math.round(metric.value)}ms (${rating})`
    );
  }

  // Analytics로 전송 (Firebase Analytics 또는 다른 서비스)
  sendToAnalytics(metric);
}

/**
 * Analytics 서비스로 메트릭 전송
 */
function sendToAnalytics(metric: Metric): void {
  // Google Analytics 4로 전송 예시
  if (typeof window !== 'undefined' && 'gtag' in window) {
    const gtag = (window as unknown as { gtag: (...args: unknown[]) => void }).gtag;
    gtag('event', metric.name, {
      event_category: 'Web Vitals',
      event_label: metric.id,
      value: Math.round(metric.name === 'CLS' ? metric.value * 1000 : metric.value),
      non_interaction: true,
    });
  }

  // Firebase Analytics로 전송 예시 (필요시 활성화)
  // import { logEvent } from 'firebase/analytics';
  // if (analytics) {
  //   logEvent(analytics, metric.name, {
  //     value: Math.round(metric.value),
  //     rating: getRating(metric.name, metric.value),
  //   });
  // }
}

/**
 * 모든 Web Vitals 메트릭 측정 시작
 */
export async function measureWebVitals(
  onReport?: (metric: Metric) => void
): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    const { onCLS, onFID, onFCP, onLCP, onTTFB, onINP } = await import('web-vitals');

    const callback = onReport || reportWebVitals;

    // Core Web Vitals
    onLCP(callback);
    onFID(callback);
    onCLS(callback);

    // 추가 메트릭
    onFCP(callback);
    onTTFB(callback);
    onINP(callback);
  } catch {
    // web-vitals 로드 실패 시 무시 (에러 로깅은 선택적)
    console.error('[Web Vitals] 라이브러리 로드 실패');
  }
}

/**
 * 성능 데이터 수집 상태 리포트
 */
export function getPerformanceSummary(): Record<string, number> | null {
  if (typeof window === 'undefined' || !('performance' in window)) {
    return null;
  }

  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;

  if (!navigation) return null;

  return {
    // DNS 조회 시간
    dnsLookup: navigation.domainLookupEnd - navigation.domainLookupStart,
    // TCP 연결 시간
    tcpConnection: navigation.connectEnd - navigation.connectStart,
    // 요청 시간
    request: navigation.responseStart - navigation.requestStart,
    // 응답 시간
    response: navigation.responseEnd - navigation.responseStart,
    // DOM 파싱 시간
    domParsing: navigation.domInteractive - navigation.responseEnd,
    // DOM 완료 시간
    domComplete: navigation.domComplete - navigation.domInteractive,
    // 전체 로드 시간
    totalLoad: navigation.loadEventEnd - navigation.startTime,
  };
}

export default measureWebVitals;
