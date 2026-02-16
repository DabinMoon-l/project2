'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';

const THRESHOLD = 120;
const WHEEL_THRESHOLD = 80;

/**
 * 스와이프/휠 다운으로 홈 이동 래퍼
 *
 * 현재 페이지가 아래로 밀리면서 뒤에 홈 배경이 보이고,
 * 밀려나면 홈으로 전환. 페이지가 이어진 느낌.
 */
export default function PullToHome({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pullY, setPullY] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const startY = useRef(0);
  const pulling = useRef(false);
  const wheelAccum = useRef(0);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 홈 미리 로드
  useEffect(() => {
    router.prefetch('/');
  }, [router]);

  const navigateHome = useCallback(() => {
    setTransitioning(true);
    sessionStorage.setItem('home_return_path', pathname);
    setPullY(window.innerHeight);
    setTimeout(() => {
      router.push('/');
    }, 300);
  }, [router, pathname]);

  // 모달/바텀시트 열림 여부
  const isModalOpen = () => document.body.hasAttribute('data-hide-nav');

  // 모바일 터치
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (transitioning || isModalOpen()) return;
    const scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
    if (scrollTop <= 0) {
      startY.current = e.touches[0].clientY;
      pulling.current = true;
    }
  }, [transitioning]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!pulling.current || transitioning) return;
    const delta = e.touches[0].clientY - startY.current;
    if (delta > 0) {
      setPullY(delta * 0.4);
    } else {
      pulling.current = false;
      setPullY(0);
    }
  }, [transitioning]);

  const onTouchEnd = useCallback(() => {
    if (!pulling.current || transitioning) return;
    pulling.current = false;
    if (pullY > THRESHOLD) {
      navigateHome();
    } else {
      setPullY(0);
    }
  }, [pullY, transitioning, navigateHome]);

  // PC 마우스 휠
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (transitioning || isModalOpen()) return;
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
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{
          position: 'relative',
          zIndex: 1,
          transform: pullY > 0 ? `translateY(${pullY}px)` : undefined,
          transition: pulling.current ? 'none' : 'transform 0.3s cubic-bezier(0.2, 0, 0, 1)',
          willChange: pullY > 0 ? 'transform' : undefined,
        }}
      >
        {/* 스와이프 인디케이터 */}
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
