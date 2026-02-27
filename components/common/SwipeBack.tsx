'use client';

import { useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';

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
 * Framer Motion spring 기반, 뒤에 반투명 검은 오버레이
 */
export default function SwipeBack({ children, enabled = true }: SwipeBackProps) {
  const router = useRouter();
  const motionX = useMotionValue(0);
  const springX = useSpring(motionX, SPRING_CONFIG);
  const overlayOpacity = useTransform(springX, [0, typeof window !== 'undefined' ? window.innerWidth * 0.5 : 200], [0, 0.4]);

  const startX = useRef(0);
  const startY = useRef(0);
  const active = useRef(false);
  const locked = useRef(false); // 방향 잠금: 세로이면 비활성화
  const navigating = useRef(false);

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

  const onTouchEnd = useCallback((e: TouchEvent) => {
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
    // passive: false로 등록하여 preventDefault 가능 (필요 시)
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
      <motion.div
        className="fixed inset-0 pointer-events-none"
        style={{
          zIndex: 9998,
          backgroundColor: '#000',
          opacity: overlayOpacity,
        }}
      />
      {/* 컨텐츠 — SwipeBack 시 전체가 슬라이드 */}
      <motion.div style={{ x: springX }}>
        {children}
      </motion.div>
    </>
  );
}
