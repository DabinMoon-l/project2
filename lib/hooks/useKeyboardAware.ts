'use client';

/**
 * 모바일 키보드 인식 훅
 *
 * visualViewport API로 가상 키보드 높이를 감지하여
 * fixed 요소의 bottom 오프셋을 자동 계산합니다.
 *
 * - iOS Safari: layout viewport 고정, visual viewport 축소 → bottomOffset > 0
 * - Android Chrome: layout viewport도 축소 → bottomOffset ≈ 0 (자동 처리)
 * - Desktop: keyboard 없음 → bottomOffset = 0
 */

import { useState, useEffect, useCallback, useRef } from 'react';

interface KeyboardAwareState {
  /** 키보드가 열려있는지 여부 */
  isKeyboardOpen: boolean;
  /** fixed 요소에 적용할 bottom 오프셋 (px) */
  bottomOffset: number;
  /** 활성 요소 blur로 키보드 닫기 */
  dismissKeyboard: () => void;
}

export function useKeyboardAware(): KeyboardAwareState {
  const [bottomOffset, setBottomOffset] = useState(0);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const vv = window.visualViewport;
    if (!vv) return;

    const handleResize = () => {
      // rAF로 배치하여 레이아웃 thrashing 방지
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        // iOS: innerHeight 고정, vv.height 축소 → offset = keyboard height
        // Android: 둘 다 축소 → offset ≈ 0
        const offset = Math.max(0, window.innerHeight - (vv.offsetTop + vv.height));
        setBottomOffset(offset);
        setIsKeyboardOpen(offset > 150);
      });
    };

    vv.addEventListener('resize', handleResize);
    vv.addEventListener('scroll', handleResize);

    return () => {
      vv.removeEventListener('resize', handleResize);
      vv.removeEventListener('scroll', handleResize);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const dismissKeyboard = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }, []);

  return { isKeyboardOpen, bottomOffset, dismissKeyboard };
}
