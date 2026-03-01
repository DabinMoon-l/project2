/**
 * 네비게이션 숨김 훅 (Set 기반 — 레이스컨디션 면역)
 *
 * 기존 카운터 방식은 React 배칭/HMR/에러바운더리에서
 * push/pop 불일치로 네비게이션이 영구 숨김되는 버그가 있었음.
 *
 * Set 기반은 같은 ID를 두 번 추가/삭제해도 무시되므로
 * 카운터 드리프트가 원천 불가능.
 */

'use client';

import { useEffect, useRef } from 'react';

// ─── data-hide-nav (네비게이션 + 제스처 숨김) ───

const activeHiders = new Set<string>();
let nextId = 0;

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
      updateHideNavAttribute();
      return () => {
        activeHiders.delete(id);
        updateHideNavAttribute();
      };
    } else {
      // shouldHide가 false로 바뀔 때 안전하게 제거
      // (cleanup이 실행되지 않은 경우를 대비)
      if (activeHiders.has(id)) {
        activeHiders.delete(id);
        updateHideNavAttribute();
      }
    }
  }, [shouldHide]);

  // 컴포넌트 언마운트 시 최종 안전망
  // (shouldHide=true인 채로 언마운트되면 위 effect cleanup이 처리하지만,
  //  에러바운더리/Suspense 등에서 cleanup이 누락될 수 있으므로 이중 보호)
  useEffect(() => {
    const id = idRef.current;
    return () => {
      if (activeHiders.has(id)) {
        activeHiders.delete(id);
        updateHideNavAttribute();
      }
    };
  }, []);
}

// ─── data-hide-nav-only (네비게이션만 숨김, 다른 제스처는 유지) ───

const activeNavOnlyHiders = new Set<string>();
let nextNavOnlyId = 0;

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
      updateNavOnlyAttribute();
      return () => {
        activeNavOnlyHiders.delete(id);
        updateNavOnlyAttribute();
      };
    } else {
      if (activeNavOnlyHiders.has(id)) {
        activeNavOnlyHiders.delete(id);
        updateNavOnlyAttribute();
      }
    }
  }, [shouldHide]);

  useEffect(() => {
    const id = idRef.current;
    return () => {
      if (activeNavOnlyHiders.has(id)) {
        activeNavOnlyHiders.delete(id);
        updateNavOnlyAttribute();
      }
    };
  }, []);
}
