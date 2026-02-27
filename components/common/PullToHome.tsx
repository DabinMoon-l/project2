'use client';

import { useRef, useState, useCallback, useEffect, useLayoutEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';

const THRESHOLD = 150;
const WHEEL_THRESHOLD = 80;
const DIRECTION_LOCK_THRESHOLD = 25; // 방향 판별 데드존 (기존 10 → 25)
const SWIPE_X_THRESHOLD = 100; // 가로 스와이프 전환 임계값 (기존 80 → 100)
const PULL_ACTIVATE_MIN = 15; // pulling 활성화 최소 deltaY
const SCROLL_TOP_TOLERANCE = 3; // 서브픽셀 scrollTop 허용
const DIRECTION_RATIO_MIN = 1.5; // 대각선 무시 비율
const SWIPE_BACK_EDGE = 25; // SwipeBack에 양보할 왼쪽 가장자리 너비
const DEFAULT_TAB_PATHS = ['/quiz', '/review', '/board'];

type Direction = 'none' | 'horizontal' | 'vertical';

interface PullToHomeProps {
  children: React.ReactNode;
  homePath?: string;
  tabPaths?: string[];
}

const SPRING_CONFIG = { stiffness: 400, damping: 35 };

/**
 * 스와이프/휠 다운으로 홈 이동 + 가로 스와이프로 탭 전환 래퍼
 *
 * Framer Motion useMotionValue + useSpring으로 드래그 중 re-render 없이 동작.
 * 인디케이터만 경계(10px, THRESHOLD) 넘을 때 useState로 리렌더.
 */
export default function PullToHome({ children, homePath = '/', tabPaths = DEFAULT_TAB_PATHS }: PullToHomeProps) {
  const router = useRouter();
  const pathname = usePathname();
  const containerRef = useRef<HTMLDivElement>(null);

  // Framer Motion 값 — re-render 없이 업데이트
  const motionY = useMotionValue(0);
  const motionX = useMotionValue(0);
  const springY = useSpring(motionY, SPRING_CONFIG);
  const springX = useSpring(motionX, SPRING_CONFIG);

  // ref 기반 추적값 (re-render 없음)
  const pullYRef = useRef(0);
  const pullXRef = useRef(0);
  const transitioningRef = useRef(false);
  const transitioningXRef = useRef(false);

  // 터치 추적
  const startY = useRef(0);
  const startX = useRef(0);
  const pulling = useRef(false);
  const swipingX = useRef(false);
  const direction = useRef<Direction>('none');
  const wheelAccum = useRef(0);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchTarget = useRef<EventTarget | null>(null);

  // 인디케이터용 — 경계를 넘을 때만 리렌더
  // 'none' | 'pulling' | 'ready' (THRESHOLD 초과)
  const [indicatorState, setIndicatorState] = useState<'none' | 'pulling' | 'ready'>('none');
  const prevIndicatorState = useRef<'none' | 'pulling' | 'ready'>('none');

  const updateIndicator = useCallback((y: number) => {
    let next: 'none' | 'pulling' | 'ready';
    if (y <= 10) next = 'none';
    else if (y > THRESHOLD) next = 'ready';
    else next = 'pulling';

    if (next !== prevIndicatorState.current) {
      prevIndicatorState.current = next;
      setIndicatorState(next);
    }
  }, []);

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

    const startOffset = enterDir === 'left' ? -window.innerWidth : window.innerWidth;
    motionX.set(startOffset);
    requestAnimationFrame(() => motionX.set(0));

    const timer = setTimeout(() => motionX.set(0), 400);
    return () => clearTimeout(timer);
  }, [pathname, motionX]);

  const navigateHome = useCallback(() => {
    transitioningRef.current = true;
    sessionStorage.setItem('home_return_path', pathname);
    motionY.set(window.innerHeight);
    setTimeout(() => router.push(homePath), 300);
  }, [router, pathname, homePath, motionY]);

  const navigateTab = useCallback((targetIndex: number, swipeDirection: 'left' | 'right') => {
    transitioningXRef.current = true;
    const exitX = swipeDirection === 'left' ? -window.innerWidth : window.innerWidth;
    motionX.set(exitX);
    sessionStorage.setItem('tab_swipe_enter', swipeDirection === 'left' ? 'right' : 'left');
    setTimeout(() => router.push(tabPaths[targetIndex]), 250);
  }, [router, tabPaths, motionX]);

  // 제스처 차단 판별
  const shouldBlockGesture = useCallback((target: EventTarget | null, dir?: 'horizontal' | 'vertical'): boolean => {
    if (document.body.hasAttribute('data-hide-nav')) return true;
    if (document.body.style.overflow === 'hidden') return true;
    let el = target as HTMLElement | null;
    while (el && el !== containerRef.current) {
      if (el.hasAttribute('data-no-pull')) return true;
      if (dir === 'horizontal' && el.hasAttribute('data-no-pull-x')) return true;
      if (window.getComputedStyle(el).position === 'fixed') return true;
      el = el.parentElement;
    }
    return false;
  }, []);

  // 스크롤 위치 (overflow scroll/auto 요소만)
  const getScrollTop = useCallback((target: EventTarget | null): number => {
    let el = target as HTMLElement | null;
    while (el && el !== containerRef.current) {
      const style = window.getComputedStyle(el);
      const isScrollable = style.overflowY === 'scroll' || style.overflowY === 'auto';
      if (isScrollable && el.scrollTop > 0 && el.scrollHeight > el.clientHeight + 1) {
        return el.scrollTop;
      }
      el = el.parentElement;
    }
    return document.documentElement.scrollTop || document.body.scrollTop;
  }, []);

  // 터치 핸들러
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (transitioningRef.current || transitioningXRef.current || shouldBlockGesture(e.target)) return;
    const clientX = e.touches[0].clientX;
    if (clientX < SWIPE_BACK_EDGE) return; // SwipeBack에 양보
    touchTarget.current = e.target;
    startX.current = clientX;
    startY.current = e.touches[0].clientY;
    direction.current = 'none';
    pulling.current = false;
    swipingX.current = false;
  }, [shouldBlockGesture]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (transitioningRef.current || transitioningXRef.current) return;
    if (shouldBlockGesture(touchTarget.current)) {
      pulling.current = false;
      swipingX.current = false;
      direction.current = 'none';
      motionY.set(0);
      motionX.set(0);
      pullYRef.current = 0;
      pullXRef.current = 0;
      updateIndicator(0);
      return;
    }

    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const deltaX = currentX - startX.current;
    const deltaY = currentY - startY.current;

    // 방향 잠금
    if (direction.current === 'none') {
      const absDx = Math.abs(deltaX);
      const absDy = Math.abs(deltaY);
      if (absDx < DIRECTION_LOCK_THRESHOLD && absDy < DIRECTION_LOCK_THRESHOLD) return;

      // 비율 기반 대각선 무시
      const maxD = Math.max(absDx, absDy);
      const minD = Math.min(absDx, absDy) + 1;
      if (maxD / minD < DIRECTION_RATIO_MIN) return;

      if (absDx > absDy) {
        if (shouldBlockGesture(touchTarget.current, 'horizontal')) return;
        direction.current = 'horizontal';
        swipingX.current = true;
      } else {
        direction.current = 'vertical';
        const scrollTop = getScrollTop(touchTarget.current);
        if (scrollTop <= SCROLL_TOP_TOLERANCE && deltaY > PULL_ACTIVATE_MIN) {
          pulling.current = true;
        }
      }
    }

    // 가로 스와이프
    if (direction.current === 'horizontal' && swipingX.current) {
      const isAtStart = tabIndex === 0;
      const isAtEnd = tabIndex === tabPaths.length - 1;
      const goingRight = deltaX > 0;
      const goingLeft = deltaX < 0;

      let x: number;
      if ((isAtStart && goingRight) || (isAtEnd && goingLeft)) {
        x = deltaX * 0.15;
      } else {
        x = deltaX * 0.5;
      }
      pullXRef.current = x;
      motionX.jump(x);
      return;
    }

    // 세로 스와이프
    if (direction.current === 'vertical' && pulling.current) {
      if (deltaY > 0) {
        const dampened = Math.pow(deltaY, 0.7) * 0.5;
        pullYRef.current = dampened;
        motionY.jump(dampened);
        updateIndicator(dampened);
      } else {
        pulling.current = false;
        pullYRef.current = 0;
        motionY.set(0);
        updateIndicator(0);
      }
    }
  }, [tabIndex, tabPaths.length, shouldBlockGesture, getScrollTop, motionX, motionY, updateIndicator]);

  const onTouchEnd = useCallback(() => {
    // 가로 스와이프 종료
    if (direction.current === 'horizontal' && swipingX.current) {
      swipingX.current = false;
      direction.current = 'none';

      const absPullX = Math.abs(pullXRef.current);
      if (absPullX > SWIPE_X_THRESHOLD) {
        if (pullXRef.current < 0 && tabIndex < tabPaths.length - 1) {
          navigateTab(tabIndex + 1, 'left');
          return;
        }
        if (pullXRef.current > 0 && tabIndex > 0) {
          navigateTab(tabIndex - 1, 'right');
          return;
        }
      }
      pullXRef.current = 0;
      motionX.set(0);
      return;
    }

    // 세로 스와이프 종료
    if (direction.current === 'vertical' && pulling.current) {
      pulling.current = false;
      direction.current = 'none';
      if (pullYRef.current > THRESHOLD) {
        navigateHome();
      } else {
        pullYRef.current = 0;
        motionY.set(0);
        updateIndicator(0);
      }
      return;
    }

    direction.current = 'none';
    pulling.current = false;
    swipingX.current = false;
  }, [tabIndex, tabPaths.length, navigateHome, navigateTab, motionX, motionY, updateIndicator]);

  // PC 마우스 휠
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (transitioningRef.current || document.body.hasAttribute('data-hide-nav') || document.body.style.overflow === 'hidden') return;
      let el = e.target as HTMLElement | null;
      while (el && el !== containerRef.current) {
        if (el.hasAttribute('data-no-pull')) return;
        el = el.parentElement;
      }
      const scrollTop = getScrollTop(e.target);
      if (scrollTop > 0) return;
      if (e.deltaY < 0) {
        wheelAccum.current += Math.abs(e.deltaY);
        const visual = Math.max(0, wheelAccum.current - 40) * 0.6;
        if (visual > 0) {
          const clamped = Math.min(visual, THRESHOLD * 1.2);
          motionY.jump(clamped);
          pullYRef.current = clamped;
          updateIndicator(clamped);
        }
        if (wheelAccum.current > WHEEL_THRESHOLD) {
          wheelAccum.current = 0;
          navigateHome();
          return;
        }
        if (wheelTimer.current) clearTimeout(wheelTimer.current);
        wheelTimer.current = setTimeout(() => {
          wheelAccum.current = 0;
          pullYRef.current = 0;
          motionY.set(0);
          updateIndicator(0);
        }, 300);
      }
    };
    window.addEventListener('wheel', handleWheel, { passive: true });
    return () => window.removeEventListener('wheel', handleWheel);
  }, [navigateHome, getScrollTop, motionY, updateIndicator]);

  return (
    <>
      {/* 홈 배경 미리보기 */}
      <PullBackground motionY={motionY} />

      {/* 현재 페이지 (Framer Motion spring) */}
      <motion.div
        ref={containerRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{
          position: 'relative',
          zIndex: 1,
          touchAction: 'pan-y',
          y: springY,
          x: springX,
          willChange: 'transform',
        }}
      >
        {/* 세로 스와이프 인디케이터 */}
        {indicatorState !== 'none' && !transitioningRef.current && (
          <div
            className="fixed top-0 left-0 right-0 z-50 flex justify-center pt-3 pointer-events-none"
            style={{ opacity: indicatorState === 'ready' ? 1 : 0.6 }}
          >
            <div className="flex flex-col items-center gap-1">
              <svg
                className="w-5 h-5 text-[#1A1A1A]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                style={{
                  transform: indicatorState === 'ready' ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.2s',
                }}
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
              <span className="text-xs font-bold text-[#1A1A1A]">
                {indicatorState === 'ready' ? '놓으면 홈으로' : '홈으로 이동'}
              </span>
            </div>
          </div>
        )}
        {children}
      </motion.div>
    </>
  );
}

/**
 * 홈 배경 미리보기 — motionY > 0일 때만 opacity 전환
 */
function PullBackground({ motionY }: { motionY: ReturnType<typeof useMotionValue<number>> }) {
  const opacity = useTransform(motionY, [0, 10], [0, 1]);

  return (
    <motion.div
      className="fixed inset-0 pointer-events-none"
      style={{
        zIndex: 0,
        backgroundImage: 'url(/images/home-bg.jpg)',
        backgroundSize: 'cover',
        backgroundPosition: 'center 5%',
        backgroundColor: '#2a2018',
        opacity,
      }}
    />
  );
}
