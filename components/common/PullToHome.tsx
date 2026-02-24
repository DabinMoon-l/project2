'use client';

import { useRef, useState, useCallback, useEffect, useLayoutEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';

const THRESHOLD = 120;
const WHEEL_THRESHOLD = 80;
const DIRECTION_LOCK_THRESHOLD = 10; // 방향 판별 최소 이동 거리
const SWIPE_X_THRESHOLD = 80; // 가로 스와이프 전환 임계값
const DEFAULT_TAB_PATHS = ['/quiz', '/review', '/board'];

type Direction = 'none' | 'horizontal' | 'vertical';

interface PullToHomeProps {
  children: React.ReactNode;
  homePath?: string;    // 홈 경로 (기본: '/')
  tabPaths?: string[];  // 탭 경로 목록 (기본: 학생용)
}

/**
 * 스와이프/휠 다운으로 홈 이동 + 가로 스와이프로 탭 전환 래퍼
 *
 * 세로: 페이지가 아래로 밀리면서 뒤에 홈 배경이 보이고, 밀려나면 홈으로 전환
 * 가로: 좌우 스와이프로 퀴즈 ↔ 복습 ↔ 게시판 탭 전환
 */
export default function PullToHome({ children, homePath = '/', tabPaths = DEFAULT_TAB_PATHS }: PullToHomeProps) {
  const router = useRouter();
  const pathname = usePathname();
  const containerRef = useRef<HTMLDivElement>(null);

  // 세로 스와이프 상태
  const [pullY, setPullY] = useState(0);
  const [transitioning, setTransitioning] = useState(false);

  // 가로 스와이프 상태
  const [pullX, setPullX] = useState(0);
  const [transitioningX, setTransitioningX] = useState(false);

  // 터치 추적
  const startY = useRef(0);
  const startX = useRef(0);
  const pulling = useRef(false); // 세로 활성
  const swipingX = useRef(false); // 가로 활성
  const direction = useRef<Direction>('none'); // 방향 잠금
  const wheelAccum = useRef(0);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tabIndex = tabPaths.indexOf(pathname);

  // 홈 + 인접 탭 프리페치
  useEffect(() => {
    router.prefetch(homePath);
    if (tabIndex > 0) router.prefetch(tabPaths[tabIndex - 1]);
    if (tabIndex < tabPaths.length - 1) router.prefetch(tabPaths[tabIndex + 1]);
  }, [router, tabIndex, homePath, tabPaths]);

  // 입장 슬라이드 인 애니메이션
  useLayoutEffect(() => {
    const enterDir = sessionStorage.getItem('tab_swipe_enter');
    if (!enterDir || !containerRef.current) return;
    sessionStorage.removeItem('tab_swipe_enter');

    const el = containerRef.current;
    // 진입 방향: 'left' = 왼쪽에서 들어옴 (이전 탭), 'right' = 오른쪽에서 들어옴 (다음 탭)
    const startOffset = enterDir === 'left' ? '-100vw' : '100vw';
    el.style.transition = 'none';
    el.style.transform = `translateX(${startOffset})`;

    // 강제 리플로우 후 애니메이션 시작
    el.getBoundingClientRect();
    el.style.transition = 'transform 300ms cubic-bezier(0.25, 0.1, 0.25, 1)';
    el.style.transform = 'translateX(0)';

    const cleanup = () => {
      el.style.transition = '';
      el.style.transform = '';
    };
    el.addEventListener('transitionend', cleanup, { once: true });
    // 안전장치: 400ms 후 강제 클린업
    const timer = setTimeout(cleanup, 400);
    return () => clearTimeout(timer);
  }, [pathname]);

  const navigateHome = useCallback(() => {
    setTransitioning(true);
    sessionStorage.setItem('home_return_path', pathname);
    setPullY(window.innerHeight);
    setTimeout(() => {
      router.push(homePath);
    }, 300);
  }, [router, pathname, homePath]);

  const navigateTab = useCallback((targetIndex: number, swipeDirection: 'left' | 'right') => {
    setTransitioningX(true);
    // 나가는 방향: 왼쪽 스와이프 → 페이지가 왼쪽으로 나감, 오른쪽 스와이프 → 오른쪽으로 나감
    const exitX = swipeDirection === 'left' ? -window.innerWidth : window.innerWidth;
    setPullX(exitX);
    // 새 페이지의 입장 방향 저장
    sessionStorage.setItem('tab_swipe_enter', swipeDirection === 'left' ? 'right' : 'left');
    setTimeout(() => {
      router.push(tabPaths[targetIndex]);
    }, 250);
  }, [router]);

  const touchTarget = useRef<EventTarget | null>(null);

  // 터치 대상이 모달/오버레이 내부이거나 캐러셀 영역인지 확인
  // data-hide-nav, body scroll lock, fixed 포지션 조상 (모달 백드롭),
  // 또는 data-no-pull (캐러셀 등 자체 스와이프가 있는 영역) 감지
  const shouldBlockGesture = useCallback((target: EventTarget | null): boolean => {
    if (document.body.hasAttribute('data-hide-nav')) return true;
    if (document.body.style.overflow === 'hidden') return true;
    let el = target as HTMLElement | null;
    while (el && el !== containerRef.current) {
      if (el.hasAttribute('data-no-pull')) return true;
      if (window.getComputedStyle(el).position === 'fixed') return true;
      el = el.parentElement;
    }
    return false;
  }, []);

  // 터치 대상 기준 스크롤 위치 (내부 스크롤 컨테이너 포함)
  const getScrollTop = useCallback((target: EventTarget | null): number => {
    let el = target as HTMLElement | null;
    while (el && el !== containerRef.current) {
      if (el.scrollTop > 0 && el.scrollHeight > el.clientHeight + 1) {
        return el.scrollTop;
      }
      el = el.parentElement;
    }
    return document.documentElement.scrollTop || document.body.scrollTop;
  }, []);

  // 모바일 터치
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (transitioning || transitioningX || shouldBlockGesture(e.target)) return;
    touchTarget.current = e.target;
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    direction.current = 'none';
    pulling.current = false;
    swipingX.current = false;
  }, [transitioning, transitioningX, shouldBlockGesture]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (transitioning || transitioningX) return;
    // 모달 등이 열려있으면 제스처 차단 (터치 시작 이후 열린 모달도 감지)
    if (shouldBlockGesture(touchTarget.current)) {
      pulling.current = false;
      swipingX.current = false;
      direction.current = 'none';
      setPullY(0);
      setPullX(0);
      return;
    }

    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const deltaX = currentX - startX.current;
    const deltaY = currentY - startY.current;

    // 방향 잠금 판별
    if (direction.current === 'none') {
      const absDx = Math.abs(deltaX);
      const absDy = Math.abs(deltaY);
      if (absDx < DIRECTION_LOCK_THRESHOLD && absDy < DIRECTION_LOCK_THRESHOLD) return;

      if (absDx > absDy) {
        // 가로 모드
        direction.current = 'horizontal';
        swipingX.current = true;
      } else {
        // 세로 모드 — 기존 pull-to-home 로직
        direction.current = 'vertical';
        const scrollTop = getScrollTop(touchTarget.current);
        if (scrollTop <= 0 && deltaY > 0) {
          pulling.current = true;
        }
      }
    }

    // 가로 스와이프 처리
    if (direction.current === 'horizontal' && swipingX.current) {
      const isAtStart = tabIndex === 0;
      const isAtEnd = tabIndex === tabPaths.length - 1;
      const goingRight = deltaX > 0; // 이전 탭으로
      const goingLeft = deltaX < 0;  // 다음 탭으로

      // 끝 탭 저항감
      if ((isAtStart && goingRight) || (isAtEnd && goingLeft)) {
        setPullX(deltaX * 0.15); // 탄성 감쇠
      } else {
        setPullX(deltaX * 0.5); // 일반 추종
      }
      return;
    }

    // 세로 스와이프 처리 (기존 로직)
    if (direction.current === 'vertical' && pulling.current) {
      if (deltaY > 0) {
        setPullY(deltaY * 0.4);
      } else {
        pulling.current = false;
        setPullY(0);
      }
    }
  }, [transitioning, transitioningX, tabIndex, shouldBlockGesture, getScrollTop]);

  const onTouchEnd = useCallback(() => {
    // 가로 스와이프 종료
    if (direction.current === 'horizontal' && swipingX.current) {
      swipingX.current = false;
      direction.current = 'none';

      const absPullX = Math.abs(pullX);
      if (absPullX > SWIPE_X_THRESHOLD) {
        if (pullX < 0 && tabIndex < tabPaths.length - 1) {
          // 왼쪽으로 밀기 → 다음 탭
          navigateTab(tabIndex + 1, 'left');
          return;
        }
        if (pullX > 0 && tabIndex > 0) {
          // 오른쪽으로 밀기 → 이전 탭
          navigateTab(tabIndex - 1, 'right');
          return;
        }
      }
      // 임계값 미달 또는 끝 탭 → 원위치 복귀
      setPullX(0);
      return;
    }

    // 세로 스와이프 종료 (기존 로직)
    if (direction.current === 'vertical' && pulling.current) {
      pulling.current = false;
      direction.current = 'none';
      if (pullY > THRESHOLD) {
        navigateHome();
      } else {
        setPullY(0);
      }
      return;
    }

    // 방향 잠금 안된 경우 초기화
    direction.current = 'none';
    pulling.current = false;
    swipingX.current = false;
  }, [pullX, pullY, transitioning, transitioningX, tabIndex, navigateHome, navigateTab]);

  // PC 마우스 휠
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (transitioning || document.body.hasAttribute('data-hide-nav') || document.body.style.overflow === 'hidden') return;
      // 캐러셀 등 data-no-pull 영역에서는 휠 제스처 차단
      let el = e.target as HTMLElement | null;
      while (el && el !== containerRef.current) {
        if (el.hasAttribute('data-no-pull')) return;
        el = el.parentElement;
      }
      const scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
      if (scrollTop > 0) return;
      if (e.deltaY < 0) {
        wheelAccum.current += Math.abs(e.deltaY);
        // 데드존: 누적 40 이상부터 시각 피드백
        const visual = Math.max(0, wheelAccum.current - 40) * 0.6;
        if (visual > 0) {
          setPullY(Math.min(visual, THRESHOLD * 1.2));
        }
        if (wheelAccum.current > WHEEL_THRESHOLD) {
          wheelAccum.current = 0;
          navigateHome();
          return;
        }
        if (wheelTimer.current) clearTimeout(wheelTimer.current);
        wheelTimer.current = setTimeout(() => {
          wheelAccum.current = 0;
          setPullY(0);
        }, 300);
      }
    };
    window.addEventListener('wheel', handleWheel, { passive: true });
    return () => window.removeEventListener('wheel', handleWheel);
  }, [transitioning, navigateHome]);

  // 현재 변환 계산
  const isSwipingHorizontal = direction.current === 'horizontal' && swipingX.current;
  const isSwipingVertical = pullY > 0;
  const isExitingX = transitioningX;

  let transform: string | undefined;
  let transition: string;

  if (isExitingX) {
    // 가로 탭 전환 나가기 애니메이션
    transform = `translateX(${pullX}px)`;
    transition = 'transform 250ms cubic-bezier(0.25, 0.1, 0.25, 1)';
  } else if (isSwipingHorizontal) {
    // 가로 스와이프 추종 (애니메이션 없이)
    transform = `translateX(${pullX}px)`;
    transition = 'none';
  } else if (isSwipingVertical) {
    // 세로 스와이프
    transform = `translateY(${pullY}px)`;
    transition = pulling.current ? 'none' : 'transform 0.3s cubic-bezier(0.2, 0, 0, 1)';
  } else {
    // 기본 상태
    transform = undefined;
    transition = 'transform 0.3s cubic-bezier(0.2, 0, 0, 1)';
  }

  return (
    <>
      {/* 홈 배경 미리보기 — 현재 페이지 뒤에 깔림 */}
      {(pullY > 0 || transitioning) && (
        <div
          className="fixed inset-0 pointer-events-none"
          style={{
            zIndex: 0,
            backgroundImage: 'url(/images/home-bg.jpg)',
            backgroundSize: 'cover',
            backgroundPosition: 'center 5%',
            backgroundColor: '#2a2018',
          }}
        />
      )}

      {/* 현재 페이지 (슬라이드) */}
      <div
        ref={containerRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{
          position: 'relative',
          zIndex: 1,
          touchAction: 'pan-y',
          transform,
          transition,
          willChange: (pullY > 0 || pullX !== 0 || transitioningX) ? 'transform' : undefined,
        }}
      >
        {/* 세로 스와이프 인디케이터 */}
        {pullY > 10 && !transitioning && (
          <div
            className="fixed top-0 left-0 right-0 z-50 flex justify-center pt-3 pointer-events-none"
            style={{ opacity: Math.min(pullY / THRESHOLD, 1) }}
          >
            <div className="flex flex-col items-center gap-1">
              <svg
                className="w-5 h-5 text-[#1A1A1A]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                style={{
                  transform: pullY > THRESHOLD ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.2s',
                }}
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
              <span className="text-xs font-bold text-[#1A1A1A]">
                {pullY > THRESHOLD ? '놓으면 홈으로' : '홈으로 이동'}
              </span>
            </div>
          </div>
        )}
        {children}
      </div>
    </>
  );
}
