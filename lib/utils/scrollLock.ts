/**
 * 스크롤 잠금 유틸 — 카운터 기반 중첩 관리
 *
 * 여러 모달/바텀시트가 동시에 열려도 마지막이 닫힐 때까지 스크롤 잠금 유지.
 * 모든 컴포넌트가 document.body.style.overflow를 직접 조작하는 대신
 * lockScroll()/unlockScroll()을 사용해야 함.
 */

let lockCount = 0;

export function lockScroll() {
  lockCount++;
  if (lockCount === 1) {
    document.body.style.overflow = 'hidden';
  }
}

export function unlockScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.body.style.overflow = '';
  }
}

/** 디버깅용: 현재 잠금 카운트 */
export function getScrollLockCount() {
  return lockCount;
}
