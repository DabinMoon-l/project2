/**
 * 네비게이션 숨김 레퍼런스 카운팅 훅
 *
 * 여러 컴포넌트가 동시에 네비게이션을 숨기려 할 때
 * 모든 컴포넌트가 해제해야만 실제로 attribute가 제거됨
 */

'use client';

import { useEffect } from 'react';

let hideNavCount = 0;

function updateAttribute() {
  if (hideNavCount > 0) {
    document.body.setAttribute('data-hide-nav', '');
  } else {
    document.body.removeAttribute('data-hide-nav');
  }
}

function pushHideNav() {
  hideNavCount++;
  updateAttribute();
}

function popHideNav() {
  hideNavCount = Math.max(0, hideNavCount - 1);
  updateAttribute();
}

/**
 * 네비게이션 숨김 훅 (레퍼런스 카운팅)
 *
 * @param shouldHide - true면 네비게이션 숨김, false면 해제
 *
 * @example
 * useHideNav(isModalOpen);
 * useHideNav(true); // 항상 숨김 (페이지 레벨)
 */
export function useHideNav(shouldHide: boolean) {
  useEffect(() => {
    if (shouldHide) {
      pushHideNav();
      return () => popHideNav();
    }
  }, [shouldHide]);
}

// ─── data-hide-nav-only (네비게이션만 숨김, 다른 제스처는 유지) ───

let hideNavOnlyCount = 0;

function updateNavOnlyAttribute() {
  if (hideNavOnlyCount > 0) {
    document.body.setAttribute('data-hide-nav-only', '');
  } else {
    document.body.removeAttribute('data-hide-nav-only');
  }
}

/**
 * 네비게이션만 숨김 훅 (레퍼런스 카운팅)
 * data-hide-nav-only 속성 사용 — 네비게이션 UI만 숨기고 다른 제스처는 유지
 */
export function useHideNavOnly(shouldHide: boolean) {
  useEffect(() => {
    if (shouldHide) {
      hideNavOnlyCount++;
      updateNavOnlyAttribute();
      return () => {
        hideNavOnlyCount = Math.max(0, hideNavOnlyCount - 1);
        updateNavOnlyAttribute();
      };
    }
  }, [shouldHide]);
}
