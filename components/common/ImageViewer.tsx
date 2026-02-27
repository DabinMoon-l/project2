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
 * 이미지 전체화면 뷰어 — 스와이프 + 화살표 + 키보드 지원
 * 공지 채널, 게시글, 댓글에서 공용 사용
 */
const ImageViewer = memo(function ImageViewer({
  urls, initialIndex, onClose,
}: ImageViewerProps) {
  const [idx, setIdx] = useState(initialIndex);
  const [showControls, setShowControls] = useState(true);
  const touchStartX = useRef(0);
  const touchDeltaX = useRef(0);
  const swiping = useRef(false);

  const src = urls[idx];
  const hasPrev = idx > 0;
  const hasNext = idx < urls.length - 1;

  const goPrev = useCallback(() => { if (hasPrev) setIdx(i => i - 1); }, [hasPrev]);
  const goNext = useCallback(() => { if (hasNext) setIdx(i => i + 1); }, [hasNext]);

  // 키보드 좌우
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goPrev, goNext, onClose]);

  const viewer = (
    <div
      className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center"
      onClick={onClose}
      onTouchStart={(e) => { touchStartX.current = scaleCoord(e.touches[0].clientX); touchDeltaX.current = 0; swiping.current = true; }}
      onTouchMove={(e) => { if (swiping.current) touchDeltaX.current = scaleCoord(e.touches[0].clientX) - touchStartX.current; }}
      onTouchEnd={() => {
        if (!swiping.current) return;
        swiping.current = false;
        if (touchDeltaX.current > 50) goPrev();
        else if (touchDeltaX.current < -50) goNext();
      }}
    >
      {/* 컨트롤 (닫기, 다운로드, 화살표, 카운터) */}
      <div className={`transition-opacity duration-200 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        {/* 닫기 */}
        <motion.button
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ delay: 0.15 }}
          onClick={onClose} className="absolute top-4 right-4 text-white p-2 z-10"
        >
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </motion.button>
        {/* 다운로드 */}
        <motion.a
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ delay: 0.15 }}
          href={src} target="_blank" rel="noopener noreferrer" download
          onClick={(e) => e.stopPropagation()}
          className="absolute top-4 left-4 text-white p-2 z-10"
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
      {/* 이미지 */}
      <motion.img
        key={src}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        src={src} alt="" className="max-w-[90vw] max-h-[85vh] object-contain"
        onClick={(e) => { e.stopPropagation(); setShowControls(v => !v); }}
      />
    </div>
  );

  // createPortal로 body에 렌더링 (z-index 우회)
  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>{viewer}</AnimatePresence>,
    document.body,
  );
});

export default ImageViewer;
