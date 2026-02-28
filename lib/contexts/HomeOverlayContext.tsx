'use client';

import { createContext, useContext, useState, useCallback, useRef, useMemo, type ReactNode, type MutableRefObject } from 'react';

interface ButtonRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface HomeOverlayContextValue {
  isOpen: boolean;
  /** 닫기 애니메이션 요청됨 (오버레이가 감지 → 축소 후 close 호출) */
  isCloseRequested: boolean;
  open: () => void;
  /** 즉시 닫기 (탭 이동 등) */
  close: () => void;
  /** 축소 애니메이션 후 닫기 (홈 버튼 토글, 스와이프) */
  closeAnimated: () => void;
  homeButtonRef: MutableRefObject<HTMLElement | null>;
  buttonRect: ButtonRect | null;
}

const HomeOverlayContext = createContext<HomeOverlayContextValue>({
  isOpen: false,
  isCloseRequested: false,
  open: () => {},
  close: () => {},
  closeAnimated: () => {},
  homeButtonRef: { current: null },
  buttonRect: null,
});

export function HomeOverlayProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isCloseRequested, setIsCloseRequested] = useState(false);
  const homeButtonRef = useRef<HTMLElement | null>(null);
  const [buttonRect, setButtonRect] = useState<ButtonRect | null>(null);

  const open = useCallback(() => {
    if (homeButtonRef.current) {
      const r = homeButtonRef.current.getBoundingClientRect();
      setButtonRect({ x: r.x, y: r.y, width: r.width, height: r.height });
    }
    setIsOpen(true);
    setIsCloseRequested(false);
    document.body.setAttribute('data-home-overlay-open', '');
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setIsCloseRequested(false);
    document.body.removeAttribute('data-home-overlay-open');
  }, []);

  const closeAnimated = useCallback(() => {
    setIsCloseRequested(true);
  }, []);

  // Context 값 메모이제이션 (불필요한 소비자 리렌더 방지)
  const value = useMemo<HomeOverlayContextValue>(() => ({
    isOpen, isCloseRequested, open, close, closeAnimated, homeButtonRef, buttonRect,
  }), [isOpen, isCloseRequested, open, close, closeAnimated, buttonRect]);

  return (
    <HomeOverlayContext.Provider value={value}>
      {children}
    </HomeOverlayContext.Provider>
  );
}

export function useHomeOverlay() {
  return useContext(HomeOverlayContext);
}
