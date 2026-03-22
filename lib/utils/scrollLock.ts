/**
 * 스크롤 잠금 유틸 — 카운터 기반 중첩 관리
 *
 * iOS 26 PWA 호환: position: fixed를 사용하지 않음.
 * position: fixed는 safe area 계산을 깨뜨리고 fixed 자식 요소 배치를 망가뜨림.
 *
 * 대신 overflow: hidden + overscroll-behavior: none으로 스크롤 차단.
 * iOS standalone PWA에서는 주소창이 없어 이 방식으로 충분.
 */

let lockCount = 0;
let savedScrollY = 0;

export function lockScroll() {
  lockCount++;
  if (lockCount === 1) {
    savedScrollY = window.scrollY;
    // overflow hidden으로 스크롤 차단 (position: fixed 사용 안 함)
    document.body.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'none';
    // iOS Safari: touch-action으로 터치 스크롤도 차단
    document.body.style.touchAction = 'none';
  }
}

export function unlockScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.body.style.overflow = '';
    document.body.style.overscrollBehavior = '';
    document.body.style.touchAction = '';
    window.scrollTo(0, savedScrollY);
  }
}

/** 디버깅용: 현재 잠금 카운트 */
export function getScrollLockCount() {
  return lockCount;
}
