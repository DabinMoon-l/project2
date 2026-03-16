'use client';

import { useState, useCallback, useEffect, useRef, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { scaleCoord } from '@/lib/hooks/useViewportScale';

interface ImageViewerProps {
  urls: string[];
  initialIndex: number;
  onClose: () => void;
}

/**
 * 이미지 전체화면 뷰어 — 스와이프 + 핀치줌(모바일) + 스크롤줌(PC)
 */
const ImageViewer = memo(function ImageViewer({
  urls, initialIndex, onClose,
}: ImageViewerProps) {
  const [idx, setIdx] = useState(initialIndex);
  const [showControls, setShowControls] = useState(true);

  // 줌 상태
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const isZoomed = scale > 1.05;

  // refs
  const touchStartX = useRef(0);
  const touchDeltaX = useRef(0);
  const swiping = useRef(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 핀치 줌 refs
  const pinchStartDist = useRef(0);
  const pinchStartScale = useRef(1);
  const isPinching = useRef(false);

  // 패닝 (줌 상태에서 드래그 이동)
  const panStart = useRef({ x: 0, y: 0 });
  const panTranslateStart = useRef({ x: 0, y: 0 });
  const isPanning = useRef(false);

  const src = urls[idx];
  const hasPrev = idx > 0;
  const hasNext = idx < urls.length - 1;

  const goPrev = useCallback(() => { if (hasPrev) { setIdx(i => i - 1); resetZoom(); } }, [hasPrev]);
  const goNext = useCallback(() => { if (hasNext) { setIdx(i => i + 1); resetZoom(); } }, [hasNext]);

  function resetZoom() {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }

  // 이미지 전환 시 줌 리셋
  useEffect(() => {
    resetZoom();
  }, [idx]);

  // 키보드
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goPrev, goNext, onClose]);

  // 두 손가락 사이 거리 계산
  function getTouchDist(touches: React.TouchList | TouchList) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // 이동 범위 제한
  function clampTranslate(tx: number, ty: number, s: number) {
    if (s <= 1) return { x: 0, y: 0 };
    const img = imgRef.current;
    if (!img) return { x: tx, y: ty };
    const rect = img.getBoundingClientRect();
    const baseW = rect.width / scale; // 원래 크기
    const baseH = rect.height / scale;
    const maxX = Math.max(0, (baseW * s - baseW) / 2);
    const maxY = Math.max(0, (baseH * s - baseH) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, tx)),
      y: Math.max(-maxY, Math.min(maxY, ty)),
    };
  }

  // 터치 시작
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // 핀치 줌 시작
      isPinching.current = true;
      swiping.current = false;
      pinchStartDist.current = getTouchDist(e.touches);
      pinchStartScale.current = scale;
    } else if (e.touches.length === 1) {
      if (isZoomed) {
        // 줌 상태 → 패닝
        isPanning.current = true;
        swiping.current = false;
        panStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        panTranslateStart.current = { ...translate };
      } else {
        // 일반 → 스와이프
        touchStartX.current = scaleCoord(e.touches[0].clientX);
        touchDeltaX.current = 0;
        swiping.current = true;
      }
    }
  }, [scale, isZoomed, translate]);

  // 터치 이동 (touchAction: 'none' + 네이티브 리스너가 브라우저 기본 동작 차단)
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (isPinching.current && e.touches.length === 2) {
      const dist = getTouchDist(e.touches);
      const newScale = Math.max(1, Math.min(5, pinchStartScale.current * (dist / pinchStartDist.current)));
      setScale(newScale);
      if (newScale <= 1) {
        setTranslate({ x: 0, y: 0 });
      }
    } else if (isPanning.current && e.touches.length === 1) {
      const dx = e.touches[0].clientX - panStart.current.x;
      const dy = e.touches[0].clientY - panStart.current.y;
      const newT = clampTranslate(
        panTranslateStart.current.x + dx,
        panTranslateStart.current.y + dy,
        scale
      );
      setTranslate(newT);
    } else if (swiping.current && e.touches.length === 1) {
      touchDeltaX.current = scaleCoord(e.touches[0].clientX) - touchStartX.current;
    }
  }, [scale]);

  // 터치 끝
  const handleTouchEnd = useCallback(() => {
    if (isPinching.current) {
      isPinching.current = false;
      // 1에 가까우면 리셋
      if (scale < 1.05) resetZoom();
      return;
    }
    if (isPanning.current) {
      isPanning.current = false;
      return;
    }
    if (swiping.current) {
      swiping.current = false;
      if (touchDeltaX.current > 50) goPrev();
      else if (touchDeltaX.current < -50) goNext();
    }
  }, [scale, goPrev, goNext]);

  // PC 스크롤 줌 (네이티브 리스너로 등록 — React onWheel은 passive라 preventDefault 불가)
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY > 0 ? -0.15 : 0.15;
      setScale(prev => {
        const newScale = Math.max(1, Math.min(5, prev + delta));
        if (newScale <= 1) {
          setTranslate({ x: 0, y: 0 });
        }
        return newScale;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // 더블탭 줌 토글
  const lastTapRef = useRef(0);
  const handleImageClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      // 더블 클릭/탭 → 줌 토글
      if (isZoomed) {
        resetZoom();
      } else {
        setScale(2.5);
      }
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
      // 단일 탭 → 컨트롤 토글 (300ms 딜레이)
      setTimeout(() => {
        if (Date.now() - lastTapRef.current >= 280) {
          setShowControls(v => !v);
        }
      }, 300);
    }
  }, [isZoomed]);

  // 배경 클릭 (줌 상태면 줌 리셋, 아니면 닫기)
  const handleBackdropClick = useCallback(() => {
    if (isZoomed) {
      resetZoom();
    } else {
      onClose();
    }
  }, [isZoomed, onClose]);

  // 줌 상태에서 브라우저 기본 줌 방지
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const prevent = (e: TouchEvent) => {
      if (e.touches.length >= 2) e.preventDefault();
    };
    el.addEventListener('touchmove', prevent, { passive: false });
    return () => el.removeEventListener('touchmove', prevent);
  }, []);

  const viewer = (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[120] bg-black/90 flex items-center justify-center"
      style={{ left: 'var(--modal-left, 0px)', touchAction: 'none' }}
      onClick={handleBackdropClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* 컨트롤 (닫기, 다운로드, 화살표, 카운터) */}
      <div className={`transition-opacity duration-200 ${showControls && !isZoomed ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        {/* 닫기 — Dynamic Island 겹침 방지: safe-area-inset-top */}
        <motion.button
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ delay: 0.15 }}
          onClick={onClose}
          className="absolute right-4 text-white p-2 z-10"
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
        >
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </motion.button>
        {/* 다운로드 — Dynamic Island 겹침 방지 */}
        <motion.a
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ delay: 0.15 }}
          href={src} target="_blank" rel="noopener noreferrer" download
          onClick={(e) => e.stopPropagation()}
          className="absolute left-4 text-white p-2 z-10"
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
        >
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </motion.a>
        {/* 좌측 화살표 */}
        {hasPrev && (
          <button
            onClick={(e) => { e.stopPropagation(); goPrev(); }}
            className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full bg-black/40 text-white/80 hover:text-white z-10"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        {/* 우측 화살표 */}
        {hasNext && (
          <button
            onClick={(e) => { e.stopPropagation(); goNext(); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full bg-black/40 text-white/80 hover:text-white z-10"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}
        {/* 카운터 */}
        {urls.length > 1 && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/70 text-sm font-medium bg-black/40 px-3 py-1 rounded-full">
            {idx + 1} / {urls.length}
          </div>
        )}
      </div>

      {/* 줌 배율 표시 (줌 중일 때만) */}
      {isZoomed && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 text-white/70 text-xs bg-black/50 px-2.5 py-1 rounded-full z-10 pointer-events-none">
          {scale.toFixed(1)}x
        </div>
      )}

      {/* 이미지 */}
      <motion.img
        ref={imgRef}
        key={src}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        src={src}
        alt=""
        className="max-w-[90vw] max-h-[85vh] object-contain select-none"
        style={{
          transform: `scale(${scale}) translate(${translate.x / scale}px, ${translate.y / scale}px)`,
          transition: isPinching.current || isPanning.current ? 'none' : 'transform 0.15s ease-out',
          cursor: isZoomed ? 'grab' : 'default',
        }}
        draggable={false}
        onClick={handleImageClick}
      />
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>{viewer}</AnimatePresence>,
    document.body,
  );
});

export default ImageViewer;
