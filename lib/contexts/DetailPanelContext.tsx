'use client';

/**
 * 우측 디테일 패널 Context (가로모드 3패널 레이아웃용)
 *
 * 가로모드(iPad/데스크탑)에서 퀴즈 상세, 게시판 상세, 복습 상세 등을
 * 우측 패널에 렌더링하기 위한 전역 상태 관리.
 *
 * 잠금(lock) 기능: 퀴즈/복습 진행 시 탭 전환해도 3쪽 유지.
 * 대기(queue) 기능: 잠금 중 openDetail 호출 시 2쪽에 대기 콘텐츠 표시,
 *   잠금 해제 시 3쪽으로 자동 승격.
 * 모바일 세로모드에서는 사용되지 않음.
 */

import { createContext, useContext, useState, useCallback, useMemo, useRef, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

interface DetailPanelContextType {
  /** 현재 우측 패널(3쪽)에 표시 중인 콘텐츠 */
  content: ReactNode | null;
  /** 잠금 중 2쪽에 대기 중인 콘텐츠 */
  queuedContent: ReactNode | null;
  /** 우측 패널에 콘텐츠 표시 (잠금 시 2쪽 대기) */
  openDetail: (content: ReactNode) => void;
  /** 우측 패널 콘텐츠 교체 (잠금 시 2쪽 대기) */
  replaceDetail: (content: ReactNode) => void;
  /** 우측 패널 닫기 (잠금 시 대기 콘텐츠 닫기) */
  closeDetail: () => void;
  /** 우측 패널이 열려있는지 */
  isDetailOpen: boolean;
  /** 대기 콘텐츠가 있는지 */
  isQueuedOpen: boolean;
  /** 패널이 잠겨있는지 (퀴즈/복습 진행 중) */
  isLocked: boolean;
  /** 패널 잠금 (탭 전환해도 유지) */
  lockDetail: () => void;
  /** 패널 잠금 해제 (대기 콘텐츠 → 3쪽 승격) */
  unlockDetail: () => void;
}

const DetailPanelContext = createContext<DetailPanelContextType>({
  content: null,
  queuedContent: null,
  openDetail: () => {},
  replaceDetail: () => {},
  closeDetail: () => {},
  isDetailOpen: false,
  isQueuedOpen: false,
  isLocked: false,
  lockDetail: () => {},
  unlockDetail: () => {},
});

export function DetailPanelProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ReactNode | null>(null);
  const [queuedContent, setQueuedContent] = useState<ReactNode | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const pathname = usePathname();

  // ref로 최신 값 추적 (useCallback 의존성 안정화)
  const isLockedRef = useRef(false);
  isLockedRef.current = isLocked;

  const queuedRef = useRef<ReactNode | null>(null);

  const openDetail = useCallback((newContent: ReactNode) => {
    if (isLockedRef.current) {
      // 잠금 시 2쪽에 대기
      queuedRef.current = newContent;
      setQueuedContent(newContent);
      return;
    }
    setContent(newContent);
  }, []);

  const replaceDetail = useCallback((newContent: ReactNode) => {
    if (isLockedRef.current) {
      queuedRef.current = newContent;
      setQueuedContent(newContent);
      return;
    }
    setContent(newContent);
  }, []);

  const closeDetail = useCallback(() => {
    if (isLockedRef.current) {
      // 잠금 시 대기 콘텐츠만 닫기 (잠긴 3쪽 보호)
      queuedRef.current = null;
      setQueuedContent(null);
      return;
    }
    setContent(null);
  }, []);

  const lockDetail = useCallback(() => {
    isLockedRef.current = true;
    setIsLocked(true);
  }, []);

  const unlockDetail = useCallback(() => {
    isLockedRef.current = false;
    setIsLocked(false);
    // 대기 콘텐츠가 있으면 3쪽으로 승격
    const queued = queuedRef.current;
    queuedRef.current = null;
    setQueuedContent(null);
    if (queued) {
      setContent(queued);
    }
  }, []);

  // 탭 전환 시 (pathname이 탭 루트로 변경되면) 디테일 패널 자동 닫기
  // 대기 콘텐츠는 탭 전환 시 항상 초기화 (잠금 상태라도)
  const prevPathnameRef = useRef(pathname);
  useEffect(() => {
    const tabRoots = ['/', '/quiz', '/review', '/board', '/professor', '/professor/stats', '/professor/quiz', '/professor/students', '/settings', '/profile'];
    const prev = prevPathnameRef.current;
    prevPathnameRef.current = pathname;

    if (tabRoots.includes(pathname)) {
      const prevRoot = tabRoots.find(r => r !== '/' && prev.startsWith(r)) || '/';
      const currRoot = tabRoots.find(r => r !== '/' && pathname.startsWith(r)) || '/';
      if (prevRoot !== currRoot) {
        // 대기 콘텐츠는 항상 초기화
        queuedRef.current = null;
        setQueuedContent(null);
        // 잠금 상태에서는 메인 콘텐츠(3쪽) 유지
        if (!isLockedRef.current) {
          setContent(null);
        }
      }
    }
  }, [pathname]);

  const value = useMemo(() => ({
    content,
    queuedContent,
    openDetail,
    replaceDetail,
    closeDetail,
    isDetailOpen: content !== null,
    isQueuedOpen: queuedContent !== null,
    isLocked,
    lockDetail,
    unlockDetail,
  }), [content, queuedContent, openDetail, replaceDetail, closeDetail, isLocked, lockDetail, unlockDetail]);

  return (
    <DetailPanelContext.Provider value={value}>
      {children}
    </DetailPanelContext.Provider>
  );
}

export function useDetailPanel() {
  return useContext(DetailPanelContext);
}
