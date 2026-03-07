/**
 * 네비게이션 숨김 훅 (Set 기반 — 레이스컨디션 면역)
 *
 * 기존 카운터 방식은 React 배칭/HMR/에러바운더리에서
 * push/pop 불일치로 네비게이션이 영구 숨김되는 버그가 있었음.
 *
 * Set 기반은 같은 ID를 두 번 추가/삭제해도 무시되므로
 * 카운터 드리프트가 원천 불가능.
 *
 * 추가 안전망: 살아있는 컴포넌트가 자신의 ID를 주기적으로 갱신(heartbeat)하고,
 * 30초 이상 갱신되지 않은 고아 ID는 자동 정리.
 */

'use client';

import { useEffect, useRef } from 'react';

// ─── data-hide-nav (네비게이션 + 제스처 숨김) ───

const activeHiders = new Set<string>();
const hiderHeartbeats = new Map<string, number>();
let nextId = 0;

/** 30초 이상 heartbeat 없는 고아 ID 정리 */
function pruneStaleHiders() {
  const now = Date.now();
  let changed = false;
  for (const [id, lastBeat] of hiderHeartbeats) {
    if (now - lastBeat > 30000) {
      activeHiders.delete(id);
      hiderHeartbeats.delete(id);
      changed = true;
    }
  }
  if (changed) updateHideNavAttribute();
}

function updateHideNavAttribute() {
  if (activeHiders.size > 0) {
    document.body.setAttribute('data-hide-nav', '');
  } else {
    document.body.removeAttribute('data-hide-nav');
  }
}

/**
 * 네비게이션 숨김 훅 (Set 기반 — 레이스컨디션 면역)
 *
 * @param shouldHide - true면 네비게이션 숨김, false면 해제
 *
 * @example
 * useHideNav(isModalOpen);
 * useHideNav(true); // 항상 숨김 (페이지 레벨)
 */
export function useHideNav(shouldHide: boolean) {
  // 컴포넌트 인스턴스별 고유 ID (마운트 시 한 번만 생성)
  const idRef = useRef('');
  if (!idRef.current) {
    idRef.current = `hn-${nextId++}`;
  }

  useEffect(() => {
    const id = idRef.current;
    if (shouldHide) {
      activeHiders.add(id);
      hiderHeartbeats.set(id, Date.now());
      updateHideNavAttribute();

      // 10초마다 heartbeat 갱신 + 고아 정리
      const interval = setInterval(() => {
        hiderHeartbeats.set(id, Date.now());
        pruneStaleHiders();
      }, 10000);

      return () => {
        clearInterval(interval);
        activeHiders.delete(id);
        hiderHeartbeats.delete(id);
        updateHideNavAttribute();
      };
    } else {
      // shouldHide가 false로 바뀔 때 안전하게 제거
      if (activeHiders.has(id)) {
        activeHiders.delete(id);
        hiderHeartbeats.delete(id);
        updateHideNavAttribute();
      }
    }
  }, [shouldHide]);

  // 컴포넌트 언마운트 시 최종 안전망
  useEffect(() => {
    const id = idRef.current;
    return () => {
      if (activeHiders.has(id)) {
        activeHiders.delete(id);
        hiderHeartbeats.delete(id);
        updateHideNavAttribute();
      }
    };
  }, []);
}

// ─── data-hide-nav-only (네비게이션만 숨김, 다른 제스처는 유지) ───

const activeNavOnlyHiders = new Set<string>();
const navOnlyHeartbeats = new Map<string, number>();
let nextNavOnlyId = 0;

function pruneStaleNavOnlyHiders() {
  const now = Date.now();
  let changed = false;
  for (const [id, lastBeat] of navOnlyHeartbeats) {
    if (now - lastBeat > 30000) {
      activeNavOnlyHiders.delete(id);
      navOnlyHeartbeats.delete(id);
      changed = true;
    }
  }
  if (changed) updateNavOnlyAttribute();
}

function updateNavOnlyAttribute() {
  if (activeNavOnlyHiders.size > 0) {
    document.body.setAttribute('data-hide-nav-only', '');
  } else {
    document.body.removeAttribute('data-hide-nav-only');
  }
}

/**
 * 네비게이션만 숨김 훅 (Set 기반)
 * data-hide-nav-only 속성 사용 — 네비게이션 UI만 숨기고 다른 제스처는 유지
 */
export function useHideNavOnly(shouldHide: boolean) {
  const idRef = useRef('');
  if (!idRef.current) {
    idRef.current = `hno-${nextNavOnlyId++}`;
  }

  useEffect(() => {
    const id = idRef.current;
    if (shouldHide) {
      activeNavOnlyHiders.add(id);
      navOnlyHeartbeats.set(id, Date.now());
      updateNavOnlyAttribute();

      const interval = setInterval(() => {
        navOnlyHeartbeats.set(id, Date.now());
        pruneStaleNavOnlyHiders();
      }, 10000);

      return () => {
        clearInterval(interval);
        activeNavOnlyHiders.delete(id);
        navOnlyHeartbeats.delete(id);
        updateNavOnlyAttribute();
      };
    } else {
      if (activeNavOnlyHiders.has(id)) {
        activeNavOnlyHiders.delete(id);
        navOnlyHeartbeats.delete(id);
        updateNavOnlyAttribute();
      }
    }
  }, [shouldHide]);

  useEffect(() => {
    const id = idRef.current;
    return () => {
      if (activeNavOnlyHiders.has(id)) {
        activeNavOnlyHiders.delete(id);
        navOnlyHeartbeats.delete(id);
        updateNavOnlyAttribute();
      }
    };
  }, []);
}

// ─── Navigation health check용 외부 호출 ───

/** 양쪽 Set의 고아 ID를 모두 정리 (Navigation에서 5초마다 호출) */
export function pruneAllStaleHiders() {
  pruneStaleHiders();
  pruneStaleNavOnlyHiders();
}
