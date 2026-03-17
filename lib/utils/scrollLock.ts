/**
 * 스크롤 잠금 유틸 — 카운터 기반 중첩 관리
 *
 * iOS Safari/PWA에서 overflow: hidden만으로는 배경 스크롤을 막을 수 없어
 * body를 position: fixed로 고정하고 스크롤 위치를 보존하는 방식 사용.
 *
 * 여러 모달/바텀시트가 동시에 열려도 마지막이 닫힐 때까지 스크롤 잠금 유지.
 */

let lockCount = 0;
let savedScrollY = 0;

export function lockScroll() {
  lockCount++;
  if (lockCount === 1) {
    savedScrollY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${savedScrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.bottom = '0';
    document.body.style.overflow = 'hidden';
  }
}

export function unlockScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.bottom = '';
    document.body.style.overflow = '';
    window.scrollTo(0, savedScrollY);
  }
}

/** 디버깅용: 현재 잠금 카운트 */
export function getScrollLockCount() {
  return lockCount;
}
