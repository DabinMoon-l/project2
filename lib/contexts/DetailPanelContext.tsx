'use client';

/**
 * 우측 디테일 패널 Context (가로모드 3패널 레이아웃용)
 *
 * 가로모드(iPad/데스크탑)에서 퀴즈 상세, 게시판 상세, 복습 상세 등을
 * 우측 패널에 렌더링하기 위한 전역 상태 관리.
 *
 * 모바일 세로모드에서는 사용되지 않음.
 */

import { createContext, useContext, useState, useCallback, useMemo, useRef, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

interface DetailPanelContextType {
  /** 현재 우측 패널에 표시 중인 콘텐츠 */
  content: ReactNode | null;
  /** 우측 패널에 콘텐츠 표시 */
  openDetail: (content: ReactNode) => void;
  /** 우측 패널 콘텐츠 교체 (열린 상태 유지) */
  replaceDetail: (content: ReactNode) => void;
  /** 우측 패널 닫기 */
  closeDetail: () => void;
  /** 우측 패널이 열려있는지 */
  isDetailOpen: boolean;
}

const DetailPanelContext = createContext<DetailPanelContextType>({
  content: null,
  openDetail: () => {},
  replaceDetail: () => {},
  closeDetail: () => {},
  isDetailOpen: false,
});

export function DetailPanelProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ReactNode | null>(null);
  const pathname = usePathname();

  const openDetail = useCallback((newContent: ReactNode) => {
    setContent(newContent);
  }, []);

  const replaceDetail = useCallback((newContent: ReactNode) => {
    setContent(newContent);
  }, []);

  const closeDetail = useCallback(() => {
    setContent(null);
  }, []);

  // 탭 전환 시 (pathname이 탭 루트로 변경되면) 디테일 패널 자동 닫기
  // 단, 현재 탭과 같은 루트에서는 닫지 않음 (2쪽 고정 + 3쪽 상세 패턴)
  const prevPathnameRef = useRef(pathname);
  useEffect(() => {
    const tabRoots = ['/', '/quiz', '/review', '/board', '/professor', '/professor/stats', '/professor/quiz', '/professor/students', '/settings', '/profile'];
    const prev = prevPathnameRef.current;
    prevPathnameRef.current = pathname;

    if (tabRoots.includes(pathname)) {
      // 같은 탭 루트 내에서 돌아온 경우(예: /review/xxx → /review)는 닫지 않음
      // 다른 탭으로 전환한 경우만 닫기
      const prevRoot = tabRoots.find(r => r !== '/' && prev.startsWith(r)) || '/';
      const currRoot = tabRoots.find(r => r !== '/' && pathname.startsWith(r)) || '/';
      if (prevRoot !== currRoot) {
        setContent(null);
      }
    }
  }, [pathname]);

  const value = useMemo(() => ({
    content,
    openDetail,
    replaceDetail,
    closeDetail,
    isDetailOpen: content !== null,
  }), [content, openDetail, replaceDetail, closeDetail]);

  return (
    <DetailPanelContext.Provider value={value}>
      {children}
    </DetailPanelContext.Provider>
  );
}

export function useDetailPanel() {
  return useContext(DetailPanelContext);
}
