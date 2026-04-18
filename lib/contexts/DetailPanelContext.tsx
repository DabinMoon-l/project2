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
import { collection, addDoc, serverTimestamp, db } from '@/lib/repositories';
import { auth } from '@/lib/firebase';
import { usePanelStateStore } from '@/lib/stores/panelStateStore';

interface DetailPanelContextType {
  /** 현재 우측 패널(3쪽)에 표시 중인 콘텐츠 */
  content: ReactNode | null;
  /** 잠금 중 2쪽에 대기 중인 콘텐츠 */
  queuedContent: ReactNode | null;
  /** 우측 패널에 콘텐츠 표시 (잠금 시 2쪽 대기, trackingPath로 pageView 자동 기록) */
  openDetail: (content: ReactNode, trackingPath?: string) => void;
  /** 우측 패널 콘텐츠 교체 (잠금 시 2쪽 대기, trackingPath로 pageView 자동 기록) */
  replaceDetail: (content: ReactNode, trackingPath?: string) => void;
  /** 우측 패널 닫기 (잠금 시 대기 콘텐츠 닫기) */
  closeDetail: () => void;
  /** 대기(2쪽)만 지우기 — 잠금/콘텐츠 무관 */
  clearQueue: () => void;
  /** 우측 패널이 열려있는지 */
  isDetailOpen: boolean;
  /** 대기 콘텐츠가 있는지 */
  isQueuedOpen: boolean;
  /** 패널이 잠겨있는지 (퀴즈/복습 진행 중) */
  isLocked: boolean;
  /** 패널 잠금 (탭 전환해도 유지) */
  lockDetail: () => void;
  /** 패널 잠금 해제 (andClose=true: 닫기 포함, false: cleanup용) */
  unlockDetail: (andClose?: boolean) => void;
  /** content 변경 시 강제 remount용 key */
  contentKey: number;
}

const DetailPanelContext = createContext<DetailPanelContextType>({
  contentKey: 0,
  content: null,
  queuedContent: null,
  clearQueue: () => {},
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
  // content 변경 시 key를 바꿔서 같은 컴포넌트 타입이어도 강제 remount
  const [contentKey, setContentKey] = useState(0);
  const pathname = usePathname();

  // ref로 최신 값 추적 (useCallback 의존성 안정화)
  const isLockedRef = useRef(false);
  isLockedRef.current = isLocked;

  const queuedRef = useRef<ReactNode | null>(null);

  // 3쪽 pageView 자동 기록 (trackingPath가 있을 때만)
  const logDetailView = useCallback((trackingPath: string) => {
    const uid = auth.currentUser?.uid;
    if (!uid || !trackingPath) return;
    // 경로에서 카테고리 추론
    let category = 'detail_other';
    if (/^\/board\//.test(trackingPath)) category = 'board_detail';
    else if (/^\/quiz\/[^/]+\/result/.test(trackingPath)) category = 'quiz_result';
    else if (/^\/quiz\/[^/]+\/feedback/.test(trackingPath)) category = 'quiz_feedback';
    else if (/^\/quiz\/[^/]+/.test(trackingPath)) category = 'quiz_solve';
    else if (/^\/review\//.test(trackingPath)) category = 'review_detail';
    else if (/^\/professor\/quiz\/[^/]+\/preview/.test(trackingPath)) category = 'prof_quiz_preview';

    let sessionId = '';
    try { sessionId = sessionStorage.getItem('pv_session_id') || ''; } catch { /* SSR */ }

    addDoc(collection(db, 'pageViews'), {
      userId: uid,
      path: trackingPath,
      category,
      sessionId,
      courseId: null, // 컨텍스트 없으므로 null — pageViewLogger에서 보충됨
      classId: null,
      timestamp: serverTimestamp(),
      isDetailPanel: true, // 3쪽 패널에서 발생한 뷰 구분용
    }).catch(() => {});
  }, []);

  const openDetail = useCallback((newContent: ReactNode, trackingPath?: string) => {
    if (isLockedRef.current) {
      queuedRef.current = newContent;
      setQueuedContent(newContent);
      return;
    }
    setContentKey(k => k + 1);
    setContent(newContent);
    if (trackingPath) logDetailView(trackingPath);
  }, [logDetailView]);

  const replaceDetail = useCallback((newContent: ReactNode, trackingPath?: string) => {
    if (isLockedRef.current) {
      queuedRef.current = newContent;
      setQueuedContent(newContent);
      return;
    }
    setContentKey(k => k + 1);
    setContent(newContent);
    if (trackingPath) logDetailView(trackingPath);
  }, [logDetailView]);

  /** 대기(2쪽)만 지우기 — 잠금/콘텐츠 무관 */
  const clearQueue = useCallback(() => {
    queuedRef.current = null;
    setQueuedContent(null);
  }, []);

  const closeDetail = useCallback(() => {
    if (isLockedRef.current) {
      // 잠금 시 대기 콘텐츠만 닫기 (잠긴 3쪽 보호)
      queuedRef.current = null;
      setQueuedContent(null);
      // 승격 아닌 닫기 → 저장된 승격 상태 클리어
      import('@/lib/stores/panelStateStore').then(m => m.usePanelStateStore.getState().clear());
      return;
    }
    setContent(null);
  }, []);

  const lockDetail = useCallback(() => {
    if (_pendingUnlockRaf) {
      cancelAnimationFrame(_pendingUnlockRaf);
      _pendingUnlockRaf = 0;
    }
    isLockedRef.current = true;
    setIsLocked(true);
  }, []);

  /**
   * 패널 잠금 해제
   * @param andClose true → 명시적 닫기 (대기 승격 or 닫기)
   *   false → cleanup용 (잠금만 해제, 대기 유지)
   */
  const unlockDetail = useCallback((andClose = false) => {
    if (isLockedRef.current) {
      isLockedRef.current = false;
      setIsLocked(false);
      if (andClose) {
        // 명시적 닫기: 대기 승격 or 닫기
        const queued = queuedRef.current;
        queuedRef.current = null;
        setQueuedContent(null);
        if (queued) {
          setContentKey(k => k + 1); // 강제 remount (기존 인스턴스 교체)
          setContent(queued);  // 대기 → 3쪽 승격
        } else {
          setContent(null);    // 대기 없으면 3쪽 닫기
        }
      }
      // cleanup: 잠금만 해제, 대기·콘텐츠 그대로 유지
    } else if (andClose) {
      // 비잠금 + 명시적 닫기: 대기 승격 or 닫기
      const queued = queuedRef.current;
      if (queued) {
        queuedRef.current = null;
        setQueuedContent(null);
        setContentKey(k => k + 1);
        setContent(queued);  // 대기 → 3쪽 승격
      } else {
        setContent(null);    // 닫기
      }
    }
    // andClose=false + 비잠금 → no-op (cleanup 중복 방지)
  }, []);

  // 탭 전환 시 디테일 패널 자동 닫기
  // 대기 콘텐츠는 탭 전환 시 항상 초기화 (잠금 상태라도)
  const prevPathnameRef = useRef(pathname);
  useEffect(() => {
    // 긴 경로를 먼저 매칭 (startsWith 충돌 방지: /professor보다 /professor/stats 우선)
    const tabRoots = [
      '/professor/stats', '/professor/quiz', '/professor/students', '/professor/board',
      '/professor', '/quiz', '/review', '/board', '/settings', '/profile', '/',
    ];
    const prev = prevPathnameRef.current;
    prevPathnameRef.current = pathname;
    if (prev === pathname) return;

    // 현재/이전 경로의 탭 루트 매칭
    const findRoot = (p: string) => tabRoots.find(r => r === '/' ? p === '/' : p.startsWith(r)) || p;
    const prevRoot = findRoot(prev);
    const currRoot = findRoot(pathname);

    if (prevRoot !== currRoot) {
      // 대기 콘텐츠는 항상 초기화
      queuedRef.current = null;
      setQueuedContent(null);
      // 잠금 상태에서는 메인 콘텐츠(3쪽) 유지
      if (!isLockedRef.current) {
        setContent(null);
      }
    }
  }, [pathname]);

  const value = useMemo(() => ({
    contentKey,
    content,
    queuedContent,
    openDetail,
    replaceDetail,
    closeDetail,
    clearQueue,
    isDetailOpen: content !== null,
    isQueuedOpen: queuedContent !== null,
    isLocked,
    lockDetail,
    unlockDetail,
  }), [contentKey, content, queuedContent, openDetail, replaceDetail, closeDetail, clearQueue, isLocked, lockDetail, unlockDetail]);

  return (
    <DetailPanelContext.Provider value={value}>
      {children}
    </DetailPanelContext.Provider>
  );
}

export function useDetailPanel() {
  return useContext(DetailPanelContext);
}

/**
 * 현재 컴포넌트가 3쪽(detail)인지 2쪽(queued)인지 구분
 * layout.tsx에서 Provider로 감싸서 사용
 */
const DetailPositionContext = createContext<'detail' | 'queued'>('detail');
export const DetailPositionProvider = DetailPositionContext.Provider;

export function useDetailPosition() {
  return useContext(DetailPositionContext);
}

/**
 * 패널 닫기 — 위치에 따라 자동 분기
 * - 3쪽(detail): unlockDetail(true) → 잠금 해제 + 대기 승격/닫기
 * - 2쪽(queued): closeDetail() → 대기만 닫기 (3쪽 보호)
 */
/**
 * 패널 잠금 — 3쪽(detail)에서만 lock/unlock, 2쪽(queued)에서는 no-op
 * @param enabled false면 잠금 안 함 (비패널 모드용, hooks 규칙 준수)
 */
// 모듈 레벨 — 대기 중인 unlock rAF를 lockDetail에서 취소
let _pendingUnlockRaf = 0;

export function usePanelLock(enabled = true) {
  const position = useDetailPosition();
  const { lockDetail, unlockDetail } = useDetailPanel();

  useEffect(() => {
    if (enabled && position === 'detail') {
      // 대기 중인 unlock rAF 취소 (리마운트/StrictMode 보호)
      cancelAnimationFrame(_pendingUnlockRaf);
      _pendingUnlockRaf = 0;
      lockDetail();
      return () => {
        // unlock을 rAF로 지연 — remount 시 위의 cancelAnimationFrame이 취소
        _pendingUnlockRaf = requestAnimationFrame(() => {
          _pendingUnlockRaf = 0;
          unlockDetail();
        });
      };
    }
  }, [enabled, position, lockDetail, unlockDetail]);
}

/**
 * 승격 시 상태 보존 hook
 * - 2쪽 unmount: 상태 저장
 * - 3쪽 mount: 상태 복원 (1회성)
 * @param componentType 고유 식별자 (e.g., 'quiz-create')
 * @param getState 현재 상태 반환 함수
 * @param restoreState 상태 복원 함수
 */
export function usePanelStatePreservation(
  componentType: string,
  getState: () => Record<string, unknown>,
  restoreState: (state: Record<string, unknown>) => void,
) {
  const position = useDetailPosition();
  const getStateRef = useRef(getState);
  getStateRef.current = getState;
  const restoreRef = useRef(restoreState);
  restoreRef.current = restoreState;

  // mount 시 복원 (3쪽에서만) — 정적 import된 store를 동기 호출해 race 제거
  useEffect(() => {
    if (position === 'detail') {
      const saved = usePanelStateStore.getState().consume(componentType);
      if (saved) restoreRef.current(saved);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount 1회만

  // unmount 시 저장 (2쪽에서만) — cleanup은 반드시 동기여야 save가 확정됨
  useEffect(() => {
    return () => {
      if (position === 'queued') {
        usePanelStateStore.getState().save(componentType, getStateRef.current());
      }
    };
  }, [position, componentType]);
}

export function useClosePanel() {
  const position = useDetailPosition();
  const { closeDetail, unlockDetail } = useDetailPanel();
  return useCallback((andClose = true) => {
    if (position === 'queued') {
      closeDetail();
    } else {
      unlockDetail(andClose);
    }
  }, [position, closeDetail, unlockDetail]);
}
