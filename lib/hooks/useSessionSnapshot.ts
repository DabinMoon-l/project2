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
// cold reload로 경로 복원 직후, 그 경로 페이지가 "이건 in-app navigation이 아니라
// cold-reload 복원이다"를 구분할 수 있게 저장하는 플래그. 1회 consume 방식.
const COLD_RESTORED_PATH_KEY = 'rabbitory-cold-restored-path';
// app boot 시점에 "이번이 cold start"임을 기록하는 1회 consume 플래그.
// useSessionSnapshot의 redirect 여부와 무관하게, 앱 최초 mount 페이지가
// "내가 cold start로 열린건가?"를 판별할 때 사용.
// 예: iOS PWA가 저장된 URL로 직접 재시작해도 이 플래그는 true.
const COLD_START_CONSUMABLE_KEY = 'rabbitory-cold-start-consumable';
// "앱을 껐다 켬" vs "잠깐 다른 앱" 구분 — 2분 내 복귀면 백그라운드 복귀로 보고
// 저장된 경로 복원. 그 이상 지났으면 사용자가 의도적으로 닫은 것으로 간주하고
// 홈화면(PWA manifest start_url=/)에 그대로 진입 (복원 스킵).
// iOS PWA가 저장된 URL 자체로 relaunch하는 경우에도 cold-start-consumable을
// set하지 않아 퀴즈 등 페이지의 '이전 진행' 모달이 정상 표시됨.
const MAX_AGE_MS = 2 * 60 * 1000;

/**
 * cold reload로 복원된 경로를 1회 소비.
 * 복원 로직이 `router.replace`하기 직전에 sessionStorage에 저장되고,
 * 해당 경로의 페이지가 mount될 때 한번 읽고 제거한다. 이후 같은 페이지에
 * 재진입해도 false가 되어 "in-app navigation"으로 정상 분류됨.
 */
export function consumeColdRestoredPath(): string | null {
  try {
    const p = sessionStorage.getItem(COLD_RESTORED_PATH_KEY);
    if (p) sessionStorage.removeItem(COLD_RESTORED_PATH_KEY);
    return p;
  } catch {
    return null;
  }
}

/**
 * 이번 앱 mount가 cold start인지 1회 소비. app layout이 boot 시 set하고,
 * 최초 페이지(특히 quiz/[id], /board/[id] 등)가 "나 지금 cold reload로 열린 거야?"를
 * 판별할 때 사용. useSessionSnapshot redirect 여부와 무관하게 true.
 */
export function consumeColdStart(): boolean {
  try {
    const v = sessionStorage.getItem(COLD_START_CONSUMABLE_KEY);
    if (v) {
      sessionStorage.removeItem(COLD_START_CONSUMABLE_KEY);
      return true;
    }
  } catch { /* noop */ }
  return false;
}

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

    // 스냅샷이 valid(2분 이내) 할 때만 "백그라운드 복귀"로 간주해 복원 수행.
    // 유효하지 않으면 아무것도 하지 않음 → 사용자는 장시간 닫은 후 재시작한 것이므로
    // PWA manifest start_url(/) 또는 iOS가 preserve한 URL 그대로 진입.
    const snap = loadSnapshot();
    if (!snap) return;

    // 복원 확정 — 자식 페이지가 "이번 mount는 cold-reload 복원이다"를 감지하도록
    // consumable 플래그 set. 퀴즈 등의 resume 모달을 스킵하는 데 쓰임.
    try { sessionStorage.setItem(COLD_START_CONSUMABLE_KEY, '1'); } catch { /* noop */ }

    if (snap.pathname === pathname) {
      // 이미 같은 경로 (iOS가 URL preserve한 경우 포함) — 스크롤만 복원
      requestAnimationFrame(() => {
        if (typeof window !== 'undefined') {
          window.scrollTo(0, snap.scrollY);
        }
      });
      clearSnapshot();
      return;
    }

    // 다른 경로 — 탭 루트에서만 redirect (직접 URL 진입은 존중)
    if (!TAB_ROOTS.has(pathname)) {
      clearSnapshot();
      return;
    }

    // 복원은 1회성 → 즉시 클리어
    clearSnapshot();

    // 해당 경로 페이지가 "cold-reload 복원이다"를 감지할 수 있도록 경로 플래그도 저장
    try { sessionStorage.setItem(COLD_RESTORED_PATH_KEY, snap.pathname); } catch { /* noop */ }

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
