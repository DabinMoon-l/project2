'use client';

import { useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useMotionValue, useSpring } from 'framer-motion';
import { getScrollLockCount } from '@/lib/utils/scrollLock';

const EDGE_WIDTH = 30; // 왼쪽 가장자리 감지 너비 (25→30, 터치 정확성 개선)
const THRESHOLD_RATIO = 0.35; // 화면 폭의 35% 초과 시 트리거
const VELOCITY_THRESHOLD = 500; // 빠른 스와이프 트리거
const DIRECTION_LOCK_DISTANCE = 12; // 방향 잠금 판별 거리 (px)
const DIAGONAL_ANGLE_THRESHOLD = 55; // 대각선 판별 각도 (도) — 55도 이상이면 세로

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

  // 모달/오버레이 열림 여부 체크
  const isBlocked = useCallback(() => {
    if (document.body.hasAttribute('data-hide-nav')) return true;
    if (document.body.hasAttribute('data-home-overlay-open')) return true;
    // 스크롤 잠금 카운터 체크 (모달/바텀시트 열림)
    if (getScrollLockCount() > 0) return true;
    return false;
  }, []);

  const onTouchStart = useCallback((e: TouchEvent) => {
    if (!enabled || navigating.current) return;
    if (isBlocked()) return;
    const x = e.touches[0].clientX;
    if (x > EDGE_WIDTH) return; // 가장자리 밖이면 무시
    startX.current = x;
    startY.current = e.touches[0].clientY;
    active.current = true;
    locked.current = false;
  }, [enabled, isBlocked]);

  const onTouchMove = useCallback((e: TouchEvent) => {
    if (!active.current || navigating.current) return;
    const dx = e.touches[0].clientX - startX.current;
    const dy = e.touches[0].clientY - startY.current;

    // 방향 잠금 (각도 기반 판별)
    if (!locked.current) {
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > DIRECTION_LOCK_DISTANCE) {
        // 각도 계산: 0° = 수평, 90° = 수직
        const angle = Math.atan2(Math.abs(dy), Math.abs(dx)) * (180 / Math.PI);
        if (angle > DIAGONAL_ANGLE_THRESHOLD) {
          // 세로 스크롤 — SwipeBack 비활성화
          active.current = false;
          motionX.set(0);
          return;
        }
        locked.current = true;
      } else {
        return; // 아직 판별 거리에 도달하지 않음
      }
    }

    // 수평 잠금 확정 — 브라우저 기본 동작 방지 (Safari 뒤로가기, 스크롤)
    if (locked.current && dx > 0) {
      e.preventDefault();
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
        // 콘텐츠를 숨긴 후 위치 리셋 → 깜빡임 방지
        if (contentRef.current) {
          contentRef.current.style.visibility = 'hidden';
        }
        motionX.jump(0);
        router.back();
        // 새 페이지 렌더링 후 다시 표시
        setTimeout(() => {
          if (contentRef.current) {
            contentRef.current.style.visibility = '';
          }
          navigating.current = false;
        }, 80);
      }, 180);
    } else {
      // spring으로 원위치 복귀
      motionX.set(0);
    }
  }, [motionX, router]);

  useEffect(() => {
    if (!enabled) return;
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    // touchmove: passive:false → 수평 스와이프 시 preventDefault 가능 (Safari 뒤로가기 방지)
    document.addEventListener('touchmove', onTouchMove, { passive: false });
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
