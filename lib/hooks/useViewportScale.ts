'use client';

import { useEffect, useState, useCallback } from 'react';

const BASE_WIDTH = 576;
const WIDE_BREAKPOINT = 1024;

/**
 * 현재 CSS zoom 값 반환 (다른 컴포넌트에서 보정용)
 */
export function getZoom(): number {
  if (typeof document === 'undefined') return 1;
  return parseFloat(document.documentElement.style.zoom || '1');
}

/**
 * 터치/마우스 좌표를 zoom 보정하여 CSS 픽셀로 변환
 * CSS zoom 시 clientX/Y는 물리 좌표를 반환하므로 zoom으로 나눠야 논리 좌표가 됨
 */
export function scaleCoord(value: number): number {
  const zoom = getZoom();
  return zoom !== 0 ? value / zoom : value;
}

/**
 * 세로모드: CSS zoom으로 576px 기준 비율 자동 스케일
 * 가로모드(1024px+ landscape): zoom 1 (사이드바 레이아웃)
 *
 * 핵심: zoom 계산 시 window.innerWidth는 이미 zoom 영향을 받으므로
 * 반드시 zoom=1로 리셋 후 읽거나 screen.width를 사용해야 피드백 루프 방지
 */
export function useViewportScale() {
  useEffect(() => {
    function update() {
      // 1) zoom을 1로 리셋하여 물리 뷰포트 너비를 정확히 읽기
      document.documentElement.style.zoom = '1';

      // 2) 리셋 후 즉시 읽으면 정확한 물리 너비
      const physicalWidth = window.innerWidth;

      const isLandscapeWide =
        physicalWidth >= WIDE_BREAKPOINT &&
        window.matchMedia('(orientation: landscape)').matches;

      if (isLandscapeWide) {
        // 가로모드: zoom 1 유지
        document.documentElement.style.zoom = '1';
      } else {
        // 세로모드: 576px 기준으로 스케일
        document.documentElement.style.zoom = String(
          physicalWidth / BASE_WIDTH
        );
      }
    }

    update();

    // orientation 변경 시 (모바일 회전)
    const mql = window.matchMedia('(orientation: portrait)');
    const handleOrientation = () => {
      requestAnimationFrame(update);
    };
    mql.addEventListener('change', handleOrientation);

    // 윈도우 리사이즈 시 (데스크톱 창 크기 변경)
    let resizeTimer: ReturnType<typeof setTimeout>;
    const handleResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(update, 100);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      mql.removeEventListener('change', handleOrientation);
      window.removeEventListener('resize', handleResize);
      document.documentElement.style.zoom = '1';
    };
  }, []);
}

/**
 * 가로모드(wide) 감지 훅
 * 주의: CSS zoom이 적용된 상태에서 matchMedia의 min-width는
 * 논리 픽셀 기준이므로, zoom=1 시점의 물리 너비와 다를 수 있음.
 * 여기서는 orientation + min-width 1024px raw 쿼리를 사용하므로
 * CSS zoom과 무관하게 동작.
 */
export function useWideMode(): boolean {
  const [isWide, setIsWide] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(
      '(orientation: landscape) and (min-width: 1024px)'
    );

    const handleChange = () => setIsWide(mql.matches);
    handleChange();

    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, []);

  return isWide;
}
