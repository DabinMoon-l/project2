'use client';

import { useEffect } from 'react';

/**
 * Web Vitals 성능 메트릭 리포터
 *
 * 클라이언트 사이드에서 Core Web Vitals를 측정하고 리포팅합니다.
 * - LCP, FID, CLS, FCP, TTFB, INP 메트릭 측정
 * - 개발 환경에서는 콘솔에 출력
 * - 프로덕션에서는 Analytics로 전송
 */
export function WebVitalsReporter() {
  useEffect(() => {
    // 동적 import로 web-vitals 로드 (코드 스플리팅)
    const initWebVitals = async () => {
      try {
        const { measureWebVitals } = await import('@/lib/utils/webVitals');
        await measureWebVitals();
      } catch {
        // web-vitals 로드 실패 시 무시 (선택적 기능)
      }
    };

    // 페이지 로드 후 측정 시작
    if (document.readyState === 'complete') {
      initWebVitals();
    } else {
      window.addEventListener('load', initWebVitals);
      return () => window.removeEventListener('load', initWebVitals);
    }
  }, []);

  // UI 렌더링 없음
  return null;
}

export default WebVitalsReporter;
