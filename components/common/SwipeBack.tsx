'use client';

import { useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useMotionValue, useSpring } from 'framer-motion';

const EDGE_WIDTH = 25; // 왼쪽 가장자리 감지 너비
const THRESHOLD_RATIO = 0.35; // 화면 폭의 35% 초과 시 트리거
const VELOCITY_THRESHOLD = 500; // 빠른 스와이프 트리거

const SPRING_CONFIG = { stiffness: 400, damping: 35 };

interface SwipeBackProps {
  children: React.ReactNode;
  enabled?: boolean;
}

/**
 * 왼쪽 가장자리에서 오른쪽 스와이프 → router.back()
 *
 * 일반 div 래퍼 + ref로 직접 transform 적용.
 * motion.div를 사용하면 transform이 항상 적용되어
 * 자식의 position: fixed 가 뷰포트 대신 래퍼 기준으로 동작하는 버그 발생.
 * spring 값이 0일 때는 transform을 제거하여 fixed 정상 동작 보장.
 */
export default function SwipeBack({ children, enabled = true }: SwipeBackProps) {
  const router = useRouter();
  const motionX = useMotionValue(0);
  const springX = useSpring(motionX, SPRING_CONFIG);

  const contentRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const startX = useRef(0);
  const startY = useRef(0);
  const active = useRef(false);
  const locked = useRef(false); // 방향 잠금: 세로이면 비활성화
  const navigating = useRef(false);

  // spring 값 변경 시 DOM 직접 업데이트 (re-render 없음)
  useEffect(() => {
    const unsubContent = springX.on('change', (x) => {
      if (!contentRef.current) return;
      if (Math.abs(x) < 0.5) {
        // 0에 수렴하면 transform 제거 → position: fixed 정상 동작
        contentRef.current.style.transform = '';
      } else {
        contentRef.current.style.transform = `translateX(${x}px)`;
      }
    });

    const halfScreen = typeof window !== 'undefined' ? window.innerWidth * 0.5 : 200;
    const unsubOverlay = springX.on('change', (x) => {
      if (!overlayRef.current) return;
      const opacity = Math.max(0, Math.min(x / halfScreen * 0.4, 0.4));
      overlayRef.current.style.opacity = String(opacity);
    });

    return () => {
      unsubContent();
      unsubOverlay();
    };
  }, [springX]);

  const onTouchStart = useCallback((e: TouchEvent) => {
    if (!enabled || navigating.current) return;
    // 모달 열림 시 차단
    if (document.body.hasAttribute('data-hide-nav') || document.body.style.overflow === 'hidden') return;
    const x = e.touches[0].clientX;
    if (x > EDGE_WIDTH) return; // 가장자리 밖이면 무시
    startX.current = x;
    startY.current = e.touches[0].clientY;
    active.current = true;
    locked.current = false;
  }, [enabled]);

  const onTouchMove = useCallback((e: TouchEvent) => {
    if (!active.current || navigating.current) return;
    const dx = e.touches[0].clientX - startX.current;
    const dy = e.touches[0].clientY - startY.current;

    // 방향 잠금 (첫 15px 이동에서 판별)
    if (!locked.current && (Math.abs(dx) > 15 || Math.abs(dy) > 15)) {
      if (Math.abs(dy) > Math.abs(dx)) {
        // 세로 스크롤 — SwipeBack 비활성화
        active.current = false;
        motionX.set(0);
        return;
      }
      locked.current = true;
    }

    if (dx > 0) {
      motionX.jump(dx);
    }
  }, [motionX]);

  const onTouchEnd = useCallback(() => {
    if (!active.current || navigating.current) return;
    active.current = false;

    const currentX = motionX.get();
    const screenWidth = window.innerWidth;

    // 트리거 조건: 35% 이상 또는 빠른 스와이프
    const velocity = motionX.getVelocity();
    if (currentX > screenWidth * THRESHOLD_RATIO || velocity > VELOCITY_THRESHOLD) {
      navigating.current = true;
      // 화면 밖으로 슬라이드 후 뒤로가기
      motionX.set(screenWidth);
      setTimeout(() => {
        router.back();
        // 복귀 후 리셋
        setTimeout(() => {
          motionX.jump(0);
          navigating.current = false;
        }, 100);
      }, 200);
    } else {
      // spring으로 원위치 복귀
      motionX.set(0);
    }
  }, [motionX, router]);

  useEffect(() => {
    if (!enabled) return;
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, [enabled, onTouchStart, onTouchMove, onTouchEnd]);

  return (
    <>
      {/* 검은 오버레이 */}
      <div
        ref={overlayRef}
        className="fixed inset-0 pointer-events-none"
        style={{
          zIndex: 9998,
          backgroundColor: '#000',
          opacity: 0,
        }}
      />
      {/* 컨텐츠 — 일반 div, 스와이프 시에만 transform 적용 */}
      <div ref={contentRef}>
        {children}
      </div>
    </>
  );
}
