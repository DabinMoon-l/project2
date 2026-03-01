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

/**
 * 숨겨진 readonly input으로 포커스를 이동시켜 키보드를 확실히 닫는 함수
 * iOS PWA에서 단순 blur()가 무시되는 경우 대응
 */
function forceCloseKeyboard() {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return;

  // 숨겨진 input이 없으면 생성
  let dummy = document.getElementById('__kb-dismiss') as HTMLInputElement | null;
  if (!dummy) {
    dummy = document.createElement('input');
    dummy.id = '__kb-dismiss';
    dummy.setAttribute('readonly', 'true');
    dummy.setAttribute('tabindex', '-1');
    dummy.setAttribute('aria-hidden', 'true');
    Object.assign(dummy.style, {
      position: 'fixed',
      opacity: '0',
      top: '-100px',
      left: '0',
      width: '1px',
      height: '1px',
      pointerEvents: 'none',
    });
    document.body.appendChild(dummy);
  }

  // readonly input에 포커스 → 키보드 닫힘 → 즉시 blur
  dummy.focus();
  dummy.blur();
}

export function useKeyboardAware(): KeyboardAwareState {
  const [bottomOffset, setBottomOffset] = useState(0);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const rafRef = useRef<number>(0);
  const initialHeightRef = useRef<number>(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const vv = window.visualViewport;
    if (!vv) return;

    // 초기 높이 저장 (Android에서 키보드 감지에 사용)
    initialHeightRef.current = vv.height;

    const handleResize = () => {
      // rAF로 배치하여 레이아웃 thrashing 방지
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        // iOS: innerHeight 고정, vv.height 축소 → offset = keyboard height
        // Android: 둘 다 축소 → offset ≈ 0
        const offset = Math.max(0, window.innerHeight - (vv.offsetTop + vv.height));

        // Android 감지 보조: 초기 높이 대비 줄어든 양도 체크
        const heightDiff = initialHeightRef.current - vv.height;
        const isOpen = offset > 100 || heightDiff > 100;

        setBottomOffset(offset);
        setIsKeyboardOpen(isOpen);
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
    forceCloseKeyboard();
  }, []);

  return { isKeyboardOpen, bottomOffset, dismissKeyboard };
}

/**
 * 스크롤 시 키보드 자동 닫기 훅 (모바일 UX 표준 패턴)
 *
 * iOS 네이티브 앱의 keyboardDismissMode: .onDrag와 동일한 동작.
 * 터치가 입력 요소 바깥에서 시작된 경우, 20px 이상 스크롤 시 키보드를 닫습니다.
 * 입력 요소 내부 스크롤(긴 텍스트 스크롤)은 키보드를 유지합니다.
 */
export function useScrollDismissKeyboard() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let startY = 0;
    let dismissed = false;
    let touchInInput = false;

    const onTouchStart = (e: TouchEvent) => {
      startY = e.touches[0].clientY;
      dismissed = false;
      // 터치가 현재 포커스된 입력 요소 내부에서 시작되면 스크롤해도 키보드 유지
      const active = document.activeElement;
      touchInInput =
        active instanceof HTMLElement &&
        (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') &&
        active.contains(e.target as Node);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (dismissed || touchInInput) return;
      const active = document.activeElement;
      if (
        !(active instanceof HTMLInputElement) &&
        !(active instanceof HTMLTextAreaElement)
      )
        return;

      const dy = Math.abs(e.touches[0].clientY - startY);
      if (dy > 20) {
        // iOS PWA에서 blur()가 무시되는 경우 대비하여 forceCloseKeyboard 사용
        forceCloseKeyboard();
        dismissed = true;
      }
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
    };
  }, []);
}

/**
 * 키보드 열림 시 스크롤 컨테이너의 paddingBottom을 동적 조정하는 훅
 *
 * iOS Safari에서 fixed 입력바가 키보드 위로 올라갈 때
 * 스크롤 가능한 콘텐츠가 입력바 뒤에 가려지는 문제를 해결합니다.
 *
 * useKeyboardAware의 bottomOffset을 재사용하므로 visualViewport 리스너를 중복 생성하지 않습니다.
 *
 * @param bottomOffset - useKeyboardAware에서 받은 키보드 오프셋 (px)
 * @param inputBarHeight - 하단 고정 입력바 높이 (px)
 * @param containerSelector - 스크롤 컨테이너 CSS 선택자
 */
export function useKeyboardScrollAdjust(
  bottomOffset: number,
  inputBarHeight: number = 80,
  containerSelector: string = '[data-board-detail]'
) {
  const origPaddingRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);

  // 컨테이너 참조를 마운트 시 한 번만 캐시
  useEffect(() => {
    containerRef.current = document.querySelector(containerSelector);
    return () => {
      // 언마운트 시 원래 패딩 복원
      if (containerRef.current && origPaddingRef.current !== null) {
        containerRef.current.style.paddingBottom = origPaddingRef.current;
        origPaddingRef.current = null;
      }
      containerRef.current = null;
    };
  }, [containerSelector]);

  // bottomOffset 변화에 따라 패딩 조정
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (bottomOffset > 100) {
      // 키보드 열림 → paddingBottom 증가
      if (origPaddingRef.current === null) {
        origPaddingRef.current = container.style.paddingBottom || '';
      }
      container.style.paddingBottom = `${bottomOffset + inputBarHeight}px`;
    } else {
      // 키보드 닫힘 → 원래 패딩 복원
      if (origPaddingRef.current !== null) {
        container.style.paddingBottom = origPaddingRef.current;
        origPaddingRef.current = null;
      }
    }
  }, [bottomOffset, inputBarHeight]);
}
