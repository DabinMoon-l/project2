'use client';

/**
 * 전역 세션 스냅샷 훅 (PWA resume 대응)
 *
 * 동작:
 * - 앱 진입 시 세션 토큰을 sessionStorage에 기록 → cold start 감지 기준
 * - visibilitychange:hidden / pagehide 시 { pathname, scrollY } localStorage 저장
 * - 앱 재진입(특히 iOS PWA eviction 후 cold reload) 시 마지막 경로로 자동 복귀
 *
 * 복원 규칙:
 * - cold start일 때만 복원 (탭 전환·라우터 이동 중에는 동작 안 함)
 * - 탭 루트(/, /quiz, /review, /board, /professor, /professor/stats 등)에서만 복원
 *   — 사용자가 직접 입력한 URL이나 딥링크는 존중
 * - 저장된 스냅샷이 24시간 이상 오래되면 무시
 * - 1회성: 복원 후 즉시 스냅샷 제거해 무한 리다이렉트 방지
 */

import { useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';

const SNAPSHOT_KEY = 'rabbitory-session-snapshot';
const SESSION_TOKEN_KEY = 'rabbitory-session-token';
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24시간

interface Snapshot {
  pathname: string;
  scrollY: number;
  timestamp: number;
}

/** 탭 루트 — 여기에 처음 진입했을 때만 복원 시도 */
const TAB_ROOTS = new Set([
  '/',
  '/quiz',
  '/review',
  '/board',
  '/professor',
  '/professor/stats',
  '/professor/quiz',
  '/professor/students',
  '/professor/board',
]);

/** 복원 대상에서 제외할 경로 — 일회성 플로우·폼 등 */
function isRestorable(pathname: string): boolean {
  if (!pathname) return false;
  // 인증 관련은 복원 금지
  if (pathname.startsWith('/login')) return false;
  if (pathname.startsWith('/signup')) return false;
  // 배틀 세션 복원 금지 (RTDB 휘발성)
  if (pathname.startsWith('/battle')) return false;
  // 랜덤 복습 복원 금지 (세션마다 새로 뽑음)
  if (pathname === '/review/random') return false;
  return true;
}

function saveSnapshot(pathname: string) {
  try {
    if (!isRestorable(pathname)) return;
    const snap: Snapshot = {
      pathname,
      scrollY: typeof window !== 'undefined' ? window.scrollY : 0,
      timestamp: Date.now(),
    };
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
  } catch {
    /* quota / disabled storage */
  }
}

function loadSnapshot(): Snapshot | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw) as Snapshot;
    if (!snap.pathname) return null;
    if (Date.now() - snap.timestamp > MAX_AGE_MS) {
      localStorage.removeItem(SNAPSHOT_KEY);
      return null;
    }
    return snap;
  } catch {
    return null;
  }
}

function clearSnapshot() {
  try {
    localStorage.removeItem(SNAPSHOT_KEY);
  } catch {
    /* noop */
  }
}

/** cold start 여부 판별 — 이 탭이 방금 열렸는지 (sessionStorage는 cold reload 시 비어있음) */
function isColdStart(): boolean {
  try {
    return !sessionStorage.getItem(SESSION_TOKEN_KEY);
  } catch {
    return false;
  }
}

function markSessionAlive() {
  try {
    sessionStorage.setItem(SESSION_TOKEN_KEY, '1');
  } catch {
    /* noop */
  }
}

export function useSessionSnapshot() {
  const router = useRouter();
  const pathname = usePathname() || '/';
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const restoreAttemptedRef = useRef(false);

  // mount 1회: cold start이고 탭 루트 진입이면 마지막 경로로 복원
  useEffect(() => {
    if (restoreAttemptedRef.current) return;
    restoreAttemptedRef.current = true;

    const cold = isColdStart();
    markSessionAlive();

    if (!cold) return;
    if (!TAB_ROOTS.has(pathname)) return;

    const snap = loadSnapshot();
    if (!snap) return;
    if (snap.pathname === pathname) {
      // 이미 같은 경로 — 스크롤만 복원
      requestAnimationFrame(() => {
        if (typeof window !== 'undefined') {
          window.scrollTo(0, snap.scrollY);
        }
      });
      clearSnapshot();
      return;
    }

    // 복원은 1회성 → 즉시 클리어
    clearSnapshot();

    // 저장된 경로로 replace (뒤로가기에 홈이 쌓이지 않게)
    router.replace(snap.pathname);

    // 페이지 이동 후 스크롤 복원은 해당 페이지에서 자체 처리하거나 F(스크롤 복원 확장)에서 일괄 처리
    // 여기선 window.scrollY만 일단 시도
    if (snap.scrollY > 0) {
      const timer = setTimeout(() => {
        window.scrollTo(0, snap.scrollY);
      }, 300);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 저장 트리거: visibilitychange:hidden / pagehide / beforeunload
  useEffect(() => {
    const onHide = () => saveSnapshot(pathnameRef.current);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        saveSnapshot(pathnameRef.current);
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onHide);
    window.addEventListener('beforeunload', onHide);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('beforeunload', onHide);
    };
  }, []);

  // pathname 변경 시에도 스냅샷 업데이트 (라우팅 중간에 eviction 대비)
  useEffect(() => {
    saveSnapshot(pathname);
  }, [pathname]);
}
